// 알림 실행기: 다음 알림 시각에 맞춰 타이머를 걸고, 때가 되면
//  ① 화면 위 알림 배너(앱이 열려 있으면 항상) ② 시스템 알림(설정에서 켰고 앱을 보고 있지 않을 때) ③ 소리·진동
// 울린 알림은 localStorage에 기록해 새로고침·여러 탭에서 중복으로 울리지 않게 한다.
// 앱이 백그라운드였다가 돌아오면 그 사이 놓친 알림(12시간 이내)을 이어서 띄운다.
import { h } from '../utils/dom.js';
import { load, save } from '../storage.js';
import { describeWhen } from '../utils/format.js';
import { dueReminders, nextReminderAt, leadText } from '../reminders.js';
import { canNotify, showSystemNotification } from './notifications.js';

const STATE_KEY = 'reminderState';
const MISSED_LIMIT_MS = 12 * 3600_000;
const KEEP_FIRED_MS = 3 * 86_400_000;
const MAX_TIMER_MS = 15 * 60_000;
const MAX_BANNERS = 3;

export function createReminderService({ store, root, openItem }) {
  let timer = null;
  let audio = null;

  // 브라우저는 사용자 동작 전에는 소리를 막으므로 첫 터치/클릭 때 오디오를 준비해 둔다
  const unlockAudio = () => {
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch { /* 소리 없이 진행 */ }
  };
  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  document.addEventListener('keydown', unlockAudio, { once: true, capture: true });

  function beep() {
    if (!audio || audio.state !== 'running') return;
    const t = audio.currentTime;
    for (const dt of [0, 0.28]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t + dt);
      gain.gain.exponentialRampToValueAtTime(0.18, t + dt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + dt);
      osc.stop(t + dt + 0.25);
    }
  }

  // 진동도 사용자가 화면을 한 번이라도 누른 뒤에만 허용된다 (안 그러면 브라우저가 경고)
  function vibrate() {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.([180, 80, 180]);
  }

  function readState() {
    const s = load(STATE_KEY, null) ?? {};
    return { lastCheck: s.lastCheck ? new Date(s.lastCheck) : null, fired: s.fired ?? {} };
  }

  function writeState(st, now) {
    const fired = {};
    for (const [k, at] of Object.entries(st.fired)) if (now - new Date(at) < KEEP_FIRED_MS) fired[k] = at;
    save(STATE_KEY, { lastCheck: now.toISOString(), fired });
  }

  function showBanner({ key, item, title, lead, body, autoHideMs = 5 * 60_000 }) {
    root.querySelector(`[data-alarm="${CSS.escape(key)}"]`)?.remove();
    while (root.children.length >= MAX_BANNERS) root.firstElementChild.remove();
    let timerId = null;
    const close = () => {
      clearTimeout(timerId);
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 160);
    };
    timerId = setTimeout(close, autoHideMs); // 오래 지난 알림이 화면(모바일 헤더)을 계속 가리지 않게
    const el = h('div', { class: 'alarm', role: 'alert', 'data-alarm': key },
      h('span', { class: 'alarm-icon', 'aria-hidden': 'true' }, '🔔'),
      h('div', { class: 'alarm-text' },
        h('span', { class: 'alarm-lead' }, lead),
        h('strong', { class: 'alarm-title' }, title),
        body ? h('span', { class: 'alarm-body' }, body) : null),
      h('div', { class: 'alarm-actions' },
        item ? h('button', {
          type: 'button',
          class: 'btn sm primary',
          onClick: () => {
            close();
            openItem(item.id);
          },
        }, '보기') : null,
        h('button', { type: 'button', class: 'icon-btn sm alarm-close', 'aria-label': '알림 닫기', onClick: close }, '✕')));
    root.append(el);
  }

  function fire(r, now) {
    const { settings } = store.getState();
    const lead = leadText(r, now);
    const body = [describeWhen(r.item), r.item.location].filter(Boolean).join(' · ');
    showBanner({ key: r.key, item: r.item, title: r.item.title, lead, body });
    const away = document.visibilityState !== 'visible' || !document.hasFocus();
    if (away && canNotify(settings)) {
      showSystemNotification({ title: `${r.item.title}`, body: `${lead} · ${body}`, tag: r.key, id: r.item.id, onClick: openItem });
    }
    if (settings.reminderSound) beep();
    vibrate();
  }

  function check() {
    clearTimeout(timer);
    const now = new Date();
    const st = readState();
    // 처음 실행이거나 너무 오래전 기록이면 지난 알림은 건너뛴다
    const from = st.lastCheck && now - st.lastCheck < 7 * 86_400_000 && st.lastCheck < now ? st.lastCheck : now;
    const { items } = store.getState();
    for (const r of dueReminders(items, from, now)) {
      if (st.fired[r.key] || now - r.fireAt > MISSED_LIMIT_MS) continue;
      st.fired[r.key] = r.fireAt.toISOString();
      fire(r, now);
    }
    writeState(st, now);
    const next = nextReminderAt(items, now);
    const delay = next ? Math.min(next - now + 300, MAX_TIMER_MS) : MAX_TIMER_MS;
    timer = setTimeout(check, Math.max(1000, delay));
  }

  store.subscribe((_, keys) => {
    if (keys.includes('items') || keys.includes('now') || keys.includes('*')) check();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  /** 설정의 "테스트 알림" */
  async function test() {
    const { settings } = store.getState();
    const body = '알림이 이렇게 표시됩니다.';
    showBanner({ key: `test-${Date.now()}`, item: null, title: 'Planit 테스트 알림', lead: '지금', body, autoHideMs: 8000 });
    if (settings.reminderSound) {
      unlockAudio();
      beep();
    }
    vibrate();
    if (canNotify(settings)) {
      return showSystemNotification({ title: 'Planit 테스트 알림', body, tag: 'planit-test' });
    }
    return false;
  }

  return { start: check, test };
}
