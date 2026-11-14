// 빠른 입력의 반복 표현. 날짜 규칙보다 먼저 실행해 "매주 월요일"의 "월요일"이 단일 날짜로 잡히지 않게 한다.
//
// 반환: { recurrence, anchor } — anchor는 규칙이 정하는 첫 회차 날짜(없으면 null → 다른 날짜/오늘 사용)
//   anchorFixed: true면 다른 날짜 표현보다 우선 (매월 15일, 매년 3월 1일처럼 날짜 자체가 규칙인 경우)
import { addDays } from '../utils/date.js';
import { nthWeekday } from '../recurrence.js';
import { upcomingDay, upcomingMonthDay } from './date-rules.js';

const WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const NTH = {
  첫째: 1, 첫번째: 1, 둘째: 2, 두번째: 2, 셋째: 3, 세번째: 3, 넷째: 4, 네번째: 4, 마지막: -1,
};
const DAYS = '[월화수목금토일](?:\\s*[,·/]?\\s*[월화수목금토일])*';
const DAYS_END = '(?:요일|(?![가-힣]))';

const parseDays = (s) => [...new Set([...s.replace(/[^월화수목금토일]/g, '')].map((c) => WD[c]))];

/** 오늘 포함, days 중 가장 가까운 요일 */
function nearestOf(today, days) {
  const offsets = days.map((d) => (d - today.getDay() + 7) % 7);
  return addDays(today, Math.min(...offsets));
}

function nextNthWeekday(today, wd, pos) {
  for (let k = 0; k < 13; k += 1) {
    const d = nthWeekday(today.getFullYear(), today.getMonth() + k, wd, pos);
    if (d && d >= today) return d;
  }
  return null;
}

const RULES = [
  {
    // 매년 3월 1일, 매년 3/1
    re: /매년\s*(?:(\d{1,2})\s*월\s*(\d{1,2})\s*일|(\d{1,2})\/(\d{1,2}))/,
    apply: (m, today) => {
      const anchor = upcomingMonthDay(+(m[1] ?? m[3]), +(m[2] ?? m[4]), today);
      return anchor && { recurrence: { freq: 'yearly', interval: 1 }, anchor, anchorFixed: true };
    },
  },
  {
    // 매월 셋째 금요일, 매달 마지막 주 금요일
    re: new RegExp(`(?:매월|매달)\\s*(첫\\s*번?째|두\\s*번째|둘째|세\\s*번째|셋째|네\\s*번째|넷째|마지막)\\s*(?:주\\s*)?([월화수목금토일])${DAYS_END}`),
    apply: (m, today) => {
      const pos = NTH[m[1].replace(/\s/g, '')];
      const anchor = nextNthWeekday(today, WD[m[2]], pos);
      return anchor && { recurrence: { freq: 'monthly', interval: 1, bySetPos: pos }, anchor, anchorFixed: true };
    },
  },
  {
    // 매월 15일, 매달 1일
    re: /(?:매월|매달)\s*(\d{1,2})\s*일/,
    apply: (m, today) => {
      const anchor = upcomingDay(+m[1], today);
      return anchor && { recurrence: { freq: 'monthly', interval: 1 }, anchor, anchorFixed: true };
    },
  },
  {
    // 격주 금요일, 2주마다 월수금, 3주에 한 번 화요일
    re: new RegExp(`(격주|(\\d{1,2})\\s*주\\s*(?:마다|에\\s*한\\s*번))\\s*(${DAYS})${DAYS_END}`),
    apply: (m, today) => {
      const byDay = parseDays(m[3]);
      return { recurrence: { freq: 'weekly', interval: m[2] ? +m[2] : 2, byDay }, anchor: nearestOf(today, byDay) };
    },
  },
  {
    // 매주 월요일, 매주 월수금, 매주 화, 목
    re: new RegExp(`매주\\s*(${DAYS})${DAYS_END}`),
    apply: (m, today) => {
      const byDay = parseDays(m[1]);
      return { recurrence: { freq: 'weekly', interval: 1, byDay }, anchor: nearestOf(today, byDay) };
    },
  },
  {
    // 평일, 주중 매일, 평일마다
    re: /(?:매\s*)?(?:평일|주중)(?:\s*매일|마다)?/,
    apply: (m, today) => {
      const byDay = [1, 2, 3, 4, 5];
      return { recurrence: { freq: 'weekly', interval: 1, byDay }, anchor: nearestOf(today, byDay) };
    },
  },
  {
    // 주말마다, 매주 주말
    re: /주말마다|매주\s*주말/,
    apply: (m, today) => {
      const byDay = [6, 0];
      return { recurrence: { freq: 'weekly', interval: 1, byDay }, anchor: nearestOf(today, byDay) };
    },
  },
  { re: /매일|날마다/, apply: () => ({ recurrence: { freq: 'daily', interval: 1 }, anchor: null }) },
  { re: /(?<!\d)(\d{1,2})\s*일\s*마다/, apply: (m) => ({ recurrence: { freq: 'daily', interval: Math.max(1, +m[1]) }, anchor: null }) },
  { re: /(?<!\d)(\d{1,2})\s*주\s*마다/, apply: (m) => ({ recurrence: { freq: 'weekly', interval: Math.max(1, +m[1]) }, anchor: null }) },
  { re: /(?<!\d)(\d{1,2})\s*(?:개월|달)\s*마다/, apply: (m) => ({ recurrence: { freq: 'monthly', interval: Math.max(1, +m[1]) }, anchor: null }) },
  { re: /매주/, apply: () => ({ recurrence: { freq: 'weekly', interval: 1 }, anchor: null }) },
  { re: /매월|매달/, apply: () => ({ recurrence: { freq: 'monthly', interval: 1 }, anchor: null }) },
  { re: /매년/, apply: () => ({ recurrence: { freq: 'yearly', interval: 1 }, anchor: null }) },
];

/** 반복 표현을 찾아 소비. 없으면 null */
export function extractRecurrence(ctx, today) {
  for (const rule of RULES) {
    const m = rule.re.exec(ctx.rest);
    if (!m) continue;
    const result = rule.apply(m, today);
    if (!result) continue;
    ctx.consumeMatch(m, 'repeat');
    return result;
  }
  return null;
}
