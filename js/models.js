import {
  parseLocal, toLocalDateStr, toLocalDateTimeStr, addMinutes, addDays, startOfDay,
} from './utils/date.js';
import { normalizeRecurrence } from './recurrence.js';
import { normalizeReminders } from './reminders.js';

export const MAX_ITEM_PHOTOS = 10;

export const DEFAULT_CATEGORIES = [
  { id: 'work', name: '업무', color: '#3B82F6', order: 0 },
  { id: 'personal', name: '개인', color: '#10B981', order: 1 },
  { id: 'study', name: '학습', color: '#F59E0B', order: 2 },
];

export const DEFAULT_SETTINGS = {
  weekStartsOn: 0,
  defaultDurationMin: 60,
  defaultCategoryId: 'personal',
  // 알림: 새 시간 일정 기본 10분 전, 종일 일정은 기본 없음 (분 단위, null = 없음)
  defaultEventReminder: 10,
  defaultAllDayReminder: null,
  notifications: false, // 시스템(OS) 알림 사용 — 권한을 받은 뒤 켠다
  reminderSound: true,
  showHolidays: true,
  dayStartHour: 0,
  dayEndHour: 24,
  filters: {
    categories: DEFAULT_CATEGORIES.map((c) => c.id),
    types: ['event', 'task'],
    hideDone: false,
  },
};

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** CSS 변수 이름으로 안전한 카테고리 키 */
export function categoryVar(categoryId) {
  const safe = String(categoryId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `--cat-${safe}`;
}

export function categoryColor(categoryId) {
  return `var(${categoryVar(categoryId)}, var(--muted))`;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isDateTime = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);

/**
 * 임의의 객체를 유효한 Item 형태로 정규화한다. (생성·수정·가져오기 공통)
 * 종류(type)에 맞지 않는 필드는 버린다.
 */
export function normalizeItem(raw, { defaultDurationMin = 60, defaultDate = new Date() } = {}) {
  const nowIso = new Date().toISOString();
  const type = raw.type === 'task' ? 'task' : 'event';
  const base = {
    id: raw.id || uid(),
    type,
    title: String(raw.title ?? '').trim() || (type === 'task' ? '새 할일' : '새 일정'),
    categoryId: raw.categoryId || DEFAULT_SETTINGS.defaultCategoryId,
    memo: String(raw.memo ?? ''),
    location: String(raw.location ?? '').trim().slice(0, 200),
    reminders: normalizeReminders(raw.reminders),
    photos: Array.isArray(raw.photos)
      ? [...new Set(raw.photos.filter((p) => typeof p === 'string' && p))].slice(0, MAX_ITEM_PHOTOS)
      : [],
    createdAt: raw.createdAt || nowIso,
    updatedAt: raw.updatedAt || nowIso,
  };

  // 반복: 원본에는 recurrence/exdates(+할일은 doneDates), "이 회차만" 수정한 항목에는 recurringId/originalDate
  const extra = {};
  const recurrence = normalizeRecurrence(raw.recurrence);
  if (recurrence) {
    extra.recurrence = recurrence;
    extra.exdates = Array.isArray(raw.exdates) ? [...new Set(raw.exdates.filter(isDate))].sort() : [];
  }
  if (raw.recurringId) {
    extra.recurringId = String(raw.recurringId);
    extra.originalDate = isDate(raw.originalDate) ? raw.originalDate : null;
  }

  if (type === 'task') {
    let due = isDate(raw.due) || isDateTime(raw.due) ? raw.due : null;
    if (recurrence) {
      // 반복 할일은 기준 날짜(마감일)가 꼭 필요 — 없으면 오늘(기본 날짜)
      if (!due) due = toLocalDateStr(defaultDate);
      // 회차별 완료 기록 { "YYYY-MM-DD": 완료 시각 }. 원본 자체의 done은 쓰지 않는다
      const doneDates = {};
      for (const [d, at] of Object.entries(raw.doneDates ?? {})) if (isDate(d)) doneDates[d] = String(at || nowIso);
      return { ...base, due, done: false, doneAt: null, ...extra, doneDates };
    }
    return { ...base, due, done: !!raw.done, doneAt: raw.done ? (raw.doneAt || nowIso) : null, ...extra };
  }

  const allDay = !!raw.allDay;
  if (allDay) {
    const start = (raw.start && String(raw.start).slice(0, 10)) || toLocalDateStr(defaultDate);
    let end = (raw.end && String(raw.end).slice(0, 10)) || start;
    if (end < start) end = start;
    return { ...base, start, end, allDay: true, ...extra };
  }

  let start = raw.start;
  if (isDate(start)) start = `${start}T09:00`;
  if (!isDateTime(start)) start = `${toLocalDateStr(defaultDate)}T09:00`;
  let end = raw.end;
  if (isDate(end)) end = `${end}T${start.slice(11)}`;
  if (!isDateTime(end) || end <= start) {
    end = toLocalDateTimeStr(addMinutes(parseLocal(start), defaultDurationMin));
  }
  return { ...base, start, end, allDay: false, ...extra };
}

/** 저장 전 검증. 문제가 있으면 메시지 배열 반환 */
export function validateItem(item) {
  const errors = [];
  if (!item.title?.trim()) errors.push('제목을 입력하세요.');
  if (item.type === 'event') {
    if (item.allDay) {
      if (!isDate(item.start)) errors.push('시작 날짜를 입력하세요.');
      else if (!isDate(item.end) || item.end < item.start) errors.push('종료 날짜는 시작 날짜와 같거나 이후여야 합니다.');
    } else {
      if (!isDateTime(item.start)) errors.push('시작 일시를 입력하세요.');
      else if (!isDateTime(item.end) || item.end <= item.start) errors.push('종료 시각은 시작 시각보다 늦어야 합니다.');
    }
  } else if (item.due != null && !isDate(item.due) && !isDateTime(item.due)) {
    errors.push('마감일 형식이 올바르지 않습니다.');
  }
  // 반복 (일정·할일 공통): 기준 날짜는 일정 시작일 / 할일 마감일
  const rec = item.recurrence;
  if (rec) {
    const anchor = String((item.type === 'task' ? item.due : item.start) ?? '').slice(0, 10);
    if (item.type === 'task' && !anchor) errors.push('반복하려면 마감일을 입력하세요.');
    if (rec.until && anchor && rec.until < anchor) {
      errors.push(`반복 종료일은 ${item.type === 'task' ? '마감일' : '시작일'}과 같거나 이후여야 합니다.`);
    }
    if (rec.freq === 'weekly' && Array.isArray(rec.byDay) && !rec.byDay.length) errors.push('반복할 요일을 하나 이상 고르세요.');
  }
  return errors;
}

/** 항목이 차지하는 시간 구간 [start, end) — 범위 조회용. 마감 없는 할일은 null */
export function itemRange(item) {
  if (item.type === 'task') {
    const d = item.due ? parseLocal(item.due.slice(0, 10)) : null;
    return d ? { start: d, end: addDays(d, 1) } : null;
  }
  if (item.allDay) {
    const s = parseLocal(item.start);
    const e = parseLocal(item.end);
    return s && e ? { start: s, end: addDays(e, 1) } : null;
  }
  const s = parseLocal(item.start);
  const e = parseLocal(item.end);
  return s && e ? { start: s, end: e } : null;
}

/** 항목이 걸쳐 있는 각 날짜("YYYY-MM-DD")에 대해 cb 호출 ([from, to) 범위로 제한) */
export function eachItemDay(item, from, to, cb) {
  const r = itemRange(item);
  if (!r) return;
  const last = r.end < to ? r.end : to;
  const startStr = toLocalDateStr(r.start);
  let d = startOfDay(r.start < from ? from : r.start);
  while (d < last) {
    const ds = toLocalDateStr(d);
    cb(ds, { isStart: ds === startStr });
    d = addDays(d, 1);
  }
}
