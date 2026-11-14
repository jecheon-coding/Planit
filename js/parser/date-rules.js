// 날짜 규칙. 위에서부터 차례로 검사해 처음 매칭되는 규칙 하나만 적용한다.
// apply()가 null을 반환하면(예: 2월 30일) 다음 규칙으로 넘어간다.
//
// "이번주/다음주"는 일상 언어 관습에 맞춰 항상 월요일 시작 주로 계산한다
// (화면 표시용 weekStartsOn 설정과는 무관).
import { addDays, addMonths, startOfWeek } from '../utils/date.js';

const WEEKDAY = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const RELATIVE = { 오늘: 0, 금일: 0, 내일: 1, 명일: 1, 모레: 2, 내일모레: 2, 글피: 3, 어제: -1 };

function makeDate(y, month, day) {
  const d = new Date(y, month - 1, day);
  return d.getFullYear() === y && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

/** 월/일만 주어지면 올해, 이미 지났으면 내년 */
function upcomingMonthDay(month, day, today) {
  const d = makeDate(today.getFullYear(), month, day);
  if (!d) return null;
  return d < today ? makeDate(today.getFullYear() + 1, month, day) : d;
}

/** 일만 주어지면 이번 달, 지났거나 없는 날이면 그다음 달부터 탐색 */
function upcomingDay(day, today) {
  if (day < 1 || day > 31) return null;
  for (let i = 0; i < 12; i += 1) {
    const base = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const d = makeDate(base.getFullYear(), base.getMonth() + 1, day);
    if (d && d >= today) return d;
  }
  return null;
}

/** 오늘 포함 가장 가까운 해당 요일 */
function nextWeekday(today, wd) {
  return addDays(today, (wd - today.getDay() + 7) % 7);
}

function weekOffset(label) {
  const s = label.replace(/\s/g, '');
  if (s.startsWith('다다음')) return 2;
  if (s.startsWith('다음') || s === '담주' || s === '차주') return 1;
  return 0;
}

export const DATE_RULES = [
  {
    name: 'ymd', // 2026-11-20, 2026.11.20, 2026년 11월 20일
    re: /(?<!\d)(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?:\s*일)?(?!\d)/,
    apply: (m) => makeDate(+m[1], +m[2], +m[3]),
  },
  {
    name: 'month-day-ko', // 11월 20일
    re: /(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/,
    apply: (m, { today }) => upcomingMonthDay(+m[1], +m[2], today),
  },
  {
    name: 'month-day-slash', // 11/20
    re: /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/,
    apply: (m, { today }) => upcomingMonthDay(+m[1], +m[2], today),
  },
  {
    name: 'days-later', // 3일 후, 3일 뒤
    re: /(?<!\d)(\d{1,3})\s*일\s*(?:후|뒤)/,
    apply: (m, { today }) => addDays(today, +m[1]),
  },
  {
    name: 'weeks-later', // 2주 후
    re: /(?<!\d)(\d{1,2})\s*주\s*(?:후|뒤)/,
    apply: (m, { today }) => addDays(today, +m[1] * 7),
  },
  {
    name: 'months-later', // 1달 후, 2개월 뒤
    re: /(?<!\d)(\d{1,2})\s*(?:달|개월)\s*(?:후|뒤)/,
    apply: (m, { today }) => addMonths(today, +m[1]),
  },
  {
    name: 'relative', // 오늘, 내일, 모레, 글피
    re: /내일\s*모레|모레|글피|내일|명일|오늘|금일|어제/,
    apply: (m, { today }) => addDays(today, RELATIVE[m[0].replace(/\s/g, '')]),
  },
  {
    name: 'week-weekday', // 이번주 금요일, 다음주 화, 다다음주 월요일
    re: /(다다음\s*주|다음\s*주|담주|차주|이번\s*주|금주)\s*([월화수목금토일])(?:요일|(?![가-힣]))/,
    apply: (m, { today }) => {
      const monday = startOfWeek(today, 1);
      return addDays(monday, weekOffset(m[1]) * 7 + ((WEEKDAY[m[2]] - 1 + 7) % 7));
    },
  },
  {
    name: 'weekend', // 주말, 이번 주말, 다음 주말
    re: /(?:(이번|다음|다다음)\s*)?주말/,
    apply: (m, { today }) => addDays(nextWeekday(today, 6), 7 * ({ 다음: 1, 다다음: 2 }[m[1]] ?? 0)),
  },
  {
    name: 'day-only', // 20일
    re: /(?<![\d월])(\d{1,2})\s*일(?!\s*(?:후|뒤|간|동안|째))/,
    apply: (m, { today }) => upcomingDay(+m[1], today),
  },
  {
    name: 'weekday', // 금요일
    re: /(?<![가-힣])([월화수목금토일])요일/,
    apply: (m, { today }) => nextWeekday(today, WEEKDAY[m[1]]),
  },
  {
    name: 'weekday-short', // 금 (단독 글자일 때만, '일'은 제외)
    re: /(?<![가-힣\d])([월화수목금토])(?![가-힣\d])/,
    apply: (m, { today }) => nextWeekday(today, WEEKDAY[m[1]]),
  },
];
