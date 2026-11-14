// 앱 부트스트랩: 스토어 생성, 컴포넌트 마운트, 해시 라우팅, 단축키, 터치 스와이프, 매분 시계
import { migrate, isPersistent } from './storage.js';
import { createStore, VIEWS } from './store.js';
import { categoryVar } from './models.js';
import { $, isNarrow, NARROW_QUERY } from './utils/dom.js';
import {
  addDays, addMonths, formatKo, parseLocal, startOfDay, toLocalDateStr, toLocalDateTimeStr, atMinutes,
} from './utils/date.js';
import { createDayView } from './views/day-view.js';
import { createMonthView } from './views/month-view.js';
import { createTasksView } from './views/tasks-view.js';
import { initToast, showToast } from './components/toast.js';
import { createItemModal } from './components/item-modal.js';
import { createQuickAdd } from './components/quick-add.js';
import { createFilterBar } from './components/filter-bar.js';
import { createMiniCalendar } from './components/mini-calendar.js';
import { createSomedayTasks } from './components/someday-tasks.js';
import { createSettingsPanel } from './components/settings-panel.js';

migrate();
const store = createStore();
initToast($('#toast-root'));

const modal = createItemModal({ store, dialog: $('#item-modal'), toast: showToast });
const openModal = (opts) => modal.open(opts);

const views = {
  day: createDayView({ store, openModal }),
  month: createMonthView({ store, openModal }),
  tasks: createTasksView({ store, openModal }),
};
const quickAdd = createQuickAdd({ store, root: $('#quick-add'), openModal, toast: showToast });
const filterBar = createFilterBar({ store, root: $('#filter-bar') });
const miniCal = createMiniCalendar({ store, root: $('#mini-calendar') });
const someday = createSomedayTasks({ store, root: $('#someday-tasks'), openModal });
const settingsPanel = createSettingsPanel({ store, root: $('#settings-panel'), toast: showToast });

const mainEl = $('#main-view');
const dateLabel = $('#date-label');
const sidebar = $('#sidebar');
const backdrop = $('#sidebar-backdrop');

// ---------- 렌더 ----------
function applyCategoryColors(categories) {
  for (const c of categories) document.documentElement.style.setProperty(categoryVar(c.id), c.color);
}

function headerLabel(state) {
  if (state.view === 'tasks') return '할일 목록';
  if (state.view === 'month') return formatKo(state.selectedDate, 'YYYY년 M월');
  return formatKo(state.selectedDate, isNarrow() ? 'M월 D일 (ddd)' : 'YYYY년 M월 D일 (ddd)');
}

function renderHeader(state) {
  dateLabel.textContent = headerLabel(state);
  document.querySelectorAll('[role="tab"][data-view]').forEach((tab) => {
    const selected = tab.dataset.view === state.view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('.tabbar [data-view]').forEach((btn) => {
    if (btn.dataset.view === state.view) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  mainEl.setAttribute('aria-labelledby', `tab-${state.view}`);
  const unit = state.view === 'month' ? '달' : '날';
  $('#prev-btn').setAttribute('aria-label', `이전 ${unit}`);
  $('#next-btn').setAttribute('aria-label', `다음 ${unit}`);
  // 할일 뷰는 날짜 이동이 의미 없으므로 숨김
  $('.nav').classList.toggle('is-hidden', state.view === 'tasks');
  $('#fab-label').textContent = state.view === 'tasks' ? '새 할일' : '새 일정';
  document.body.dataset.view = state.view;
}

let currentView = null;

function render(state, keys) {
  const k = new Set(keys);
  const all = k.has('*');

  if (all || k.has('categories')) applyCategoryColors(state.categories);

  // 매분 시계만 바뀐 경우: 현재 시각선만 갱신
  if (k.size === 1 && k.has('now')) {
    if (state.view === 'day') views.day.updateNow();
    return;
  }

  renderHeader(state);

  const view = views[state.view];
  if (currentView !== view) {
    mainEl.replaceChildren(view.root);
    currentView = view;
    view.render({ reset: true });
  } else {
    view.render();
  }

  miniCal.render();
  someday.render();
  if (all || k.has('settings') || k.has('categories')) {
    filterBar.render();
    settingsPanel.render();
    quickAdd.refresh();
  }
  if (all || k.has('categories')) modal.refreshCategories();
  if (all || k.has('view') || k.has('selectedDate')) syncHash(state);
}

// ---------- 해시 라우팅: #/day/2026-11-15, #/month/2026-11, #/tasks ----------
function syncHash(state) {
  let hash = `#/day/${toLocalDateStr(state.selectedDate)}`;
  if (state.view === 'month') hash = `#/month/${toLocalDateStr(state.selectedDate).slice(0, 7)}`;
  if (state.view === 'tasks') hash = '#/tasks';
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function applyHash() {
  const m = /^#\/(day|month|tasks)(?:\/(\d{4}-\d{2})(?:-(\d{2}))?)?$/.exec(location.hash);
  if (!m) return;
  const [, view, ym, d] = m;
  if (ym) {
    const { selectedDate } = store.getState();
    const sameMonth = toLocalDateStr(selectedDate).startsWith(ym);
    const date = parseLocal(`${ym}-${d ?? (sameMonth ? toLocalDateStr(selectedDate).slice(8) : '01')}`);
    if (date) store.setSelectedDate(date);
  }
  store.setView(view);
}

window.addEventListener('hashchange', applyHash);

// ---------- 네비게이션 ----------
function navigate(delta) {
  const { view, selectedDate } = store.getState();
  if (view === 'tasks') return;
  store.setSelectedDate(view === 'month' ? addMonths(selectedDate, delta) : addDays(selectedDate, delta));
}

function goToday() {
  store.setSelectedDate(startOfDay(new Date()));
}

function newItem() {
  const { selectedDate, settings, now, view } = store.getState();
  if (view === 'tasks') {
    openModal({ draft: { type: 'task', due: null } });
    return;
  }
  // 오늘이면 다음 정각, 아니면 09:00
  const startMin = toLocalDateStr(selectedDate) === toLocalDateStr(now)
    ? Math.min((now.getHours() + 1) * 60, 23 * 60)
    : 9 * 60;
  openModal({
    draft: {
      type: 'event',
      start: toLocalDateTimeStr(atMinutes(selectedDate, startMin)),
      end: toLocalDateTimeStr(atMinutes(selectedDate, startMin + settings.defaultDurationMin)),
    },
  });
}

$('#prev-btn').addEventListener('click', () => navigate(-1));
$('#next-btn').addEventListener('click', () => navigate(1));
$('#today-btn').addEventListener('click', goToday);
$('#new-btn').addEventListener('click', newItem);
$('#fab').addEventListener('click', newItem);

document.querySelectorAll('[role="tab"][data-view]').forEach((tab) => {
  tab.addEventListener('click', () => store.setView(tab.dataset.view));
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const i = VIEWS.indexOf(tab.dataset.view);
    const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
    store.setView(next);
    $(`#tab-${next}`).focus();
  });
});
document.querySelectorAll('.tabbar [data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    setSidebar(false);
    // 이미 일간 뷰에서 일간을 다시 누르면 오늘로 이동
    if (btn.dataset.view === 'day' && store.getState().view === 'day') goToday();
    store.setView(btn.dataset.view);
  });
});

