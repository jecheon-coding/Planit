// 항목 생성/수정 모달 (<dialog> 사용 — 포커스 가두기와 Esc 닫기는 브라우저 기본 동작)
import { h } from '../utils/dom.js';
import {
  parseLocal, toLocalDateStr, toLocalDateTimeStr, addMinutes, minutesBetween, WEEKDAYS_KO,
} from '../utils/date.js';
import {
  recurrencePresets, matchPreset, weekdayPosition, sameRecurrence, describeRecurrence, anchorOf,
} from '../recurrence.js';
import { askScope } from './scope-dialog.js';
import {
  validateItem, normalizeItem, categoryColor, MAX_ITEM_PHOTOS,
} from '../models.js';
import { isNarrow } from '../utils/dom.js';
import { attachTimePicker } from './time-picker.js';
import { describeWhen } from '../utils/format.js';
import {
  TIMED_OPTIONS, DATE_OPTIONS, MAX_REMINDERS, describeReminder, convertReminders, defaultReminders, isDateOnly,
} from '../reminders.js';
import { notificationStatus, canNotify, maybeSuggestNotifications } from './notifications.js';
import { addPhoto, photoUrl, photosSupported } from '../photos.js';
import { openPhotoViewer } from './photo-viewer.js';
import { itemsToIcs, icsFileName } from '../ics.js';
import { downloadFile } from '../utils/download.js';

