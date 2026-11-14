import { test, assertEqual, assert } from './runner.js';
import {
  expandOccurrences, describeRecurrence, recurrencePresets, matchPreset, normalizeRecurrence, findOccurrence, currentOccurrence,
} from '../js/recurrence.js';
import { createStore } from '../js/store.js';

const D = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const series = (rec, extra = {}) => ({
  id: 's1', type: 'event', title: '반복', categoryId: 'work', allDay: false,
  start: '2026-11-16T09:00', end: '2026-11-16T10:00', recurrence: normalizeRecurrence(rec), exdates: [], ...extra,
});
const dates = (s, from, to) => expandOccurrences(s, D(from), D(to)).map((o) => o.occurrenceDate);

// ---------- 펼치기 ----------
test('rec: 매일', () => {
  assertEqual(dates(series({ freq: 'daily' }), '2026-11-15', '2026-11-19'), ['2026-11-16', '2026-11-17', '2026-11-18']);
});

test('rec: 3일마다 + 먼 미래 구간도 정확 (건너뛰기 계산)', () => {
  const s = series({ freq: 'daily', interval: 3 });
  assertEqual(dates(s, '2026-11-16', '2026-11-23'), ['2026-11-16', '2026-11-19', '2026-11-22']);
  // 2026-11-16 + 366일(3의 배수) = 2027-11-17
  assertEqual(dates(s, '2027-11-16', '2027-11-21'), ['2027-11-17', '2027-11-20']);
});

test('rec: 매주 월·수·금 (시작일 이전 요일은 제외)', () => {
  const s = series({ freq: 'weekly', byDay: [1, 3, 5] }, { start: '2026-11-18T09:00', end: '2026-11-18T10:00' }); // 수요일 시작
  assertEqual(dates(s, '2026-11-16', '2026-11-28'), ['2026-11-18', '2026-11-20', '2026-11-23', '2026-11-25', '2026-11-27']);
});

test('rec: 격주 월요일', () => {
  const s = series({ freq: 'weekly', interval: 2, byDay: [1] });
  assertEqual(dates(s, '2026-11-16', '2026-12-31'), ['2026-11-16', '2026-11-30', '2026-12-14', '2026-12-28']);
});

