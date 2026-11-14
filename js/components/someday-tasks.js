// 사이드바: 마감 없는 "언제든" 할일 목록
import { h, preserveFocus } from '../utils/dom.js';
import { taskChip, bindItemEvents } from '../views/chips.js';

export function createSomedayTasks({ store, root, openModal }) {
  bindItemEvents(root, { store, openModal });
  root.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-add-someday]')) {
      openModal({ draft: { type: 'task', due: null } });
    }
  });

  function render() {
    const tasks = store.selectSomedayTasks();
    preserveFocus(root, () => {
      root.replaceChildren(
        h('h3', { class: 'section-title' },
          h('span', {}, `언제든 할일 ${tasks.length ? `(${tasks.filter((t) => !t.item.done).length})` : ''}`),
          h('button', {
            type: 'button', class: 'icon-btn sm', 'data-add-someday': '', 'aria-label': '마감 없는 할일 추가',
          }, '+')),
        tasks.length
          ? h('div', { class: 'someday-list' }, tasks.map(({ item }) => taskChip(item)))
          : h('p', { class: 'empty' }, '마감 없는 할일이 없습니다.'),
      );
    });
  }

  return { render };
}
