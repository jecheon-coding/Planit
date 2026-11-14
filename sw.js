// Planit 서비스 워커
//  - 시스템 알림 표시/클릭 처리 (안드로이드 Chrome은 서비스 워커로만 알림을 띄울 수 있다)
//  - 오프라인 실행: 네트워크 우선, 실패하면 저장해 둔 파일 (항상 최신 파일을 먼저 받으므로 옛 화면이 남지 않는다)
const CACHE = 'planit-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/favicon.ico')) return; // 브라우저가 알아서 찾는 기본 아이콘 (앱은 icons/icon.svg 사용)
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = (await caches.match('./index.html')) ?? (await caches.match('./'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

// 알림을 누르면: 열려 있는 앱으로 가서 그 항목을 연다 (없으면 새로 연다)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.id ?? '';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      if (id) client.postMessage({ type: 'open-item', id });
      return;
    }
    await self.clients.openWindow(id ? `./?open=${encodeURIComponent(id)}` : './');
  })());
});
