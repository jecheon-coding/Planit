// 빠른 입력 자연어 파서.
// 파이프라인: 정규화 → 할일 접두어 → #카테고리 → @장소 → 알림 → 반복 → 날짜 → 시간/범위 → 기간 → 종일 → 종류 키워드 → 제목 → 카테고리 추론
// 매칭된 구간은 같은 길이의 공백으로 "가려서" 다음 단계로 넘긴다 → 원문 위치가 유지되어 하이라이트에 쓸 수 있다.
import { DATE_RULES } from './date-rules.js';
import { extractTimes, extractDuration, ALL_DAY_RE } from './time-rules.js';
import { extractHashtag, inferCategory } from './category-rules.js';
import { extractRecurrence } from './recurrence-rules.js';
import { extractLocation, extractReminders } from './extra-rules.js';
import { convertReminders, normalizeReminders } from '../reminders.js';
import { DEFAULT_CATEGORIES } from '../models.js';
import {
  startOfDay, atMinutes, addMinutes, toLocalDateStr, toLocalDateTimeStr,
} from '../utils/date.js';

const TASK_PREFIX_RE = /^\s*(?:-|\*|\[\s?\]|☐)\s+/;
const TASK_KEYWORD_RE = /(?<![가-힣A-Za-z])(?:할\s?일|todo)(?![가-힣A-Za-z])/i;
const DUE_RE = /까지/;
const DEADLINE_RE = /마감/;
const PARTICLES = new Set(['에', '에서', '은', '는', '엔', '에는', '까지', '부터', '쯤', '경', '즈음', '에도']);

/** 전각 문자 → 반각. 길이를 바꾸지 않는 정규화만 수행한다 (토큰 위치 보존) */
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[　\t\r\n]/g, ' ');
}

class ParseContext {
  constructor(src) {
    this.src = src;
    this.rest = src;
    this.tokens = [];
  }

  consume(index, length, kind) {
    if (length <= 0) return;
    this.rest = this.rest.slice(0, index) + ' '.repeat(length) + this.rest.slice(index + length);
    // 앞뒤 공백은 하이라이트에서 제외
    const raw = this.src.slice(index, index + length);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) this.tokens.push({ start: index + lead, end: index + lead + text.length, kind, text });
  }

  consumeMatch(m, kind) {
    this.consume(m.index, m[0].length, kind);
  }
}

/**
 * @param {string} text 사용자 입력
 * @param {Date} now 기준 시각 (테스트 시 주입)
 * @param {{ categories?: Array, defaultDurationMin?: number }} options
 */
