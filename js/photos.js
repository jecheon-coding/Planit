// 메모 사진 저장소 — IndexedDB (localStorage는 용량이 작아 사진에 쓸 수 없다)
//  - 올리는 사진은 긴 변 1600px JPEG로 줄이고, 목록용 320px 썸네일을 따로 만든다
//  - 항목에는 사진 id 배열(item.photos)만 저장
//  - 어떤 항목도 쓰지 않는 사진은 앱 시작 시 정리 (gcPhotos)
import { uid } from './models.js';

const DB_NAME = 'planit';
const DB_VERSION = 1;
const STORE = 'photos';
const FULL_PX = 1600;
const THUMB_PX = 320;

let dbPromise = null;

export function photosSupported() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // 다른 탭이 DB를 지우거나 버전을 올리려 하면 연결을 닫아 막지 않는다
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('다른 탭에서 Planit을 닫은 뒤 다시 시도하세요.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/** 트랜잭션 하나에서 fn(store) 실행 → 완료되면 마지막 요청의 result로 resolve */
async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('저장 공간이 부족합니다.'));
  });
}

async function draw(bitmap, maxPx, quality) {
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const hgt = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // 투명 PNG → JPEG 변환 시 검은 배경 방지
  ctx.fillRect(0, 0, w, hgt);
  ctx.drawImage(bitmap, 0, 0, w, hgt);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('사진을 변환하지 못했습니다.');
  return { blob, width: w, height: hgt };
}

async function decode(blob) {
  try {
    // 휴대폰 사진의 회전 정보(EXIF)는 브라우저가 반영한다
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // createImageBitmap이 못 읽는 경우 <img>로 한 번 더 시도
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error('이 사진 형식은 열 수 없습니다.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function makeRecord(blob, id = uid()) {
  const bitmap = await decode(blob);
  const full = await draw(bitmap, FULL_PX, 0.85);
  const thumb = await draw(bitmap, THUMB_PX, 0.8);
  bitmap.close?.();
  return { id, blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height, createdAt: Date.now() };
}

let persistAsked = false;

/** 파일(사진) → 줄여서 저장 → id */
export async function addPhoto(file) {
  const rec = await makeRecord(file);
  await run('readwrite', (s) => s.put(rec));
  // 브라우저가 저장소를 임의로 비우지 않도록 요청 (지원하는 경우)
  if (!persistAsked) {
    persistAsked = true;
    navigator.storage?.persist?.().catch(() => {});
  }
  return rec.id;
}

export function getPhoto(id) {
  return run('readonly', (s) => s.get(id));
}

const urls = new Map();

/** 표시용 object URL (kind: 'thumb' | 'full'). 없으면 null */
export async function photoUrl(id, kind = 'thumb') {
  const key = `${id}:${kind}`;
  if (urls.has(key)) return urls.get(key);
  const rec = await getPhoto(id).catch(() => null);
  if (!rec) return null;
  const url = URL.createObjectURL(kind === 'thumb' ? rec.thumb : rec.blob);
  urls.set(key, url);
  return url;
}

/** 어떤 항목도 쓰지 않는 사진 삭제. 방금 올린(아직 저장 전일 수 있는) 사진은 하루 동안 남긴다 */
export async function gcPhotos(keepIds, { graceMs = 86_400_000 } = {}) {
  if (!photosSupported()) return 0;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let removed = 0;
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const rec = cursor.value;
      if (!keepIds.has(rec.id) && Date.now() - (rec.createdAt ?? 0) > graceMs) {
        cursor.delete();
        removed += 1;
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 백업용: id 목록 → [{ id, data(dataURL) }] */
export async function exportPhotos(ids) {
  const out = [];
  for (const id of ids) {
    const rec = await getPhoto(id).catch(() => null);
    if (rec) out.push({ id, data: await blobToDataUrl(rec.blob) });
  }
  return out;
}

/** 백업 복원: 같은 id로 저장 (썸네일은 다시 만든다) */
export async function importPhotos(list) {
  let count = 0;
  for (const p of list ?? []) {
    if (!p?.id || typeof p.data !== 'string' || !p.data.startsWith('data:image/')) continue;
    const blob = await (await fetch(p.data)).blob();
    const rec = await makeRecord(blob, p.id);
    await run('readwrite', (s) => s.put(rec));
    count += 1;
  }
  return count;
}
