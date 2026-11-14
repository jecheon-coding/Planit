// 앱 상태 + 액션 + 구독 + 영속화. 뷰는 상태를 직접 바꾸지 않고 반드시 여기 액션을 호출한다.
import { load, save, SCHEMA_VERSION } from './storage.js';
import {
  DEFAULT_CATEGORIES, DEFAULT_SETTINGS, normalizeItem, itemRange,
} from './models.js';
import {
  startOfDay, addDays, addMinutes, toLocalDateStr, toLocalDateTimeStr, isSameDay, parseLocal, minutesBetween,
} from './utils/date.js';
import {
  expandOccurrences, findOccurrence, firstOccurrenceDate, countBefore, sameRecurrence, currentOccurrence, anchorOf,
} from './recurrence.js';
import { defaultReminders } from './reminders.js';

const PERSIST_DELAY = 300;
export const VIEWS = ['day', 'month', 'tasks'];
const DONE_LIMIT = 50;

function loadCategories() {
  const saved = load('categories', null);
  if (!Array.isArray(saved) || !saved.length) return structuredClone(DEFAULT_CATEGORIES);
  // 기본 카테고리가 빠져 있으면 보충
  const merged = [...saved];
  for (const def of DEFAULT_CATEGORIES) {
    if (!merged.some((c) => c.id === def.id)) merged.push({ ...def });
  }
  return merged.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function loadSettings() {
  const saved = load('settings', {}) ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    filters: { ...DEFAULT_SETTINGS.filters, ...(saved.filters ?? {}) },
  };
}

