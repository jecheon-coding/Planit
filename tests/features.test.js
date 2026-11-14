// 알림 · 공휴일 · .ics · 장소/알림 파싱 · 검색
import { test, assertEqual, assert } from './runner.js';
import {
  describeReminder, convertReminders, dueReminders, nextReminderAt, normalizeReminders, defaultReminders, leadText, reminderBase,
} from '../js/reminders.js';
import { holidayName, holidaysOf } from '../js/holidays.js';
import {
  itemsToIcs, toRRule, triggerValue, foldLine, escapeText,
} from '../js/ics.js';
import { parseQuickInput } from '../js/parser/index.js';
import { createStore } from '../js/store.js';
import { normalizeItem, DEFAULT_SETTINGS } from '../js/models.js';
import { normalizeRecurrence } from '../js/recurrence.js';

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);
const ev = (extra = {}) => normalizeItem({
  id: 'e1', type: 'event', title: '회의', start: '2026-11-16T15:00', end: '2026-11-16T16:00', reminders: [10], ...extra,
});

// ---------- 알림 문구 ----------
test('reminder: 문구 (시간 항목)', () => {
  assertEqual([0, 5, 60, 90, 1440, 10080].map((m) => describeReminder(m, false)), ['정시', '5분 전', '1시간 전', '1시간 30분 전', '1일 전', '1주 전']);
});

test('reminder: 문구 (종일 항목)', () => {
  assertEqual([-540, 900, 2340, 9540].map((m) => describeReminder(m, true)), ['당일 오전 9시', '1일 전 오전 9시', '2일 전 오전 9시', '1주 전 오전 9시']);
});

test('reminder: 시간 ↔ 종일 변환', () => {
  assertEqual(convertReminders([10, 1440], true), [-540, 900]);
  assertEqual(convertReminders([-540, 900], false, 10), [10, 1440]);
});

test('reminder: 정규화 (중복·범위 밖·최대 5개)', () => {
  assertEqual(normalizeReminders([10, 10, '30', -5000, 1.5, 0, 5, 60, 120, 1440]), [0, 5, 10, 30, 60]);
  assertEqual(normalizeReminders(null), []);
});

test('reminder: 기본 알림 (일정만, 종일은 설정값)', () => {
  const s = { ...DEFAULT_SETTINGS };
  assertEqual(defaultReminders({ type: 'event', allDay: false }, s), [10]);
  assertEqual(defaultReminders({ type: 'event', allDay: true }, s), []);
  assertEqual(defaultReminders({ type: 'event', allDay: true }, { ...s, defaultAllDayReminder: -540 }), [-540]);
  assertEqual(defaultReminders({ type: 'task' }, s), []);
});

// ---------- 알림 시각 계산 ----------
test('reminder: 10분 전 → 14:50에 울림', () => {
  const due = dueReminders([ev()], at(2026, 11, 16, 14, 40), at(2026, 11, 16, 14, 50));
  assertEqual(due.length, 1);
  assertEqual(due[0].fireAt.getTime(), at(2026, 11, 16, 14, 50).getTime());
  assertEqual(dueReminders([ev()], at(2026, 11, 16, 14, 50), at(2026, 11, 16, 15, 0)).length, 0, '(from, to] — 이미 확인한 시각은 제외');
});

test('reminder: 종일 "1일 전 오전 9시"', () => {
  const item = normalizeItem({ id: 'a', type: 'event', title: '휴가', allDay: true, start: '2026-12-31', end: '2026-12-31', reminders: [900] });
  const [r] = dueReminders([item], at(2026, 12, 30, 8, 0), at(2026, 12, 30, 9, 0));
  assert(r, '울려야 함');
  assertEqual(r.fireAt.getTime(), at(2026, 12, 30, 9, 0).getTime());
});

test('reminder: 반복 일정은 회차마다, 완료한 할일은 제외', () => {
  const weekly = ev({ id: 'w', recurrence: normalizeRecurrence({ freq: 'weekly' }), exdates: ['2026-11-23'] });
  const fired = dueReminders([weekly], at(2026, 11, 15), at(2026, 12, 8));
  assertEqual(fired.map((r) => r.item.occurrenceDate), ['2026-11-16', '2026-11-30', '2026-12-07'], '11/23은 제외한 회차');
  const task = normalizeItem({ id: 't', type: 'task', title: '보고', due: '2026-11-16T18:00', reminders: [30], done: true });
  assertEqual(dueReminders([task], at(2026, 11, 16), at(2026, 11, 17)).length, 0);
  const daily = normalizeItem({
    id: 'd', type: 'task', title: '단어', due: '2026-11-16', reminders: [-540], recurrence: { freq: 'daily' }, doneDates: { '2026-11-17': 'x' },
  });
  assertEqual(dueReminders([daily], at(2026, 11, 16), at(2026, 11, 19)).map((r) => r.item.occurrenceDate), ['2026-11-16', '2026-11-18']);
});

