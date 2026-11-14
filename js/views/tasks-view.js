// 할일 뷰: 지연됨 / 오늘 / 예정 / 언제든 / 완료됨 그룹 목록
import { h, preserveFocus } from '../utils/dom.js';
import { parseLocal, formatKo } from '../utils/date.js';
import { listRow, bindItemEvents } from './chips.js';

const GROUPS = [
  { key: 'overdue', title: '지연됨', meta: 'date' },
  { key: 'today', title: '오늘', meta: 'time' },
  { key: 'upcoming', title: '예정', meta: 'date' },
  { key: 'someday', title: '언제든', meta: null },
  { key: 'done', title: '완료됨', meta: 'date', collapsible: true },
];

function dueMeta(item, mode) {
  if (!item.due || !mode) return '';
  const d = parseLocal(item.due);
  const hasTime = item.due.length > 10;
  if (mode === 'time') return hasTime ? `${formatKo(d, 'HH:mm')}까지` : '';
  return formatKo(d, hasTime ? 'M/D(ddd) HH:mm' : 'M/D(ddd)');
}

export function createTasksView({ store, openModal }) {
  const root = h('section', { class: 'tasks-view', 'aria-label': '할일 목록' });
  bindItemEvents(root, { store, openModal });
  let doneOpen = false;

  root.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-add-task]')) {
      openModal({ draft: { type: 'task', due: null } });
    }
  });
  root.addEventListener('toggle', (e) => {
    if (e.target.matches?.('details.task-group')) doneOpen = e.target.open;
  }, true);

  function render() {
    const { categories } = store.getState();
    const catName = (id) => categories.find((c) => c.id === id)?.name ?? '';
    const groups = store.selectTaskGroups();
    const total = GROUPS.reduce((n, g) => n + groups[g.key].length, 0);
    const scrollTop = root.scrollTop;

    const sections = GROUPS.filter((g) => groups[g.key].length).map((g) => {
      const items = groups[g.key];
      const list = h('ul', { class: 'task-list' }, items.map((item) => listRow(item, {
        meta: dueMeta(item, g.meta),
        overdue: g.key === 'overdue',
        categoryName: catName(item.categoryId),
      })));
      const heading = [
        h('span', {}, g.title),
        h('span', { class: `count${g.key === 'overdue' ? ' is-danger' : ''}` }, items.length),
      ];
      if (g.collapsible) {
        return h('details', { class: 'task-group', open: doneOpen },
          h('summary', { class: 'task-group-title' }, heading), list);
      }
      return h('section', { class: `task-group group-${g.key}` },
        h('h3', { class: 'task-group-title' }, heading), list);
    });

    preserveFocus(root, () => {
      root.replaceChildren(h('div', { class: 'tasks-inner' },
        h('div', { class: 'tasks-head' },
          h('p', { class: 'muted' }, `미완료 ${total - groups.done.length}개`),
          h('button', { type: 'button', class: 'btn sm', 'data-add-task': '' }, '+ 할일')),
        total
          ? sections
          : h('div', { class: 'tasks-empty' },
            h('p', {}, '할일이 없습니다.'),
            h('p', { class: 'muted' }, '빠른 입력에 "금요일까지 보고서 제출"이나 "할일 장보기"처럼 입력해 보세요.'))));
    });
    root.scrollTop = scrollTop;
  }

  return { root, render };
}