export function createStore() {
  const settings = loadSettings();
  const state = {
    items: (load('items', []) ?? []).map((i) => normalizeItem(i, settings)),
    categories: loadCategories(),
    settings,
    view: 'day',
    selectedDate: startOfDay(new Date()),
    now: new Date(),
  };

  const listeners = new Set();
  const dirty = new Set();
  let timer = null;

  // ---------- 영속화 ----------
  function persist(...keys) {
    keys.forEach((k) => dirty.add(k));
    clearTimeout(timer);
    timer = setTimeout(flush, PERSIST_DELAY);
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    for (const key of dirty) save(key, state[key]);
    dirty.clear();
  }

  function notify(keys) {
    for (const fn of listeners) fn(state, keys);
  }

  // ---------- 조회 ----------
  function isVisible(item) {
    const f = state.settings.filters;
    const known = state.categories.some((c) => c.id === item.categoryId);
    if (known && !f.categories.includes(item.categoryId)) return false;
    if (!f.types.includes(item.type)) return false;
    if (item.type === 'task' && f.hideDone && item.done) return false;
    return true;
  }

  /** [from, to) 구간과 겹치는, 필터를 통과한 항목들 (마감 없는 할일 제외, 반복은 회차로 펼침) */
  function selectItemsInRange(from, to) {
    const out = [];
    for (const item of state.items) {
      if (item.recurrence) {
        // 회차마다 완료 여부가 다르므로 필터는 회차 단위로
        for (const occ of expandOccurrences(item, from, to)) if (isVisible(occ)) out.push(occ);
        continue;
      }
      if (!isVisible(item)) continue;
      const r = itemRange(item);
      if (r && r.start < to && r.end > from) out.push(item);
    }
    return out;
  }

  const byStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

  function sortTasks(entries) {
    return entries.sort((a, b) =>
      (a.item.done - b.item.done)
      || (b.overdue - a.overdue)
      || String(a.item.due ?? '').localeCompare(String(b.item.due ?? ''))
      || a.item.title.localeCompare(b.item.title, 'ko'));
  }

  /** 하루치 데이터: 종일 일정, 시간 일정, 할일(오늘이면 지연된 할일 포함) */
  function selectDay(date) {
    const from = startOfDay(date);
    const to = addDays(from, 1);
    const inRange = selectItemsInRange(from, to);
    const allDay = inRange.filter((i) => i.type === 'event' && i.allDay).sort(byStart);
    const timed = inRange.filter((i) => i.type === 'event' && !i.allDay).sort(byStart);
    let tasks = inRange.filter((i) => i.type === 'task').map((item) => ({ item, overdue: false }));

    if (isSameDay(from, state.now)) {
      const todayStr = toLocalDateStr(from);
      const overdue = [];
      for (const i of state.items) {
        if (i.type !== 'task') continue;
        // 반복 할일은 "지금 해야 할 회차"가 오늘 이전이면 지연
        const cur = i.recurrence ? currentOccurrence(i, from) : i;
        if (cur && !cur.done && cur.due && cur.due.slice(0, 10) < todayStr && isVisible(cur)) overdue.push({ item: cur, overdue: true });
      }
      tasks = overdue.concat(tasks);
    }
    return { allDay, timed, tasks: sortTasks(tasks) };
  }

  /** 마감 없는 할일 */
  function selectSomedayTasks() {
    return sortTasks(state.items
      .filter((i) => i.type === 'task' && !i.due && isVisible(i))
      .map((item) => ({ item, overdue: false })));
  }

  /** 할일 뷰용 그룹: 지연됨 / 오늘 / 예정 / 언제든 / 완료됨 */
  function selectTaskGroups() {
    const todayStr = toLocalDateStr(state.now);
    const groups = { overdue: [], today: [], upcoming: [], someday: [], done: [] };
    const today = startOfDay(state.now);
    // 반복 할일: 지금 해야 할 회차 1개 + 최근 완료한 회차들
    const entries = [];
    for (const item of state.items) {
      if (item.type !== 'task') continue;
      if (!item.recurrence) {
        entries.push(item);
        continue;
      }
      const cur = currentOccurrence(item, today);
      if (cur) entries.push(cur);
      const doneDays = Object.keys(item.doneDates ?? {}).sort().reverse().slice(0, DONE_LIMIT);
      for (const d of doneDays) {
        const occ = findOccurrence(item, d);
        if (occ) entries.push(occ);
      }
    }
    for (const item of entries) {
      if (!isVisible(item)) continue;
      const day = item.due?.slice(0, 10);
      if (item.done) groups.done.push(item);
      else if (!day) groups.someday.push(item);
      else if (day < todayStr) groups.overdue.push(item);
      else if (day === todayStr) groups.today.push(item);
      else groups.upcoming.push(item);
    }
    const byDue = (a, b) => String(a.due).localeCompare(String(b.due)) || a.title.localeCompare(b.title, 'ko');
    groups.overdue.sort(byDue);
    groups.today.sort(byDue);
    groups.upcoming.sort(byDue);
    groups.someday.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    groups.done = groups.done
      .sort((a, b) => String(b.doneAt ?? b.updatedAt).localeCompare(String(a.doneAt ?? a.updatedAt)))
      .slice(0, DONE_LIMIT);
    return groups;
  }

  /**
   * 검색: 제목·메모·장소에 모든 단어가 들어 있는 항목 (필터와 무관하게 전체에서)
   * 반복은 원본 하나당 한 줄 — 다가오는 회차(할일은 지금 해야 할 회차), 없으면 첫 회차
   * 정렬: 오늘 이후(가까운 순) → 지난 항목(최근 순) → 날짜 없는 할일
   */
  function searchItems(query, limit = 100) {
    const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const today = startOfDay(state.now);
    const todayStr = toLocalDateStr(today);
    const found = [];
    for (const item of state.items) {
      const hay = `${item.title}\n${item.memo}\n${item.location ?? ''}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      let target = item;
      if (item.recurrence) {
        target = (item.type === 'task' ? currentOccurrence(item, today) : expandOccurrences(item, today, addDays(today, 800))[0])
          ?? findOccurrence(item, firstOccurrenceDate(item) ?? anchorOf(item));
        if (!target) continue;
      }
      found.push(target);
    }
    const rank = (i) => {
      const d = anchorOf(i);
      if (!d) return [2, ''];
      return d >= todayStr ? [0, d] : [1, d];
    };
    return found.sort((a, b) => {
      const [ra, da] = rank(a);
      const [rb, db] = rank(b);
      if (ra !== rb) return ra - rb;
      if (da !== db) return ra === 1 ? db.localeCompare(da) : da.localeCompare(db);
      return String(a.start ?? a.due ?? '').localeCompare(String(b.start ?? b.due ?? '')) || a.title.localeCompare(b.title, 'ko');
    }).slice(0, limit);
  }

  /** 회차 id는 "원본id::YYYY-MM-DD" */
  function splitOccurrenceId(id) {
    const i = String(id).indexOf('::');
    return i === -1 ? null : { seriesId: id.slice(0, i), date: id.slice(i + 2) };
  }

  function getItem(id) {
    const occ = splitOccurrenceId(id);
    if (!occ) return state.items.find((i) => i.id === id) ?? null;
    const series = state.items.find((i) => i.id === occ.seriesId);
    return series?.recurrence ? findOccurrence(series, occ.date) : null;
  }

  // ---------- 액션 ----------
  function addItem(partial) {
    const item = normalizeItem(partial, { ...state.settings, defaultDate: state.selectedDate });
    // 알림을 따로 정하지 않았으면 설정의 기본 알림 (빠른 입력 등)
    if (partial.reminders === undefined) item.reminders = defaultReminders(item, state.settings);
    state.items = [...state.items, item];
    persist('items');
    notify(['items']);
    return item;
  }

  function updateItem(id, patch) {
    const idx = state.items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const prev = state.items[idx];
    const next = normalizeItem(
      { ...prev, ...patch, id, createdAt: prev.createdAt, updatedAt: new Date().toISOString() },
      { ...state.settings, defaultDate: state.selectedDate },
    );
    state.items = state.items.with(idx, next);
    persist('items');
    notify(['items']);
    return next;
  }

  /** 삭제 후 실행 취소용 스냅샷 반환 */
  function deleteItem(id) {
    const index = state.items.findIndex((i) => i.id === id);
    if (index === -1) return null;
    const item = state.items[index];
    state.items = state.items.toSpliced(index, 1);
    persist('items');
    notify(['items']);
    return { item, index };
  }

  function restoreItem(snapshot) {
    if (!snapshot || getItem(snapshot.item.id)) return;
    state.items = state.items.toSpliced(Math.min(snapshot.index, state.items.length), 0, snapshot.item);
    persist('items');
    notify(['items']);
  }

  // ---------- 반복 일정: 회차 단위 수정/삭제 ----------
  // 모두 실행 전 items 스냅샷을 돌려주므로 restoreSnapshot()으로 실행 취소할 수 있다.
  const normOpts = () => ({ ...state.settings, defaultDate: state.selectedDate });
  const nowIso = () => new Date().toISOString();

  function commitItems(next) {
    const snapshot = state.items;
    state.items = next;
    persist('items');
    notify(['items']);
    return snapshot;
  }

  function restoreSnapshot(snapshot) {
    if (!Array.isArray(snapshot)) return;
    commitItems(snapshot);
  }

  const dayBefore = (dateStr) => toLocalDateStr(addDays(parseLocal(dateStr), -1));

  /** 원본 반복을 dateStr 전날에서 끝낸 규칙 (count는 until로 바꾼다) */
  function endBefore(rec, dateStr) {
    const { count, ...rest } = rec;
    return { ...rest, until: dayBefore(dateStr) };
  }

  const shiftDate = (dateStr, n) => toLocalDateStr(addDays(parseLocal(dateStr), n));

  /** 할일 회차 완료 기록 { 날짜: 완료시각 } 에서 한 날짜를 켜고/끈 사본 */
  function withDone(doneDates, dateStr, done) {
    const next = { ...(doneDates ?? {}) };
    if (done) next[dateStr] = next[dateStr] ?? nowIso();
    else delete next[dateStr];
    return next;
  }

  const pickDone = (doneDates, keep) => Object.fromEntries(Object.entries(doneDates ?? {}).filter(([d]) => keep(d)));

  /**
   * 회차 수정 (일정·할일 공통)
   * @param {string} occId "원본id::날짜"
   * @param {object} patch 수정 창에서 모은 값 (start/end 또는 due는 그 회차 기준)
   * @param {'this'|'following'|'all'} scope
   * @returns {{ item: object, snapshot: object[] } | null}
   */
  function updateOccurrence(occId, patch, scope) {
    const ids = splitOccurrenceId(occId);
    const occ = ids && getItem(occId);
    const series = ids && state.items.find((i) => i.id === ids.seriesId);
    if (!occ || !series) return null;
    const { date } = ids;
    const merged = { ...occ, ...patch };
    const toTask = merged.type === 'task';
    let next;
    let result;

    if (scope === 'this') {
      // 이 회차만: 원본에서 제외하고, 바뀐 내용으로 독립 항목 생성 (완료 여부도 그대로)
      result = normalizeItem({
        ...merged, id: undefined, recurrence: null, exdates: undefined, doneDates: undefined,
        recurringId: series.id, originalDate: date, createdAt: undefined, updatedAt: undefined,
      }, normOpts());
      next = state.items.map((i) => (i.id === series.id ? {
        ...i,
        exdates: [...new Set([...i.exdates, date])].sort(),
        ...(i.doneDates ? { doneDates: withDone(i.doneDates, date, false) } : {}),
        updatedAt: nowIso(),
      } : i)).concat(result);
    } else if (scope === 'following' && date !== firstOccurrenceDate(series)) {
      // 이 회차 및 향후: 원본은 전날에서 끝내고, 이 회차부터 새 반복을 만든다
      const recChanged = patch.recurrence !== undefined && !sameRecurrence(patch.recurrence, series.recurrence);
      let rec = recChanged ? patch.recurrence : series.recurrence;
      // 규칙을 그대로 두고 나눈 경우 "N회"는 남은 횟수만 새 반복으로 넘긴다
      if (!recChanged && rec?.count) rec = { ...rec, count: Math.max(1, rec.count - countBefore(series, date)) };
      const doneDates = toTask
        ? withDone(pickDone(series.doneDates, (d) => d > date), anchorOf(merged), merged.done)
        : undefined;
      result = normalizeItem({
        ...merged, id: undefined, recurrence: rec, exdates: series.exdates.filter((x) => x > date), doneDates,
        recurringId: undefined, originalDate: undefined, createdAt: undefined, updatedAt: undefined,
      }, normOpts());
      next = state.items.map((i) => (i.id === series.id ? {
        ...i,
        recurrence: endBefore(i.recurrence, date),
        ...(i.doneDates ? { doneDates: pickDone(i.doneDates, (d) => d < date) } : {}),
        updatedAt: nowIso(),
      } : i)).concat(result);
    } else {
      // 모든 회차: 이 회차에서 바꾼 날짜·시각만큼 원본 전체를 옮긴다 (제외/완료 날짜도 같이 이동)
      const shiftDays = Math.round((parseLocal(anchorOf(merged)) - parseLocal(date)) / 86_400_000);
      const anchorDay = shiftDate(anchorOf(series), shiftDays);
      const fields = {};
      if (toTask) {
        fields.due = merged.due && merged.due.length > 10 ? `${anchorDay}${merged.due.slice(10)}` : anchorDay;
        const shifted = Object.fromEntries(Object.entries(series.doneDates ?? {}).map(([d, at]) => [shiftDate(d, shiftDays), at]));
        fields.doneDates = withDone(shifted, shiftDate(date, shiftDays), merged.done);
      } else if (merged.allDay) {
        const span = Math.round((parseLocal(merged.end.slice(0, 10)) - parseLocal(merged.start.slice(0, 10))) / 86_400_000);
        fields.start = anchorDay;
        fields.end = shiftDate(anchorDay, span);
      } else {
        const s = parseLocal(`${anchorDay}T${merged.start.slice(11, 16)}`);
        fields.start = toLocalDateTimeStr(s);
        fields.end = toLocalDateTimeStr(addMinutes(s, minutesBetween(parseLocal(merged.start), parseLocal(merged.end))));
      }
      result = normalizeItem({
        ...series, ...patch, ...fields, id: series.id,
        recurrence: patch.recurrence !== undefined ? patch.recurrence : series.recurrence,
        exdates: series.exdates.map((d) => shiftDate(d, shiftDays)),
        createdAt: series.createdAt, updatedAt: nowIso(),
      }, normOpts());
      next = state.items.map((i) => (i.id === series.id ? result : i));
    }

    const snapshot = commitItems(next);
    return { item: result, snapshot };
  }

  /** 반복 할일 회차의 완료 표시 */
  function setOccurrenceDone(occId, done) {
    const ids = splitOccurrenceId(occId);
    const series = ids && state.items.find((i) => i.id === ids.seriesId);
    if (!series || series.type !== 'task') return;
    commitItems(state.items.map((i) => (i.id === series.id
      ? { ...i, doneDates: withDone(i.doneDates, ids.date, done), updatedAt: nowIso() } : i)));
  }

  /** 회차 삭제 — 실행 취소용 스냅샷 반환 */
  function deleteOccurrence(occId, scope) {
    const ids = splitOccurrenceId(occId);
    const series = ids && state.items.find((i) => i.id === ids.seriesId);
    if (!series) return null;
    const { date } = ids;
    let next;
    if (scope === 'this') {
      next = state.items.map((i) => (i.id === series.id
        ? { ...i, exdates: [...new Set([...i.exdates, date])].sort(), updatedAt: nowIso() } : i));
    } else if (scope === 'following' && date !== firstOccurrenceDate(series)) {
      next = state.items.map((i) => (i.id === series.id
        ? { ...i, recurrence: endBefore(i.recurrence, date), updatedAt: nowIso() } : i));
    } else {
      // 모든 일정: 원본 + "이 일정만" 수정해 둔 회차까지 삭제
      next = state.items.filter((i) => i.id !== series.id && i.recurringId !== series.id);
    }
    return commitItems(next);
  }

  function toggleTask(id) {
    const item = getItem(id);
    if (!item || item.type !== 'task') return;
    if (item.seriesId) {
      setOccurrenceDone(id, !item.done); // 반복 할일: 그 회차만 완료/해제 → 다음 회차가 나타남
      return;
    }
    updateItem(id, { done: !item.done, doneAt: item.done ? null : new Date().toISOString() });
  }

  function setView(view) {
    if (!VIEWS.includes(view)) return;
    if (state.view === view) return;
    state.view = view;
    notify(['view']);
  }

  function setSelectedDate(date) {
    const d = startOfDay(date);
    if (isSameDay(d, state.selectedDate)) return;
    state.selectedDate = d;
    notify(['selectedDate']);
  }

  function setFilter(patch) {
    state.settings = { ...state.settings, filters: { ...state.settings.filters, ...patch } };
    persist('settings');
    notify(['settings']);
  }

  function toggleInFilter(key, value) {
    const list = state.settings.filters[key];
    setFilter({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  }

  function updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    persist('settings');
    notify(['settings']);
  }

  function updateCategory(id, patch) {
    state.categories = state.categories.map((c) => (c.id === id ? { ...c, ...patch } : c));
    persist('categories');
    notify(['categories']);
  }

  /** 1분마다 호출 — 날짜가 바뀌었으면 'today'도 알린다 */
  function tick() {
    const now = new Date();
    const dayChanged = !isSameDay(now, state.now);
    state.now = now;
    notify(dayChanged ? ['now', 'today'] : ['now']);
  }

  function exportData() {
    flush();
    return {
      app: 'planit',
      schema: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      items: state.items,
      categories: state.categories,
      settings: state.settings,
    };
  }

  function importData(data) {
    if (!data || data.app !== 'planit' || !Array.isArray(data.items)) {
      throw new Error('Planit 백업 파일이 아닙니다.');
    }
    state.items = data.items.map((i) => normalizeItem(i, state.settings));
    if (Array.isArray(data.categories) && data.categories.length) state.categories = data.categories;
    if (data.settings) {
      state.settings = {
        ...DEFAULT_SETTINGS,
        ...data.settings,
        filters: { ...DEFAULT_SETTINGS.filters, ...(data.settings.filters ?? {}) },
      };
    }
    persist('items', 'categories', 'settings');
    notify(['*']);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // 탭을 닫기 직전 대기 중인 저장을 즉시 기록
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  return {
    getState: () => state,
    getItem,
    isVisible,
    selectItemsInRange,
    selectDay,
    selectSomedayTasks,
    selectTaskGroups,
    searchItems,
    addItem,
    updateItem,
    deleteItem,
    restoreItem,
    updateOccurrence,
    deleteOccurrence,
    setOccurrenceDone,
    restoreSnapshot,
    toggleTask,
    setView,
    setSelectedDate,
    setFilter,
    toggleInFilter,
    updateSettings,
    updateCategory,
    tick,
    exportData,
    importData,
    subscribe,
    flush,
  };
}
