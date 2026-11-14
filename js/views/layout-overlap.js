// 일간 타임라인에서 겹치는 일정의 열(column) 배치를 계산하는 순수 함수.
//
// 1) 시작순(같으면 긴 것 먼저) 정렬
// 2) 서로 이어지며 겹치는 일정을 하나의 클러스터로 묶음
// 3) 클러스터 안에서 비어 있는 가장 왼쪽 열에 탐욕적으로 배정
// 4) 같은 클러스터의 모든 일정은 같은 열 개수(cols)를 공유

/**
 * @param {Array<{id: string, startMin: number, endMin: number}>} events
 * @param {number} minDuration 화면상 최소 높이에 해당하는 분 (짧은 일정끼리 겹쳐 보이지 않게)
 * @returns {Array<{id: string, startMin: number, endMin: number, col: number, cols: number}>}
 */
export function layoutColumns(events, minDuration = 0) {
  const sorted = events
    .map((e) => ({ ...e, visEnd: Math.max(e.endMin, e.startMin + minDuration) }))
    .sort((a, b) => a.startMin - b.startMin || (b.visEnd - b.startMin) - (a.visEnd - a.startMin));

  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const colEnds = [];
    for (const ev of cluster) {
      let col = colEnds.findIndex((end) => end <= ev.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(ev.visEnd);
      } else {
        colEnds[col] = ev.visEnd;
      }
      ev.col = col;
    }
    for (const ev of cluster) {
      out.push({ id: ev.id, startMin: ev.startMin, endMin: ev.endMin, col: ev.col, cols: colEnds.length });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const ev of sorted) {
    if (cluster.length && ev.startMin >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.visEnd);
  }
  if (cluster.length) flush();
  return out;
}
