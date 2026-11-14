// 시스템(OS) 알림: 지원 여부·권한·표시
// 웹 알림의 한계 (서버 없는 앱):
//  - HTTPS(또는 localhost)에서만 동작 — 같은 Wi-Fi의 http://192.168.x.x 주소로는 시스템 알림 불가
//  - iPhone은 홈 화면에 추가한 앱(iOS 16.4+)에서만
//  - 앱(탭)이 완전히 닫혀 있으면 울리지 않는다 → 꼭 받아야 하는 알림은 .ics로 기기 캘린더에 맡긴다
import { load, save } from '../storage.js';

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * @returns {{ supported: boolean, permission?: NotificationPermission, reason: string, text: string }}
 *  text: 설정 화면용 설명
 */
export function notificationStatus() {
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'insecure',
      text: 'HTTPS(또는 localhost) 주소로 열어야 시스템 알림을 쓸 수 있습니다. 지금은 앱이 열려 있을 때 화면 안에서만 알려 드립니다.',
    };
  }
  if (!('Notification' in window)) {
    return isIos() && !isStandalone()
      ? { supported: false, reason: 'ios-browser', text: 'iPhone·iPad는 Safari 공유 › 홈 화면에 추가한 앱에서만 시스템 알림을 받을 수 있습니다 (iOS 16.4 이상).' }
      : { supported: false, reason: 'unsupported', text: '이 브라우저는 시스템 알림을 지원하지 않습니다. 앱이 열려 있을 때 화면 안에서 알려 드립니다.' };
  }
  const permission = Notification.permission;
  if (permission === 'denied') {
    return { supported: true, permission, reason: 'denied', text: '알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 알림을 허용해 주세요.' };
  }
  return {
    supported: true,
    permission,
    reason: permission,
    text: permission === 'granted' ? '시스템 알림을 받을 수 있습니다.' : '켜면 브라우저가 알림 권한을 묻습니다.',
  };
}

/** 시스템 알림을 실제로 보낼 수 있는 상태인가 */
export function canNotify(settings) {
  return !!settings.notifications && 'Notification' in window && Notification.permission === 'granted';
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * 시스템 알림 표시. 서비스 워커가 있으면 그쪽으로 (Android Chrome은 new Notification()을 막는다)
 * @returns {Promise<boolean>}
 */
export async function showSystemNotification({ title, body, tag, id, onClick }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const options = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { id } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      onClick?.(id);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** 처음 알림이 있는 항목을 저장했을 때 한 번만 시스템 알림을 권한다 */
export function maybeSuggestNotifications({ store, toast }) {
  const { settings } = store.getState();
  if (settings.notifications || load('notifySuggested', false)) return;
  const status = notificationStatus();
  if (!status.supported || status.permission !== 'default') return;
  save('notifySuggested', true);
  setTimeout(() => toast('앱을 보고 있지 않을 때도 휴대폰·PC 알림으로 받을까요?', {
    actionLabel: '알림 켜기',
    duration: 10000,
    onAction: async () => {
      const result = await requestPermission();
      if (result === 'granted') {
        store.updateSettings({ notifications: true });
        toast('시스템 알림을 켰습니다.');
      } else {
        toast('알림이 허용되지 않았습니다. 설정 › 알림에서 다시 켤 수 있습니다.', { tone: 'error' });
      }
    },
  }), 1200);
}