test('reminder: 다음 알림 시각', () => {
  assertEqual(nextReminderAt([ev({ reminders: [10, 60] })], at(2026, 11, 16, 14, 0))?.getTime(), at(2026, 11, 16, 14, 50).getTime());
  assertEqual(nextReminderAt([ev()], at(2026, 11, 16, 15, 0)), null);
});

test('reminder: 안내 문구', () => {
  const [r] = dueReminders([ev()], at(2026, 11, 16, 14, 0), at(2026, 11, 16, 15, 0));
  assertEqual(leadText(r, at(2026, 11, 16, 14, 50)), '10분 후 시작');
  assertEqual(leadText(r, at(2026, 11, 16, 15, 0)), '지금 시작');
  assertEqual(reminderBase({ type: 'task', due: null }), null);
});

test('reminder: 빠른 입력은 기본 알림, "알림 없이"는 없음 (store)', () => {
  const store = createStore();
  const a = store.addItem({ type: 'event', title: 'A', start: '2026-11-20T10:00', end: '2026-11-20T11:00' });
  const b = store.addItem({ type: 'event', title: 'B', start: '2026-11-20T10:00', end: '2026-11-20T11:00', reminders: [] });
  const c = store.addItem({ type: 'task', title: 'C', due: '2026-11-20' });
  assertEqual([a.reminders, b.reminders, c.reminders], [[10], [], []]);
});

