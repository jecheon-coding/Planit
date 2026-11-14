// 항목 생성/수정 모달 (<dialog> 사용 — 포커스 가두기와 Esc 닫기는 브라우저 기본 동작)
import { h } from '../utils/dom.js';
import {
  parseLocal, toLocalDateStr, toLocalDateTimeStr, addMinutes, minutesBetween,
} from '../utils/date.js';
import { validateItem, normalizeItem, categoryColor } from '../models.js';
import { isNarrow } from '../utils/dom.js';
import { describeWhen } from '../utils/format.js';

const TEMPLATE = `
<form class="modal-form" novalidate>
  <header class="modal-head">
    <button type="button" class="link-btn mobile-only" data-close>취소</button>
    <h2 class="modal-title" id="modal-title">새 항목</h2>
    <button type="submit" class="btn primary sm mobile-only">저장</button>
    <button type="button" class="icon-btn desktop-only" data-close aria-label="닫기">✕</button>
  </header>

  <div class="seg" role="radiogroup" aria-label="종류">
    <label><input type="radio" name="type" value="event"><span>일정</span></label>
    <label><input type="radio" name="type" value="task"><span>할일</span></label>
  </div>

  <label class="field">
    <span>제목</span>
    <input name="title" type="text" maxlength="200" autocomplete="off" required>
  </label>

  <fieldset class="field">
    <legend>카테고리</legend>
    <div class="cat-chips" role="radiogroup" aria-label="카테고리"></div>
  </fieldset>

  <fieldset class="event-fields">
    <legend class="visually-hidden">일정 시간</legend>
    <label class="switch-row">
      <span>종일</span>
      <input type="checkbox" name="allDay" class="switch" role="switch">
    </label>
    <div class="row">
      <label class="field"><span>시작</span><input type="date" name="startDate"></label>
      <label class="field time-field"><span>시작 시각</span><input type="time" name="startTime" step="300"></label>
    </div>
    <div class="row">
      <label class="field"><span>종료</span><input type="date" name="endDate"></label>
      <label class="field time-field"><span>종료 시각</span><input type="time" name="endTime" step="300"></label>
    </div>
  </fieldset>

  <fieldset class="task-fields">
    <legend class="visually-hidden">할일 마감</legend>
    <div class="row">
      <label class="field"><span>마감일 (선택)</span><input type="date" name="dueDate"></label>
      <label class="field"><span>마감 시각 (선택)</span><input type="time" name="dueTime" step="300"></label>
    </div>
    <label class="check"><input type="checkbox" name="done"> 완료</label>
  </fieldset>

  <label class="field">
    <span>메모</span>
    <textarea name="memo" rows="3"></textarea>
  </label>

  <p class="form-error" role="alert"></p>

  <footer class="modal-foot">
    <button type="button" class="btn danger" data-delete>삭제</button>
    <span class="spacer"></span>
    <button type="button" class="btn desktop-only" data-close>취소</button>
    <button type="submit" class="btn primary desktop-only">저장</button>
  </footer>
</form>`;

