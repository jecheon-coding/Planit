import { test, assertEqual, assert } from './runner.js';
import { parseQuickInput } from '../js/parser/index.js';
import { parseTimeInput, formatDuration } from '../js/parser/time-rules.js';

// 기준: 2026-11-14(토) 10:00
const NOW = new Date(2026, 10, 14, 10, 0);
const parse = (text) => parseQuickInput(text, NOW);

// DESIGN.md 7.3 테스트 케이스 + 추가 케이스
const CASES = [
  ['내일 오후 3시 회의', { type: 'event', start: '2026-11-15T15:00', end: '2026-11-15T16:00', categoryId: 'work', title: '회의' }],
  ['다음주 화요일 10시~12시 스터디 #학습', { type: 'event', start: '2026-11-17T10:00', end: '2026-11-17T12:00', categoryId: 'study', title: '스터디' }],
  ['11/20 저녁 7시 친구 약속', { type: 'event', start: '2026-11-20T19:00', end: '2026-11-20T20:00', categoryId: 'personal', title: '친구 약속' }],
  ['금요일까지 보고서 제출', { type: 'task', due: '2026-11-20', categoryId: 'work', title: '보고서 제출' }],
  ['모레 종일 워크숍', { type: 'event', allDay: true, start: '2026-11-16', end: '2026-11-16', categoryId: null, title: '워크숍' }],
  ['3시 치과 1시간 반', { type: 'event', start: '2026-11-14T15:00', end: '2026-11-14T16:30', categoryId: 'personal', title: '치과' }],
  ['우유 사기', { type: 'task', due: null, categoryId: null, title: '우유 사기' }],
  ['20일 오전 9시 30분 면접', { type: 'event', start: '2026-11-20T09:30', end: '2026-11-20T10:30', categoryId: null, title: '면접' }],
  ['오늘 오전 8시 운동', { type: 'event', start: '2026-11-14T08:00', end: '2026-11-14T09:00', categoryId: 'personal', title: '운동' }],
  // 추가
  ['내일 오후 3시부터 5시까지 회의', { type: 'event', start: '2026-11-15T15:00', end: '2026-11-15T17:00', title: '회의' }],
  ['모레 3~5시 세미나', { type: 'event', start: '2026-11-16T15:00', end: '2026-11-16T17:00', title: '세미나' }],
  ['오후 2시 30분 통화 30분', { type: 'event', start: '2026-11-14T14:30', end: '2026-11-14T15:00', title: '통화' }],
  ['내일 15:00 팀 미팅', { type: 'event', start: '2026-11-15T15:00', end: '2026-11-15T16:00', title: '팀 미팅', categoryId: 'work' }],
  ['다음 주말 가족 여행', { type: 'task', due: '2026-11-21', title: '가족 여행', categoryId: 'personal' }],
  ['이번 주말 대청소', { type: 'task', due: '2026-11-14', title: '대청소' }],
  ['밤 11시 영화', { type: 'event', start: '2026-11-14T23:00', end: '2026-11-15T00:00', title: '영화' }],
  ['내일 정오 점심 약속', { type: 'event', start: '2026-11-15T12:00', end: '2026-11-15T13:00', title: '점심 약속' }],
  ['할일 장보기', { type: 'task', due: null, title: '장보기' }],
  ['- 책 반납', { type: 'task', due: null, title: '책 반납' }],
  ['내일 오후 6시까지 과제 제출', { type: 'task', due: '2026-11-15T18:00', title: '과제 제출', categoryId: 'study' }],
  ['3일 후 오전 10시 병원', { type: 'event', start: '2026-11-17T10:00', end: '2026-11-17T11:00', title: '병원' }],
  ['2026-12-25 크리스마스 #개인', { type: 'task', due: '2026-12-25', title: '크리스마스', categoryId: 'personal' }],
  ['12월 31일 종일 휴가', { type: 'event', allDay: true, start: '2026-12-31', end: '2026-12-31', title: '휴가' }],
  ['다음주 월 9:30 스탠드업', { type: 'event', start: '2026-11-16T09:30', end: '2026-11-16T10:30', title: '스탠드업' }],
  ['이번주 일요일 오후 두시 브런치', { type: 'event', start: '2026-11-15T14:00', end: '2026-11-15T15:00', title: '브런치' }],
  ['내일 3시에 회의', { type: 'event', start: '2026-11-15T15:00', title: '회의' }],
  ['다음주 일정 정리', { type: 'task', due: null, title: '다음주 일정 정리' }],
  ['10/3 개천절', { type: 'task', due: '2027-10-03', title: '개천절' }],
  ['오후 11시~1시 야간 작업', { type: 'event', start: '2026-11-14T23:00', end: '2026-11-15T01:00', title: '야간 작업' }],
  ['ＴＯＤＯ 메일 확인', { type: 'task', title: '메일 확인' }],
];

for (const [input, expected] of CASES) {
  test(`parse: "${input}"`, () => {
    const r = parse(input);
    for (const [key, value] of Object.entries(expected)) assertEqual(r[key], value, key);
  });
}

test('parse: 지난 시각이면 경고', () => {
  const r = parse('오늘 오전 8시 운동');
  assert(r.warnings.length === 1, `warnings: ${JSON.stringify(r.warnings)}`);
});

test('parse: 미래 시각이면 경고 없음', () => {
  assertEqual(parse('내일 오후 3시 회의').warnings, []);
});

