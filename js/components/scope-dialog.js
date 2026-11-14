// 반복 회차 수정/삭제 범위 선택: 이 일정 / 이 일정 및 향후 일정 / 모든 일정 (Google Calendar 방식)
// 할일이면 "이 할일 / 이 할일 및 향후 할일 / 모든 할일"
import { h } from '../utils/dom.js';

let dialog = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = h('dialog', { class: 'scope-dialog', 'aria-labelledby': 'scope-title' });
  document.body.append(dialog);
  return dialog;
}

/**
 * @param {{ title: string, noun?: '일정'|'할일', allowThis?: boolean, confirmLabel?: string, danger?: boolean }} opts
 * @returns {Promise<'this'|'following'|'all'|null>} 취소하면 null
 */
export function askScope({ title, noun = '일정', allowThis = true, confirmLabel = '확인', danger = false }) {
  const dlg = ensureDialog();
  const options = [
    { value: 'this', label: `이 ${noun}` },
    { value: 'following', label: `이 ${noun} 및 향후 ${noun}` },
    { value: 'all', label: `모든 ${noun}` },
  ].filter((o) => allowThis || o.value !== 'this');
  const form = h('form', { method: 'dialog', class: 'scope-form' },
    h('h2', { id: 'scope-title', class: 'scope-title' }, title),
    !allowThis ? h('p', { class: 'scope-note' }, `반복 규칙을 바꾸면 이 ${noun}만 따로 바꿀 수 없습니다.`) : null,
    h('div', { class: 'scope-options', role: 'radiogroup', 'aria-labelledby': 'scope-title' },
      options.map((o, i) => h('label', { class: 'scope-option' },
        h('input', { type: 'radio', name: 'scope', value: o.value, checked: i === 0 }),
        h('span', {}, o.label)))),
    h('div', { class: 'scope-actions' },
      h('button', { type: 'button', class: 'btn', 'data-cancel': '' }, '취소'),
      h('button', { type: 'submit', class: `btn ${danger ? 'danger-solid' : 'primary'}` }, confirmLabel)));
  dlg.replaceChildren(form);

  return new Promise((resolve) => {
    let result = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      result = form.elements.scope.value || null;
      dlg.close();
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => resolve(result), { once: true });
    dlg.showModal();
    form.querySelector('input[name="scope"]:checked')?.focus();
  });
}
