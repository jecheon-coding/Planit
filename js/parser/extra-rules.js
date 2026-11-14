// 장소·알림 규칙
//  장소: "@강남역" (공백 전까지 한 단어, 이메일 주소의 @는 제외)
//  알림: "10분 전 알림", "1시간 전에 알려줘", "알림 30분 전", "하루 전 알림", "정시 알림", "알림 없이"
// 시간·기간·날짜 규칙보다 먼저 실행해야 "1시간"이 일정 길이로, "1일"이 날짜로 잡히지 않는다.

const LOCATION_RE = /(?:^|\s)@([^\s@#]+)/;
const UNIT_MIN = { 분: 1, 시간: 60, 일: 1440, 주: 10080 };
const ALARM = '(?:알림|알람|알려\\s?줘|알려\\s?주세요)';
const REMINDER_RES = [
  new RegExp(`(\\d{1,3})\\s*(분|시간|일|주)\\s*전(?:에)?\\s*${ALARM}`),
  new RegExp(`${ALARM}\\s*(\\d{1,3})\\s*(분|시간|일|주)\\s*전`),
];
const WORD_RES = [
  [new RegExp(`하루\\s*전(?:날)?(?:에)?\\s*${ALARM}`), 1440],
  [new RegExp(`이틀\\s*전(?:에)?\\s*${ALARM}`), 2880],
  [new RegExp(`(?:한\\s?시간)\\s*전(?:에)?\\s*${ALARM}`), 60],
  [new RegExp(`(?:반\\s?시간)\\s*전(?:에)?\\s*${ALARM}`), 30],
  [new RegExp(`정시(?:에)?\\s*${ALARM}|${ALARM}\\s*정시`), 0],
];
const NONE_RE = new RegExp(`${ALARM}\\s*(?:없이|없음|끄기|off)`, 'i');

/** "@장소"를 찾아 소비하고 장소 문자열 반환 */
export function extractLocation(ctx) {
  const m = LOCATION_RE.exec(ctx.rest);
  if (!m) return null;
  const at = m.index + m[0].indexOf('@');
  ctx.consume(at, m.index + m[0].length - at, 'location');
  return m[1];
}

/**
 * 알림 표현을 모두 찾아 소비. 시간 기준 "N분 전" 목록(분) 반환.
 * "알림 없이" → [] / 알림 표현이 없으면 null(기본 알림 사용)
 */
export function extractReminders(ctx) {
  const m0 = NONE_RE.exec(ctx.rest);
  if (m0) {
    ctx.consumeMatch(m0, 'reminder');
    return [];
  }
  const out = [];
  for (let guard = 0; guard < 5; guard += 1) {
    let found = false;
    for (const re of REMINDER_RES) {
      const m = re.exec(ctx.rest);
      if (!m) continue;
      out.push(Number(m[1]) * UNIT_MIN[m[2]]);
      ctx.consumeMatch(m, 'reminder');
      found = true;
    }
    for (const [re, min] of WORD_RES) {
      const m = re.exec(ctx.rest);
      if (!m) continue;
      out.push(min);
      ctx.consumeMatch(m, 'reminder');
      found = true;
    }
    if (!found) break;
  }
  return out.length ? out : null;
}
