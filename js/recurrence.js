// 일정 반복 — iCalendar RRULE의 일부를 따르는 순수 함수 모음.
//
// 반복 일정은 "원본(series) 1개"만 저장하고, 화면에 필요한 기간만 회차(occurrence)로 펼친다.
//   recurrence: {
//     freq: 'daily' | 'weekly' | 'monthly' | 'yearly',
//     interval: 1~99,                 // N일/주/개월/년마다
//     byDay?: number[],               // weekly 전용, 0=일 … 6=토 (없으면 시작일 요일)
//     bySetPos?: 1|2|3|4|-1,          // monthly 전용, "N번째(-1=마지막) 시작일 요일" (없으면 매월 시작일과 같은 날짜)
//     until?: 'YYYY-MM-DD',           // 이 날짜까지 (포함)
//     count?: number,                 // N회 (until과 동시에 쓰지 않음)
//   }
//   exdates: ['YYYY-MM-DD']           // 제외된 회차 날짜 ("이 일정만" 삭제/수정)
//
// 기준(anchor)은 원본의 시작일: 매월 N일·N번째 요일·매년 날짜는 모두 시작일에서 정해진다 (Google Calendar와 동일).
// 31일 반복은 31일이 없는 달을, 2월 29일 매년 반복은 평년을 건너뛴다.
import {
  parseLocal, toLocalDateStr, toLocalDateTimeStr, addDays, addMinutes, startOfWeek, minutesBetween, formatKo,
} from './utils/date.js';

export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const NTH_LABEL = { 1: '첫째', 2: '둘째', 3: '셋째', 4: '넷째', '-1': '마지막' };
const DAY_MS = 86_400_000;

const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);
const mondayIndex = (wd) => (wd + 6) % 7; // 월=0 … 일=6
/** 반복 기준 날짜 "YYYY-MM-DD": 일정은 시작일, 할일은 마감일 */
export const anchorOf = (item) => String((item.type === 'task' ? item.due : item.start) ?? '').slice(0, 10);

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

