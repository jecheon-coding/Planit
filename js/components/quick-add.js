// 빠른 입력창: 입력 중 실시간 파싱 미리보기 → Enter 저장 / Shift+Enter 상세 편집 / Esc 취소
import { h } from '../utils/dom.js';
import { parseQuickInput } from '../parser/index.js';
import { categoryColor } from '../models.js';
import { describeWhen, typeLabel } from '../utils/format.js';
import { parseLocal } from '../utils/date.js';

const DEBOUNCE_MS = 100;
const KIND_LABEL = {
  date: '날짜', time: '시간', duration: '기간', allday: '종일', category: '카테고리', type: '종류',
};

export function createQuickAdd({ store, root, openModal, toast }) {
  const input = h('input', {
    type: 'text',
    id: 'quick-input',
    class: 'qa-input',
    placeholder: '빠른 입력 — 예) 내일 오후 3시 회의 #업무',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': '빠른 입력',
    'aria-describedby': 'qa-preview',
    enterkeyhint: 'done',
  });
  const submitBtn = h('button', { type: 'submit', class: 'qa-submit', hidden: true }, '추가');
  const preview = h('div', { id: 'qa-preview', class: 'qa-preview', 'aria-live': 'polite' });
  // <form>으로 감싸면 모바일 키보드의 완료/이동 키도 submit으로 들어온다
  const form = h('form', { class: 'qa-box', role: 'search', 'aria-label': '빠른 입력' },
    h('span', { class: 'qa-icon', 'aria-hidden': 'true' }, '⚡'),
    input,
    h('kbd', { class: 'qa-kbd', title: '단축키: /' }, '/'),
    submitBtn);
  root.append(form, preview);

  let timer = null;
  let pendingCommit = null; // 한글 IME 조합 중 Enter 처리용
  let lastCommitAt = 0;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (Date.now() - lastCommitAt < 300) return; // keydown에서 이미 처리
    pendingCommit = null;
    commit();
  });

  function parse() {
    const { categories, settings } = store.getState();
    return parseQuickInput(input.value, new Date(), {
      categories,
      defaultDurationMin: settings.defaultDurationMin,
    });
  }

  function toDraft(r) {
    const { settings } = store.getState();
    return {
      type: r.type,
      title: r.title,
      categoryId: r.categoryId ?? settings.defaultCategoryId,
      start: r.start ?? undefined,
      end: r.end ?? undefined,
      allDay: r.allDay,
      due: r.due,
    };
  }

  function highlighted(src, tokens) {
    const parts = [];
    let pos = 0;
    for (const t of tokens) {
      if (t.start < pos) continue;
      if (t.start > pos) parts.push(src.slice(pos, t.start));
      parts.push(h('mark', { class: `k-${t.kind}`, title: KIND_LABEL[t.kind] }, src.slice(t.start, t.end)));
      pos = t.end;
    }
    if (pos < src.length) parts.push(src.slice(pos));
    return parts;
  }

  function renderPreview() {
    submitBtn.hidden = !input.value.trim();
    if (!input.value.trim()) {
      preview.replaceChildren();
      return;
    }
    const r = parse();
    const { categories, settings } = store.getState();
    const draft = toDraft(r);
    const cat = categories.find((c) => c.id === draft.categoryId);
    const parts = [
      h('div', { class: 'qa-summary' },
        h('span', { class: `qa-pill type-${r.type}` }, typeLabel(r.type)),
        h('span', { class: 'qa-pill' }, `📅 ${describeWhen({ ...draft, end: draft.end ?? draft.start })}`),
        h('span', { class: 'qa-pill cat', style: { '--item-color': categoryColor(draft.categoryId) } },
          h('span', { class: 'chip-dot', 'aria-hidden': 'true' }),
          cat?.name ?? draft.categoryId,
          r.categorySource === 'keyword' ? h('small', {}, ' (추론)') : null,
          !r.categoryId && settings.defaultCategoryId ? h('small', {}, ' (기본)') : null),
        h('span', { class: 'qa-title' }, `“${r.title || (r.type === 'task' ? '새 할일' : '새 일정')}”`)),
      r.tokens.length
        ? h('div', { class: 'qa-source' }, h('span', { class: 'muted' }, '인식: '), highlighted(input.value, r.tokens))
        : null,
      r.warnings.length ? h('div', { class: 'qa-warn' }, `⚠ ${r.warnings.join(' ')}`) : null,
      h('div', { class: 'qa-hint' },
        h('kbd', {}, 'Enter'), ' 저장 · ', h('kbd', {}, 'Shift'), '+', h('kbd', {}, 'Enter'), ' 상세 편집 · ',
        h('kbd', {}, 'Esc'), ' 취소'),
    ];
    preview.replaceChildren(...parts.filter(Boolean));
  }

  function commit({ detailed = false } = {}) {
    if (!input.value.trim()) return;
    lastCommitAt = Date.now();
    const draft = toDraft(parse());
    if (detailed) {
      openModal({ draft });
      clear();
      return;
    }
    const item = store.addItem(draft);
    const dateStr = (item.start ?? item.due)?.slice(0, 10);
    if (dateStr) store.setSelectedDate(parseLocal(dateStr));
    toast(`추가했습니다: ${item.title} · ${describeWhen(item)}`, {
      actionLabel: '실행 취소',
      onAction: () => store.deleteItem(item.id),
    });
    clear();
  }

  function clear() {
    input.value = '';
    renderPreview();
  }

  input.addEventListener('input', () => {
    submitBtn.hidden = !input.value.trim();
    clearTimeout(timer);
    timer = setTimeout(renderPreview, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // 한글 조합 중 Enter: 조합이 끝난 뒤 한 번만 저장되도록 미룬다
      if (e.isComposing || e.keyCode === 229) {
        pendingCommit = { detailed: e.shiftKey };
        return;
      }
      e.preventDefault();
      const opts = pendingCommit ?? { detailed: e.shiftKey };
      pendingCommit = null;
      commit(opts);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clear();
      input.blur();
    }
  });

  input.addEventListener('compositionend', () => {
    if (!pendingCommit) return;
    setTimeout(() => {
      if (!pendingCommit) return; // 브라우저가 조합 후 Enter keydown을 다시 보낸 경우 이미 처리됨
      const opts = pendingCommit;
      pendingCommit = null;
      commit(opts);
    }, 0);
  });

  return {
    focus: () => {
      input.focus();
      input.select();
    },
    refresh: renderPreview,
  };
}
