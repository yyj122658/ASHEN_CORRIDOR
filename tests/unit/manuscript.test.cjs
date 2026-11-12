'use strict';
/* 蚀刻法膜的两条判定：覆盖（有纹路占格就算填上）与贯通（对上的格能否连到出口）。
   这两条是整个系统的地基，错一点「填充」就退化成装箱。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const M = A.Veteran.Manuscript;

/* 一条 3 格横纹：0,0 --E--> 1,0 --W/E--> 2,0 */
const LINE3 = {
  id: 'line3', name: '一线',
  cells: [[0, 0], [1, 0], [2, 0]],
  veins: { '0,0': ['E'], '1,0': ['W', 'E'], '2,0': ['W'] },
  entry: [0, 0], exits: [[2, 0]],
  tiers: [{ at: 40, id: 't1' }, { at: 75, id: 't2' }, { at: 100, id: 't3' }],
};

const PLATE = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]];

function idx(map) {
  const dirs = new Map(Object.entries(map));
  return { dirs, occupied: new Set(dirs.keys()) };
}

test('normalize 把格子平移到 0,0 并保留走向', () => {
  const ms = M.normalize({
    ...LINE3,
    cells: [[5, 5], [6, 5], [7, 5]],
    veins: { '5,5': ['E'], '6,5': ['W', 'E'], '7,5': ['W'] },
    entry: [5, 5], exits: [[7, 5]],
  });
  assert.deepEqual(ms.cells, [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(ms.veins['0,0'], ['E']);
  assert.deepEqual(ms.entry, [0, 0]);
  assert.deepEqual(ms.exits, [[2, 0]]);
});

test('旋转 4 次 / 翻转 2 次都回到原样', () => {
  const base = M.normalize(LINE3);
  let cur = base;
  for (let i = 0; i < 4; i++) cur = M.orient(M.normalize(cur), 1, false);
  assert.deepEqual(cur.cells.slice().sort(), base.cells.slice().sort());
  assert.deepEqual(cur.entry, base.entry);

  const flipped = M.orient(base, 0, true);
  const back = M.orient(M.normalize({ ...flipped, veins: flipped.veins, entry: flipped.entry, exits: flipped.exits }), 0, true);
  assert.deepEqual(back.cells.slice().sort(), base.cells.slice().sort());
});

test('旋转 90° 后竖起来，走向也跟着转', () => {
  const ms = M.orient(M.normalize(LINE3), 1, false);
  assert.deepEqual(ms.cells.slice().sort(), [[0, 0], [0, 1], [0, 2]].sort());
  /* 原 E 方向转 90° 变 S */
  const head = ms.cells.find((c) => c[0] === 0 && c[1] === 0);
  assert.ok(head);
  const dirs = Object.values(ms.veins).flat();
  assert.ok(dirs.includes('S') || dirs.includes('N'), '旋转后应该是竖方向');
});

test('fits：格子超出板面就放不下', () => {
  const ms = M.normalize(LINE3);
  assert.equal(M.fits(ms, PLATE, 0, 0), true);
  assert.equal(M.fits(ms, PLATE, 1, 0), true);
  assert.equal(M.fits(ms, PLATE, 2, 0), false, '2,0 加 3 格会越界');
});

test('覆盖率：每格都被纹路覆盖就是 100%', () => {
  const ms = M.normalize(LINE3);
  const full = M.coverage(ms, 0, 0, idx({
    '0,0': ['E'], '1,0': ['W', 'E'], '2,0': ['W'],
  }));
  assert.equal(full.pct, 100);
  assert.equal(full.aligned, 3);
  assert.equal(full.tier.id, 't3');

  /* 中间接缝不通，三格仍有覆盖 */
  const broken = M.coverage(ms, 0, 0, idx({
    '0,0': ['E'], '1,0': ['E'], '2,0': ['W'],
  }));
  assert.equal(broken.aligned, 3);
  assert.equal(broken.pct, 100);
  assert.equal(broken.tier.id, 't3');
});

test('覆盖率的分子分母都只认膜：板面再大也只有 3 格', () => {
  const ms = M.normalize(LINE3);
  const cov = M.coverage(ms, 0, 0, idx({ '0,0': ['E'], '1,0': ['W', 'E'], '2,0': ['W'] }));
  assert.equal(cov.total, 3, '分母是膜的格数，不是板面 8 格');
});

test('格子被占住但没纹路，不算填上', () => {
  const ms = M.normalize({
    id: 'plain', name: '纯占位', cells: [[0, 0]], veins: {}, entry: [0, 0], exits: [[0, 0]],
    tiers: [{ at: 100, id: 't1' }],
  });
  const empty = M.coverage(ms, 0, 0, { dirs: new Map(), occupied: new Set() });
  assert.equal(empty.pct, 0, '没有纹路就不是填上');

  const covered = M.coverage(ms, 0, 0, { dirs: new Map(), occupied: new Set(['0,0']) });
  assert.equal(covered.pct, 100, '被纹路占住即算填上（该格不要求走向）');
});

test('贯通：三格都上的时候连得通', () => {
  const ms = M.normalize(LINE3);
  const r = M.route(ms, 0, 0, idx({ '0,0': ['E'], '1,0': ['W', 'E'], '2,0': ['W'] }));
  assert.equal(r.ok, true);
});

test('贯通：中间一格断掉就走不过去', () => {
  const ms = M.normalize(LINE3);
  const r = M.route(ms, 0, 0, idx({
    '0,0': ['E'], '1,0': ['W', 'E'], '2,0': ['E'],
  }));
  assert.equal(r.ok, false, '最后一格没开 W，接不上');
});

test('贯通：只一方开口不算连通', () => {
  const ms = M.normalize({
    id: 'pair', name: '两格', cells: [[0, 0], [1, 0]],
    veins: { '0,0': ['E'], '1,0': ['E'] },
    entry: [0, 0], exits: [[1, 0]], tiers: [{ at: 100, id: 't1' }],
  });
  /* 1,0 上确实有 E 开口，但 0,0 的 E 没有对应的 W 回过来 */
  const r = M.route(ms, 0, 0, idx({ '0,0': ['E'], '1,0': ['E'] }));
  assert.equal(r.ok, false);
});

test('pieceIndex 从 layout 结果建索引', () => {
  const layout = {
    built: [{
      abs: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      aps: [
        { cell: [0, 0], dir: 'E' },
        { cell: [1, 0], dir: 'W' },
      ],
    }],
  };
  const index = M.pieceIndex(layout);
  assert.deepEqual(index.dirs.get('0,0'), ['E']);
  assert.equal(index.occupied.has('1,0'), true);
});
