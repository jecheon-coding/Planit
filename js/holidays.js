// 대한민국 공휴일 (「관공서의 공휴일에 관한 규정」 기준)
//  - 양력 고정 공휴일은 매년 계산
//  - 음력 명절(설날·부처님오신날·추석)은 양력 날짜 표 (LUNAR) — 표에 없는 해는 음력 공휴일을 표시하지 않는다
//  - 대체공휴일은 규칙으로 계산:
//      삼일절·어린이날·광복절·개천절·한글날·부처님오신날·성탄절 → 토·일요일 또는 다른 공휴일과 겹치면
//      설날·추석 연휴 → 일요일 또는 다른 공휴일과 겹치면
//    겹친 날 다음의 첫 평일(공휴일 아닌 날)
//  - 선거일·임시공휴일은 EXTRA 표 (정부가 그때그때 지정하므로 필요하면 여기에 추가)
import { pad } from './utils/date.js';

const FIXED = [
  ['01-01', '신정'],
  ['03-01', '삼일절'],
  ['05-05', '어린이날'],
  ['06-06', '현충일'],
  ['08-15', '광복절'],
  ['10-03', '개천절'],
  ['10-09', '한글날'],
  ['12-25', '성탄절'],
];

/** 연도별 [설날 당일, 부처님오신날, 추석 당일] (한국천문연구원 음양력 기준) */
const LUNAR = {
  2024: ['02-10', '05-15', '09-17'],
  2025: ['01-29', '05-05', '10-06'],
  2026: ['02-17', '05-24', '09-25'],
  2027: ['02-07', '05-13', '09-15'],
  2028: ['01-27', '05-02', '10-03'],
  2029: ['02-13', '05-20', '09-22'],
  2030: ['02-03', '05-09', '09-12'],
};

const EXTRA = {
  '2024-04-10': '국회의원 선거일',
  '2024-10-01': '임시공휴일',
  '2025-01-27': '임시공휴일',
  '2025-06-03': '대통령 선거일',
  '2026-06-03': '지방선거일',
};

const SUB_WEEKEND = new Set(['삼일절', '어린이날', '광복절', '개천절', '한글날', '부처님오신날', '성탄절']);
const SUB_SUNDAY = new Set(['설날', '추석']);

export const HOLIDAY_YEARS = Object.keys(LUNAR).map(Number);

const cache = new Map();

const dateOf = (y, md) => `${y}-${md}`;
const toDate = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (s, n) => {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return toStr(d);
};

/** year의 공휴일 Map("YYYY-MM-DD" → [이름, ...]) */
export function holidaysOf(year) {
  if (cache.has(year)) return cache.get(year);
  const map = new Map();
  const add = (date, name) => {
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(name);
  };
  for (const [md, name] of FIXED) add(dateOf(year, md), name);
  const lunar = LUNAR[year];
  if (lunar) {
    const [seol, buddha, chuseok] = lunar.map((md) => dateOf(year, md));
    for (const n of [-1, 0, 1]) add(shift(seol, n), '설날');
    add(buddha, '부처님오신날');
    for (const n of [-1, 0, 1]) add(shift(chuseok, n), '추석');
  }
  for (const [date, name] of Object.entries(EXTRA)) if (date.startsWith(`${year}-`)) add(date, name);

  // 대체공휴일: 겹친 날짜 순서대로, 다음 첫 평일을 하나씩 배정
  const needs = [];
  for (const [date, names] of [...map].sort(([a], [b]) => a.localeCompare(b))) {
    const wd = toDate(date).getDay();
    let weekend = 0;
    for (const name of names) {
      if (SUB_WEEKEND.has(name) && (wd === 0 || wd === 6)) weekend += 1;
      else if (SUB_SUNDAY.has(name) && wd === 0) weekend += 1;
    }
    const eligible = names.filter((n) => SUB_WEEKEND.has(n) || SUB_SUNDAY.has(n)).length;
    const overlap = names.length > 1 && eligible ? names.length - 1 : 0;
    for (let i = 0; i < Math.max(weekend, overlap); i += 1) needs.push(date);
  }
  const taken = new Set();
  for (const date of needs) {
    let d = shift(date, 1);
    for (;;) {
      const wd = toDate(d).getDay();
      if (wd !== 0 && wd !== 6 && !map.has(d) && !taken.has(d)) break;
      d = shift(d, 1);
    }
    taken.add(d);
  }
  for (const d of taken) add(d, '대체공휴일');
  cache.set(year, map);
  return map;
}

/** "YYYY-MM-DD"가 공휴일이면 이름("설날", "어린이날 · 부처님오신날"), 아니면 null */
export function holidayName(dateStr) {
  const year = Number(String(dateStr).slice(0, 4));
  if (!year) return null;
  const names = holidaysOf(year).get(dateStr);
  return names ? [...new Set(names)].join(' · ') : null;
}
