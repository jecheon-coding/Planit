// 뷰 공통 항목 칩 렌더러.
// 클릭 처리는 각 뷰의 이벤트 위임이 담당: [data-open]=상세 열기, [data-toggle]=할일 완료 토글
import { h } from '../utils/dom.js';
import { categoryColor } from '../models.js';
import { describeWhen } from '../utils/format.js';

export function eventChip(item, { continued = false } = {}) {
  const time = !item.allDay && !continued ? item.start.slice(11, 16) : null;
  return h('button', {
    type: 'button',
    class: `chip chip-event${item.allDay ? ' is-allday' : ''}`,
    'data-open': item.id,
    'data-focus-key': `open:${item.id}`,
    style: { '--item-color': categoryColor(item.categoryId) },
    title: `${item.title}\n${describeWhen(item)}`,
  },
  item.allDay ? null : h('span', { class: 'chip-dot', 'aria-hidden': 'true' }),
  time ? h('span', { class: 'chip-time' }, time) : null,
  h('span', { class: 'chip-label' }, continued ? `… ${item.title}` : item.title));
}

export function taskChip(item, { overdue = false, showDate = false } = {}) {
  const dueTime = item.due && item.due.length > 10 ? item.due.slice(11) : null;
  return h('div', {
    class: `chip chip-task${item.done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`,
    style: { '--item-color': categoryColor(item.categoryId) },
  },
  h('input', {
    type: 'checkbox',
    class: 'chip-check',
    checked: item.done,
    'data-toggle': item.id,
    'data-focus-key': `toggle:${item.id}`,
    'aria-label': `${item.title} 완료`,
  }),
  h('button', {
    type: 'button',
    class: 'chip-title',
    'data-open': item.id,
    'data-focus-key': `open:${item.id}`,
    title: `${item.title}\n${describeWhen(item)}`,
  },
  overdue ? h('span', { class: 'badge badge-overdue' }, '지연') : null,
  showDate && item.due ? h('span', { class: 'chip-time' }, describeWhen(item).replace('까지', '')) : null,
  !showDate && dueTime ? h('span', { class: 'chip-time' }, dueTime) : null,
  h('span', { class: 'chip-label' }, item.title)));
}

/**
 * 목록형 행 (할일 뷰, 모바일 월간 아래 목록). 터치하기 좋은 높이.
 * meta: 제목 아래 보조 정보 문자열
 */
export function listRow(item, { meta = '', overdue = false, categoryName = '' } = {}) {
  const isTask = item.type === 'task';
  const time = !isTask
    ? (item.allDay ? '종일' : item.start.slice(11, 16))
    : null;
  return h('li', {
    class: `list-row${isTask ? ' is-task' : ' is-event'}${item.done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`,
    style: { '--item-color': categoryColor(item.categoryId) },
  },
  isTask
    ? h('input', {
      type: 'checkbox',
      class: 'row-check',
      checked: item.done,
      'data-toggle': item.id,
      'data-focus-key': `toggle:${item.id}`,
      'aria-label': `${item.title} 완료`,
    })
    : h('span', { class: 'row-time' }, time),
  h('button', {
    type: 'button',
    class: 'row-main',
    'data-open': item.id,
    'data-focus-key': `open:${item.id}`,
  },
  h('span', { class: 'row-title' }, item.title),
  meta || categoryName
    ? h('span', { class: 'row-meta' },
      categoryName ? h('span', { class: 'row-cat' }, categoryName) : null,
      meta ? h('span', {}, meta) : null)
    : null),
  h('span', { class: 'row-bar', 'aria-hidden': 'true' }));
}

/** 뷰 루트에 공통 클릭/토글 위임을 건다 */
export function bindItemEvents(root, { store, openModal }) {
  root.addEventListener('change', (e) => {
    const id = e.target?.dataset?.toggle;
    if (id) store.toggleTask(id);
  });
  root.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('[data-toggle]')) return;
    const opener = e.target.closest('[data-open]');
    if (opener && root.contains(opener)) {
      const item = store.getItem(opener.dataset.open);
      if (item) openModal({ item });
      e.stopPropagation();
    }
  });
  // role="button" 요소(타임라인 블록)의 키보드 지원
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target instanceof Element ? e.target.closest('[role="button"][data-open]') : null;
    if (!el) return;
    e.preventDefault();
    el.click();
  });
}
