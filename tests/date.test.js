import { test, assertEqual } from './runner.js';
import {
  toLocalDateStr, toLocalDateTimeStr, parseLocal, addMonths, startOfWeek, getMonthGrid, formatKo, atMinutes,
} from '../js/utils/date.js';
import { layoutColumns } from '../js/views/layout-overlap.js';
import { normalizeItem, validateItem, eachItemDay } from '../js/models.js';

test('date: parseLocal ↔ toLocalDateTimeStr 왕복', () => {
  assertEqual(toLocalDateTimeStr(parseLocal('2026-11-15T15:30')), '2026-11-15T15:30');
  assertEqual(toLocalDateStr(parseLocal('2026-01-01')), '2026-01-01');
  assertEqual(parseLocal('2026/01/01'), null);
});

test('date: addMonths 말일 보정', () => {
  assertEqual(toLocalDateStr(addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
  assertEqual(toLocalDateStr(addMonths(new Date(2026, 2, 31), -1)), '2026-02-28');
  assertEqual(toLocalDateStr(addMonths(new Date(2026, 10, 14), 2)), '2027-01-14');
});

test('date: startOfWeek', () => {
  const sat = new Date(2026, 10, 14);
  assertEqual(toLocalDateStr(startOfWeek(sat, 0)), '2026-11-08');
  assertEqual(toLocalDateStr(startOfWeek(sat, 1)), '2026-11-09');
});

test('date: 월간 그리드는 항상 42칸', () => {
  const grid = getMonthGrid(2026, 10, 0);
  assertEqual(grid.length, 42);
  assertEqual(toLocalDateStr(grid[0]), '2026-11-01');
  assertEqual(toLocalDateStr(getMonthGrid(2026, 10, 1)[0]), '2026-10-26');
});

test('date: formatKo', () => {
  assertEqual(formatKo(new Date(2026, 10, 15, 9, 5), 'M/D(ddd) HH:mm'), '11/15(일) 09:05');
  assertEqual(formatKo(new Date(2026, 10, 15), 'YYYY년 M월 D일'), '2026년 11월 15일');
});

test('date: atMinutes 1440 이상은 다음 날', () => {
  assertEqual(toLocalDateTimeStr(atMinutes(new Date(2026, 10, 14), 1500)), '2026-11-15T01:00');
});

test('layout: 겹치는 일정 3개 → 3열', () => {
  const out = layoutColumns([
    { id: 'a', startMin: 600, endMin: 720 },
    { id: 'b', startMin: 630, endMin: 690 },
    { id: 'c', startMin: 660, endMin: 750 },
  ]);
  assertEqual(out.map((e) => [e.id, e.col, e.cols]), [['a', 0, 3], ['b', 1, 3], ['c', 2, 3]]);
});

test('layout: 빈 열 재사용과 클러스터 분리', () => {
  const out = layoutColumns([
    { id: 'a', startMin: 540, endMin: 660 },
    { id: 'b', startMin: 540, endMin: 600 },
    { id: 'c', startMin: 600, endMin: 630 }, // b가 끝난 열(1)을 재사용
    { id: 'd', startMin: 700, endMin: 760 }, // 별도 클러스터
  ]);
  const byId = Object.fromEntries(out.map((e) => [e.id, [e.col, e.cols]]));
  assertEqual(byId, { a: [0, 2], b: [1, 2], c: [1, 2], d: [0, 1] });
});

test('model: 종일 일정 정규화 및 검증', () => {
  const item = normalizeItem({ type: 'event', title: '휴가', allDay: true, start: '2026-11-20', end: '2026-11-18' });
  assertEqual([item.start, item.end], ['2026-11-20', '2026-11-20']);
  assertEqual(validateItem(item), []);
});

test('model: 종료 없는 시간 일정은 기본 길이 적용', () => {
  const item = normalizeItem({ type: 'event', title: 'x', start: '2026-11-20T23:30' }, { defaultDurationMin: 60 });
  assertEqual(item.end, '2026-11-21T00:30');
});

test('model: 할일로 바뀌면 일정 필드 제거', () => {
  const item = normalizeItem({ type: 'task', title: 'x', start: '2026-11-20T10:00', due: '2026-11-20' });
  assertEqual([item.start, item.due, item.done], [undefined, '2026-11-20', false]);
});

test('model: eachItemDay — 여러 날 일정', () => {
  const days = [];
  eachItemDay(
    { type: 'event', allDay: false, start: '2026-11-14T22:00', end: '2026-11-16T00:00' },
    new Date(2026, 10, 1), new Date(2026, 11, 1),
    (d, { isStart }) => days.push([d, isStart]),
  );
  assertEqual(days, [['2026-11-14', true], ['2026-11-15', false]]);
});