const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

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
      <div class="field time-field"><span id="lbl-startTime">시작 시각</span><input name="startTime" aria-labelledby="lbl-startTime" data-time-picker="start"></div>
    </div>
    <div class="row">
      <label class="field"><span>종료</span><input type="date" name="endDate"></label>
      <div class="field time-field"><span id="lbl-endTime">종료 시각</span><input name="endTime" aria-labelledby="lbl-endTime" data-time-picker="end"></div>
    </div>
  </fieldset>

  <fieldset class="task-fields">
    <legend class="visually-hidden">할일 마감</legend>
    <div class="row">
      <label class="field"><span>마감일 (선택)</span><input type="date" name="dueDate"></label>
      <div class="field"><span id="lbl-dueTime">마감 시각 (선택)</span><input name="dueTime" aria-labelledby="lbl-dueTime" data-time-picker="due"></div>
    </div>
    <label class="check"><input type="checkbox" name="done"> 완료</label>
  </fieldset>

  <fieldset class="repeat-fields">
    <legend class="visually-hidden">반복</legend>
    <div class="field repeat-field">
      <span id="lbl-repeat">반복</span>
      <select name="repeat" aria-labelledby="lbl-repeat"></select>
    </div>
    <div class="repeat-custom" hidden>
      <div class="rc-line">
        <span class="rc-label">반복 간격</span>
        <input type="number" name="rcInterval" min="1" max="99" value="1" class="rc-num" aria-label="반복 간격" inputmode="numeric">
        <select name="rcFreq" aria-label="반복 단위">
          <option value="daily">일</option>
          <option value="weekly">주</option>
          <option value="monthly">개월</option>
          <option value="yearly">년</option>
        </select>
        <span class="rc-label">마다</span>
      </div>
      <div class="rc-line rc-days" role="group" aria-label="반복 요일">
        <label class="rc-day"><input type="checkbox" name="rcDay" value="1"><span>월</span></label>
        <label class="rc-day"><input type="checkbox" name="rcDay" value="2"><span>화</span></label>
        <label class="rc-day"><input type="checkbox" name="rcDay" value="3"><span>수</span></label>
        <label class="rc-day"><input type="checkbox" name="rcDay" value="4"><span>목</span></label>
        <label class="rc-day"><input type="checkbox" name="rcDay" value="5"><span>금</span></label>
        <label class="rc-day"><input type="checkbox" name="rcDay" value="6"><span>토</span></label>
        <label class="rc-day"><input type="checkbox" name="rcDay" value="0"><span>일</span></label>
      </div>
      <div class="rc-monthly" role="radiogroup" aria-label="매월 반복 방식"></div>
      <div class="rc-end" role="radiogroup" aria-labelledby="lbl-rc-end">
        <span class="rc-label" id="lbl-rc-end">종료</span>
        <label class="check"><input type="radio" name="rcEnd" value="never" checked> 없음</label>
        <label class="check"><input type="radio" name="rcEnd" value="until"> 날짜 <input type="date" name="rcUntil" class="rc-input" aria-label="반복 종료 날짜"></label>
        <label class="check"><input type="radio" name="rcEnd" value="count"> <input type="number" name="rcCount" min="1" max="999" value="10" class="rc-num" aria-label="반복 횟수" inputmode="numeric"> 회 반복 후</label>
      </div>
    </div>
  </fieldset>

  <div class="field reminder-field">
    <span id="lbl-reminders">알림</span>
    <ul class="reminder-list" aria-labelledby="lbl-reminders"></ul>
    <select name="addReminder" class="reminder-add" aria-label="알림 추가"></select>
    <p class="field-hint reminder-hint"></p>
  </div>

  <div class="field">
    <span id="lbl-location">장소</span>
    <div class="input-action">
      <input name="location" type="text" maxlength="200" autocomplete="off" aria-labelledby="lbl-location" placeholder="장소 추가">
      <a class="btn map-link" data-map target="_blank" rel="noopener noreferrer" hidden>지도</a>
    </div>
  </div>

  <label class="field">
    <span>메모</span>
    <textarea name="memo" rows="3"></textarea>
  </label>

  <div class="field photo-field">
    <span id="lbl-photos">사진</span>
    <div class="photo-grid" role="list" aria-labelledby="lbl-photos"></div>
    <input type="file" name="photoInput" accept="image/*" multiple hidden>
  </div>

  <p class="form-error" role="alert"></p>

  <footer class="modal-foot">
    <button type="button" class="btn danger" data-delete>삭제</button>
    <button type="button" class="btn" data-copy title="같은 내용으로 새 항목 만들기">복제</button>
    <button type="button" class="btn" data-ics title="휴대폰·PC 캘린더 앱에 추가 (.ics 파일)">캘린더 앱에 추가</button>
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
  const copyBtn = dialog.querySelector('[data-copy]');
  const icsBtn = dialog.querySelector('[data-ics]');

  let editingId = null;
  let openSeq = 0; // 사진 처리 중에 다른 항목으로 바뀌었는지 확인용
  let editingItem = null; // 반복 회차면 seriesId/occurrenceDate가 있다
  let returnFocus = null;
  let lastStart = null; // 시작 변경 시 길이를 유지하기 위한 이전 시작값

  const catChips = form.querySelector('.cat-chips');

  // 시간 선택: PC는 15분 간격 목록, 모바일은 오전/오후·시·분 휠 (둘 다 반복 없음)
  // 종료 시각은 같은 날이면 시작 이후만 + 길이 표시
  const pickers = [
    attachTimePicker(f.startTime, { label: '시작 시각' }),
    attachTimePicker(f.endTime, {
      label: '종료 시각',
      getReference: () => (!f.endDate.value || f.endDate.value === f.startDate.value ? f.startTime.value || null : null),
    }),
    attachTimePicker(f.dueTime, { label: '마감 시각', optional: true }),
  ];

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

  // ---------- 반복 ----------
  const repeatCustom = form.querySelector('.repeat-custom');
  const rcMonthly = form.querySelector('.rc-monthly');
  const rcDays = () => [...form.querySelectorAll('input[name="rcDay"]')];
  // 반복 기준 날짜: 일정은 시작일, 할일은 마감일(비어 있으면 선택한 날짜)
  const anchorDateStr = () => (currentType() === 'task'
    ? (f.dueDate.value || toLocalDateStr(store.getState().selectedDate))
    : f.startDate.value);
  const startDay = () => parseLocal(anchorDateStr()) ?? store.getState().selectedDate;
  let repeatKey = 'none';

  function presetRec(key) {
    return recurrencePresets(anchorDateStr()).find((p) => p.key === key)?.rec ?? null;
  }

  /** "반복" 선택 상자: 시작 날짜에 맞춘 보기 + 맞춤… */
  function renderRepeatSelect() {
    const presets = recurrencePresets(anchorDateStr());
    if (repeatKey !== 'custom' && !presets.some((p) => p.key === repeatKey)) {
      // 날짜를 바꿔서 사라진 보기(예: 마지막 금요일)는 비슷한 보기로
      repeatKey = repeatKey.startsWith('monthly-') ? (presets.find((p) => p.key.startsWith('monthly-'))?.key ?? 'none') : 'none';
    }
    f.repeat.replaceChildren(
      ...presets.map((p) => h('option', { value: p.key }, p.label)),
      h('option', { value: 'custom' }, '맞춤…'),
    );
    f.repeat.value = repeatKey;
    repeatCustom.hidden = repeatKey !== 'custom';
    renderMonthlyOptions();
    syncCustomVisibility();
  }

  function renderMonthlyOptions() {
    const d = startDay();
    const { nth, isLast } = weekdayPosition(d);
    const wd = WEEKDAYS_KO[d.getDay()];
    const current = form.querySelector('input[name="rcMonthly"]:checked')?.value ?? 'day';
    const opts = [['day', `매월 ${d.getDate()}일`]];
    if (nth <= 4) opts.push(['nth', `매월 ${['', '첫째', '둘째', '셋째', '넷째'][nth]} ${wd}요일`]);
    if (isLast) opts.push(['last', `매월 마지막 ${wd}요일`]);
    const value = opts.some(([v]) => v === current) ? current : 'day';
    rcMonthly.replaceChildren(...opts.map(([v, label]) => h('label', { class: 'check' },
      h('input', { type: 'radio', name: 'rcMonthly', value: v, checked: v === value }), label)));
  }

  function syncCustomVisibility() {
    form.querySelector('.rc-days').hidden = f.rcFreq.value !== 'weekly';
    rcMonthly.hidden = f.rcFreq.value !== 'monthly';
  }

  /** 맞춤 패널을 규칙으로 채움 */
  function fillCustom(rec) {
    const d = startDay();
    const r = rec ?? { freq: 'weekly', interval: 1 };
    f.rcInterval.value = r.interval ?? 1;
    f.rcFreq.value = r.freq;
    const days = r.byDay ?? [d.getDay()];
    rcDays().forEach((el) => { el.checked = days.includes(Number(el.value)); });
    renderMonthlyOptions();
    const mode = r.bySetPos == null ? 'day' : r.bySetPos === -1 ? 'last' : 'nth';
    const radio = form.querySelector(`input[name="rcMonthly"][value="${mode}"]`);
    if (radio) radio.checked = true;
    const end = r.until ? 'until' : r.count ? 'count' : 'never';
    form.querySelector(`input[name="rcEnd"][value="${end}"]`).checked = true;
    f.rcUntil.value = r.until ?? '';
    f.rcCount.value = r.count ?? 10;
    syncCustomVisibility();
  }

  function collectRecurrence() {
    if (repeatKey === 'none') return null;
    if (repeatKey !== 'custom') return presetRec(repeatKey);
    const d = startDay();
    const rec = { freq: f.rcFreq.value, interval: Math.max(1, Math.min(99, Number(f.rcInterval.value) || 1)) };
    if (rec.freq === 'weekly') rec.byDay = rcDays().filter((el) => el.checked).map((el) => Number(el.value));
    if (rec.freq === 'monthly') {
      const mode = form.querySelector('input[name="rcMonthly"]:checked')?.value;
      if (mode === 'nth') rec.bySetPos = weekdayPosition(d).nth;
      if (mode === 'last') rec.bySetPos = -1;
    }
    const end = form.querySelector('input[name="rcEnd"]:checked')?.value;
    if (end === 'until' && f.rcUntil.value) rec.until = f.rcUntil.value;
    if (end === 'count') rec.count = Math.max(1, Math.min(999, Number(f.rcCount.value) || 1));
    return rec;
  }

  // 종료 날짜/횟수 칸을 건드리면 해당 라디오를 자동 선택
  for (const [name, value] of [['rcUntil', 'until'], ['rcCount', 'count']]) {
    f[name].addEventListener('focus', () => { form.querySelector(`input[name="rcEnd"][value="${value}"]`).checked = true; });
  }

  // ---------- 알림 (네이버 캘린더처럼 여러 개, 시간 항목은 "N분 전", 종일은 "N일 전 오전 9시") ----------
  const reminderList = form.querySelector('.reminder-list');
  const reminderHint = form.querySelector('.reminder-hint');
  let reminders = [];
  let remindersDateOnly = false;
  let remindersTouched = false; // 새 항목에서 직접 고치기 전까지는 종류·종일 변경에 맞춰 기본 알림을 다시 고른다

  const formDateOnly = () => (currentType() === 'task' ? !f.dueTime.value : f.allDay.checked);
  const formDraftShape = () => ({ type: currentType(), allDay: f.allDay.checked });

  function reminderHintText() {
    const { settings } = store.getState();
    if (canNotify(settings)) return '';
    const status = notificationStatus();
    if (status.supported && status.permission !== 'denied') return '앱이 열려 있을 때 화면에 알려 드립니다. 설정 › 알림에서 휴대폰·PC 알림을 켤 수 있습니다.';
    return `앱이 열려 있을 때 화면에 알려 드립니다. ${status.reason === 'insecure' ? '(휴대폰·PC 알림은 HTTPS 주소에서만 가능)' : ''}`.trim();
  }

  function renderReminders() {
    const dateOnly = formDateOnly();
    const noDue = currentType() === 'task' && !f.dueDate.value;
    const shown = noDue ? [] : reminders;
    reminderList.replaceChildren(...shown.map((m) => h('li', { class: 'reminder-chip' },
      h('span', {}, describeReminder(m, dateOnly)),
      h('button', {
        type: 'button', class: 'reminder-remove', 'data-remove-reminder': String(m), 'aria-label': `${describeReminder(m, dateOnly)} 알림 삭제`,
      }, '✕'))));
    const full = reminders.length >= MAX_REMINDERS;
    const placeholder = noDue ? '마감일을 정하면 알림을 받을 수 있습니다'
      : full ? `알림은 ${MAX_REMINDERS}개까지` : reminders.length ? '+ 알림 추가' : '알림 없음 — 눌러서 추가';
    f.addReminder.replaceChildren(
      h('option', { value: '' }, placeholder),
      ...(dateOnly ? DATE_OPTIONS : TIMED_OPTIONS).filter((m) => !reminders.includes(m))
        .map((m) => h('option', { value: String(m) }, describeReminder(m, dateOnly))),
    );
    f.addReminder.value = '';
    f.addReminder.disabled = noDue || full;
    reminderHint.textContent = shown.length ? reminderHintText() : '';
  }

  /** 종일·마감 시각이 바뀌면 알림을 그 형식에 맞게 바꾼다 */
  function syncReminderMode() {
    const dateOnly = formDateOnly();
    const { settings } = store.getState();
    if (!editingId && !remindersTouched) {
      reminders = defaultReminders(formDraftShape(), settings);
    } else if (dateOnly !== remindersDateOnly) {
      reminders = convertReminders(reminders, dateOnly, settings.defaultEventReminder ?? 10);
    }
    remindersDateOnly = dateOnly;
    renderReminders();
  }

  form.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-remove-reminder]') : null;
    if (!btn) return;
    reminders = reminders.filter((m) => m !== Number(btn.dataset.removeReminder));
    remindersTouched = true;
    renderReminders();
    f.addReminder.focus();
  });

  // ---------- 장소 ----------
  const mapLink = form.querySelector('[data-map]');
  function syncMap() {
    const q = f.location.value.trim();
    mapLink.hidden = !q;
    if (q) {
      mapLink.href = `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
      mapLink.setAttribute('aria-label', `네이버 지도에서 "${q}" 보기 (새 창)`);
    }
  }
  f.location.addEventListener('input', syncMap);

  // ---------- 사진 ----------
  const photoGrid = form.querySelector('.photo-grid');
  let photoIds = [];
  let photoBusy = 0;

  function renderPhotos() {
    const tiles = photoIds.map((id, i) => {
      const img = h('img', { alt: `사진 ${i + 1}`, decoding: 'async' });
      const tile = h('div', { class: 'photo-thumb', role: 'listitem' },
        h('button', { type: 'button', class: 'photo-open', 'data-photo-open': String(i), 'aria-label': `사진 ${i + 1} 크게 보기` }, img),
        h('button', { type: 'button', class: 'photo-remove', 'data-photo-remove': id, 'aria-label': `사진 ${i + 1} 빼기` }, '✕'));
      photoUrl(id).then((url) => {
        if (url) img.src = url;
        else tile.classList.add('is-missing');
      });
      return tile;
    });
    const canAdd = photosSupported() && photoIds.length < MAX_ITEM_PHOTOS;
    photoGrid.replaceChildren(...tiles, canAdd
      ? h('button', {
        type: 'button', class: 'photo-add', 'data-photo-add': '', disabled: photoBusy > 0, 'aria-label': '사진 추가',
      }, h('span', { 'aria-hidden': 'true' }, photoBusy ? '…' : '+'), h('small', {}, photoBusy ? '처리 중' : '사진'))
      : null);
  }

  photoGrid.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const open = e.target.closest('[data-photo-open]');
    if (open) {
      openPhotoViewer(photoIds, Number(open.dataset.photoOpen));
      return;
    }
    const remove = e.target.closest('[data-photo-remove]');
    if (remove) {
      photoIds = photoIds.filter((id) => id !== remove.dataset.photoRemove);
      renderPhotos();
      photoGrid.querySelector('.photo-add')?.focus();
      return;
    }
    if (e.target.closest('[data-photo-add]')) f.photoInput.click();
  });

  f.photoInput.addEventListener('change', async (e) => {
    e.stopPropagation();
    const files = [...(f.photoInput.files ?? [])];
    f.photoInput.value = '';
    if (!files.length) return;
    const seq = openSeq;
    const room = MAX_ITEM_PHOTOS - photoIds.length;
    if (files.length > room) toast(`사진은 한 항목에 ${MAX_ITEM_PHOTOS}장까지 넣을 수 있습니다.`, { tone: 'error' });
    photoBusy += 1;
    renderPhotos();
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        const id = await addPhoto(file);
        if (seq !== openSeq) break; // 그사이 창을 닫거나 다른 항목을 열었음
        photoIds = [...photoIds, id];
        renderPhotos();
      } catch (err) {
        toast(`사진을 넣지 못했습니다: ${err.message}`, { tone: 'error' });
      }
    }
    photoBusy -= 1;
    if (seq === openSeq) renderPhotos();
  });

  function syncFooter() {
    const existing = !!editingId;
    deleteBtn.hidden = !existing;
    copyBtn.hidden = !existing;
    icsBtn.hidden = !existing || (editingItem?.type === 'task' && !editingItem?.due);
  }

  function fill(item) {
    form.reset();
    openSeq += 1;
    photoBusy = 0;
    errorEl.textContent = '';
    f.location.value = item.location ?? '';
    syncMap();
    photoIds = [...(item.photos ?? [])];
    renderPhotos();
    reminders = [...(item.reminders ?? [])];
    remindersDateOnly = isDateOnly(item);
    remindersTouched = false;
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
    pickers.forEach((p) => p.sync());
    const rec = item.recurrence ?? null;
    repeatKey = matchPreset(rec, anchorDateStr()) ?? 'custom';
    fillCustom(rec);
    renderRepeatSelect();
    syncVisibility();
    renderReminders();
  }

  /** draft(부분 데이터) 또는 기존 item으로 연다 */
  function open({ item = null, draft = null } = {}) {
    const { settings, selectedDate } = store.getState();
    refreshCategories();
    editingId = item?.id ?? null;
    editingItem = item;
    const data = item ?? normalizeItem(
      { categoryId: settings.defaultCategoryId, ...draft, title: draft?.title ?? '' },
      { ...settings, defaultDate: selectedDate },
    );
    if (!item && !draft?.title) data.title = '';
    // 새 항목: 알림을 정하지 않았으면 설정의 기본 알림
    if (!item && draft?.reminders === undefined) data.reminders = defaultReminders(data, settings);
    fill(data);
    titleEl.textContent = item?.seriesId ? (item.type === 'task' ? '반복 할일 수정' : '반복 일정 수정') : item ? '항목 수정' : '새 항목';
    syncFooter();
    returnFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
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
      location: f.location.value.trim(),
      photos: [...photoIds],
      reminders: type === 'task' && !f.dueDate.value ? [] : [...reminders],
    };
    base.recurrence = collectRecurrence();
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
    pickers.forEach((p) => p.refresh()); // 위에서 바뀐 시각을 화면 표시에 반영
    if (name === 'allDay' || name === 'type') pickers.forEach((p) => p.close());

    // 반복
    if (name === 'repeat') {
      const prev = repeatKey;
      repeatKey = f.repeat.value;
      if (repeatKey === 'custom') fillCustom(presetRec(prev) ?? { freq: 'weekly', interval: 1 });
      repeatCustom.hidden = repeatKey !== 'custom';
    }
    // 반복할 할일에 마감일이 없으면 오늘(선택한 날짜)로 채움
    if (name === 'repeat' && currentType() === 'task' && repeatKey !== 'none' && !f.dueDate.value) {
      f.dueDate.value = toLocalDateStr(store.getState().selectedDate);
    }
    // "매주 금요일" 같은 문구를 기준 날짜(일정 시작일/할일 마감일)에 맞춤
    if (name === 'startDate' || name === 'dueDate' || name === 'type' || name === 'repeat') renderRepeatSelect();
    if (name === 'rcFreq') syncCustomVisibility();
    // 알림
    if (name === 'addReminder' && f.addReminder.value !== '') {
      reminders = [...reminders, Number(f.addReminder.value)].sort((a, b) => a - b).slice(0, MAX_REMINDERS);
      remindersTouched = true;
      renderReminders();
    }
    if (['allDay', 'type', 'dueTime', 'dueDate'].includes(name)) syncReminderMode();
    syncVisibility();
    errorEl.textContent = '';
  });

  const summary = (item) => {
    const repeat = item.recurrence ? ` · ↻ ${describeRecurrence(item.recurrence, anchorOf(item))}` : '';
    return `${item.title} · ${describeWhen(item)}${repeat}`;
  };
  let busy = false; // 범위 선택 창이 떠 있는 동안 중복 제출 방지

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (photoBusy > 0) {
      errorEl.textContent = '사진을 넣는 중입니다. 잠시 후 저장하세요.';
      return;
    }
    const data = collect();
    const errors = validateItem(data);
    if (data._dueTimeWithoutDate) errors.push('마감 시각을 쓰려면 마감일도 입력하세요.');
    delete data._dueTimeWithoutDate;
    if (errors.length) {
      errorEl.textContent = errors[0];
      return;
    }

    // 반복 회차 수정: 범위 선택 (반복 규칙을 바꾸면 "이 회차"는 고를 수 없음)
    if (editingItem?.seriesId) {
      const isTask = editingItem.type === 'task';
      const noun = isTask ? '할일' : '일정';
      // 반복 할일에서 "완료"만 바꿨다면 묻지 않고 그 회차만 완료/해제
      const onlyDoneChanged = isTask && data.type === 'task'
        && data.done !== editingItem.done
        && data.title === editingItem.title && data.categoryId === editingItem.categoryId
        && data.memo === (editingItem.memo ?? '') && data.due === editingItem.due
        && data.location === (editingItem.location ?? '')
        && same(data.reminders, editingItem.reminders) && same(data.photos, editingItem.photos)
        && sameRecurrence(data.recurrence, editingItem.recurrence);
      if (onlyDoneChanged) {
        store.setOccurrenceDone(editingItem.id, data.done);
        close();
        toast(`${data.done ? '완료했습니다' : '완료를 취소했습니다'}: ${editingItem.title}`);
        return;
      }
      const recChanged = data.type !== editingItem.type || !sameRecurrence(data.recurrence, editingItem.recurrence);
      busy = true;
      const scope = await askScope({ title: `반복 ${noun} 수정`, noun, allowThis: !recChanged, confirmLabel: '저장' });
      busy = false;
      if (!scope) return;
      const res = store.updateOccurrence(editingItem.id, data, scope);
      close();
      if (res) {
        const day = anchorOf(data) || anchorOf(res.item);
        if (day) store.setSelectedDate(parseLocal(day));
        toast(`수정했습니다: ${summary(res.item)}`, { actionLabel: '실행 취소', onAction: () => store.restoreSnapshot(res.snapshot) });
        if (res.item.reminders?.length) maybeSuggestNotifications({ store, toast });
      }
      return;
    }

    const wasEditing = !!editingId;
    const saved = editingId ? store.updateItem(editingId, data) : store.addItem(data);
    close();
    if (saved) {
      if (saved.start || saved.due) store.setSelectedDate(parseLocal((saved.start ?? saved.due).slice(0, 10)));
      toast(`${wasEditing ? '수정했습니다' : '추가했습니다'}: ${summary(saved)}`);
      if (saved.reminders?.length) maybeSuggestNotifications({ store, toast });
    }
  });

  // 복제: 지금 창의 내용 그대로 새 항목으로 (저장해야 추가됨)
  copyBtn.addEventListener('click', () => {
    if (!editingId || busy) return;
    const data = collect();
    delete data._dueTimeWithoutDate;
    const { settings, selectedDate } = store.getState();
    const copy = normalizeItem({ ...data, done: false }, { ...settings, defaultDate: selectedDate });
    editingId = null;
    editingItem = null;
    fill(copy);
    remindersTouched = true;
    titleEl.textContent = '복제한 새 항목';
    syncFooter();
    form.scrollTop = 0;
    f.title.focus({ preventScroll: true });
    toast('복사본을 만들었습니다. 저장하면 새 항목으로 추가됩니다.');
  });

  // 기기 캘린더로 보내기: 반복 회차면 반복 전체를 보낸다 (저장된 내용 기준)
  icsBtn.addEventListener('click', () => {
    if (!editingItem) return;
    const { items } = store.getState();
    const src = items.find((i) => i.id === (editingItem.seriesId ?? editingItem.id));
    if (!src) return;
    downloadFile(itemsToIcs([src]), icsFileName(src.title), 'text/calendar;charset=utf-8');
    toast('캘린더 파일(.ics)을 만들었습니다. 파일을 열면 휴대폰·PC 캘린더 앱에 추가할 수 있고, 알림도 그 앱이 보내 줍니다.', { duration: 8000 });
  });

  deleteBtn.addEventListener('click', async () => {
    if (!editingId || busy) return;
    const item = store.getItem(editingId);
    if (!item) return;
    if (item.seriesId) {
      busy = true;
      const noun = item.type === 'task' ? '할일' : '일정';
      const scope = await askScope({ title: `반복 ${noun} 삭제`, noun, confirmLabel: '삭제', danger: true });
      busy = false;
      if (!scope) return;
      const snapshot = store.deleteOccurrence(item.id, scope);
      close();
      const what = { this: `이 ${noun}`, following: `이 ${noun} 및 향후 ${noun}`, all: `모든 ${noun}` }[scope];
      toast(`삭제했습니다: ${item.title} (${what})`, { actionLabel: '실행 취소', onAction: () => store.restoreSnapshot(snapshot) });
      return;
    }
    if (!window.confirm(`"${item.title}" 항목을 삭제할까요?`)) return;
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
    if (dialog.open) return; // 닫자마자 다른 항목으로 다시 연 경우 (알림 배너의 "보기" 등)
    openSeq += 1;
    editingId = null;
    editingItem = null;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  });

  return { open, close, refreshCategories, isOpen: () => dialog.open };
}
