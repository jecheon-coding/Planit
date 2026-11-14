// 아주 작은 테스트 러너 — 브라우저(tests/test.html)와 Node(tests/run-node.js) 양쪽에서 동작.

const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export function assertEqual(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label ? `${label}: ` : ''}expected ${e}, got ${a}`);
}

export function assert(cond, message = 'assertion failed') {
  if (!cond) throw new Error(message);
}

export async function run() {
  const results = [];
  for (const { name, fn } of cases) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  }
  return results;
}
