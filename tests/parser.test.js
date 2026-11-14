import { test, assertEqual, assert } from './runner.js';
import { parseQuickInput } from '../js/parser/index.js';

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
