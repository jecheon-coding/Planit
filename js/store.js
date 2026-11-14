// 앱 상태 + 액션 + 구독 + 영속화. 뷰는 상태를 직접 바꾸지 않고 반드시 여기 액션을 호출한다.
import { load, save, SCHEMA_VERSION } from './storage.js';
import {
  DEFAULT_CATEGORIES, DEFAULT_SETTINGS, normalizeItem, itemRange,
} from './models.js';
import {
  startOfDay, addDays, toLocalDateStr, isSameDay,
} from './utils/date.js';

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

  /** [from, to) 구간과 겹치는, 필터를 통과한 항목들 (마감 없는 할일 제외) */
  function selectItemsInRange(from, to) {
    return state.items.filter((item) => {
      if (!isVisible(item)) return false;
      const r = itemRange(item);
      return r && r.start < to && r.end > from;
    });
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
      const overdue = state.items
        .filter((i) => i.type === 'task' && !i.done && i.due && i.due.slice(0, 10) < todayStr && isVisible(i))
        .map((item) => ({ item, overdue: true }));
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
    for (const item of state.items) {
      if (item.type !== 'task' || !isVisible(item)) continue;
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

  const getItem = (id) => state.items.find((i) => i.id === id) ?? null;

  // ---------- 액션 ----------
  function addItem(partial) {
    const item = normalizeItem(partial, { ...state.settings, defaultDate: state.selectedDate });
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

  function toggleTask(id) {
    const item = getItem(id);
    if (!item || item.type !== 'task') return;
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
    addItem,
    updateItem,
    deleteItem,
    restoreItem,
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
