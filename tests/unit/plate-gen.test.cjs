'use strict';
/* 板面生成的四条硬保证：确定性、格数命中、单连通、无孤立格。
   还有一条形状身份：狭长不会被补成方块。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const G = A.Veteran.PlateGen;

const cellsKey = (cells) => cells.map((c) => c.join(',')).join('|');

test('同一 seed 结果完全一致（可存档、可重放）', () => {
  const a = G.generate({ seed: 12345, archetype: 'full', target: 28 });
  const b = G.generate({ seed: 12345, archetype: 'full', target: 28 });
  assert.equal(cellsKey(a.cells), cellsKey(b.cells));

  const c = G.generate({ seed: 12346, archetype: 'full', target: 28 });
  assert.notEqual(cellsKey(a.cells), cellsKey(c.cells), '换 seed 应该换形状');
});

test('所有原型种子都能命中目标格数', () => {
  Object.keys(G.ARCHETYPES).forEach((arch) => {
    const target = G.ARCHETYPES[arch].target;
    let hit = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = G.generate({ seed: seed * 7919, archetype: arch, target });
      assert.equal(r.cells.length, target, `${arch} seed=${seed * 7919} 得到 ${r.cells.length}/${target}`);
      if (r.hit) hit++;
    }
    assert.equal(hit, 20, `${arch} 应全部命中`);
  });
});

test('永远单连通、无孤立格（否则 2 格纹路放不进去）', () => {
  Object.keys(G.ARCHETYPES).forEach((arch) => {
    for (let seed = 1; seed <= 12; seed++) {
      const { cells } = G.generate({ seed: seed * 31337, archetype: arch, target: G.ARCHETYPES[arch].target });
      const info = G.analyze(cells);
      assert.equal(info.connected, true, `${arch} 应该连通`);
      const set = new Set(cells.map((c) => c.join(',')));
      cells.forEach(([x, y]) => {
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .filter(([dx, dy]) => set.has((x + dx) + ',' + (y + dy))).length;
        assert.ok(n >= 1, `${arch} 的 (${x},${y}) 是孤立格`);
      });
    }
  });
});

test('形状身份保住了：狭长不会被补成方块，环一定会留孔', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const bar = G.generate({ seed: seed * 104729, archetype: 'bar', target: 22 });
    assert.ok(G.analyze(bar.cells).width <= 4, '狭长最宽不该超过 4');

    const ring = G.generate({ seed: seed * 104729, archetype: 'ring', target: 28 });
    assert.ok(G.analyze(ring.cells).holes >= 1, '环应该有被围住的孔');
  }
});

test('analyze 的孔洞与最长直线段算得对', () => {
  /* 3x3 的空心环：8 格 + 1 个孔 */
  const ringCells = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x === 1 && y === 1) continue;
    ringCells.push([x, y]);
  }
  const info = G.analyze(ringCells);
  assert.equal(info.count, 8);
  assert.equal(info.holes, 1, '中间那格应算孔洞');
  assert.equal(info.longestRun, 3, '顶行是 3 连');

  /* 一条 1x5 的直线 */
  const line = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const li = G.analyze(line);
  assert.equal(li.longestRun, 5);
  assert.equal(li.holes, 0);
  assert.equal(li.width, 5);
  assert.equal(li.height, 1);
});

test('目标格数可以覆盖原型默认值（两档：28 / 22）', () => {
  const big = G.generate({ seed: 99, archetype: 'full', target: 28 });
  const small = G.generate({ seed: 99, archetype: 'full', target: 22 });
  assert.equal(big.cells.length, 28);
  assert.equal(small.cells.length, 22);
});