test('rec: 매월 31일 → 31일 없는 달은 건너뜀', () => {
  const s = series({ freq: 'monthly' }, { start: '2026-01-31T09:00', end: '2026-01-31T10:00' });
  assertEqual(dates(s, '2026-01-01', '2026-08-01'), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
});

test('rec: 매월 셋째 금요일 / 마지막 금요일', () => {
  const third = series({ freq: 'monthly', bySetPos: 3 }, { start: '2026-11-20T09:00', end: '2026-11-20T10:00' });
  assertEqual(dates(third, '2026-11-01', '2027-02-01'), ['2026-11-20', '2026-12-18', '2027-01-15']);
  const last = series({ freq: 'monthly', bySetPos: -1 }, { start: '2026-11-27T09:00', end: '2026-11-27T10:00' });
  assertEqual(dates(last, '2026-11-01', '2027-02-01'), ['2026-11-27', '2026-12-25', '2027-01-29']);
});

test('rec: 매년 2월 29일 → 윤년만', () => {
  const s = series({ freq: 'yearly' }, { start: '2028-02-29T09:00', end: '2028-02-29T10:00' });
  assertEqual(dates(s, '2028-01-01', '2037-01-01'), ['2028-02-29', '2032-02-29', '2036-02-29']);
});

test('rec: until(포함) / count / 제외 날짜는 count에 포함', () => {
  assertEqual(dates(series({ freq: 'daily', until: '2026-11-18' }), '2026-11-01', '2026-12-01'), ['2026-11-16', '2026-11-17', '2026-11-18']);
  const counted = series({ freq: 'daily', count: 3 }, { exdates: ['2026-11-17'] });
  assertEqual(dates(counted, '2026-11-01', '2026-12-01'), ['2026-11-16', '2026-11-18']);
});

test('rec: 자정을 넘는 회차는 다음 날 구간에도 걸린다', () => {
  const s = series({ freq: 'daily' }, { start: '2026-11-16T23:00', end: '2026-11-17T01:00' });
  assertEqual(dates(s, '2026-11-18', '2026-11-19'), ['2026-11-17', '2026-11-18']);
  const occ = expandOccurrences(s, D('2026-11-18'), D('2026-11-19'))[1];
  assertEqual([occ.id, occ.start, occ.end], ['s1::2026-11-18', '2026-11-18T23:00', '2026-11-19T01:00']);
});

test('rec: 여러 날 종일 반복', () => {
  const s = series({ freq: 'weekly' }, { allDay: true, start: '2026-11-20', end: '2026-11-22' });
  assertEqual(dates(s, '2026-11-29', '2026-11-30'), ['2026-11-27']);
  assertEqual(findOccurrence(s, '2026-11-27').end, '2026-11-29');
  assertEqual(findOccurrence(s, '2026-11-28'), null);
});

// ---------- 표시 ----------
test('rec: 설명 문구', () => {
  const start = '2026-11-20';
  assertEqual([
    { freq: 'daily' }, { freq: 'daily', interval: 2 }, { freq: 'weekly' }, { freq: 'weekly', byDay: [1, 3, 5] },
    { freq: 'weekly', interval: 2, byDay: [5] }, { freq: 'weekly', byDay: [1, 2, 3, 4, 5] }, { freq: 'monthly' },
    { freq: 'monthly', bySetPos: 3 }, { freq: 'yearly' }, { freq: 'daily', until: '2026-12-31' }, { freq: 'weekly', count: 10 },
    { freq: 'monthly', interval: 3, until: '2027-06-30' },
  ].map((r) => describeRecurrence(normalizeRecurrence(r), start)), [
    '매일', '2일마다', '매주 금요일', '매주 월·수·금', '격주 금요일', '주중 매일', '매월 20일',
    '매월 셋째 금요일', '매년 11월 20일', '매일 · 12/31까지', '매주 금요일 · 10회', '3개월마다 20일 · 2027/6/30까지',
  ]);
});

test('rec: 보기 목록은 시작일에 맞춰 생성', () => {
  assertEqual(recurrencePresets('2026-11-20').map((p) => p.label), [
    '반복 안 함', '매일', '매주 금요일', '매월 셋째 금요일', '매월 20일', '매년 11월 20일', '주중 매일 (월~금)',
  ]);
  // 11/27은 넷째이자 마지막 금요일
  assert(recurrencePresets('2026-11-27').some((p) => p.label === '매월 마지막 금요일'));
  assert(recurrencePresets('2026-11-27').some((p) => p.label === '매월 넷째 금요일'));
  // 29일 이후는 다섯째 → 마지막만
  assertEqual(recurrencePresets('2026-10-30').filter((p) => p.key.startsWith('monthly-')).map((p) => p.label), ['매월 마지막 금요일', '매월 30일']);
});

test('rec: 보기 매칭', () => {
  assertEqual(matchPreset({ freq: 'weekly', byDay: [5] }, '2026-11-20'), 'weekly');
  assertEqual(matchPreset({ freq: 'weekly' }, '2026-11-20'), 'weekly');
  assertEqual(matchPreset({ freq: 'weekly', byDay: [1, 2, 3, 4, 5] }, '2026-11-20'), 'weekdays');
  assertEqual(matchPreset({ freq: 'weekly', interval: 2 }, '2026-11-20'), null);
  assertEqual(matchPreset(null, '2026-11-20'), 'none');
});

// ---------- 스토어: 회차 수정/삭제 범위 ----------
function storeWith(rec, extra = {}) {
  const store = createStore();
  const item = store.addItem({ ...series(rec, extra), id: undefined, title: '팀 회의' });
  return { store, item, ids: () => store.selectItemsInRange(D('2026-11-01'), D('2027-01-01')).map((o) => `${o.occurrenceDate ?? o.start.slice(0, 10)}${o.title === '팀 회의' ? '' : `(${o.title})`}`) };
}

test('store: 이 일정만 수정 → 원본 제외 + 독립 일정', () => {
  const { store, item, ids } = storeWith({ freq: 'weekly', count: 4 });
  const occ = store.getItem(`${item.id}::2026-11-23`);
  const { item: saved } = store.updateOccurrence(occ.id, { title: '특별 회의', start: '2026-11-24T14:00', end: '2026-11-24T15:00' }, 'this');
  assertEqual(ids(), ['2026-11-16', '2026-11-30', '2026-12-07', '2026-11-24(특별 회의)']);
  assertEqual([saved.recurringId, saved.originalDate, saved.recurrence], [item.id, '2026-11-23', undefined]);
});

test('store: 이 일정 및 향후 → 나눠지고 남은 횟수 이어짐', () => {
  const { store, item, ids } = storeWith({ freq: 'weekly', count: 4 });
  store.updateOccurrence(`${item.id}::2026-11-30`, { title: '새 회의', start: '2026-11-30T10:00', end: '2026-11-30T11:00' }, 'following');
  assertEqual(ids(), ['2026-11-16', '2026-11-23', '2026-11-30(새 회의)', '2026-12-07(새 회의)']);
});

test('store: 모든 일정 → 시각 이동이 원본 전체에 적용', () => {
  const { store, item } = storeWith({ freq: 'weekly' });
  const { item: saved } = store.updateOccurrence(`${item.id}::2026-11-30`, { start: '2026-11-30T14:00', end: '2026-11-30T15:30' }, 'all');
  assertEqual([saved.id, saved.start, saved.end], [item.id, '2026-11-16T14:00', '2026-11-16T15:30']);
});

test('store: 삭제 범위 + 실행 취소', () => {
  const { store, item, ids } = storeWith({ freq: 'weekly', count: 4 });
  const snap = store.deleteOccurrence(`${item.id}::2026-11-23`, 'this');
  assertEqual(ids(), ['2026-11-16', '2026-11-30', '2026-12-07']);
  store.deleteOccurrence(`${item.id}::2026-11-30`, 'following');
  assertEqual(ids(), ['2026-11-16']);
  store.restoreSnapshot(snap);
  assertEqual(ids(), ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07']);
  store.updateOccurrence(`${item.id}::2026-11-23`, { title: '변경' }, 'this');
  store.deleteOccurrence(`${item.id}::2026-11-16`, 'all');
  assertEqual(ids(), []);
});

test('store: 없는 회차 id는 null', () => {
  const { store, item } = storeWith({ freq: 'weekly' });
  assertEqual(store.getItem(`${item.id}::2026-11-17`), null);
  assert(store.getItem(`${item.id}::2026-11-23`));
});

// ---------- 할일 반복 ----------

const taskSeries = (rec, due, extra = {}) => ({
  id: 't1', type: 'task', title: '보고서', categoryId: 'work', due, done: false,
  recurrence: normalizeRecurrence(rec), exdates: [], doneDates: {}, ...extra,
});
const cur = (s, today) => currentOccurrence(s, D(today))?.occurrenceDate ?? null;

test('task rec: 회차는 마감일이 그 날짜, 완료는 doneDates에서', () => {
  const s = taskSeries({ freq: 'weekly' }, '2026-11-06T17:00', { doneDates: { '2026-11-13': '2026-11-13T10:00:00.000Z' } });
  const occ = expandOccurrences(s, D('2026-11-01'), D('2026-11-21'));
  assertEqual(occ.map((o) => [o.id, o.due, o.done]), [
    ['t1::2026-11-06', '2026-11-06T17:00', false], ['t1::2026-11-13', '2026-11-13T17:00', true], ['t1::2026-11-20', '2026-11-20T17:00', false],
  ]);
});

test('task rec: 지금 해야 할 회차 — 오늘 이전 가장 최근 미완료, 완료하면 다음', () => {
  const weeklyFri = taskSeries({ freq: 'weekly' }, '2026-11-06');
  assertEqual(cur(weeklyFri, '2026-11-20'), '2026-11-20');
  assertEqual(cur({ ...weeklyFri, doneDates: { '2026-11-20': 'x' } }, '2026-11-20'), '2026-11-27');
  // 매일 할일을 며칠 빼먹어도 지연은 쌓이지 않고 오늘 회차 하나
  const daily = taskSeries({ freq: 'daily' }, '2026-11-01');
  assertEqual(cur(daily, '2026-11-20'), '2026-11-20');
  // 월요일 할일, 금요일 기준: 이번 주 월요일 미완료 → 지연, 완료하면 다음 월요일
  const weeklyMon = taskSeries({ freq: 'weekly' }, '2026-11-02');
  assertEqual(cur(weeklyMon, '2026-11-20'), '2026-11-16');
  assertEqual(cur({ ...weeklyMon, doneDates: { '2026-11-16': 'x' } }, '2026-11-20'), '2026-11-23');
  // 시작 전이면 첫 회차
  assertEqual(cur(taskSeries({ freq: 'monthly' }, '2026-12-05'), '2026-11-20'), '2026-12-05');
});

test('task rec: 횟수가 끝나고 모두 완료하면 없음', () => {
  const s = taskSeries({ freq: 'daily', count: 2 }, '2026-11-18');
  assertEqual(cur(s, '2026-11-20'), '2026-11-19');
  assertEqual(cur({ ...s, doneDates: { '2026-11-19': 'x' } }, '2026-11-20'), null);
  // 건너뛴(제외) 회차는 대상 아님
  assertEqual(cur({ ...s, exdates: ['2026-11-19'] }, '2026-11-20'), '2026-11-18');
});

function taskStore() {
  const store = createStore();
  const item = store.addItem({ ...taskSeries({ freq: 'weekly' }, '2026-11-16'), id: undefined, title: '주간 보고' });
  const occ = (d) => store.getItem(`${item.id}::${d}`);
  return { store, item, occ, series: () => store.getItem(item.id) };
}

test('task store: 회차 완료 토글은 그 회차만', () => {
  const { store, item, occ, series } = taskStore();
  store.toggleTask(`${item.id}::2026-11-23`);
  assertEqual([occ('2026-11-16').done, occ('2026-11-23').done, occ('2026-11-30').done], [false, true, false]);
  assert(series().doneDates['2026-11-23']);
  assertEqual(series().done, false);
  store.toggleTask(`${item.id}::2026-11-23`);
  assertEqual(occ('2026-11-23').done, false);
});

test('task store: 완료 숨기기 필터는 회차 단위', () => {
  const { store, item } = taskStore();
  store.toggleTask(`${item.id}::2026-11-23`);
  store.setFilter({ hideDone: true });
  const days = store.selectItemsInRange(D('2026-11-16'), D('2026-12-01')).map((o) => o.occurrenceDate);
  assertEqual(days, ['2026-11-16', '2026-11-30']);
});

test('task store: 이 회차만 수정 → 독립 할일 (완료 상태 유지)', () => {
  const { store, item, series } = taskStore();
  const { item: saved } = store.updateOccurrence(`${item.id}::2026-11-23`, { title: '특별 보고', due: '2026-11-24', done: true }, 'this');
  assertEqual([saved.type, saved.title, saved.due, saved.done, saved.recurringId], ['task', '특별 보고', '2026-11-24', true, item.id]);
  assertEqual(series().exdates, ['2026-11-23']);
});

test('task store: 모든 회차 날짜 이동 → 완료 기록도 같이 이동', () => {
  const { store, item, series } = taskStore();
  store.toggleTask(`${item.id}::2026-11-16`);
  store.updateOccurrence(`${item.id}::2026-11-23`, { due: '2026-11-24T10:00', recurrence: { freq: 'weekly', interval: 1, byDay: [2] } }, 'all');
  assertEqual([series().due, Object.keys(series().doneDates)], ['2026-11-17T10:00', ['2026-11-17']]);
});

test('task store: 향후 회차로 나누기 → 이전 완료는 원본에, 새 규칙은 새 원본에', () => {
  const { store, item, series } = taskStore();
  store.toggleTask(`${item.id}::2026-11-16`);
  const { item: created } = store.updateOccurrence(`${item.id}::2026-11-30`, { title: '격주 보고', recurrence: { freq: 'weekly', interval: 2, byDay: [1] } }, 'following');
  assertEqual([series().recurrence.until, Object.keys(series().doneDates)], ['2026-11-29', ['2026-11-16']]);
  assertEqual([created.title, created.due, created.recurrence.interval], ['격주 보고', '2026-11-30', 2]);
});