export function createItemModal({ store, dialog, toast }) {
  dialog.classList.add('modal');
  dialog.setAttribute('aria-labelledby', 'modal-title');
  dialog.innerHTML = TEMPLATE; // 정적 템플릿 — 사용자 데이터는 .value로만 넣는다
  const form = dialog.querySelector('form');
  const f = form.elements;
  const titleEl = dialog.querySelector('.modal-title');
  const errorEl = dialog.querySelector('.form-error');
  const deleteBtn = dialog.querySelector('[data-delete]');

  let editingId = null;
  let returnFocus = null;
  let lastStart = null; // 시작 변경 시 길이를 유지하기 위한 이전 시작값

  const catChips = form.querySelector('.cat-chips');

  function getCategory() {
    return form.querySelector('input[name="categoryId"]:checked')?.value ?? null;
  }

  function setCategory(id) {
    const radios = [...form.querySelectorAll('input[name="categoryId"]')];
    (radios.find((r) => r.value === id) ?? radios[0]).checked = true;
  }

  function refreshCategories() {
    const current = getCategory();
    catChips.replaceChildren(...store.getState().categories.map((c) => h('label', {
      class: 'cat-chip', style: { '--item-color': categoryColor(c.id) },
    },
    h('input', { type: 'radio', name: 'categoryId', value: c.id }),
    h('span', {}, h('span', { class: 'chip-dot', 'aria-hidden': 'true' }), c.name))));
    if (current) setCategory(current);
  }

  function currentType() {
    return form.querySelector('input[name="type"]:checked')?.value ?? 'event';
  }

  function syncVisibility() {
    const type = currentType();
    form.querySelector('.event-fields').hidden = type !== 'event';
    form.querySelector('.task-fields').hidden = type !== 'task';
    const allDay = f.allDay.checked;
    form.querySelectorAll('.time-field').forEach((el) => { el.hidden = allDay; });
  }

  function readStart() {
    return f.startDate.value ? parseLocal(`${f.startDate.value}T${f.startTime.value || '00:00'}`) : null;
  }

  function fill(item) {
    form.reset();
    errorEl.textContent = '';
    form.querySelector(`input[name="type"][value="${item.type}"]`).checked = true;
    f.title.value = item.title ?? '';
    setCategory(item.categoryId);
    f.memo.value = item.memo ?? '';

    const { selectedDate } = store.getState();
    const fallbackDate = toLocalDateStr(selectedDate);
    if (item.type === 'event') {
      f.allDay.checked = !!item.allDay;
      f.startDate.value = item.start.slice(0, 10);
      f.endDate.value = item.end.slice(0, 10);
      f.startTime.value = item.allDay ? '09:00' : item.start.slice(11, 16);
      f.endTime.value = item.allDay ? '10:00' : item.end.slice(11, 16);
      f.dueDate.value = item.start.slice(0, 10);
    } else {
      f.done.checked = !!item.done;
      f.dueDate.value = item.due ? item.due.slice(0, 10) : '';
      f.dueTime.value = item.due && item.due.length > 10 ? item.due.slice(11, 16) : '';
      f.startDate.value = item.due ? item.due.slice(0, 10) : fallbackDate;
      f.endDate.value = f.startDate.value;
      f.startTime.value = '09:00';
      f.endTime.value = '10:00';
    }
    lastStart = readStart();
    syncVisibility();
  }

  /** draft(부분 데이터) 또는 기존 item으로 연다 */
  function open({ item = null, draft = null } = {}) {
    const { settings, selectedDate } = store.getState();
    refreshCategories();
    editingId = item?.id ?? null;
    const data = item ?? normalizeItem(
      { categoryId: settings.defaultCategoryId, ...draft, title: draft?.title ?? '' },
      { ...settings, defaultDate: selectedDate },
    );
    if (!item && !draft?.title) data.title = '';
    fill(data);
    titleEl.textContent = item ? '항목 수정' : '새 항목';
    deleteBtn.hidden = !item;
    returnFocus = document.activeElement;
    dialog.showModal();
    form.scrollTop = 0;
    // 모바일에서 기존 항목을 열 때는 키보드가 화면을 가리지 않게 자동 포커스하지 않는다
    if (!item) f.title.focus();
    else if (!isNarrow()) {
      f.title.focus();
      f.title.select();
    } else {
      dialog.querySelector('.modal-head [data-close]')?.focus({ preventScroll: true });
    }
  }

  function close() {
    dialog.close();
  }

  function collect() {
    const type = currentType();
    const base = {
      type,
      title: f.title.value.trim(),
      categoryId: getCategory(),
      memo: f.memo.value,
    };
    if (type === 'task') {
      let due = null;
      if (f.dueDate.value) due = f.dueTime.value ? `${f.dueDate.value}T${f.dueTime.value}` : f.dueDate.value;
      return { ...base, due, done: f.done.checked, _dueTimeWithoutDate: !f.dueDate.value && !!f.dueTime.value };
    }
    if (f.allDay.checked) {
      return { ...base, allDay: true, start: f.startDate.value, end: f.endDate.value || f.startDate.value };
    }
    const endDate = f.endDate.value || f.startDate.value;
    return {
      ...base,
      allDay: false,
      start: f.startDate.value ? `${f.startDate.value}T${f.startTime.value || '09:00'}` : '',
      end: endDate ? `${endDate}T${f.endTime.value || f.startTime.value || '10:00'}` : '',
    };
  }

  // ---------- 이벤트 ----------
  form.addEventListener('change', (e) => {
    const name = e.target.name;
    if (name === 'type') {
      // 종류를 바꿔도 날짜는 이어서 사용
      if (currentType() === 'task' && !f.dueDate.value) f.dueDate.value = f.startDate.value;
      if (currentType() === 'event' && f.dueDate.value) {
        f.startDate.value = f.dueDate.value;
        if (!f.endDate.value || f.endDate.value < f.startDate.value) f.endDate.value = f.dueDate.value;
      }
    }
    if (name === 'startDate' || name === 'startTime') {
      // 시작을 옮기면 종료도 같은 길이만큼 함께 이동
      const prevEnd = f.endDate.value ? parseLocal(`${f.endDate.value}T${f.endTime.value || '00:00'}`) : null;
      const newStart = readStart();
      if (newStart && lastStart && prevEnd) {
        const duration = Math.max(minutesBetween(lastStart, prevEnd), f.allDay.checked ? 0 : 15);
        const newEnd = toLocalDateTimeStr(addMinutes(newStart, duration));
        f.endDate.value = newEnd.slice(0, 10);
        f.endTime.value = newEnd.slice(11, 16);
      }
      lastStart = newStart;
    }
    syncVisibility();
    errorEl.textContent = '';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = collect();
    const errors = validateItem(data);
    if (data._dueTimeWithoutDate) errors.push('마감 시각을 쓰려면 마감일도 입력하세요.');
    delete data._dueTimeWithoutDate;
    if (errors.length) {
      errorEl.textContent = errors[0];
      return;
    }
    const saved = editingId ? store.updateItem(editingId, data) : store.addItem(data);
    close();
    if (saved) {
      if (saved.start || saved.due) store.setSelectedDate(parseLocal((saved.start ?? saved.due).slice(0, 10)));
      toast(`${editingId ? '수정했습니다' : '추가했습니다'}: ${saved.title} · ${describeWhen(saved)}`);
    }
  });

  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    const item = store.getItem(editingId);
    if (!item || !window.confirm(`"${item.title}" 항목을 삭제할까요?`)) return;
    const snapshot = store.deleteItem(editingId);
    close();
    toast(`삭제했습니다: ${item.title}`, { actionLabel: '실행 취소', onAction: () => store.restoreItem(snapshot) });
  });

  // 배경 클릭으로 닫기 — 입력창에서 드래그하다 밖에서 놓은 경우는 제외
  let downOnBackdrop = false;
  dialog.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if ((e.target === dialog && downOnBackdrop) || e.target.closest?.('[data-close]')) close();
  });

  dialog.addEventListener('close', () => {
    editingId = null;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  });

  return { open, close, refreshCategories, isOpen: () => dialog.open };
}
