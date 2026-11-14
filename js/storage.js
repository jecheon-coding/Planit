// localStorage 래퍼 + 스키마 마이그레이션.
// localStorage를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 메모리에만 저장한다.

const PREFIX = 'planit:';
export const SCHEMA_VERSION = 1;

const memory = new Map();
let persistent = probe();

function probe() {
  try {
    const key = `${PREFIX}__probe`;
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function isPersistent() {
  return persistent;
}

export function load(key, fallback) {
  try {
    const raw = persistent ? localStorage.getItem(PREFIX + key) : memory.get(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  const raw = JSON.stringify(value);
  if (persistent) {
    try {
      localStorage.setItem(PREFIX + key, raw);
      return;
    } catch {
      persistent = false; // 용량 초과 등 → 메모리 모드로 전환
    }
  }
  memory.set(key, raw);
}

/**
 * 버전 n으로 올라갈 때 실행할 함수. 예)
 * 2: () => { const items = load('items', []); save('items', items.map(...)); }
 */
const migrations = {
  1: () => {}, // 최초 스키마
};

export function migrate() {
  let version = load('schema', 0);
  while (version < SCHEMA_VERSION) {
    version += 1;
    migrations[version]?.();
  }
  save('schema', SCHEMA_VERSION);
}
