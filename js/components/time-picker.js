// 시간 선택기 — 네이티브 <input type="time">의 무한 반복 휠/열 대신 직접 구현.
//   PC     : "오전 12:00"~"오후 11:45" 15분 간격 목록 (반복 없음, 직접 입력 가능)
//   모바일 : 오전/오후 · 시 · 분(5분 단위) 3열 휠 (끝에서 멈춤, 반복 없음)
//
// 폼 값은 숨김 input(name 유지)에 항상 "HH:mm"(24시간제) 또는 ''로 들어간다.
// 값이 바뀌면 숨김 input에서 bubbling 'change' 이벤트가 발생하므로 기존 폼 로직을 그대로 쓴다.
// 프로그램에서 숨김 input 값을 바꾼 뒤에는 refresh()를 호출해 화면 표시를 맞춘다.
import { h, isNarrow } from '../utils/dom.js';
import { parseTimeInput, formatDuration } from '../parser/time-rules.js';

const LIST_STEP = 15;
const WHEEL_MIN_STEP = 5;
const ITEM_H = 40; // 휠 한 칸 높이(px) — CSS --tw-item과 같게
const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const pad2 = (n) => String(n).padStart(2, '0');
const toHHmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
const toMin = (hhmm) => (/^\d{2}:\d{2}$/.test(hhmm ?? '') ? +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) : null);

