'use strict';
/* 板面生成的硬保证：确定性、格数命中、单连通、无孤立格，以及形状身份。
   格数统一 77、形态 14 种——这两种维度必须互不干扰：换形态换轮廓，不换格数。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const G = A.Veteran.PlateGen;
const TARGET = G.PLATE_TARGET;
const ARCHES = Object.keys(G.ARCHETYPES);

const cellsKey = (cells) => cells.map((c) => c.join(',')).join('|');

test('同一 seed 结果完全一致（可存档、可重放）', () => {
  const a = G.generate({ seed: 12345, archetype: 'full' });
  const b = G.generate({ seed: 12345, archetype: 'full' });
  assert.equal(cellsKey(a.cells), cellsKey(b.cells));

  const c = G.generate({ seed: 12346, archetype: 'ell' });
  assert.notEqual(
    cellsKey(G.generate({ seed: 12345, archetype: 'ell' }).cells),
    cellsKey(c.cells),
    '换 seed 应该换形状',
  );

  const other = G.generate({ seed: 12345, archetype: 'ring' });
  assert.notEqual(cellsKey(a.cells), cellsKey(other.cells), '换形态必须换轮廓');
});

test('14 种形态 × 40 个种子都命中 77 格', () => {
  assert.equal(ARCHES.length, 14, '形态应该是 14 种');
  assert.equal(TARGET, 77, '目标格数统一 77，不再按形态分档');
  ARCHES.forEach((arch) => {
    assert.equal(G.ARCHETYPES[arch].target, TARGET, `${arch} 的 target 应统一`);
    for (let seed = 1; seed <= 40; seed++) {
      const r = G.generate({ seed: seed * 7919, archetype: arch });
      assert.equal(r.cells.length, TARGET, `${arch} seed=${seed * 7919} 得到 ${r.cells.length}/${TARGET}`);
      assert.ok(G.isConnected(new Set(r.cells.map((c) => c.join(',')))), `${arch} seed=${seed * 7919} 不连通`);
    }
  });
});

test('永远单连通、无孤立格（否则 2 格纹路放不进去）', () => {
  ARCHES.forEach((arch) => {
    for (let seed = 1; seed <= 12; seed++) {
      const { cells } = G.generate({ seed: seed * 31337, archetype: arch });
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

test('形状身份保住了：象笏仍是窄长条，鉴燧之齐一定留孔，浑沌未凿是一块实心板', () => {
  for (let seed = 1; seed <= 15; seed++) {
    /* 狭长：77 格堆在 12×12 里，最宽仍要明显窄于包围盒 */
    const bar = G.analyze(G.generate({ seed: seed * 104729, archetype: 'bar' }).cells);
    assert.ok(bar.width <= 8, `狭长最宽不该超过 8，实际 ${bar.width}`);
    assert.ok(bar.height >= 10, `狭长应该纵向拉开，实际高 ${bar.height}`);

    /* 环：必须围出真正的孔，且孔要成片而不是零星漏格 */
    const ring = G.analyze(G.generate({ seed: seed * 104729, archetype: 'ring' }).cells);
    assert.ok(ring.holes >= 6, `环应该留出成片孔洞，实际 ${ring.holes}`);

    /* 浑沌未凿：77 格必须是一块没有缺口的实心板（11×7 正好铺满），
       所以它也是唯一不随 seed 变形的原型——它的身份就是「没有形状」。 */
    const full = G.analyze(G.generate({ seed: seed * 104729, archetype: 'full' }).cells);
    assert.equal(full.holes, 0, `浑沌未凿不该有孔洞，实际 ${full.holes}`);
    assert.ok(full.width * full.height === full.count, `浑沌未凿应铺满包围盒（${full.width}×${full.height} / ${full.count} 格）`);
    assert.ok(full.width >= 10, `浑沌未凿应横着铺开，实际宽 ${full.width}`);
  }
});

test('14 种形态的轮廓两两可区分（同一 seed 下没有两块长得一样）', () => {
  const seen = new Map();
  ARCHES.forEach((arch) => {
    const cells = G.generate({ seed: 4242, archetype: arch }).cells;
    const sig = cellsKey([...cells].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0])));
    assert.ok(!seen.has(sig), `${arch} 与 ${seen.get(sig)} 生成了完全相同的轮廓`);
    seen.set(sig, arch);
  });
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

test('目标格数可以显式覆盖（给小板留的应急口）', () => {
  const big = G.generate({ seed: 99, archetype: 'full' });
  const small = G.generate({ seed: 99, archetype: 'full', target: 40 });
  assert.equal(big.cells.length, TARGET);
  assert.equal(small.cells.length, 40);
});
