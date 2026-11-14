// 검색: 제목·메모·장소 (네이버 캘린더의 일정 검색처럼 전체 기간에서). 모바일은 전체 화면.
import { h } from '../utils/dom.js';
import { describeWhen } from '../utils/format.js';
import { listRow } from '../views/chips.js';

export function createSearchDialog({ store, openModal }) {
  const input = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: '제목, 메모, 장소 검색',
    autocomplete: 'off',
    enterkeyhint: 'search',
    'aria-label': '검색어',
  });
  const results = h('div', { class: 'search-results', 'aria-live': 'polite' });
  const dlg = h('dialog', { class: 'modal search-dialog', 'aria-label': '검색' },
    h('div', { class: 'search-form' },
      h('div', { class: 'search-head' },
        h('span', { class: 'search-icon', 'aria-hidden': 'true' }, '🔍'),
        input,
        h('button', { type: 'button', class: 'link-btn', 'data-close': '' }, '닫기')),
      results));
  document.body.append(dlg);

  let timer = null;

  function render() {
    const q = input.value.trim();
    if (!q) {
      results.replaceChildren(h('p', { class: 'empty search-empty' }, '찾을 단어를 입력하세요. 여러 단어는 모두 들어 있는 항목만 보여 줍니다.'));
      return;
    }
    const { categories } = store.getState();
    const found = store.searchItems(q);
    if (!found.length) {
      results.replaceChildren(h('p', { class: 'empty search-empty' }, `"${q}"에 해당하는 항목이 없습니다.`));
      return;
    }
    const catName = (id) => categories.find((c) => c.id === id)?.name ?? '';
    results.replaceChildren(
      h('p', { class: 'search-count' }, `${found.length}개${found.length >= 100 ? ' (최대 100개 표시)' : ''}`),
      h('ul', { class: 'task-list' }, found.map((item) => listRow(item, {
        meta: describeWhen(item), categoryName: catName(item.categoryId),
      }))));
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 80);
  });
  input.addEventListener('keydown', (e) => {
    // 검색 중 Enter: 첫 결과 열기
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      results.querySelector('[data-open]')?.click();
    }
  });

  dlg.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target === dlg || e.target.closest('[data-close]')) {
      dlg.close();
      return;
    }
    const opener = e.target.closest('[data-open]');
    if (opener) {
      const item = store.getItem(opener.dataset.open);
      dlg.close();
      if (item) openModal({ item });
    }
  });
  // 검색 결과의 할일 체크
  dlg.addEventListener('change', (e) => {
    const id = e.target?.dataset?.toggle;
    if (id) {
      store.toggleTask(id);
      render();
    }
  });

  return {
    open() {
      dlg.showModal();
      input.select();
      render();
    },
    isOpen: () => dlg.open,
  };
}
