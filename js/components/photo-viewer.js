// 사진 크게 보기 (수정 창 위에 겹쳐 뜨는 <dialog>). ←/→ 또는 좌우로 밀어 넘기기, Esc 닫기
import { h } from '../utils/dom.js';
import { photoUrl } from '../photos.js';

let dlg = null;
let ids = [];
let index = 0;
let img;
let counter;
let prevBtn;
let nextBtn;

function show() {
  const id = ids[index];
  counter.textContent = `${index + 1} / ${ids.length}`;
  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === ids.length - 1;
  img.removeAttribute('src');
  img.alt = `사진 ${index + 1}`;
  photoUrl(id, 'full').then((url) => {
    if (ids[index] === id && url) img.src = url;
  });
}

function go(delta) {
  const next = index + delta;
  if (next < 0 || next >= ids.length) return;
  index = next;
  show();
}

function create() {
  img = h('img', { class: 'pv-img', alt: '' });
  counter = h('span', { class: 'pv-counter', 'aria-live': 'polite' });
  prevBtn = h('button', { type: 'button', class: 'pv-nav pv-prev', 'aria-label': '이전 사진', onClick: () => go(-1) }, '‹');
  nextBtn = h('button', { type: 'button', class: 'pv-nav pv-next', 'aria-label': '다음 사진', onClick: () => go(1) }, '›');
  dlg = h('dialog', { class: 'photo-viewer', 'aria-label': '사진 보기' },
    h('div', { class: 'pv-bar' },
      counter,
      h('button', { type: 'button', class: 'pv-close', 'aria-label': '닫기', onClick: () => dlg.close() }, '✕')),
    h('div', { class: 'pv-stage' }, prevBtn, img, nextBtn));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  // 사진 바깥(어두운 부분)을 누르면 닫기
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.classList?.contains('pv-stage')) dlg.close();
  });
  let start = null;
  dlg.addEventListener('touchstart', (e) => {
    start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  dlg.addEventListener('touchend', (e) => {
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx)) go(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dx) < dy) dlg.close(); // 아래로 밀어 닫기
  }, { passive: true });
  document.body.append(dlg);
}

export function openPhotoViewer(photoIds, startIndex = 0) {
  if (!photoIds.length) return;
  if (!dlg) create();
  ids = [...photoIds];
  index = Math.min(Math.max(0, startIndex), ids.length - 1);
  show();
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.pv-close').focus();
}
