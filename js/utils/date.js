// 날짜 유틸리티 — 모두 로컬 시간 기준의 순수 함수이며 입력 Date를 변경하지 않는다.
// 주의: new Date("YYYY-MM-DD")는 UTC로 해석되므로 사용하지 말고 parseLocal()을 쓴다.

export const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
export const MS_PER_MIN = 60_000;

export const pad = (n) => String(n).padStart(2, '0');

/** Date → "YYYY-MM-DD" */
export function toLocalDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date → "YYYY-MM-DDTHH:mm" */
export function toLocalDateTimeStr(d) {
  return `${toLocalDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD" | "YYYY-MM-DDTHH:mm" → Date (로컬). 형식이 틀리면 null */
export function parseLocal(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(str);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMinutes(d, n) {
  return new Date(d.getTime() + n * MS_PER_MIN);
}

/** 해당 날짜 00:00 기준으로 min분 뒤의 시각 (1440 이상이면 다음 날로 넘어감) */
export function atMinutes(day, min) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min);
}

/** 월 더하기 — 말일 보정 (1/31 + 1개월 → 2/28) */
export function addMonths(d, n) {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(d.getDate(), lastDay));
  return first;
}

export function startOfWeek(d, weekStartsOn = 0) {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() - weekStartsOn + 7) % 7));
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** 반열린 구간 [aStart, aEnd) 와 [bStart, bEnd) 가 겹치는지 (Date 또는 같은 형식의 문자열) */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function minutesBetween(a, b) {
  return Math.round((b - a) / MS_PER_MIN);
}

/** 월간 뷰용 6주 × 7일 = 42칸 날짜 배열 */
export function getMonthGrid(year, month, weekStartsOn = 0) {
  const start = startOfWeek(new Date(year, month, 1), weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * 간단한 포맷터. 토큰: YYYY, M, MM, D, DD, ddd(요일), HH, mm
 * 예) formatKo(d, 'M/D(ddd)') → "11/15(일)"
 */
export function formatKo(d, fmt) {
  const map = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    M: d.getMonth() + 1,
    DD: pad(d.getDate()),
    D: d.getDate(),
    ddd: WEEKDAYS_KO[d.getDay()],
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
  };
  return fmt.replace(/YYYY|MM|DD|ddd|HH|mm|M|D/g, (t) => map[t]);
}
