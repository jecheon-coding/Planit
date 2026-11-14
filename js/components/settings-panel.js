// 사이드바: 설정 (일반 · 알림 · 표시) + 백업(JSON 내보내기/가져오기, 사진 포함) + 캘린더(.ics) 내보내기
import { h, preserveFocus } from '../utils/dom.js';
import { toLocalDateStr } from '../utils/date.js';
import { downloadFile } from '../utils/download.js';
import { itemsToIcs } from '../ics.js';
import { exportPhotos, importPhotos, photosSupported } from '../photos.js';
import { notificationStatus, requestPermission } from './notifications.js';

const EVENT_REMINDER_OPTIONS = [['', '없음'], [0, '정시'], [5, '5분 전'], [10, '10분 전'], [15, '15분 전'], [30, '30분 전'], [60, '1시간 전'], [1440, '1일 전']];
const ALLDAY_REMINDER_OPTIONS = [['', '없음'], [-540, '당일 오전 9시'], [900, '1일 전 오전 9시'], [2340, '2일 전 오전 9시']];

export function createSettingsPanel({ store, root, toast, onTestReminder }) {
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });

  const numOrNull = (v) => (v === '' ? null : Number(v));

  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t === fileInput) {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!window.confirm(`현재 데이터를 "${file.name}" 내용으로 바꿉니다. 계속할까요?`)) return;
        store.importData(data);
        let photos = 0;
        if (Array.isArray(data.photos) && data.photos.length && photosSupported()) {
          toast('사진을 복원하는 중입니다…');
          photos = await importPhotos(data.photos);
        }
        toast(`가져왔습니다: 항목 ${data.items.length}개${photos ? `, 사진 ${photos}장` : ''}`);
        store.updateSettings({}); // 사진 썸네일 등 다시 그리기
      } catch (err) {
        toast(`가져오기 실패: ${err.message}`, { tone: 'error' });
      }
      return;
    }
    if (t.name === 'weekStartsOn') store.updateSettings({ weekStartsOn: Number(t.value) });
    if (t.name === 'defaultDurationMin') store.updateSettings({ defaultDurationMin: Number(t.value) });
    if (t.name === 'defaultCategoryId') store.updateSettings({ defaultCategoryId: t.value });
    if (t.name === 'defaultEventReminder') store.updateSettings({ defaultEventReminder: numOrNull(t.value) });
    if (t.name === 'defaultAllDayReminder') store.updateSettings({ defaultAllDayReminder: numOrNull(t.value) });
    if (t.name === 'reminderSound') store.updateSettings({ reminderSound: t.checked });
    if (t.name === 'showHolidays') store.updateSettings({ showHolidays: t.checked });
    if (t.name === 'notifications') {
      if (!t.checked) {
        store.updateSettings({ notifications: false });
        return;
      }
      const result = await requestPermission();
      if (result === 'granted') {
        store.updateSettings({ notifications: true });
        toast('휴대폰·PC 알림을 켰습니다. "테스트 알림"으로 확인해 보세요.');
      } else {
        t.checked = false;
        store.updateSettings({ notifications: false });
        toast(result === 'denied'
          ? '알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 알림을 허용해 주세요.'
          : '알림 권한을 받지 못했습니다.', { tone: 'error' });
      }
    }
  });

  root.addEventListener('click', async (e) => {
    const action = e.target instanceof Element ? e.target.closest('[data-action]')?.dataset.action : null;
    if (action === 'export') {
      const data = store.exportData();
      const ids = [...new Set(data.items.flatMap((i) => i.photos ?? []))];
      if (ids.length && photosSupported()) data.photos = await exportPhotos(ids);
      downloadFile(JSON.stringify(data, null, 2), `planit-backup-${toLocalDateStr(new Date())}.json`, 'application/json');
    } else if (action === 'import') {
      fileInput.click();
    } else if (action === 'export-ics') {
      const { items } = store.getState();
      downloadFile(itemsToIcs(items), `planit-${toLocalDateStr(new Date())}.ics`, 'text/calendar;charset=utf-8');
      toast('캘린더 파일(.ics)을 만들었습니다. 휴대폰·PC 캘린더 앱에서 가져오기 하세요.');
    } else if (action === 'test-reminder') {
      const sent = await onTestReminder?.();
      if (store.getState().settings.notifications && !sent) toast('시스템 알림을 보내지 못했습니다. 브라우저 알림 권한을 확인하세요.', { tone: 'error' });
    }
  });

  const select = (name, value, options, label) => h('label', { class: 'field compact' },
    h('span', {}, label),
    h('select', { name, 'data-focus-key': `set:${name}` },
      options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, text))));

  const toggle = (name, checked, label, { disabled = false } = {}) => h('label', { class: 'switch-row compact' },
    h('span', {}, label),
    h('input', {
      type: 'checkbox', name, class: 'switch', role: 'switch', checked, disabled, 'data-focus-key': `set:${name}`,
    }));

  function render() {
    const { settings, categories } = store.getState();
    const status = notificationStatus();
    preserveFocus(root, () => {
      root.replaceChildren(
        h('details', { class: 'settings' },
          h('summary', { class: 'section-title' }, '설정'),
          h('div', { class: 'settings-body' },
            select('weekStartsOn', settings.weekStartsOn, [[0, '일요일'], [1, '월요일']], '주 시작 요일'),
            select('defaultDurationMin', settings.defaultDurationMin,
              [[30, '30분'], [60, '1시간'], [90, '1시간 30분'], [120, '2시간']], '기본 일정 길이'),
            select('defaultCategoryId', settings.defaultCategoryId,
              categories.map((c) => [c.id, c.name]), '기본 카테고리'),

            h('h3', { class: 'settings-sub' }, '알림'),
            toggle('notifications', settings.notifications && status.permission === 'granted', '휴대폰·PC 알림', { disabled: !status.supported }),
            h('p', { class: 'settings-note' }, status.text),
            select('defaultEventReminder', settings.defaultEventReminder, EVENT_REMINDER_OPTIONS, '새 일정 기본 알림'),
            select('defaultAllDayReminder', settings.defaultAllDayReminder, ALLDAY_REMINDER_OPTIONS, '새 종일 일정 기본 알림'),
            toggle('reminderSound', settings.reminderSound, '알림 소리'),
            h('button', { type: 'button', class: 'btn sm', 'data-action': 'test-reminder' }, '테스트 알림'),
            h('p', { class: 'settings-note' },
              '웹 앱이라 앱(탭)을 완전히 닫으면 알림이 오지 않습니다. 꼭 받아야 하는 일정은 항목의 "캘린더 앱에 추가"로 휴대폰 캘린더에 넣어 두세요.'),

            h('h3', { class: 'settings-sub' }, '표시'),
            toggle('showHolidays', settings.showHolidays, '공휴일 표시'),

            h('h3', { class: 'settings-sub' }, '백업 · 내보내기'),
            h('div', { class: 'row wrap' },
              h('button', { type: 'button', class: 'btn sm', 'data-action': 'export' }, '내보내기'),
              h('button', { type: 'button', class: 'btn sm', 'data-action': 'import' }, '가져오기'),
              h('button', { type: 'button', class: 'btn sm', 'data-action': 'export-ics', title: '모든 일정을 .ics 파일로' }, '캘린더 파일(.ics)')),
            h('p', { class: 'settings-note' }, '백업 파일(JSON)에는 메모 사진도 들어갑니다.'),
            fileInput)),
      );
      // 다시 그려도 펼침 상태 유지
      root.querySelector('details').open = expanded;
    });
  }

  let expanded = false;
  root.addEventListener('toggle', (e) => {
    if (e.target.matches?.('details')) expanded = e.target.open;
  }, true);

  return { render, open: () => {
    expanded = true;
    render();
  } };
}