// ---------- 공휴일 ----------
test('holiday: 2026년 (대체공휴일 포함)', () => {
  const list = [...holidaysOf(2026)].filter(([, n]) => n.includes('대체공휴일')).map(([d]) => d).sort();
  assertEqual(list, ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05']);
  assertEqual(holidayName('2026-02-17'), '설날');
  assertEqual(holidayName('2026-09-25'), '추석');
  assertEqual(holidayName('2026-11-16'), null);
});

test('holiday: 겹치는 공휴일 → 다음 평일 대체', () => {
  assertEqual(holidayName('2025-05-05'), '어린이날 · 부처님오신날');
  assertEqual(holidayName('2025-05-06'), '대체공휴일');
  assertEqual(holidayName('2025-10-08'), '대체공휴일', '추석 연휴가 일요일과 겹침');
  assertEqual(holidayName('2028-10-05'), '대체공휴일', '추석과 개천절이 겹침');
});

test('holiday: 설·추석은 토요일과 겹쳐도 대체 없음, 양력 공휴일은 있음', () => {
  assertEqual(holidayName('2026-09-28'), null, '2026 추석 연휴 9/24~26(토)');
  assertEqual(holidayName('2027-12-27'), '대체공휴일', '2027 성탄절 토요일');
  assertEqual(holidayName('2031-01-01'), '신정', '표 밖의 해도 양력 공휴일은 표시');
});

// ---------- .ics ----------
test('ics: 알림 TRIGGER', () => {
  assertEqual([10, 0, -540, 900, 1440, 90].map(triggerValue), ['-PT10M', 'PT0M', 'PT9H', '-PT15H', '-P1D', '-PT1H30M']);
});

test('ics: RRULE', () => {
  assertEqual(toRRule({ freq: 'weekly', interval: 2, byDay: [1, 3] }, '2026-11-16', false), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
  assertEqual(toRRule({ freq: 'monthly', interval: 1, bySetPos: -1 }, '2026-11-27', false), 'FREQ=MONTHLY;BYDAY=-1FR');
  assertEqual(toRRule({ freq: 'daily', interval: 1, until: '2026-12-31' }, '2026-11-16', true), 'FREQ=DAILY;UNTIL=20261231');
  assertEqual(toRRule({ freq: 'yearly', interval: 1, count: 3 }, '2026-11-16', false), 'FREQ=YEARLY;COUNT=3');
});

test('ics: 일정 + 반복 + 제외 + 장소 + 알림', () => {
  const item = ev({
    location: '강남역, 2번 출구', memo: '자료\n준비', recurrence: normalizeRecurrence({ freq: 'weekly' }), exdates: ['2026-11-23'],
  });
  const ics = itemsToIcs([item], { now: new Date(Date.UTC(2026, 10, 15, 0, 0)) });
  for (const line of ['DTSTART:20261116T150000', 'DTEND:20261116T160000', 'RRULE:FREQ=WEEKLY', 'EXDATE:20261123T150000',
    'LOCATION:강남역\\, 2번 출구', 'DESCRIPTION:자료\\n준비', 'TRIGGER:-PT10M', 'DTSTAMP:20261115T000000Z']) {
    assert(ics.includes(line), `없음: ${line}`);
  }
  assert(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'CRLF');
});

test('ics: 종일·할일·마감 없는 할일', () => {
  const allDay = normalizeItem({ id: 'a', type: 'event', title: '여행', allDay: true, start: '2026-12-24', end: '2026-12-26' });
  const task = normalizeItem({ id: 't', type: 'task', title: '보고서', due: '2026-11-20' });
  const someday = normalizeItem({ id: 's', type: 'task', title: '언젠가' });
  const ics = itemsToIcs([allDay, task, someday]);
  assert(ics.includes('DTSTART;VALUE=DATE:20261224') && ics.includes('DTEND;VALUE=DATE:20261227'), '종일 끝은 다음 날');
  assert(ics.includes('SUMMARY:[할일] 보고서'), '할일');
  assert(!ics.includes('언젠가'), '마감 없는 할일 제외');
});

test('ics: 시작일이 반복 요일이 아니면 첫 회차로 이동', () => {
  const item = ev({ start: '2026-11-18T09:00', end: '2026-11-18T10:00', recurrence: normalizeRecurrence({ freq: 'weekly', byDay: [1, 5] }) });
  assert(itemsToIcs([item]).includes('DTSTART:20261120T090000'), '수요일 시작 + 월·금 → 금요일');
});

test('ics: 75바이트 줄 접기·이스케이프', () => {
  const folded = foldLine(`SUMMARY:${'가'.repeat(40)}`);
  for (const part of folded.split('\r\n')) assert(new TextEncoder().encode(part).length <= 75, '75바이트 이하');
  assertEqual(folded.replace(/\r\n /g, ''), `SUMMARY:${'가'.repeat(40)}`);
  assertEqual(escapeText('a;b,c\\d'), 'a\\;b\\,c\\\\d');
});

// ---------- 빠른 입력: 장소·알림 ----------
const NOW = new Date(2026, 10, 14, 10, 0);
const P = (t) => parseQuickInput(t, NOW);

test('parse: @장소 + 10분 전 알림', () => {
  const r = P('내일 오후 3시 회의 @강남역 10분 전 알림');
  assertEqual([r.title, r.start, r.location, r.reminders], ['회의', '2026-11-15T15:00', '강남역', [10]]);
});

test('parse: "1시간 전에 알려줘"는 일정 길이가 아님', () => {
  const r = P('모레 2시 치과 1시간 전에 알려줘');
  assertEqual([r.title, r.end, r.reminders], ['치과', '2026-11-16T15:00', [60]]);
});

test('parse: 종일 + 하루 전 알림 → 1일 전 오전 9시', () => {
  assertEqual(P('12월 31일 종일 휴가 하루 전 알림').reminders, [900]);
  assertEqual(P('금요일까지 보고서 1일 전 알림').reminders, [900]);
});

test('parse: 알림 없이 / 표현 없음 / 이메일 @', () => {
  assertEqual(P('내일 3시 회의 알림 없이').reminders, []);
  assertEqual(P('내일 3시 회의').reminders, null);
  const r = P('메일 a@b.com 확인');
  assertEqual([r.location, r.title], [null, '메일 a@b.com 확인']);
});

// ---------- 검색 ----------
test('search: 제목·메모·장소, 반복은 다가오는 회차 하나', () => {
  const store = createStore();
  store.addItem({ type: 'event', title: '팀 회의', start: '2020-01-06T09:00', end: '2020-01-06T10:00', recurrence: { freq: 'weekly' } });
  store.addItem({ type: 'event', title: '점심', start: '2026-11-20T12:00', end: '2026-11-20T13:00', location: '회의실 앞 식당' });
  store.addItem({ type: 'task', title: '자료 정리', memo: '회의 준비' });
  store.addItem({ type: 'event', title: '지난 회의', start: '2020-02-01T09:00', end: '2020-02-01T10:00' });
  const res = store.searchItems('회의');
  assertEqual(res.length, 4);
  assert(res[0].seriesId && res[0].start >= '2026', `반복은 다가오는 회차: ${res[0].start}`);
  assertEqual(res.map((i) => i.title).slice(1), ['점심', '지난 회의', '자료 정리']);
  assertEqual(store.searchItems('회의 식당').map((i) => i.title), ['점심'], '여러 단어는 모두 포함');
  assertEqual(store.searchItems('  '), []);
});