/** 해당 월(mIndex는 넘쳐도 됨)의 day일. 없는 날이면 null */
function makeDate(y, mIndex, day) {
  const first = new Date(y, mIndex, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return day <= last ? new Date(first.getFullYear(), first.getMonth(), day) : null;
}

/** 해당 월의 pos번째(-1=마지막) wd요일 */
export function nthWeekday(y, mIndex, wd, pos) {
  const first = new Date(y, mIndex, 1);
  if (pos === -1) {
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return addDays(last, -((last.getDay() - wd + 7) % 7));
  }
  const d = addDays(first, ((wd - first.getDay() + 7) % 7) + (pos - 1) * 7);
  return d.getMonth() === first.getMonth() ? d : null;
}

/** 날짜가 그 달의 몇 번째 요일인지 (1~5)와 마지막 주 여부 */
export function weekdayPosition(date) {
  return { nth: Math.ceil(date.getDate() / 7), isLast: addDays(date, 7).getMonth() !== date.getMonth() };
}

/** 저장 전 정규화. 잘못된 값이면 null(반복 안 함) */
export function normalizeRecurrence(raw) {
  if (!raw || !FREQS.includes(raw.freq)) return null;
  const rec = { freq: raw.freq, interval: clampInt(raw.interval ?? 1, 1, 99) ?? 1 };
  if (rec.freq === 'weekly' && Array.isArray(raw.byDay)) {
    const days = [...new Set(raw.byDay.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
      .sort((a, b) => mondayIndex(a) - mondayIndex(b));
    if (days.length) rec.byDay = days;
  }
  if (rec.freq === 'monthly' && [1, 2, 3, 4, -1].includes(Number(raw.bySetPos))) rec.bySetPos = Number(raw.bySetPos);
  if (isDateStr(raw.until)) rec.until = raw.until;
  else if (raw.count != null && raw.count !== '') {
    const count = clampInt(raw.count, 1, 999);
    if (count) rec.count = count;
  }
  return rec;
}

export function sameRecurrence(a, b) {
  const x = normalizeRecurrence(a);
  const y = normalizeRecurrence(b);
  return JSON.stringify(x) === JSON.stringify(y);
}

/**
 * 반복 규칙이 만드는 회차 날짜(00:00)를 시간순으로 무한히 생성.
 * hint: 이 날짜 근처부터 시작해도 되는 경우(count가 없을 때) 앞부분을 건너뛰어 빠르게 계산
 */
function* occurrenceDates(series, hint = null) {
  const rec = series.recurrence;
  const start = parseLocal(anchorOf(series));
  const { interval } = rec;
  const skip = hint && !rec.count && hint > start;

  switch (rec.freq) {
    case 'daily': {
      const k0 = skip ? Math.floor(daysBetween(start, hint) / interval) : 0;
      for (let k = k0; ; k += 1) yield addDays(start, k * interval);
    }
    case 'weekly': {
      const days = rec.byDay ?? [start.getDay()];
      const weekStart = startOfWeek(start, 1); // RRULE 기본 WKST=MO
      const w0 = skip ? Math.floor(daysBetween(weekStart, hint) / 7 / interval) * interval : 0;
      for (let w = w0; ; w += interval) {
        for (const d of days) {
          const date = addDays(weekStart, w * 7 + mondayIndex(d));
          if (date >= start) yield date;
        }
      }
    }
    case 'monthly': {
      const months = skip
        ? (hint.getFullYear() - start.getFullYear()) * 12 + hint.getMonth() - start.getMonth() - 1
        : 0;
      const k0 = Math.max(0, Math.floor(months / interval) * interval);
      for (let k = k0; k < k0 + 12 * 1000; k += interval) {
        const y = start.getFullYear();
        const m = start.getMonth() + k;
        const date = rec.bySetPos != null ? nthWeekday(y, m, start.getDay(), rec.bySetPos) : makeDate(y, m, start.getDate());
        if (date && date >= start) yield date;
      }
      return;
    }
    case 'yearly': {
      const k0 = skip ? Math.max(0, Math.floor((hint.getFullYear() - start.getFullYear() - 1) / interval) * interval) : 0;
      for (let k = k0; k < k0 + 4000; k += interval) {
        const date = makeDate(start.getFullYear() + k, start.getMonth(), start.getDate());
        if (date) yield date;
      }
      return;
    }
    default:
  }
}

/** 날짜 단위로 다루는 항목인지 (종일 일정, 할일) */
const isDayBased = (series) => series.type === 'task' || series.allDay;

/** 원본 시작~종료의 길이: 시간 일정은 분, 종일 일정은 일(0 = 하루짜리), 할일은 0 */
function spanOf(series) {
  if (series.type === 'task') return 0;
  return series.allDay
    ? daysBetween(parseLocal(series.start.slice(0, 10)), parseLocal(series.end.slice(0, 10)))
    : minutesBetween(parseLocal(series.start), parseLocal(series.end));
}

/** 원본에서 특정 날짜의 회차 객체를 만든다 (검증 없이) */
export function makeOccurrence(series, dateStr) {
  const base = { ...series, id: `${series.id}::${dateStr}`, seriesId: series.id, occurrenceDate: dateStr };
  if (series.type === 'task') {
    // 할일 회차: 마감일을 그 날짜로, 완료 여부는 원본의 doneDates에서
    const time = series.due.length > 10 ? series.due.slice(10) : '';
    const doneAt = series.doneDates?.[dateStr] ?? null;
    return { ...base, due: `${dateStr}${time}`, done: !!doneAt, doneAt };
  }
  const span = spanOf(series);
  let start;
  let end;
  if (series.allDay) {
    start = dateStr;
    end = toLocalDateStr(addDays(parseLocal(dateStr), span));
  } else {
    const s = parseLocal(`${dateStr}T${series.start.slice(11, 16)}`);
    start = toLocalDateTimeStr(s);
    end = toLocalDateTimeStr(addMinutes(s, span));
  }
  return { ...base, start, end };
}

/** 회차의 [시작, 끝) — 겹침 판정용 */
function occurrenceRange(occ) {
  if (occ.type === 'task') {
    const d = parseLocal(occ.due.slice(0, 10));
    return { start: d, end: addDays(d, 1) };
  }
  if (occ.allDay) return { start: parseLocal(occ.start), end: addDays(parseLocal(occ.end), 1) };
  return { start: parseLocal(occ.start), end: parseLocal(occ.end) };
}

/**
 * [from, to) 구간과 겹치는 회차들 (제외 날짜 반영)
 * @returns {Array<object>} makeOccurrence() 결과 배열
 */
export function expandOccurrences(series, from, to) {
  const rec = series.recurrence;
  if (!rec) return [];
  const span = spanOf(series);
  // 여러 날에 걸친 회차가 from 이전에 시작해도 잡히도록 여유를 둔다
  const lookBack = isDayBased(series) ? addDays(from, -span - 1) : addMinutes(from, -span - 1440);
  const until = rec.until ? parseLocal(rec.until) : null;
  const excluded = new Set(series.exdates ?? []);
  const out = [];
  let n = 0;
  for (const date of occurrenceDates(series, lookBack)) {
    if (until && date > until) break;
    n += 1;
    if (rec.count && n > rec.count) break;
    if (date >= to) break;
    if (date < lookBack) continue;
    const dateStr = toLocalDateStr(date);
    if (excluded.has(dateStr)) continue;
    const occ = makeOccurrence(series, dateStr);
    const r = occurrenceRange(occ);
    if (r.start < to && r.end > from) out.push(occ);
  }
  return out;
}

/** 특정 날짜에 실제로 존재하는 회차 (없거나 제외됐으면 null) */
export function findOccurrence(series, dateStr) {
  const day = parseLocal(dateStr);
  if (!day || !series.recurrence) return null;
  return expandOccurrences(series, day, addDays(day, 1)).find((o) => o.occurrenceDate === dateStr) ?? null;
}

/**
 * 반복 할일의 "지금 해야 할 회차" (Google Tasks 방식)
 *  - 오늘(포함) 이전의 가장 최근 회차가 미완료면 그 회차 (지연 또는 오늘)
 *  - 완료했거나 없으면 오늘 이후 첫 미완료 회차
 *  - 그보다 오래된 미완료 회차는 쌓아 두지 않는다 (매일 할일을 며칠 빼먹어도 지연은 1개)
 * 반복이 끝났고 모두 완료했으면 null
 */
export function currentOccurrence(series, today) {
  const rec = series.recurrence;
  if (!rec) return null;
  const until = rec.until ? parseLocal(rec.until) : null;
  const excluded = new Set(series.exdates ?? []);
  const done = series.doneDates ?? {};
  // count가 없으면 오늘 2년 전부터만 보면 충분 (가장 최근 과거 회차를 찾기 위함)
  const hint = rec.count ? null : addDays(today, -800);
  let latest = null;
  let resolved = false;
  let n = 0;
  let guard = 0;
  for (const date of occurrenceDates(series, hint)) {
    if (until && date > until) break;
    n += 1;
    if (rec.count && n > rec.count) break;
    const ds = toLocalDateStr(date);
    if (excluded.has(ds)) continue;
    if (date <= today) {
      latest = ds;
      continue;
    }
    if (!resolved) {
      resolved = true;
      if (latest && !done[latest]) return makeOccurrence(series, latest);
    }
    if (!done[ds]) return makeOccurrence(series, ds);
    if ((guard += 1) > 5000) break;
  }
  if (!resolved && latest && !done[latest]) return makeOccurrence(series, latest);
  return null;
}

/** 규칙상 첫 회차 날짜 (제외 날짜 무시) */
export function firstOccurrenceDate(series) {
  const { value } = occurrenceDates(series).next();
  return value ? toLocalDateStr(value) : null;
}

/** dateStr 이전에 규칙이 만든 회차 수 (count 나눌 때 사용, 제외 날짜 포함) */
export function countBefore(series, dateStr) {
  let n = 0;
  for (const date of occurrenceDates(series)) {
    if (toLocalDateStr(date) >= dateStr) break;
    n += 1;
    if (n > 5000) break;
  }
  return n;
}

// ---------- 표시 ----------
function joinDays(days) {
  return days.map((d) => WD[d]).join('·');
}

/** 예) "매주 월요일", "격주 월·수·금", "매월 셋째 금요일", "매년 11월 20일 · 12/31까지" */
export function describeRecurrence(rec, startStr) {
  if (!rec) return '';
  const start = parseLocal(String(startStr).slice(0, 10));
  if (!start) return '';
  const n = rec.interval ?? 1;
  let text;
  switch (rec.freq) {
    case 'daily':
      text = n === 1 ? '매일' : `${n}일마다`;
      break;
    case 'weekly': {
      const days = rec.byDay ?? [start.getDay()];
      const isWeekdays = days.join() === '1,2,3,4,5';
      const what = days.length === 1 ? `${WD[days[0]]}요일` : joinDays(days);
      if (n === 1) text = isWeekdays ? '주중 매일' : `매주 ${what}`;
      else text = `${n === 2 ? '격주' : `${n}주마다`} ${isWeekdays ? '주중' : what}`;
      break;
    }
    case 'monthly': {
      const what = rec.bySetPos != null
        ? `${NTH_LABEL[rec.bySetPos]} ${WD[start.getDay()]}요일`
        : `${start.getDate()}일`;
      text = `${n === 1 ? '매월' : `${n}개월마다`} ${what}`;
      break;
    }
    case 'yearly':
      text = `${n === 1 ? '매년' : `${n}년마다`} ${start.getMonth() + 1}월 ${start.getDate()}일`;
      break;
    default:
      return '';
  }
  if (rec.until) {
    const u = parseLocal(rec.until);
    text += ` · ${formatKo(u, u.getFullYear() === start.getFullYear() ? 'M/D' : 'YYYY/M/D')}까지`;
  } else if (rec.count) {
    text += ` · ${rec.count}회`;
  }
  return text;
}

/** 수정 창 "반복" 선택 상자의 보기 — 시작 날짜에 맞춰 문구가 바뀐다 */
export function recurrencePresets(startDateStr) {
  const d = parseLocal(startDateStr);
  if (!d) return [{ key: 'none', label: '반복 안 함', rec: null }];
  const wd = d.getDay();
  const { nth, isLast } = weekdayPosition(d);
  const presets = [
    { key: 'none', label: '반복 안 함', rec: null },
    { key: 'daily', label: '매일', rec: { freq: 'daily', interval: 1 } },
    { key: 'weekly', label: `매주 ${WD[wd]}요일`, rec: { freq: 'weekly', interval: 1, byDay: [wd] } },
  ];
  if (nth <= 4) presets.push({ key: 'monthly-nth', label: `매월 ${NTH_LABEL[nth]} ${WD[wd]}요일`, rec: { freq: 'monthly', interval: 1, bySetPos: nth } });
  if (isLast) presets.push({ key: 'monthly-last', label: `매월 마지막 ${WD[wd]}요일`, rec: { freq: 'monthly', interval: 1, bySetPos: -1 } });
  presets.push(
    { key: 'monthly-day', label: `매월 ${d.getDate()}일`, rec: { freq: 'monthly', interval: 1 } },
    { key: 'yearly', label: `매년 ${d.getMonth() + 1}월 ${d.getDate()}일`, rec: { freq: 'yearly', interval: 1 } },
    { key: 'weekdays', label: '주중 매일 (월~금)', rec: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] } },
  );
  return presets;
}

/** 규칙이 보기 중 하나와 같으면 그 key, 아니면 null(맞춤) */
export function matchPreset(rec, startDateStr) {
  const norm = normalizeRecurrence(rec);
  if (!norm) return 'none';
  // 매주 + 요일 하나가 시작일 요일이면 byDay 생략형과 같다
  const found = recurrencePresets(startDateStr).find((p) => p.rec && sameRecurrence(p.rec, norm));
  if (found) return found.key;
  if (norm.freq === 'weekly' && !norm.byDay) {
    const wd = parseLocal(startDateStr).getDay();
    return matchPreset({ ...norm, byDay: [wd] }, startDateStr);
  }
  return null;
}
