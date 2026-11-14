// 사이드바: 카테고리 필터 + 색상 변경, 종류 필터, 완료 숨기기
import { h, preserveFocus } from '../utils/dom.js';
import { categoryColor, categoryVar } from '../models.js';

export function createFilterBar({ store, root }) {
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.cat) store.toggleInFilter('categories', t.dataset.cat);
    else if (t.dataset.type) store.toggleInFilter('types', t.dataset.type);
    else if (t.name === 'hideDone') store.setFilter({ hideDone: t.checked });
    else if (t.dataset.color) store.updateCategory(t.dataset.color, { color: t.value });
  });

  // 색상 선택 중에는 CSS 변수만 바꿔 즉시 미리보기 (저장은 change 시점)
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.color) document.documentElement.style.setProperty(categoryVar(t.dataset.color), t.value);
  });

  root.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-only]') : null;
    if (!btn) return;
    const { categories, settings } = store.getState();
    const id = btn.dataset.only;
    const onlyThis = settings.filters.categories.length === 1 && settings.filters.categories[0] === id;
    store.setFilter({ categories: onlyThis ? categories.map((c) => c.id) : [id] });
  });

  function render() {
    const { categories, settings } = store.getState();
    const f = settings.filters;
    preserveFocus(root, () => {
      root.replaceChildren(
        h('h3', { class: 'section-title' }, '카테고리'),
        h('ul', { class: 'cat-list' },
          categories.map((c) => h('li', { class: 'cat-row', style: { '--item-color': categoryColor(c.id) } },
            h('label', { class: 'cat-toggle' },
              h('input', {
                type: 'checkbox',
                checked: f.categories.includes(c.id),
                'data-cat': c.id,
                'data-focus-key': `cat:${c.id}`,
              }),
              h('span', { class: 'cat-name' }, c.name)),
            h('button', {
              type: 'button',
              class: 'cat-only',
              'data-only': c.id,
              'data-focus-key': `only:${c.id}`,
              title: `${c.name}만 보기 (다시 누르면 전체)`,
              'aria-label': `${c.name}만 보기`,
            }, '◎'),
            h('input', {
              type: 'color',
              class: 'color-input',
              value: c.color,
              'data-color': c.id,
              'data-focus-key': `color:${c.id}`,
              'aria-label': `${c.name} 색상 변경`,
              title: '색상 변경',
            })))),
        h('h3', { class: 'section-title' }, '보기'),
        h('div', { class: 'opt-list' },
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: f.types.includes('event'), 'data-type': 'event', 'data-focus-key': 'type:event' }),
            '일정'),
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: f.types.includes('task'), 'data-type': 'task', 'data-focus-key': 'type:task' }),
            '할일'),
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', name: 'hideDone', checked: f.hideDone, 'data-focus-key': 'hideDone' }),
            '완료된 할일 숨기기')),
      );
    });
  }

  return { render };
}
