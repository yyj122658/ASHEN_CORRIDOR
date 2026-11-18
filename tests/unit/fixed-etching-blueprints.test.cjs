'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const families = ['象笏窄锋型', '鉴燧空环型', '凿户窗棂型', '溯洄曲折型', '抱瓮 U 钳型', '传世大阵型'];
const ranges = [[6, 9], [10, 14], [16, 21], [23, 29], [35, 39], [44, 54], [44, 54]];
const matchingArchetypes = [
  ['xianghu', 'zhibi', 'xuanhuang'], ['jiansui', 'lunya'], ['zaohuyou', 'sida', 'bingdi'],
  ['suhui', 'jiuceng'], ['xuanzhen', 'chuyao', 'dibuman'], ['hundun'],
];

test('八十门固定蚀刻法有对应轮廓族、稀有度格数、连通格与朝外起止刻线', () => {
  const V = loadVeteran().Veteran;
  const specs = Object.values(V.Data.MANUSCRIPTS);
  assert.equal(specs.length, 80);
  assert.deepEqual(new Set(specs.map((spec) => spec.geometryFamily)), new Set(families));
  for (const spec of specs) {
    const [min, max] = ranges[spec.rarity - 1];
    assert.ok(spec.cells.length >= min && spec.cells.length <= max, spec.id);
    const w = Math.max(...spec.cells.map(([x]) => x)) + 1;
    const h = Math.max(...spec.cells.map(([, y]) => y)) + 1;
    assert.ok(spec.cells.length < w * h, `${spec.id} 应有留白`);
    const cells = new Set(spec.cells.map(String));
    assert.equal(cells.size, spec.cells.length, spec.id);
    const { clock, main } = spec.io;
    assert.equal(String(clock.cell), String(spec.entry), spec.id);
    assert.equal(String(main.cell), String(spec.exits[0]), spec.id);
    for (const { cell, dir } of [clock, main]) {
      const [dx, dy] = V.Manuscript.ORTH[dir];
      assert.ok(cells.has(String(cell)), spec.id);
      assert.ok(!cells.has(`${cell[0] + dx},${cell[1] + dy}`), spec.id);
      assert.ok(spec.veins[String(cell)].includes(dir), spec.id);
    }
    const reached = new Set([String(spec.entry)]);
    for (const k of reached) {
      const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of Object.values(V.Manuscript.ORTH)) {
        const next = `${x + dx},${y + dy}`;
        if (cells.has(next)) reached.add(next);
      }
    }
    assert.equal(reached.size, cells.size, spec.id);
  }
});

test('传世大阵完整落在 11×7 浑沌实板，每门有三至四个 2×2 孔位', () => {
  const V = loadVeteran().Veteran;
  const plate = Array.from({ length: 77 }, (_, i) => [i % 11, Math.floor(i / 11)]);
  const arrays = Object.values(V.Data.MANUSCRIPTS).filter((m) => m.geometryFamily === families[5]);
  assert.ok(arrays.some((m) => m.rarity === 5));
  for (const spec of arrays) {
    assert.ok(spec.rarity >= 5, spec.id);
    const norm = V.Manuscript.normalize(spec);
    assert.ok(V.Manuscript.placements(norm, plate).length, spec.id);
    const cells = new Set(spec.cells.map(String));
    const w = Math.max(...spec.cells.map(([x]) => x)) + 1;
    const h = Math.max(...spec.cells.map(([, y]) => y)) + 1;
    const wells = [];
    for (let y = 1; y < h - 2; y += 1) {
      for (let x = 1; x < w - 2; x += 1) {
        const pocket = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
        const rim = [[x - 1, y], [x - 1, y + 1], [x + 2, y], [x + 2, y + 1],
          [x, y - 1], [x + 1, y - 1], [x, y + 2], [x + 1, y + 2]];
        if (pocket.every((c) => !cells.has(String(c))) && rim.every((c) => cells.has(String(c)))) wells.push([x, y]);
      }
    }
    assert.ok(wells.length >= 3 && wells.length <= 4, `${spec.id} 的孔位数为 ${wells.length}`);
    for (const [x, y] of wells) {
      assert.ok(wells.some(([rx, ry]) => rx === w - x - 2 && ry === y), `${spec.id} 的孔位应左右对称`);
    }
  }
});

test('固定轮廓各有相合板面，一阶通用，二阶起有装配取舍', () => {
  const V = loadVeteran().Veteran;
  const plates = Object.keys(V.PlateGen.ARCHETYPES).map((id) => [id, V.PlateGen.generate({ archetype: id }).cells]);
  const signatures = new Set();
  const compatibility = new Map();
  const specs = Object.values(V.Data.MANUSCRIPTS);
  for (const spec of specs) {
    const norm = V.Manuscript.normalize(spec);
    const orientations = Array.from({ length: 8 }, (_, i) => V.Manuscript.orient(norm, i % 4, i >= 4));
    const signature = orientations.map((shape) => shape.cells.map(String).sort().join(';')).sort()[0];
    assert.ok(!signatures.has(signature), `${spec.id} 与其他蚀刻法同形`);
    signatures.add(signature);
    const fits = plates.filter(([, cells]) => orientations.some((shape) => V.Manuscript.placements(shape, cells).length))
      .map(([id]) => id);
    compatibility.set(spec.id, fits);
    const expected = matchingArchetypes[families.indexOf(spec.geometryFamily)];
    assert.ok(expected.some((id) => fits.includes(id)), `${spec.id} 缺少相合的板面`);
    if (spec.rarity === 1) assert.equal(fits.length, plates.length, spec.id);
    if (spec.rarity >= 5) assert.ok(fits.includes('hundun'), spec.id);
    if (spec.rarity >= 6) assert.equal(spec.geometryFamily, families[5], spec.id);
    if (spec.geometryFamily === families[5]) assert.deepEqual(fits, ['hundun'], spec.id);
  }
  const universalSecond = specs.filter((m) => m.rarity === 2 && compatibility.get(m.id).length === plates.length);
  assert.ok(universalSecond.length <= 5, `通用二阶蚀刻法 ${universalSecond.length} 门`);
  for (const [id] of plates) {
    assert.ok(specs.some((m) => m.rarity >= 4 && compatibility.get(m.id).includes(id)), `${id} 缺少高阶选择`);
  }
  for (const [id, favored] of Object.entries({ furnaceEye: 'jiansui', lodestone: 'suhui', turbine: 'zaohuyou', surveyLens: 'xuanzhen' })) {
    const fits = compatibility.get(id);
    assert.ok(fits.includes(favored) && fits.length < plates.length, id);
  }
});
