import { h, preserveFocus } from '../utils/dom.js';
import {
  parseLocal, toLocalDateStr, toLocalDateTimeStr, startOfDay, isSameDay,
  minutesBetween, atMinutes, formatKo, pad,
} from '../utils/date.js';
import { categoryColor } from '../models.js';
import { describeWhen } from '../utils/format.js';
import { layoutColumns } from './layout-overlap.js';
import { eventChip, taskChip, bindItemEvents } from './chips.js';

const HOUR_HEIGHT = 56; // px — CSS의 --hour-height로 주입
const MIN_BLOCK_PX = 22;
const SNAP_MIN = 15;

const pxPerMin = HOUR_HEIGHT / 60;

export function createDayView({ store, openModal }) {
  const root = h('section', { class: 'day-view', 'aria-label': '일간 타임라인' });
  root.style.setProperty('--hour-height', `${HOUR_HEIGHT}px`);
  bindItemEvents(root, { store, openModal });

  let scrollEl = null;
  let timelineEl = null;
  let nowLineEl = null;
  let lastScrollKey = null;
  let range = { start: 0, end: 1440 };
  let renderedDate = null;

  // 타임라인 빈 곳 클릭 → 해당 시각(15분 단위)으로 새 일정
  root.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !timelineEl) return;
    if (!e.target.closest('.timeline') || e.target.closest('[data-open]')) return;
    const rect = timelineEl.getBoundingClientRect();
    const min = range.start + Math.floor((e.clientY - rect.top) / pxPerMin / SNAP_MIN) * SNAP_MIN;
    if (min < range.start || min >= range.end) return;
    const { selectedDate, settings } = store.getState();
    const start = atMinutes(selectedDate, min);
    const end = atMinutes(selectedDate, min + settings.defaultDurationMin);
    openModal({ draft: { type: 'event', start: toLocalDateTimeStr(start), end: toLocalDateTimeStr(end) } });
  });

  root.addEventListener('click', (e) => {
    const add = e.target instanceof Element ? e.target.closest('[data-add-task]') : null;
    if (add) openModal({ draft: { type: 'task', due: add.dataset.addTask } });
  });

  function minuteOf(dayStart, str) {
    return minutesBetween(dayStart, parseLocal(str));
  }

  function renderTop(dateStr, allDay, tasks) {
    return h('div', { class: 'day-top' },
      h('div', { class: 'day-row' },
        h('span', { class: 'day-row-label' }, '종일'),
        h('div', { class: 'day-row-items' },
          allDay.length
            ? allDay.map((item) => eventChip(item))
            : h('span', { class: 'empty' }, '종일 일정 없음'))),
      h('div', { class: 'day-row' },
        h('span', { class: 'day-row-label' }, '할일'),
        h('div', { class: 'day-row-items' },
          tasks.map(({ item, overdue }) => taskChip(item, { overdue, showDate: overdue })),
          h('button', {
            type: 'button', class: 'chip chip-add', 'data-add-task': dateStr, 'aria-label': '이 날짜에 할일 추가',
          }, '+ 할일'))));
  }

  function renderEventBlock(item, layout, dayStart, clip) {
    const top = (layout.startMin - range.start) * pxPerMin;
    const height = Math.max((layout.endMin - layout.startMin) * pxPerMin, MIN_BLOCK_PX);
    const short = height < 40;
    const s = parseLocal(item.start);
    const e = parseLocal(item.end);
    const fmt = (d) => (isSameDay(d, dayStart) ? formatKo(d, 'HH:mm') : formatKo(d, 'M/D HH:mm'));
    return h('div', {
      class: `event-block${short ? ' is-short' : ''}${clip.top ? ' clip-top' : ''}${clip.bottom ? ' clip-bottom' : ''}`,
      role: 'button',
      tabindex: '0',
      'data-open': item.id,
      'data-focus-key': `open:${item.id}`,
      'aria-label': `${item.title}, ${describeWhen(item)}`,
      title: `${item.title}\n${describeWhen(item)}`,
      style: {
        top: `${top}px`,
        height: `${height - 2}px`,
        left: `calc(${(layout.col / layout.cols) * 100}% + 1px)`,
        width: `calc(${100 / layout.cols}% - 4px)`,
        '--item-color': categoryColor(item.categoryId),
      },
    },
    h('div', { class: 'event-title' }, item.title),
    h('div', { class: 'event-time' }, `${fmt(s)}–${fmt(e)}`));
  }

  function renderTimeline(dayStart, timed, tasks, now) {
    const totalMin = range.end - range.start;
    timelineEl = h('div', { class: 'timeline', style: { height: `${totalMin * pxPerMin}px` } });

    for (let hr = range.start / 60; hr < range.end / 60; hr += 1) {
      timelineEl.append(h('div', { class: 'hour', style: { top: `${(hr * 60 - range.start) * pxPerMin}px` } },
        h('span', { class: 'hour-label' }, `${pad(hr)}:00`)));
    }

    const layer = h('div', { class: 'events-layer' });
    const clips = new Map();
    const spans = timed.map((item) => {
      const rawStart = minuteOf(dayStart, item.start);
      const rawEnd = minuteOf(dayStart, item.end);
      clips.set(item.id, { top: rawStart < range.start, bottom: rawEnd > range.end });
      return {
        id: item.id,
        startMin: Math.max(rawStart, range.start),
        endMin: Math.min(rawEnd, range.end),
      };
    }).filter((s) => s.endMin > s.startMin);

    const byId = new Map(timed.map((i) => [i.id, i]));
    for (const layout of layoutColumns(spans, MIN_BLOCK_PX / pxPerMin)) {
      layer.append(renderEventBlock(byId.get(layout.id), layout, dayStart, clips.get(layout.id)));
    }
    timelineEl.append(layer);

    // 마감 시각이 있는 할일 → 점선 마커
    for (const { item, overdue } of tasks) {
      if (overdue || !item.due || item.due.length <= 10) continue;
      const min = minuteOf(dayStart, item.due);
      if (min < range.start || min > range.end) continue;
      timelineEl.append(h('div', {
        class: `task-marker${item.done ? ' is-done' : ''}`,
        style: { top: `${(min - range.start) * pxPerMin}px`, '--item-color': categoryColor(item.categoryId) },
      }, h('button', { type: 'button', 'data-open': item.id, title: describeWhen(item) }, `◆ ${item.title}`)));
    }

    nowLineEl = null;
    if (isSameDay(dayStart, now)) {
      nowLineEl = h('div', { class: 'now-line', 'aria-hidden': 'true' }, h('span', { class: 'now-label' }));
      timelineEl.append(nowLineEl);
      updateNow();
    }
    return timelineEl;
  }

  function initialScrollTop(dayStart, timed, now) {
    let targetMin = 8 * 60;
    if (isSameDay(dayStart, now)) targetMin = minutesBetween(dayStart, now) - 90;
    else if (timed.length) targetMin = Math.max(minuteOf(dayStart, timed[0].start), range.start) - 30;
    return Math.max(0, (targetMin - range.start) * pxPerMin);
  }

  function render({ reset = false } = {}) {
    const state = store.getState();
    const dayStart = startOfDay(state.selectedDate);
    const dateStr = toLocalDateStr(dayStart);
    range = {
      start: Math.max(0, state.settings.dayStartHour) * 60,
      end: Math.min(24, state.settings.dayEndHour) * 60,
    };
    const { allDay, timed, tasks } = store.selectDay(dayStart);
    const prevScroll = scrollEl?.scrollTop ?? 0;
    renderedDate = dayStart;

    preserveFocus(root, () => {
      scrollEl = h('div', { class: 'timeline-scroll' }, renderTimeline(dayStart, timed, tasks, state.now));
      root.replaceChildren(renderTop(dateStr, allDay, tasks), scrollEl);
    });

    if (reset || lastScrollKey !== dateStr) {
      scrollEl.scrollTop = initialScrollTop(dayStart, timed, state.now);
      lastScrollKey = dateStr;
    } else {
      scrollEl.scrollTop = prevScroll;
    }
  }

  /** 현재 시각선만 갱신 (매분 호출) */
  function updateNow() {
    if (!nowLineEl || !renderedDate) return;
    const { now } = store.getState();
    const min = minutesBetween(startOfDay(now), now);
    const visible = min >= range.start && min <= range.end && isSameDay(renderedDate, now);
    nowLineEl.hidden = !visible;
    nowLineEl.style.top = `${(min - range.start) * pxPerMin}px`;
    nowLineEl.firstChild.textContent = formatKo(now, 'HH:mm');
  }

  return { root, render, updateNow };
}
