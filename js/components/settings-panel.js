// 사이드바: 설정 + 백업(JSON 내보내기/가져오기)
import { h, preserveFocus } from '../utils/dom.js';
import { toLocalDateStr } from '../utils/date.js';

export function createSettingsPanel({ store, root, toast }) {
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });

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
        toast(`가져왔습니다: 항목 ${data.items.length}개`);
      } catch (err) {
        toast(`가져오기 실패: ${err.message}`, { tone: 'error' });
      }
      return;
    }
    if (t.name === 'weekStartsOn') store.updateSettings({ weekStartsOn: Number(t.value) });
    if (t.name === 'defaultDurationMin') store.updateSettings({ defaultDurationMin: Number(t.value) });
    if (t.name === 'defaultCategoryId') store.updateSettings({ defaultCategoryId: t.value });
  });

  root.addEventListener('click', (e) => {
    const action = e.target instanceof Element ? e.target.closest('[data-action]')?.dataset.action : null;
    if (action === 'export') {
      const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `planit-backup-${toLocalDateStr(new Date())}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (action === 'import') {
      fileInput.click();
    }
  });

  const select = (name, value, options, label) => h('label', { class: 'field compact' },
    h('span', {}, label),
    h('select', { name, 'data-focus-key': `set:${name}` },
      options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text))));

  function render() {
    const { settings, categories } = store.getState();
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
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn sm', 'data-action': 'export' }, '내보내기'),
              h('button', { type: 'button', class: 'btn sm', 'data-action': 'import' }, '가져오기')),
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

  return { render };
}
