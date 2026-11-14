import { h, preserveFocus, isNarrow } from '../utils/dom.js';
import {
  getMonthGrid, addDays, toLocalDateStr, parseLocal, isSameDay, formatKo, WEEKDAYS_KO,
} from '../utils/date.js';
import { eachItemDay } from '../models.js';
import {
  eventChip, taskChip, listRow, bindItemEvents,
} from './chips.js';

const MAX_PER_CELL = 3;
const MOBILE_DOTS = 6;

/** 셀 안 정렬: 종일 → 시간(시작순) → 할일(미완료 먼저) */
function sortEntries(a, b) {
  const rank = (e) => (e.item.type === 'task' ? 2 : e.item.allDay ? 0 : 1);
  return rank(a) - rank(b)
    || (a.item.type === 'task' ? a.item.done - b.item.done : 0)
    || String(a.item.start ?? a.item.due ?? '').localeCompare(String(b.item.start ?? b.item.due ?? ''))
    || a.item.title.localeCompare(b.item.title, 'ko');
}

export function createMonthView({ store, openModal }) {
  const root = h('section', { class: 'month-view', 'aria-label': '월간 캘린더' });
  bindItemEvents(root, { store, openModal });

  let dayMap = new Map();
  let popoverDate = null;

  const goToDay = (dateStr) => {
    popoverDate = null;
    store.setSelectedDate(parseLocal(dateStr));
    store.setView('day');
  };

  root.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const t = e.target;
    if (t.closest('[data-open],[data-toggle]')) return; // chips.js에서 처리

    const add = t.closest('[data-add]');
    if (add) {
      openModal({ draft: { type: 'event', start: `${add.dataset.add}T09:00` } });
      return;
    }
    // 모바일: 셀을 누르면 날짜만 선택하고 아래 목록으로 보여준다
    const narrowCell = isNarrow() ? t.closest('.month-cell[data-date]') : null;
    if (narrowCell) {
      store.setSelectedDate(parseLocal(narrowCell.dataset.date));
      return;
    }
    const more = t.closest('[data-more]');
    if (more) {
      popoverDate = popoverDate === more.dataset.more ? null : more.dataset.more;
      renderPopover();
      return;
    }
    const goto = t.closest('[data-goto]');
    if (goto) {
      goToDay(goto.dataset.goto);
      return;
    }
    if (t.closest('.month-popover, .month-agenda')) return;
    const cell = t.closest('[data-date]');
    if (cell) {
      popoverDate = null;
      store.setSelectedDate(parseLocal(cell.dataset.date));
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popoverDate) {
      e.stopPropagation();
      const date = popoverDate;
      popoverDate = null;
      renderPopover();
      root.querySelector(`[data-more="${date}"]`)?.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (popoverDate && e.target instanceof Element && !root.contains(e.target)) {
      popoverDate = null;
      renderPopover();
    }
  });

  function buildDayMap(grid) {
    const from = grid[0];
    const to = addDays(grid[grid.length - 1], 1);
    const map = new Map();
    for (const item of store.selectItemsInRange(from, to)) {
      eachItemDay(item, from, to, (dateStr, { isStart }) => {
        if (!map.has(dateStr)) map.set(dateStr, []);
        map.get(dateStr).push({ item, isStart });
      });
    }
    for (const list of map.values()) list.sort(sortEntries);
    return map;
  }

  function renderEntry({ item, isStart }, dayIndex) {
    if (item.type === 'task') return taskChip(item);
    // 여러 날 일정: 시작일과 매주 첫 칸에서만 제목, 나머지는 "… 제목"
    return eventChip(item, { continued: !isStart && dayIndex % 7 !== 0 });
  }

  function renderCell(date, index, ctx) {
    const dateStr = toLocalDateStr(date);
    const entries = dayMap.get(dateStr) ?? [];
    const hidden = entries.length - MAX_PER_CELL;
    const shown = hidden > 0 ? MAX_PER_CELL - 1 : entries.length;
    // 데스크톱은 shown개만, 모바일(점 표시)은 최대 MOBILE_DOTS개까지 보이도록 여분은 CSS로 숨긴다
    const visible = entries.slice(0, Math.max(shown, MOBILE_DOTS));
    const classes = ['month-cell'];
    if (date.getMonth() !== ctx.month) classes.push('is-other');
    if (isSameDay(date, ctx.now)) classes.push('is-today');
    if (isSameDay(date, ctx.selected)) classes.push('is-selected');
    if (date.getDay() === 0) classes.push('is-sun');
    if (date.getDay() === 6) classes.push('is-sat');

    return h('div', { class: classes.join(' '), 'data-date': dateStr },
      h('div', { class: 'cell-head' },
        h('button', {
          type: 'button',
          class: 'cell-date',
          'data-goto': dateStr,
          'data-focus-key': `goto:${dateStr}`,
          'aria-label': `${formatKo(date, 'M월 D일 ddd요일')} 일간 보기${entries.length ? `, 항목 ${entries.length}개` : ''}`,
        }, date.getDate()),
        h('button', {
          type: 'button', class: 'cell-add', 'data-add': dateStr, 'aria-label': `${formatKo(date, 'M월 D일')}에 일정 추가`,
        }, '+')),
      h('div', { class: 'cell-items' },
        visible.map((entry, i) => {
          const el = renderEntry(entry, index);
          if (i >= shown) el.classList.add('cell-overflow');
          return el;
        }),
        hidden > 0
          ? h('button', {
            type: 'button',
            class: 'cell-more',
            'data-more': dateStr,
            'data-focus-key': `more:${dateStr}`,
            'aria-expanded': String(popoverDate === dateStr),
          }, `+${hidden + 1} 더보기`)
          : null));
  }

  function renderPopover({ focus = true } = {}) {
    root.querySelector('.month-popover')?.remove();
    root.querySelectorAll('[data-more]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.more === popoverDate)));
    if (!popoverDate) return;
    const cell = root.querySelector(`[data-date="${popoverDate}"]`);
    if (!cell) {
      popoverDate = null;
      return;
    }
    const date = parseLocal(popoverDate);
    const entries = dayMap.get(popoverDate) ?? [];
    const pop = h('div', { class: 'month-popover', role: 'dialog', 'aria-label': `${formatKo(date, 'M월 D일')} 전체 항목` },
      h('div', { class: 'popover-head' },
        h('button', { type: 'button', class: 'popover-date', 'data-goto': popoverDate },
          formatKo(date, 'M월 D일 (ddd)')),
        h('span', { class: 'muted' }, `${entries.length}개`)),
      h('div', { class: 'popover-items' }, entries.map((entry) => renderEntry({ ...entry, isStart: true }, 0))));

    // 셀 기준으로 위치 지정 (뷰 밖으로 나가지 않게 보정)
    const rootRect = root.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    const width = 260;
    let left = rect.left - rootRect.left;
    left = Math.min(left, rootRect.width - width - 8);
    let top = rect.top - rootRect.top;
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.width = `${width}px`;
    root.append(pop);
    const maxTop = rootRect.height - pop.offsetHeight - 8;
    top = Math.min(top, maxTop);
    pop.style.top = `${Math.max(8, top)}px`;
    if (focus) pop.querySelector('button')?.focus();
  }

  /** 모바일 전용: 그리드 아래 선택한 날짜의 목록 (데스크톱에서는 CSS로 숨김) */
  function renderAgenda(selectedDate, categories) {
    const dateStr = toLocalDateStr(selectedDate);
    const entries = dayMap.get(dateStr) ?? [];
    const catName = (id) => categories.find((c) => c.id === id)?.name ?? '';
    const meta = (item) => {
      if (item.type === 'task') return item.due?.length > 10 ? `${item.due.slice(11)}까지` : '할일';
      if (item.allDay) return '';
      const end = parseLocal(item.end);
      return `~ ${isSameDay(end, selectedDate) ? formatKo(end, 'HH:mm') : formatKo(end, 'M/D HH:mm')}`;
    };
    return h('div', { class: 'month-agenda' },
      h('div', { class: 'agenda-head' },
        h('h3', {}, formatKo(selectedDate, 'M월 D일 (ddd)')),
        h('button', { type: 'button', class: 'btn sm', 'data-goto': dateStr }, '일간 보기')),
      entries.length
        ? h('ul', { class: 'task-list' }, entries.map(({ item }) => listRow(item, {
          meta: meta(item), categoryName: catName(item.categoryId),
        })))
        : h('p', { class: 'empty agenda-empty' }, '일정이 없습니다.'));
  }

  function render() {
    const state = store.getState();
    const { selectedDate, settings, now } = state;
    const scrollTop = root.scrollTop;
    const month = selectedDate.getMonth();
    const grid = getMonthGrid(selectedDate.getFullYear(), month, settings.weekStartsOn);
    dayMap = buildDayMap(grid);

    const weekdays = Array.from({ length: 7 }, (_, i) => (settings.weekStartsOn + i) % 7);
    const ctx = { month, now, selected: selectedDate };

    preserveFocus(root, () => {
      root.replaceChildren(
        h('div', { class: 'month-weekdays', 'aria-hidden': 'true' },
          weekdays.map((wd) => h('div', {
            class: wd === 0 ? 'wd-sun' : wd === 6 ? 'wd-sat' : '',
          }, WEEKDAYS_KO[wd]))),
        h('div', { class: 'month-grid', 'aria-label': formatKo(selectedDate, 'YYYY년 M월') },
          grid.map((date, i) => renderCell(date, i, ctx))),
        renderAgenda(selectedDate, state.categories),
      );
      if (popoverDate) renderPopover({ focus: false });
    });
    root.scrollTop = scrollTop;
  }

  return { root, render };
}
