// iCalendar(.ics) 내보내기 — 휴대폰 기본 캘린더(아이폰 캘린더, 구글 캘린더, 삼성 캘린더 등)로 보내기용.
// 웹 앱은 닫혀 있으면 알림을 보낼 수 없으므로, 꼭 받아야 하는 알림은 기기 캘린더에 맡길 수 있게 한다.
//  - 시각은 "floating"(시간대 없는 로컬 시각)으로 기록 → 기기의 현재 시간대로 해석
//  - 반복은 RRULE, 제외한 회차는 EXDATE, 알림은 VALARM
//  - 할일은 기기 캘린더 호환성을 위해 VEVENT로 (마감일 종일 / 마감 시각부터 15분)
import { parseLocal, addDays, addMinutes, toLocalDateStr, toLocalDateTimeStr } from './utils/date.js';
import { firstOccurrenceDate, anchorOf } from './recurrence.js';
import { isDateOnly } from './reminders.js';

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const icsDate = (dateStr) => dateStr.replaceAll('-', '');
const icsDateTime = (dtStr) => `${dtStr.slice(0, 10).replaceAll('-', '')}T${dtStr.slice(11, 13)}${dtStr.slice(14, 16)}00`;

function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function escapeText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** 75바이트(UTF-8) 넘는 줄 접기 (RFC 5545 3.1) */
export function foldLine(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** 알림 분(기준 시각 − 분) → TRIGGER 값 ("-PT10M", "PT9H", "-P1DT15H") */
export function triggerValue(minutes) {
  if (minutes === 0) return 'PT0M';
  const sign = minutes > 0 ? '-' : '';
  let m = Math.abs(minutes);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  const time = `${h ? `${h}H` : ''}${m ? `${m}M` : ''}`;
  return `${sign}P${d ? `${d}D` : ''}${time ? `T${time}` : ''}`;
}

/** 우리 반복 규칙 → RRULE 문자열 */
export function toRRule(rec, anchorDateStr, dateOnly) {
  const parts = [`FREQ=${rec.freq.toUpperCase()}`];
  if (rec.interval > 1) parts.push(`INTERVAL=${rec.interval}`);
  if (rec.freq === 'weekly' && rec.byDay?.length) parts.push(`BYDAY=${rec.byDay.map((d) => WD[d]).join(',')}`);
  if (rec.freq === 'monthly' && rec.bySetPos != null) {
    parts.push(`BYDAY=${rec.bySetPos}${WD[parseLocal(anchorDateStr).getDay()]}`);
  }
  if (rec.until) parts.push(`UNTIL=${icsDate(rec.until)}${dateOnly ? '' : 'T235959'}`);
  else if (rec.count) parts.push(`COUNT=${rec.count}`);
  return parts.join(';');
}

function eventLines(item, stamp) {
  const lines = ['BEGIN:VEVENT', `UID:${item.id}@planit`, `DTSTAMP:${stamp}`];
  const dateOnly = isDateOnly(item);
  let start;
  let end;
  if (item.type === 'task') {
    start = item.due;
    end = dateOnly ? toLocalDateStr(addDays(parseLocal(item.due), 1)) : toLocalDateTimeStr(addMinutes(parseLocal(item.due), 15));
  } else if (item.allDay) {
    start = item.start;
    end = toLocalDateStr(addDays(parseLocal(item.end), 1)); // DTEND는 다음 날(미포함)
  } else {
    start = item.start;
    end = item.end;
  }
  // 반복 규칙이 시작일을 포함하지 않으면(예: 수요일 시작 + 매주 월·금) 첫 회차로 옮긴다
  if (item.recurrence) {
    const first = firstOccurrenceDate(item);
    const anchor = anchorOf(item);
    if (first && first !== anchor) {
      const days = Math.round((parseLocal(first) - parseLocal(anchor)) / 86_400_000);
      const move = (s) => (s.length > 10 ? toLocalDateTimeStr(addDays(parseLocal(s), days)) : toLocalDateStr(addDays(parseLocal(s), days)));
      start = move(start);
      end = move(end);
    }
  }
  if (dateOnly) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(end)}`);
  } else {
    lines.push(`DTSTART:${icsDateTime(start)}`, `DTEND:${icsDateTime(end)}`);
  }
  lines.push(`SUMMARY:${escapeText(item.type === 'task' ? `[할일] ${item.title}` : item.title)}`);
  if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
  if (item.memo) lines.push(`DESCRIPTION:${escapeText(item.memo)}`);
  if (item.recurrence) {
    lines.push(`RRULE:${toRRule(item.recurrence, start.slice(0, 10), dateOnly)}`);
    for (const d of item.exdates ?? []) {
      lines.push(dateOnly ? `EXDATE;VALUE=DATE:${icsDate(d)}` : `EXDATE:${icsDate(d)}T${start.slice(11, 13)}${start.slice(14, 16)}00`);
    }
  }
  for (const m of item.reminders ?? []) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(item.title)}`, `TRIGGER:${triggerValue(m)}`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

/**
 * 항목들 → .ics 문자열. 마감 없는 할일, 완료한 할일은 뺀다.
 * 반복 원본(회차가 아닌 저장된 항목)을 넘겨야 RRULE이 붙는다.
 */
export function itemsToIcs(items, { now = new Date(), calName = 'Planit' } = {}) {
  const stamp = utcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planit//Planit KO//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`,
  ];
  for (const item of items) {
    if (item.type === 'task' && (!item.due || (!item.recurrence && item.done))) continue;
    if (item.type === 'event' && (!item.start || !item.end)) continue;
    lines.push(...eventLines(item, stamp));
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** 파일 이름으로 쓸 수 없는 문자 제거 */
export function icsFileName(title) {
  const base = String(title ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `${base || 'planit'}.ics`;
}
