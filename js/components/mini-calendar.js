// 사이드바 미니 캘린더: 날짜 선택 + 항목 있는 날 점 표시. 월 이동은 메인 뷰와 독립.
import { h, preserveFocus } from '../utils/dom.js';
import {
  getMonthGrid, addDays, addMonths, startOfMonth, toLocalDateStr, parseLocal, isSameDay, formatKo, WEEKDAYS_KO,
} from '../utils/date.js';
import { eachItemDay } from '../models.js';
import { holidayName } from '../holidays.js';

export function createMiniCalendar({ store, root }) {
  let cursor = startOfMonth(store.getState().selectedDate);
  let lastSelected = null;

  root.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      cursor = addMonths(cursor, Number(nav.dataset.nav));
      render();
      return;
    }
    const day = e.target.closest('[data-date]');
    if (day) store.setSelectedDate(parseLocal(day.dataset.date));
  });

  function render() {
    const { selectedDate, settings, now } = store.getState();
    if (!lastSelected || !isSameDay(lastSelected, selectedDate)) {
      cursor = startOfMonth(selectedDate);
      lastSelected = selectedDate;
    }
    const grid = getMonthGrid(cursor.getFullYear(), cursor.getMonth(), settings.weekStartsOn);
    const from = grid[0];
    const to = addDays(grid[41], 1);
    const busy = new Set();
    for (const item of store.selectItemsInRange(from, to)) eachItemDay(item, from, to, (d) => busy.add(d));

    preserveFocus(root, () => {
      root.replaceChildren(
        h('div', { class: 'mini-cal-head' },
          h('button', { type: 'button', class: 'icon-btn sm', 'data-nav': '-1', 'data-focus-key': 'nav:-1', 'aria-label': '이전 달' }, '‹'),
          h('span', { class: 'mini-cal-title' }, formatKo(cursor, 'YYYY년 M월')),
          h('button', { type: 'button', class: 'icon-btn sm', 'data-nav': '1', 'data-focus-key': 'nav:1', 'aria-label': '다음 달' }, '›')),
        h('div', { class: 'mini-cal-grid' },
          Array.from({ length: 7 }, (_, i) => h('span', { class: 'mini-cal-wd', 'aria-hidden': 'true' },
            WEEKDAYS_KO[(settings.weekStartsOn + i) % 7])),
          grid.map((d) => {
            const ds = toLocalDateStr(d);
            const cls = ['mini-day'];
            if (d.getMonth() !== cursor.getMonth()) cls.push('is-other');
            if (isSameDay(d, now)) cls.push('is-today');
            if (isSameDay(d, selectedDate)) cls.push('is-selected');
            if (busy.has(ds)) cls.push('has-items');
            const holiday = settings.showHolidays ? holidayName(ds) : null;
            if (holiday) cls.push('is-holiday');
            return h('button', {
              type: 'button',
              class: cls.join(' '),
              'data-date': ds,
              'data-focus-key': `mini:${ds}`,
              title: holiday,
              'aria-label': formatKo(d, 'M월 D일 ddd요일') + (holiday ? ` ${holiday}` : '') + (busy.has(ds) ? ', 항목 있음' : ''),
              'aria-current': isSameDay(d, selectedDate) ? 'date' : null,
            }, d.getDate());
          })),
      );
    });
  }

  return { render };
}
