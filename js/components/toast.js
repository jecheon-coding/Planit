import { h, isNarrow } from '../utils/dom.js';

let rootEl = null;

export function initToast(root) {
  rootEl = root;
}

/**
 * 하단 알림. actionLabel/onAction을 주면 "실행 취소" 같은 버튼이 붙는다.
 * @returns {() => void} 즉시 닫기 함수
 */
export function showToast(message, { actionLabel, onAction, duration = 5000, tone = 'default' } = {}) {
  if (!rootEl) return () => {};
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 150);
  };
  const el = h('div', { class: `toast${tone === 'error' ? ' is-error' : ''}`, role: tone === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-msg' }, message),
    actionLabel
      ? h('button', {
        type: 'button',
        class: 'toast-action',
        onClick: () => {
          onAction?.();
          close();
        },
      }, actionLabel)
      : null,
    h('button', { type: 'button', class: 'toast-close', 'aria-label': '알림 닫기', onClick: close }, '✕'));

  // 너무 많이 쌓이지 않게: 데스크톱은 최근 3개, 모바일은 최신 1개만
  const max = isNarrow() ? 1 : 3;
  while (rootEl.children.length >= max) rootEl.firstElementChild.remove();
  rootEl.append(el);
  timer = setTimeout(close, duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2000); });
  return close;
}
