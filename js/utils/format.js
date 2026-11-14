import { parseLocal, formatKo, isSameDay, addMinutes } from './date.js';

/** 항목의 날짜/시간을 사람이 읽기 쉬운 문자열로 */
export function describeWhen(item) {
  if (item.type === 'task') {
    if (!item.due) return '마감 없음';
    const d = parseLocal(item.due);
    if (!d) return '마감 없음';
    return item.due.length > 10 ? `${formatKo(d, 'M/D(ddd) HH:mm')}까지` : `${formatKo(d, 'M/D(ddd)')}까지`;
  }
  const s = parseLocal(item.start);
  const e = parseLocal(item.end);
  if (!s || !e) return '';
  if (item.allDay) {
    return isSameDay(s, e)
      ? `${formatKo(s, 'M/D(ddd)')} 종일`
      : `${formatKo(s, 'M/D(ddd)')} – ${formatKo(e, 'M/D(ddd)')} 종일`;
  }
  // 종료가 같은 날이거나 다음 날 00:00이면 한 줄로 짧게
  if (isSameDay(s, addMinutes(e, -1))) {
    return `${formatKo(s, 'M/D(ddd) HH:mm')}–${formatKo(e, 'HH:mm')}`;
  }
  return `${formatKo(s, 'M/D(ddd) HH:mm')} – ${formatKo(e, 'M/D(ddd) HH:mm')}`;
}

export function typeLabel(type) {
  return type === 'task' ? '할일' : '일정';
}
