// DOM 헬퍼. 사용자 입력 문자열은 항상 텍스트 노드로 들어가므로 XSS 걱정 없이 쓸 수 있다.

/**
 * 요소 생성 헬퍼.
 * h('button', { class: 'btn', onClick: fn, dataset: { id }, style: { '--item-color': 'red' } }, '텍스트', childEl)
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (v == null) continue;
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') el.value = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** 이벤트 위임: root 안에서 selector에 맞는 요소에 대해 handler(event, matchedEl) 호출 */
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const target = e.target instanceof Element ? e.target.closest(selector) : null;
    if (target && root.contains(target)) handler(e, target);
  });
}

/**
 * 재렌더 시 포커스 유지: root 안의 포커스 요소가 data-focus-key를 가지고 있으면
 * fn() 실행 후 같은 키를 가진 새 요소로 포커스를 옮긴다.
 */
export function preserveFocus(root, fn) {
  const active = document.activeElement;
  const key = active && root.contains(active) ? active.dataset?.focusKey : null;
  fn();
  if (key) {
    const next = root.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    next?.focus({ preventScroll: true });
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** 모바일 레이아웃 조건 — CSS의 @media 조건과 반드시 같게 유지 (가로로 돌린 휴대폰 포함) */
export const NARROW_QUERY = '(max-width: 767px), (max-height: 520px) and (hover: none)';
export const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;
