// 알림(리마인더) 계산 — DOM 없이 동작하는 순수 함수 (Node 테스트 가능)
//
// 저장 형식: item.reminders = [분, ...]   알림 시각 = 기준 시각 − 분
//   기준 시각: 시간 일정은 시작, 마감 시각이 있는 할일은 마감,
//             종일 일정·날짜만 있는 할일은 그날 0시
//   → 종일의 "당일 오전 9시" = −540, "1일 전 오전 9시" = 900 (= 1440 − 540)
// 네이버 캘린더처럼 한 항목에 알림을 여러 개(최대 5개) 둘 수 있다.
import { parseLocal, addMinutes, toLocalDateTimeStr } from './utils/date.js';
import { expandOccurrences } from './recurrence.js';

export const MAX_REMINDERS = 5;
/** 알림을 앞당길 수 있는 최대 시간 (4주) */
export const MAX_LEAD_MIN = 4 * 7 * 1440;
const MIN_LEAD_MIN = -1439; // 종일: 당일 오후 11:59까지

/** 수정 창 보기 — 시간이 있는 항목 */
export const TIMED_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
/** 수정 창 보기 — 종일 일정 / 날짜만 있는 할일 (모두 오전 9시) */
export const DATE_OPTIONS = [-540, 900, 2340, 9540];

/** 날짜만 있는 항목인가 (종일 일정, 마감 시각 없는 할일) */
export function isDateOnly(item) {
  if (item.type === 'task') return !(item.due && item.due.length > 10);
  return !!item.allDay;
}

/** 알림 기준 시각. 마감 없는 할일은 null */
export function reminderBase(item) {
  const s = item.type === 'task' ? item.due : item.start;
  if (!s) return null;
  return parseLocal(isDateOnly(item) ? s.slice(0, 10) : s);
}

export function normalizeReminders(raw) {
  if (!Array.isArray(raw)) return [];
  const list = raw.map(Number).filter((n) => Number.isInteger(n) && n >= MIN_LEAD_MIN && n <= MAX_LEAD_MIN);
  return [...new Set(list)].sort((a, b) => a - b).slice(0, MAX_REMINDERS);
}

function clockKo(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h < 12 ? '오전' : '오후'} ${h12}시${m ? ` ${m}분` : ''}`;
}

function amountKo(min) {
  if (min % 10080 === 0) return `${min / 10080}주`;
  if (min % 1440 === 0) return `${min / 1440}일`;
  if (min % 60 === 0) return `${min / 60}시간`;
  if (min > 60) return `${Math.floor(min / 60)}시간 ${min % 60}분`;
  return `${min}분`;
}

/** "10분 전", "정시", "1일 전 오전 9시", "당일 오전 9시" */
export function describeReminder(min, dateOnly) {
  if (dateOnly) {
    const days = Math.max(0, Math.ceil(min / 1440));
    const at = days * 1440 - min; // 그날 0시부터 몇 분 뒤
    const day = days === 0 ? '당일' : days % 7 === 0 ? `${days / 7}주 전` : `${days}일 전`;
    return `${day} ${clockKo(at)}`;
  }
  if (min === 0) return '정시';
  return min < 0 ? `${amountKo(-min)} 후` : `${amountKo(min)} 전`;
}

/**
 * 시간 ↔ 종일 전환 시 알림을 비슷한 뜻으로 바꾼다.
 *  시간 → 종일: 하루 미만이면 "당일 오전 9시", N일 전이면 "N일 전 오전 9시"
 *  종일 → 시간: "당일"이면 fallback(기본 10분 전), N일 전이면 "N일 전"
 */
export function convertReminders(list, toDateOnly, fallbackTimed = 10) {
  return normalizeReminders(list.map((m) => {
    if (toDateOnly) {
      const days = Math.floor(m / 1440);
      return days <= 0 ? -540 : days * 1440 - 540;
    }
    const days = Math.max(0, Math.ceil(m / 1440));
    return days === 0 ? fallbackTimed : days * 1440;
  }));
}

/** 새 항목의 기본 알림 (설정값). 할일은 기본 알림 없음 */
export function defaultReminders(item, settings = {}) {
  if (item.type === 'task') return [];
  const v = isDateOnly(item) ? settings.defaultAllDayReminder : settings.defaultEventReminder;
  return v == null || v === '' ? [] : normalizeReminders([Number(v)]);
}

/**
 * 알림 하나하나에 대해 cb({ key, item, minutes, fireAt, base }) 호출.
 * 반복 항목은 [from, to) 사이 회차로 펼친다. 완료한 할일은 제외.
 */
function eachReminder(items, from, to, cb) {
  for (const item of items) {
    if (!item.reminders?.length) continue;
    const list = item.recurrence ? expandOccurrences(item, from, to) : [item];
    for (const occ of list) {
      if (occ.type === 'task' && occ.done) continue;
      const base = reminderBase(occ);
      if (!base) continue;
      for (const minutes of occ.reminders) {
        cb({
          // 시각을 바꾸면 키도 바뀌므로 다시 울린다
          key: `${occ.id}|${minutes}|${toLocalDateTimeStr(base)}`,
          item: occ,
          minutes,
          fireAt: addMinutes(base, -minutes),
          base,
        });
      }
    }
  }
}

/** (from, to] 사이에 울려야 하는 알림 (시각순) */
export function dueReminders(items, from, to) {
  const out = [];
  eachReminder(items, addMinutes(from, MIN_LEAD_MIN - 1), addMinutes(to, MAX_LEAD_MIN + 1440), (r) => {
    if (r.fireAt > from && r.fireAt <= to) out.push(r);
  });
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

/** after 이후 horizonMin 안에 가장 먼저 울릴 알림 시각 (없으면 null) */
export function nextReminderAt(items, after, horizonMin = 2 * 1440) {
  const limit = addMinutes(after, horizonMin);
  let best = null;
  eachReminder(items, addMinutes(after, MIN_LEAD_MIN - 1), addMinutes(limit, MAX_LEAD_MIN + 1440), (r) => {
    if (r.fireAt > after && r.fireAt <= limit && (!best || r.fireAt < best)) best = r.fireAt;
  });
  return best;
}

/** 알림 배너·시스템 알림에 쓰는 "10분 후 시작", "지금 시작", "마감 1시간 전" */
export function leadText(r, now = new Date()) {
  const isTask = r.item.type === 'task';
  const diff = Math.round((r.base - now) / 60_000);
  if (isDateOnly(r.item)) {
    const days = Math.round((r.base - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
    const when = days === 0 ? '오늘' : days === 1 ? '내일' : days > 1 ? `${days}일 후` : '지난';
    return isTask ? `${when} 마감` : `${when} 일정`;
  }
  if (diff <= 0) return isTask ? (diff > -1 ? '지금 마감' : '마감 시각 지남') : (diff > -1 ? '지금 시작' : '진행 중');
  return isTask ? `마감 ${amountKo(diff)} 전` : `${amountKo(diff)} 후 시작`;
}
