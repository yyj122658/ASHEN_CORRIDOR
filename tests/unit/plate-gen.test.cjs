'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const { PlateGen: G, Data: D } = loadVeteran().Veteran;

const legends = {
  xianghu: ['周岳', '象笏', 2], hundun: ['赵德厚', '浑沌未凿', 0],
  suhui: ['林知微', '溯洄从之', 3], xuanzhen: ['马库斯·霍尔特', '悬针', 3],
  jiansui: ['塞西尔·范·德·伯格', '鉴燧之齐', 3], zaohuyou: ['克拉拉·莫雷蒂', '凿户牖', 2],
  lunya: ['卢卡斯·克劳泽', '轮牙', 8], zhibi: ['奥托·施密特', '栉比', 7],
  xuanhuang: ['巴图尔', '玄璜', 2], jiuceng: ['叶莲娜·莫罗佐娃', '九层之台', 2],
  dibuman: ['陈大勇', '地不满东南', 3], chuyao: ['沈明轩', '楚腰', 2],
  bingdi: ['米丽娅姆', '并蒂', 1], sida: ['约瑟夫·卡特', '四达之衢', 1],
};

test('十四位传奇各带一块固定、连通的 77 格板面，锚点和心核坐标合法', () => {
  assert.deepEqual(Object.keys(G.ARCHETYPES).sort(), Object.keys(legends).sort());
  assert.equal(D.SKINS.length, 14);
  const shapes = new Set();
  for (const skin of D.SKINS) {
    const arch = D.body(skin.metal).archetype;
    const [name, plateName, anchorCount] = legends[arch];
    assert.equal(skin.name, name);
    assert.equal(D.bodyStyle(skin.metal, skin.culture), plateName);
    const g = G.generate({ archetype: arch, seed: 2 });
    assert.deepEqual(g, G.generate({ archetype: arch, seed: 2009, target: 31 }), arch);
    assert.equal(g.archetype, arch);
    assert.equal(g.cells.length, 77, arch);
    const geo = G.analyze(g.cells);
    assert.equal(geo.count, 77, arch);
    assert.equal(geo.connected, true, arch);
    assert.ok(g.cells.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y)
      && x >= 0 && x < G.SIZE && y >= 0 && y < G.SIZE), arch);
    const cells = new Set(g.cells.map((c) => c.join(',')));
    assert.equal(g.clockCore.length, arch === 'bingdi' ? 2 : 1, arch);
    assert.equal(g.innateNodes.length, anchorCount, arch);
    const marks = [...g.clockCore, ...g.innateNodes].map((c) => c.join(','));
    assert.equal(new Set(marks).size, marks.length, arch);
    assert.ok(marks.every((mark) => cells.has(mark)), arch);
    shapes.add(g.cells.map((cell) => cell.join(',')).sort().join('|'));
  }
  assert.equal(shapes.size, 14);
});

test('实板、镜环与窗格的空格保持原设计', () => {
  const solid = G.analyze(G.generate({ archetype: 'hundun' }).cells);
  assert.equal(solid.width, 11);
  assert.equal(solid.height, 7);
  assert.equal(solid.holes, 0);

  const ring = G.generate({ archetype: 'jiansui' });
  assert.equal(G.analyze(ring.cells).holes, 16);
  assert.ok(ring.cells.every(([x, y]) => x < 4 || x > 7 || y < 4 || y > 7));

  const frame = G.generate({ archetype: 'zaohuyou' });
  assert.equal(G.analyze(frame.cells).holes, 16);
  const cut = [2, 3, 7, 8];
  assert.ok(frame.cells.every(([x, y]) => !cut.includes(x) || !cut.includes(y)));
});

test('象笏纵贯，楚腰仅两格宽，并蒂两瓣只在底部接合', () => {
  const bar = G.generate({ archetype: 'xianghu' });
  assert.equal(G.analyze(bar.cells).height, 11);
  assert.ok([...Array(11).keys()].every((y) => [4, 5, 6].every((x) =>
    bar.cells.some(([cx, cy]) => x === cx && y === cy))));
  assert.equal(G.generate({ archetype: 'chuyao' }).cells.filter(([, y]) => y === 5).length, 2);

  const twin = G.generate({ archetype: 'bingdi' });
  const mid = twin.cells.filter(([x]) => x === 5);
  assert.equal(mid.length, 1);
  assert.equal(mid[0][1], Math.max(...twin.cells.map(([, y]) => y)));
  const mirror = new Set(twin.cells.map(([x, y]) => `${10 - x},${y}`));
  assert.ok(twin.cells.every((cell) => mirror.has(cell.join(','))));
});

test('河弯、盾刺、齿尖、梳齿、弧口和台阶的方向固定', () => {
  const plate = (archetype) => G.generate({ archetype });
  const row = (g, y) => g.cells.filter(([, cy]) => cy === y).map(([x]) => x);
  const middle = (g, y) => (Math.min(...row(g, y)) + Math.max(...row(g, y))) / 2;
  const river = plate('suhui');
  assert.ok(middle(river, 0) > middle(river, 4));
  assert.ok(middle(river, 4) < middle(river, 8));
  assert.ok(middle(river, 8) > middle(river, 10));

  const shield = plate('xuanzhen');
  assert.equal(shield.cells.filter(([x]) => x === 11).length, 1);
  assert.equal(shield.cells.filter(([x]) => x === 3).length, 11);

  const wheel = plate('lunya');
  const tips = wheel.cells.filter(([x, y]) => (x - 5) ** 2 + (y - 5) ** 2 === 25);
  assert.deepEqual(wheel.innateNodes, tips);

  const comb = plate('zhibi');
  const mirror = new Set(comb.cells.map(([x, y]) => `${10 - x},${y}`));
  assert.ok(comb.cells.every((cell) => mirror.has(cell.join(','))));
  assert.ok(comb.innateNodes.every(([x]) => x === 5));

  const crescent = plate('xuanhuang');
  assert.ok(Math.max(...row(crescent, 5)) < Math.max(...row(crescent, 0)));
  assert.ok(crescent.innateNodes.every(([x, y]) => x === Math.max(...row(crescent, y))));
  assert.equal(crescent.holes, 0);

  const steps = plate('jiuceng');
  assert.deepEqual([...new Set([0, 3, 8].map((y) => row(steps, y).length))], [3, 7, 11]);
  const notch = plate('dibuman');
  assert.ok([5, 7, 9].every((y) => row(notch, y).length < row(notch, y - 1).length));

  const hub = plate('sida');
  assert.equal(row(hub, 5).length, 11);
  assert.equal(hub.cells.filter(([x]) => x === 5).length, 11);
});

test('固定板面的坐标可安全供不同实例使用', () => {
  const plate = G.generate({ archetype: 'xianghu' });
  plate.cells[0][0] = -1;
  plate.clockCore[0][0] = -1;
  plate.innateNodes[0][0] = -1;
  const fresh = G.generate({ archetype: 'xianghu' });
  for (const grid of [fresh.cells, fresh.clockCore, fresh.innateNodes]) {
    assert.ok(grid.every(([x, y]) => x >= 0 && y >= 0));
  }
});

test('analyze 记出环的孔洞与直线最长段', () => {
  const ring = G.analyze([[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]);
  assert.equal(ring.count, 8);
  assert.equal(ring.holes, 1);
  assert.equal(ring.longestRun, 3);
  const line = G.analyze([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  assert.equal(line.longestRun, 5);
  assert.equal(line.holes, 0);
  assert.equal(line.width, 5);
  assert.equal(line.height, 1);
});