// ---------- 모바일 사이드바(드로어) ----------
function setSidebar(open) {
  sidebar.classList.toggle('open', open);
  backdrop.hidden = !open;
  $('#menu-btn').setAttribute('aria-expanded', String(open));
  $('#tabbar-menu').setAttribute('aria-expanded', String(open));
  $('#tabbar-menu').toggleAttribute('aria-current', open);
}
const toggleSidebar = () => setSidebar(!sidebar.classList.contains('open'));
$('#menu-btn').addEventListener('click', toggleSidebar);
$('#tabbar-menu').addEventListener('click', toggleSidebar);
backdrop.addEventListener('click', () => setSidebar(false));
sidebar.addEventListener('click', (e) => {
  // 모바일에서 날짜를 고르면 드로어 닫기
  if (sidebar.classList.contains('open') && e.target instanceof Element && e.target.closest('.mini-day')) setSidebar(false);
});

// ---------- 터치 스와이프: 좌우로 밀어 이전/다음 ----------
let touch = null;
mainEl.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1 || store.getState().view === 'tasks') {
    touch = null;
    return;
  }
  const t = e.touches[0];
  touch = { x: t.clientX, y: t.clientY, time: Date.now() };
}, { passive: true });
mainEl.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
mainEl.addEventListener('touchend', (e) => {
  if (!touch) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x;
  const dy = t.clientY - touch.y;
  const fast = Date.now() - touch.time < 1000; // 천천히 미는 동작도 허용 (거리·방향 조건이 오작동을 막음)
  touch = null;
  if (fast && Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx) * 0.6) navigate(dx < 0 ? 1 : -1);
}, { passive: true });

// ---------- 단축키 ----------
function isTyping(target) {
  return target instanceof Element
    && (target.closest('input, textarea, select, [contenteditable="true"]') != null);
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (modal.isOpen() || isTyping(e.target)) return;
  switch (e.key) {
    case '/':
      e.preventDefault();
      quickAdd.focus();
      break;
    case 'd': case 'D': store.setView('day'); break;
    case 'm': case 'M': store.setView('month'); break;
    case 'l': case 'L': store.setView('tasks'); break;
    case 't': case 'T': goToday(); break;
    case 'n': case 'N': e.preventDefault(); newItem(); break;
    case 'ArrowLeft': navigate(-1); break;
    case 'ArrowRight': navigate(1); break;
    case 'Escape': setSidebar(false); break;
    default:
  }
});

// 화면 폭이 모바일 ↔ 데스크톱으로 바뀌면 헤더 문구·월간 표시를 다시 그림
window.matchMedia(NARROW_QUERY).addEventListener('change', (e) => {
  if (!e.matches) setSidebar(false);
  render(store.getState(), ['*']);
});

// ---------- 시작 ----------
if (!isPersistent()) $('#storage-warning').hidden = false;

applyHash();
store.subscribe(render);
render(store.getState(), ['*']);

// 매분 정각에 맞춰 시계 갱신
setTimeout(() => {
  store.tick();
  setInterval(() => store.tick(), 60_000);
}, (60 - new Date().getSeconds()) * 1000);
