// 시간·범위·기간 규칙. 시간은 "해당 날짜 00:00으로부터의 분"으로 다룬다 (1440 이상 = 다음 날).

const MERIDIEM = '오전|오후|아침|점심|저녁|밤|새벽|낮';
const KOREAN_HOURS = {
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12,
};
const KNUM = '열한|열두|다섯|여섯|일곱|여덟|아홉|한|두|세|네|열';

// 오후 3시, 오전 10시 30분, 3시 반, 세 시
const KOR_TIME_RE = new RegExp(
  `(?:(${MERIDIEM})\\s*)?(?<!\\d)(\\d{1,2}|${KNUM})\\s*시(?!간)(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?`, 'g',
);
// 15:00, 오후 3:30
const COLON_TIME_RE = new RegExp(`(?:(${MERIDIEM})\\s*)?(?<![\\d:])(\\d{1,2}):(\\d{2})(?![\\d:])`, 'g');
const SPECIAL_TIME_RE = /정오|자정/g;
// 3~5시, 오후 3-5시
const COMPACT_RANGE_RE = new RegExp(
  `(?:(${MERIDIEM})\\s*)?(?<![\\d:])(\\d{1,2})\\s*[~\\-–〜]\\s*(\\d{1,2})\\s*시(?!간)(?:\\s*까지)?`,
);
const RANGE_CONNECTOR_RE = /^\s*(?:~|-|–|〜|부터|에서)\s*$/;
const RANGE_TAIL_RE = /^\s*까지/;

// 2시간, 1시간 30분, 한시간 반, 30분
const DURATION_HOUR_RE = new RegExp(
  `(?<!\\d)(\\d{1,2}|${KNUM})\\s*시간(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?(?:\\s*(?:동안|간))?`,
);
const DURATION_MIN_RE = /(?<!\d)(\d{1,3})\s*분(?:\s*(?:동안|간))?/;

export const ALL_DAY_RE = /하루\s*종일|온종일|종일/;

/**
 * 시(h)·분(m)·시간대(mer)를 분으로 변환.
 * 오전/오후가 없으면 1~6시는 오후로 추정(업무 시간 휴리스틱). 콜론 표기는 24시간제로 본다.
 */
export function toMinutes({ h, m = 0, mer = null, colon = false, fixed = null }) {
  if (fixed != null) return fixed;
  if (h > 24 || m > 59) return null;
  if (h >= 13 || h === 0) return h * 60 + m;
  let hh;
  switch (mer) {
    case '오전': case '아침': case '새벽': hh = h === 12 ? 0 : h; break;
    case '오후': hh = h === 12 ? 12 : h + 12; break;
    case '저녁': hh = h === 12 ? 24 : h + 12; break;
    case '밤': hh = h === 12 ? 24 : (h <= 4 ? h + 24 : h + 12); break; // 밤 1시 → 다음 날 01:00
    case '점심': case '낮': hh = h <= 6 ? h + 12 : h; break;
    default: hh = colon ? h : (h <= 6 ? h + 12 : h);
  }
  return hh * 60 + m;
}

const isHangul = (ch) => !!ch && /[가-힣]/.test(ch);

/** rest 문자열에서 시간 토큰을 모두 찾아 위치순으로 반환 */
export function findTimeTokens(rest) {
  const tokens = [];
  for (const m of rest.matchAll(KOR_TIME_RE)) {
    const mer = m[1] ?? null;
    const raw = m[2];
    const isKoreanNum = !/^\d/.test(raw);
    // "회의세시" 같은 경우 단어 일부일 수 있으므로 한글 숫자는 앞이 한글이면 무시
    if (isKoreanNum && !mer && isHangul(rest[m.index - 1])) continue;
    const h = isKoreanNum ? KOREAN_HOURS[raw] : +raw;
    const min = m[3] != null ? +m[3] : m[4] ? 30 : 0;
    if (h > 24 || min > 59) continue;
    tokens.push({ index: m.index, length: m[0].length, h, m: min, mer, colon: false });
  }
  for (const m of rest.matchAll(COLON_TIME_RE)) {
    const h = +m[2];
    const min = +m[3];
    if (h > 24 || min > 59) continue;
    tokens.push({ index: m.index, length: m[0].length, h, m: min, mer: m[1] ?? null, colon: true });
  }
  for (const m of rest.matchAll(SPECIAL_TIME_RE)) {
    tokens.push({ index: m.index, length: m[0].length, fixed: m[0] === '정오' ? 720 : 1440 });
  }
  return tokens.sort((a, b) => a.index - b.index);
}

/** 종료 시각: 오전/오후가 없으면 시작에서 상속, 시작보다 이르면 12시간씩 더한다 */
function resolveEnd(startMin, token, inheritMer) {
  const useInherit = !token.mer && token.fixed == null && !token.colon;
  let end = toMinutes(useInherit ? { ...token, mer: inheritMer } : token);
  for (let i = 0; end != null && end <= startMin && i < 2; i += 1) end += 720;
  return end;
}

/**
 * 시간/시간 범위를 추출하고 ctx에서 소비한다.
 * @returns {{ startMin: number|null, endMin: number|null }}
 */
export function extractTimes(ctx) {
  const compact = COMPACT_RANGE_RE.exec(ctx.rest);
  if (compact) {
    const mer = compact[1] ?? null;
    const startMin = toMinutes({ h: +compact[2], mer });
    const endMin = resolveEnd(startMin, { h: +compact[3], m: 0, mer: null }, mer);
    if (startMin != null && endMin != null) {
      ctx.consumeMatch(compact, 'time');
      return { startMin, endMin };
    }
  }

  const tokens = findTimeTokens(ctx.rest);
  if (!tokens.length) return { startMin: null, endMin: null };

  const [a, b] = tokens;
  const startMin = toMinutes(a);
  if (startMin == null) return { startMin: null, endMin: null };

  if (b) {
    const between = ctx.rest.slice(a.index + a.length, b.index);
    if (RANGE_CONNECTOR_RE.test(between)) {
      const endMin = resolveEnd(startMin, b, a.mer);
      let length = b.index + b.length - a.index;
      const tail = RANGE_TAIL_RE.exec(ctx.rest.slice(a.index + length));
      if (tail) length += tail[0].length;
      ctx.consume(a.index, length, 'time');
      return { startMin, endMin };
    }
  }
  ctx.consume(a.index, a.length, 'time');
  return { startMin, endMin: null };
}

/** 기간(분)을 추출하고 ctx에서 소비한다. 없으면 null */
export function extractDuration(ctx) {
  const hm = DURATION_HOUR_RE.exec(ctx.rest);
  if (hm) {
    const hours = /^\d/.test(hm[1]) ? +hm[1] : KOREAN_HOURS[hm[1]];
    const minutes = hm[2] != null ? +hm[2] : hm[3] ? 30 : 0;
    ctx.consumeMatch(hm, 'duration');
    return hours * 60 + minutes;
  }
  const mm = DURATION_MIN_RE.exec(ctx.rest);
  if (mm && +mm[1] > 0) {
    ctx.consumeMatch(mm, 'duration');
    return +mm[1];
  }
  return null;
}
