'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('../helpers/load-game.cjs');

const A = loadGame();
const R = A.Random;

test('seed=0 可用且确定', () => {
  const a = R.next(0);
  const b = R.next(0);
  assert.equal(a.value, b.value);
  assert.ok(a.value >= 0 && a.value < 1, 'value 必须在 [0,1)');
  assert.notEqual(a.state, 0, 'state 必须推进');
});

test('连续 200 次取值都落在 [0,1)', () => {
  let s = 12345;
  for (let i = 0; i < 200; i++) {
    const r = R.next(s);
    assert.ok(r.value >= 0 && r.value < 1);
    assert.ok(Number.isInteger(r.state) && r.state >= 0);
    s = r.state;
  }
});

test('保存中间 state 后重放产生完全相同的后续序列', () => {
  let s = 999;
  const first = [];
  for (let i = 0; i < 20; i++) { const r = R.next(s); first.push(r.value); s = r.state; }

  const checkpoint = 7;
  let s2 = 999;
  for (let i = 0; i < checkpoint; i++) { s2 = R.next(s2).state; }
  let s3 = s2;
  const replay = [];
  for (let i = checkpoint; i < 20; i++) { const r = R.next(s3); replay.push(r.value); s3 = r.state; }

  assert.deepEqual(replay, first.slice(checkpoint));
});

test('shuffle 不修改入参且是排列', () => {
  const src = [1, 2, 3, 4, 5, 6, 7];
  const r = R.shuffle(42, src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(r.value.slice().sort((a, b) => a - b), src);
});

test('int 覆盖闭区间边界', () => {
  let s = 7;
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const r = R.int(s, 0, 3); seen.add(r.value); s = r.state; }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test('seedFrom 对同一输入稳定，对不同输入不同', () => {
  assert.equal(R.seedFrom('灰烬'), R.seedFrom('灰烬'));
  assert.notEqual(R.seedFrom('a'), R.seedFrom('b'));
});