/** 분 → "오전 9:05", "오후 12:00" */
export function meridiemLabel(min) {
  const hh = Math.floor(min / 60);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hh < 12 ? '오전' : '오후'} ${h12}:${pad2(min % 60)}`;
}

const useWheel = () => isNarrow() || window.matchMedia('(hover: none) and (pointer: coarse)').matches;

let uidSeq = 0;
let openPicker = null; // 한 번에 하나만 열림

/**
 * @param {HTMLInputElement} source 폼의 name 붙은 input — 숨김 값 필드로 바뀐다
 * @param {{ optional?: boolean, getReference?: () => string|null, label?: string }} options
 *   optional: '시각 없음' 허용
 *   getReference: 기준 시각("HH:mm") — 있으면 그 이후 시각만 + 길이 표시 (종료 시각용)
 */
export function attachTimePicker(source, { optional = false, getReference = () => null, label = '' } = {}) {
  const id = `tp-${++uidSeq}`;
  const labelledBy = source.getAttribute('aria-labelledby');
  source.type = 'hidden';
  source.removeAttribute('aria-labelledby');

  const display = h('input', {
    type: 'text',
    class: 'tp-input',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-autocomplete': 'none',
    'aria-expanded': 'false',
    'aria-haspopup': 'listbox',
    'aria-labelledby': labelledBy,
    placeholder: optional ? '시각 없음' : '시간 선택',
  });
  const list = h('ul', { class: 'tp-list', role: 'listbox', id: `${id}-list`, hidden: true, tabindex: '-1' });
  display.setAttribute('aria-controls', list.id);
  const wrap = h('div', { class: 'tp' });
  source.replaceWith(wrap);
  wrap.append(source, display, list);

  let lastValid = source.value;
  let options = [];
  let activeIndex = -1;
  let wheel = null; // 모바일 휠 패널 (처음 열 때 생성)

  // ---------- 공통 ----------
  function render() {
    display.value = source.value ? meridiemLabel(toMin(source.value)) : '';
    display.readOnly = useWheel();
  }

  function setValue(value, { silent = false } = {}) {
    const changed = value !== source.value;
    source.value = value;
    lastValid = value;
    display.removeAttribute('aria-invalid');
    render();
    if (changed && !silent) source.dispatchEvent(new Event('change', { bubbles: true }));
    return changed;
  }

  const isOpen = () => !list.hidden || (wheel && !wheel.panel.hidden);

  function open() {
    if (isOpen()) return;
    if (openPicker && openPicker !== api) openPicker.close();
    openPicker = api;
    display.setAttribute('aria-expanded', 'true');
    display.classList.add('is-editing');
    if (useWheel()) openWheel();
    else openList();
  }

  function close() {
    if (!list.hidden) {
      list.hidden = true;
      display.removeAttribute('aria-activedescendant');
    }
    if (wheel && !wheel.panel.hidden) wheel.panel.hidden = true;
    display.setAttribute('aria-expanded', 'false');
    display.classList.remove('is-editing');
    if (openPicker === api) openPicker = null;
  }

  // ---------- PC: 목록 ----------
  function buildOptions() {
    const ref = toMin(getReference());
    const entries = [];
    if (optional) entries.push({ value: '', main: '시각 없음' });
    const start = ref != null && ref + LIST_STEP < 1440 ? Math.floor(ref / LIST_STEP) * LIST_STEP + LIST_STEP : 0;
    for (let min = start; min < 1440; min += LIST_STEP) {
      entries.push({ value: toHHmm(min), main: meridiemLabel(min), dur: ref != null ? formatDuration(min - ref) : '' });
    }
    // 목록 간격에 없는 현재 값(예: 11:14)도 보이도록 끼워 넣음
    const cur = toMin(source.value);
    if (cur != null && !entries.some((e) => e.value === source.value) && (ref == null || cur > ref)) {
      const at = entries.findIndex((e) => e.value && toMin(e.value) > cur);
      entries.splice(at === -1 ? entries.length : at, 0,
        { value: source.value, main: meridiemLabel(cur), dur: ref != null ? formatDuration(cur - ref) : '' });
    }
    return entries;
  }

  function renderList() {
    options = buildOptions();
    list.replaceChildren(...options.map((o, i) => h('li', {
      id: `${id}-opt-${i}`,
      class: 'tp-option',
      role: 'option',
      'aria-selected': String(o.value === source.value),
      'data-index': i,
    },
    h('span', { class: 'tp-main' }, o.main),
    o.dur ? h('span', { class: 'tp-dur' }, o.dur) : null)));
  }

  function nearestIndex(value) {
    const exact = options.findIndex((o) => o.value === value);
    if (exact !== -1) return exact;
    const target = toMin(value);
    if (target == null) return options.length ? 0 : -1;
    let best = 0;
    let bestDiff = Infinity;
    options.forEach((o, i) => {
      const m = toMin(o.value);
      if (m != null && Math.abs(m - target) < bestDiff) { best = i; bestDiff = Math.abs(m - target); }
    });
    return best;
  }

  function setActive(index, { center = false } = {}) {
    list.querySelector('.is-active')?.classList.remove('is-active');
    activeIndex = index;
    const el = list.children[index];
    if (!el) return;
    el.classList.add('is-active');
    display.setAttribute('aria-activedescendant', el.id);
    if (center) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
    else el.scrollIntoView({ block: 'nearest' });
  }

  function openList() {
    renderList();
    list.style.maxHeight = '';
    list.hidden = false;
    // 편집 창(dialog) 안에서 잘리지 않게: 실제 목록 높이로 아래/위를 고르고, 둘 다 좁으면 높이를 줄인다
    const rect = display.getBoundingClientRect();
    const box = display.closest('dialog')?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const below = Math.min(window.innerHeight, box.bottom) - rect.bottom - 12;
    const above = rect.top - Math.max(0, box.top) - 12;
    const needed = list.offsetHeight;
    const up = below < needed && above > below;
    wrap.classList.toggle('drop-up', up);
    if ((up ? above : below) < needed) list.style.maxHeight = `${Math.max(140, up ? above : below)}px`;
    setActive(nearestIndex(source.value || (getReference() ? '' : '09:00')), { center: true });
  }

  /** 직접 입력한 문자열 → 값. 해석 불가면 되돌림 */
  function commitTyped() {
    const parsed = parseTimeInput(display.value);
    if (parsed === null || (parsed === '' && !optional)) {
      render(); // 이전 값 표시로 복원
      display.setAttribute('aria-invalid', 'true');
      display.title = '예) 오후 3:30, 15:30, 1530, 3시 반';
      setTimeout(() => display.removeAttribute('aria-invalid'), 1200);
      return false;
    }
    setValue(parsed);
    return true;
  }

  const typedText = () => display.value.trim();
  const isUntouched = () => typedText() === (source.value ? meridiemLabel(toMin(source.value)) : '');

  display.addEventListener('click', () => (isOpen() ? close() : open()));
  display.addEventListener('input', () => {
    if (display.readOnly) return;
    if (list.hidden) open();
    const parsed = parseTimeInput(display.value);
    if (parsed) setActive(nearestIndex(parsed), { center: true });
  });
  // 표시용 input의 change는 폼으로 올려보내지 않는다 (값 변경은 숨김 input에서 알림)
  display.addEventListener('change', (e) => {
    e.stopPropagation();
    if (!display.readOnly && !isUntouched()) commitTyped();
  });

  display.addEventListener('keydown', (e) => {
    if (useWheel()) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isOpen() ? close() : open(); }
      if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); close(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (list.hidden) { open(); return; }
        setActive(Math.max(0, Math.min(options.length - 1, activeIndex + (e.key === 'ArrowDown' ? 1 : -1))));
        break;
      case 'PageDown':
      case 'PageUp':
        if (list.hidden) return;
        e.preventDefault();
        setActive(Math.max(0, Math.min(options.length - 1, activeIndex + (e.key === 'PageDown' ? 4 : -4))));
        break;
      case 'Enter':
        e.preventDefault(); // 폼 제출 방지
        if (!list.hidden && activeIndex >= 0 && isUntouched()) {
          setValue(options[activeIndex].value);
          close();
        } else if (commitTyped()) {
          close();
        }
        break;
      case 'Escape':
        if (isOpen()) {
          e.preventDefault();
          e.stopPropagation(); // 모달까지 닫히지 않게
          render();
          close();
        }
        break;
      case 'Tab':
        close();
        break;
      default:
    }
  });
  display.addEventListener('blur', () => setTimeout(() => { if (!list.hidden) close(); }, 0));

  list.addEventListener('pointerdown', (e) => e.preventDefault()); // 입력창 포커스 유지
  list.addEventListener('click', (e) => {
    const li = e.target instanceof Element ? e.target.closest('.tp-option') : null;
    if (!li) return;
    setValue(options[+li.dataset.index].value);
    close();
  });
  list.addEventListener('pointermove', (e) => {
    const li = e.target instanceof Element ? e.target.closest('.tp-option') : null;
    if (li && e.pointerType === 'mouse' && +li.dataset.index !== activeIndex) setActive(+li.dataset.index);
  });

  // ---------- 모바일: 3열 휠 ----------
  function createWheel() {
    const makeCol = (name, aria) => h('div', {
      class: 'tw-col', role: 'listbox', tabindex: '0', 'aria-label': aria, 'data-col': name,
    });
    const cols = { mer: makeCol('mer', '오전/오후'), hour: makeCol('hour', '시'), min: makeCol('min', '분') };
    const duration = h('span', { class: 'tw-dur' });
    const clearBtn = optional ? h('button', { type: 'button', class: 'link-btn tw-clear' }, '시각 지우기') : null;
    const panel = h('div', { class: 'tw', hidden: true, id: `${id}-wheel` },
      h('div', { class: 'tw-head' },
        h('span', { class: 'tw-title' }, label),
        duration,
        h('span', { class: 'spacer' }),
        clearBtn,
        h('button', { type: 'button', class: 'btn primary sm tw-done' }, '완료')),
      h('div', { class: 'tw-wheels' },
        h('div', { class: 'tw-band', 'aria-hidden': 'true' }),
        cols.mer, cols.hour, h('span', { class: 'tw-colon', 'aria-hidden': 'true' }, ':'), cols.min));

    // 패널은 필드가 속한 줄(.row) 바로 아래에 전체 폭으로 펼친다
    const anchor = wrap.closest('.row') ?? wrap.closest('.field') ?? wrap;
    anchor.after(panel);

    const state = { mer: [], hour: [], min: [] }; // 각 열의 값 배열
    const timers = {};

    function fill(col, values, labels) {
      state[col] = values;
      cols[col].replaceChildren(...values.map((v, i) => h('div', {
        class: 'tw-item', role: 'option', 'data-i': i, 'aria-selected': 'false',
      }, labels[i])));
    }

    function indexOf(col) {
      const el = cols[col];
      return Math.max(0, Math.min(state[col].length - 1, Math.round(el.scrollTop / ITEM_H)));
    }

    function mark(col, i) {
      [...cols[col].children].forEach((el, k) => el.setAttribute('aria-selected', String(k === i)));
    }

    function scrollToIndex(col, i, smooth) {
      cols[col].scrollTo({ top: i * ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
      mark(col, i);
    }

    function currentMinutes() {
      const mer = state.mer[indexOf('mer')];
      const h12 = state.hour[indexOf('hour')];
      const m = state.min[indexOf('min')];
      return ((h12 % 12) + (mer ? 12 : 0)) * 60 + m;
    }

    function updateDuration() {
      const ref = toMin(getReference());
      const cur = toMin(source.value);
      duration.classList.remove('is-warn');
      if (ref == null || cur == null) { duration.textContent = ''; return; }
      if (cur > ref) duration.textContent = formatDuration(cur - ref);
      else {
        duration.textContent = '시작보다 이른 시각';
        duration.classList.add('is-warn');
      }
    }

    function settle(col) {
      const i = indexOf(col);
      mark(col, i);
      setValue(toHHmm(currentMinutes()));
      updateDuration();
    }

    for (const col of Object.keys(cols)) {
      const el = cols[col];
      el.addEventListener('scroll', () => {
        clearTimeout(timers[col]);
        timers[col] = setTimeout(() => settle(col), 90);
      }, { passive: true });
      el.addEventListener('click', (e) => {
        const item = e.target instanceof Element ? e.target.closest('.tw-item') : null;
        if (item) scrollToIndex(col, +item.dataset.i, true);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const next = Math.max(0, Math.min(state[col].length - 1, indexOf(col) + (e.key === 'ArrowDown' ? 1 : -1)));
        scrollToIndex(col, next, true);
      });
    }

    panel.querySelector('.tw-done').addEventListener('click', () => { close(); display.focus({ preventScroll: true }); });
    clearBtn?.addEventListener('click', () => { setValue(''); close(); });

    function show() {
      let value = toMin(source.value);
      if (value == null) {
        // 비어 있으면 기준 시각 + 1시간 또는 오전 9시에서 시작하고 바로 값으로 채운다
        const ref = toMin(getReference());
        value = ref != null ? Math.min(ref + 60, 1435) : 540;
        setValue(toHHmm(value));
      }
      const minutes = [];
      for (let m = 0; m < 60; m += WHEEL_MIN_STEP) minutes.push(m);
      if (!minutes.includes(value % 60)) minutes.push(value % 60); // 11:14 같은 값도 그대로 표시
      minutes.sort((a, b) => a - b);
      fill('mer', [0, 1], ['오전', '오후']);
      fill('hour', HOURS_12, HOURS_12.map(String));
      fill('min', minutes, minutes.map(pad2));

      panel.hidden = false;
      const hh = Math.floor(value / 60);
      scrollToIndex('mer', hh < 12 ? 0 : 1, false);
      scrollToIndex('hour', HOURS_12.indexOf(hh % 12 === 0 ? 12 : hh % 12), false);
      scrollToIndex('min', minutes.indexOf(value % 60), false);
      updateDuration();
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    return { panel, show };
  }

  function openWheel() {
    wheel ??= createWheel();
    wheel.show();
  }

  // 휠 밖을 누르면 접기
  document.addEventListener('pointerdown', (e) => {
    if (!wheel || wheel.panel.hidden) return;
    if (wheel.panel.contains(e.target) || display.contains(e.target)) return;
    close();
  }, true);

  const api = {
    close,
    /** 숨김 input 값을 프로그램에서 바꾼 뒤 호출 — 표시 갱신 (열려 있으면 닫음) */
    sync() {
      lastValid = source.value;
      close();
      render();
    },
    /** 열린 상태는 유지하고 표시만 갱신 */
    refresh: render,
  };
  render();
  return api;
}