test('parse: 토큰 위치가 원문과 일치', () => {
  const input = '내일 오후 3시 팀 회의 #업무';
  const r = parse(input);
  for (const t of r.tokens) assertEqual(input.slice(t.start, t.end), t.text, t.kind);
  assertEqual(r.tokens.map((t) => t.kind), ['date', 'time', 'category']);
});

test('parse: 빈 입력', () => {
  const r = parse('   ');
  assertEqual(r.type, 'task');
  assertEqual(r.title, '');
});

// ---------- 시간 선택 입력창 직접 입력 ----------

const TIME_INPUTS = [
  ['15:30', '15:30'], ['9:05', '09:05'], ['9', '09:00'], ['930', '09:30'], ['1530', '15:30'], ['0', '00:00'],
  ['3시 반', '15:30'], ['오전 9시', '09:00'], ['오후 3', '15:00'], ['오후 3:30', '15:30'], ['밤 11시', '23:00'],
  ['정오', '12:00'], ['열두시', '12:00'], ['１５：００', '15:00'],
  ['', ''], ['   ', ''],
  ['25:00', null], ['12:60', null], ['자정', null], ['회의', null], ['3시 회의', null],
];
for (const [input, expected] of TIME_INPUTS) {
  test(`time input: "${input}" → ${expected}`, () => assertEqual(parseTimeInput(input), expected));
}

test('formatDuration', () => {
  assertEqual([15, 60, 90, 120, 135].map(formatDuration), ['15분', '1시간', '1시간 30분', '2시간', '2시간 15분']);
});

// ---------- 반복 (기준: 2026-11-14 토 10:00) ----------
const REPEAT_CASES = [
  ['매주 월요일 9시 팀 회의', { type: 'event', start: '2026-11-16T09:00', recurrence: { freq: 'weekly', interval: 1, byDay: [1] }, title: '팀 회의' }],
  ['매일 아침 7시 운동', { type: 'event', start: '2026-11-14T07:00', recurrence: { freq: 'daily', interval: 1 }, title: '운동', warnings: [] }],
  ['격주 금요일 오후 3시 스터디', { start: '2026-11-20T15:00', recurrence: { freq: 'weekly', interval: 2, byDay: [5] }, title: '스터디' }],
  ['매월 15일 월세 #개인', { type: 'event', allDay: true, start: '2026-11-15', recurrence: { freq: 'monthly', interval: 1 }, title: '월세', categoryId: 'personal' }],
  ['평일 9시 스탠드업', { start: '2026-11-16T09:00', recurrence: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] }, title: '스탠드업' }],
  ['매월 마지막 금요일 회고', { allDay: true, start: '2026-11-27', recurrence: { freq: 'monthly', interval: 1, bySetPos: -1 }, title: '회고' }],
  ['매달 셋째 주 화요일 오후 7시 독서모임', { start: '2026-11-17T19:00', recurrence: { freq: 'monthly', interval: 1, bySetPos: 3 }, title: '독서모임' }],
  ['매년 3월 1일 기념일', { allDay: true, start: '2027-03-01', recurrence: { freq: 'yearly', interval: 1 }, title: '기념일' }],
  ['매주 월수금 7시 수영', { start: '2026-11-16T07:00', recurrence: { freq: 'weekly', interval: 1, byDay: [1, 3, 5] }, title: '수영' }],
  ['매주 월요일 9시 회의 12월 31일까지', { type: 'event', start: '2026-11-16T09:00', recurrence: { freq: 'weekly', interval: 1, byDay: [1], until: '2026-12-31' }, title: '회의' }],
  ['다음주 수요일부터 매일 8시 조깅', { start: '2026-11-18T08:00', recurrence: { freq: 'daily', interval: 1 }, title: '조깅' }],
  ['매주 일정 점검', { allDay: true, start: '2026-11-14', recurrence: { freq: 'weekly', interval: 1 }, title: '일정 점검' }],
  ['3일마다 오후 9시 물주기', { start: '2026-11-14T21:00', recurrence: { freq: 'daily', interval: 3 }, title: '물주기' }],
  ['할일 매주 금요일 보고', { type: 'task', recurrence: { freq: 'weekly', interval: 1, byDay: [5] }, title: '보고', due: '2026-11-20' }],
  ['매주 금요일까지 주간 보고서 제출', { type: 'task', recurrence: { freq: 'weekly', interval: 1, byDay: [5] }, title: '주간 보고서 제출', due: '2026-11-20', categoryId: 'work' }],
  ['- 매일 영어 단어 외우기', { type: 'task', recurrence: { freq: 'daily', interval: 1 }, title: '영어 단어 외우기', due: '2026-11-14' }],
  ['매월 25일 할일 카드값 확인', { type: 'task', recurrence: { freq: 'monthly', interval: 1 }, title: '카드값 확인', due: '2026-11-25' }],
  ['할일 매주 월요일 오전 9시 주간 계획', { type: 'task', recurrence: { freq: 'weekly', interval: 1, byDay: [1] }, due: '2026-11-16T09:00', title: '주간 계획' }],
  ['매일 아침 7시 할일 약 먹기', { type: 'task', recurrence: { freq: 'daily', interval: 1 }, due: '2026-11-14T07:00', warnings: [] }],
  ['내일 오후 3시 회의', { recurrence: null }],
];
for (const [input, expected] of REPEAT_CASES) {
  test(`parse repeat: "${input}"`, () => {
    const r = parse(input);
    for (const [key, value] of Object.entries(expected)) assertEqual(r[key], value, key);
  });
}