export function parseQuickInput(text, now = new Date(), options = {}) {
  const { categories = DEFAULT_CATEGORIES, defaultDurationMin = 60 } = options;
  const src = normalizeText(text);
  const ctx = new ParseContext(src);
  const today = startOfDay(now);
  const warnings = [];
  let forceTask = false;
  let dueMode = false;
  let m;

  // 할일 접두어: "- 책 반납", "[] 장보기"
  if ((m = TASK_PREFIX_RE.exec(ctx.rest))) {
    ctx.consumeMatch(m, 'type');
    forceTask = true;
  }

  // #카테고리
  let categoryId = extractHashtag(ctx, categories);
  let categorySource = categoryId ? 'tag' : null;

  // @장소, "10분 전 알림" (시간·날짜보다 먼저: "1시간 전 알림"의 "1시간"이 일정 길이로 잡히지 않게)
  const location = extractLocation(ctx);
  const reminders = extractReminders(ctx);

  // 반복 (날짜보다 먼저: "매주 월요일"의 "월요일"이 단일 날짜로 잡히지 않게)
  let repeat = extractRecurrence(ctx, today);

  // 날짜
  let date = null;
  for (const rule of DATE_RULES) {
    const dm = rule.re.exec(ctx.rest);
    if (!dm) continue;
    const d = rule.apply(dm, { today });
    if (!d) continue;
    date = startOfDay(d);
    ctx.consumeMatch(dm, 'date');
    break;
  }

  // 시간 / 범위 / 기간 / 종일
  const { startMin, endMin } = extractTimes(ctx);
  const durationMin = extractDuration(ctx);
  let allDay = false;
  if ((m = ALL_DAY_RE.exec(ctx.rest))) {
    allDay = true;
    ctx.consumeMatch(m, 'allday');
  }

  // 종류 키워드
  if ((m = TASK_KEYWORD_RE.exec(ctx.rest))) {
    forceTask = true;
    ctx.consumeMatch(m, 'type');
  }
  if ((m = DUE_RE.exec(ctx.rest))) {
    // 반복 + "12월 31일까지" → 반복 종료일
    if (repeat && date) {
      repeat.recurrence.until = toLocalDateStr(date);
      date = null;
      ctx.consumeMatch(m, 'repeat');
      const dateToken = ctx.tokens.find((t) => t.kind === 'date');
      if (dateToken) dateToken.kind = 'repeat';
    } else {
      dueMode = true;
      ctx.consumeMatch(m, 'type');
    }
  }
  if (DEADLINE_RE.test(ctx.rest)) dueMode = true; // '마감'은 제목에 남긴다

  // 제목: 남은 텍스트에서 홀로 남은 조사 제거
  const title = ctx.rest.split(/\s+/).filter((w) => w && !PARTICLES.has(w)).join(' ');

  if (!categoryId) {
    categoryId = inferCategory(title, categories);
    if (categoryId) categorySource = 'keyword';
  }

  const hasTime = startMin != null;
  const taskWanted = forceTask || dueMode; // "할일", "까지", "마감", "- " 접두어
  // 반복 + 할일 표현 → 반복 할일 / 반복만 있고 시간이 없으면 → 종일 반복 일정 (예: 매월 15일 월세)
  if (repeat && !hasTime && !taskWanted) allDay = true;
  const isTask = taskWanted || (!hasTime && !allDay);
  // 매월 15일·매년 3/1처럼 날짜 자체가 규칙이면 그 날짜가 우선, 아니면 지정한 날짜 → 규칙상 첫 날짜 → 오늘
  const base = repeat?.anchorFixed ? repeat.anchor : (date ?? repeat?.anchor ?? today);
  const result = {
    type: isTask ? 'task' : 'event',
    title,
    categoryId,
    categorySource,
    start: null,
    end: null,
    allDay: false,
    due: null,
    recurrence: repeat?.recurrence ?? null,
    location,
    reminders: null,
    tokens: ctx.tokens.sort((a, b) => a.start - b.start),
    warnings,
  };

  if (isTask) {
    if (hasTime) {
      const due = atMinutes(base, startMin);
      result.due = toLocalDateTimeStr(due);
      if (due < now && !repeat) warnings.push('마감 시각이 이미 지났습니다.');
    } else if (date || repeat) {
      // 반복 할일은 첫 회차 날짜가 마감일 (매주 금요일 → 이번 금요일)
      result.due = toLocalDateStr(base);
      if (base < today && !repeat) warnings.push('마감일이 이미 지났습니다.');
    }
  } else if (allDay) {
    result.allDay = true;
    result.start = toLocalDateStr(base);
    result.end = result.start;
    if (base < today && !repeat) warnings.push('지난 날짜입니다.');
  } else {
    const start = atMinutes(base, startMin);
    let end = endMin != null ? atMinutes(base, endMin) : addMinutes(start, durationMin ?? defaultDurationMin);
    if (end <= start) end = addMinutes(start, defaultDurationMin);
    result.start = toLocalDateTimeStr(start);
    result.end = toLocalDateTimeStr(end);
    if (start < now && !repeat) warnings.push('지난 시각입니다.');
  }

  // 알림: 종일·날짜만 있는 항목이면 "N일 전 오전 9시"로 / 마감 없는 할일은 알림을 둘 수 없음
  if (reminders) {
    const dateOnly = result.type === 'task' ? !(result.due && result.due.length > 10) : result.allDay;
    if (result.type === 'task' && !result.due) {
      if (reminders.length) warnings.push('마감일이 없으면 알림을 받을 수 없습니다.');
    } else {
      result.reminders = dateOnly ? convertReminders(reminders, true) : normalizeReminders(reminders);
    }
  }

  return result;
}
