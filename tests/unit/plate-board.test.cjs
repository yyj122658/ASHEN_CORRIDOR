'use strict';
/* 板面从「固定 4x4」换成「按 seed 生成的异形金属」后必须仍然成立的几条：
   seed 稳定、格数命中、终端在板面上、放不下的位置要报对原因。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;

const key = (c) => c[0] + ',' + c[1];

test('新开档走异形板面，每个单位都有自己的 plateSeed', () => {
  const st = V.State.create(4242);
  assert.equal(st.plateMode, 'plate');
  st.roster.forEach((u) => {
    assert.ok(Number.isInteger(u.plateSeed), `${u.name} 缺少 plateSeed`);
    const plate = V.Circuit.plateOf(u);
    assert.equal(plate.generated, true);
    const target = V.Data.BODIES[u.bodyPreset].plate.target;
    assert.equal(plate.cells.size, target, `${u.name} 格数应命中 ${target}`);
  });
});

test('同一单位重复取板面结果一致（seed 稳定，可存档）', () => {
  const st = V.State.create(777);
  const u = st.roster[0];
  const a = [...V.Circuit.plateOf(u).cells].sort().join('|');
  const b = [...V.Circuit.plateOf(JSON.parse(JSON.stringify(u))).cells].sort().join('|');
  assert.equal(a, b);
});

test('能量点由功法给：四个具名点都落在功法格上', () => {
  const st = V.State.create(9001);
  st.roster.forEach((u) => {
    assert.ok(u.manuscript, `${u.name} 应该带一套入门功法`);
    const plate = V.Circuit.plateOf(u);
    const t = plate.terminals;
    assert.deepEqual(Object.keys(t).sort(), ['clock', 'damage', 'main', 'support']);
    Object.keys(t).forEach((id) => {
      assert.ok(plate.cells.has(key(t[id].cell)), `${u.name} 的 ${id} 不在板面上`);
      assert.equal(t[id].fromManuscript, true);
    });
    assert.equal(t.clock.role, 'in');
    assert.equal(t.main.role, 'out');
  });
});

test('没有功法就没有能量点：板面只剩槽位', () => {
  const st = V.State.create(9001);
  const u = st.roster[0];
  const bare = Object.assign({}, u, { manuscript: null });
  const plate = V.Circuit.plateOf(bare);
  assert.deepEqual(Object.keys(plate.terminals), []);
});

test('板面外的位置报「不在板面上」，不再说屏蔽格', () => {
  const st = V.State.create(2468);
  const u = st.roster[0];
  const plate = V.Circuit.plateOf(u);
  /* 找一个肯定不在板面上的格 */
  let outside = null;
  for (let y = 0; y < 7 && !outside; y++) {
    for (let x = 0; x < 7 && !outside; x++) {
      if (!plate.cells.has(x + ',' + y)) outside = [x, y];
    }
  }
  assert.ok(outside, '板面不该铺满 7x7');
  const part = V.State.makePart(V.State.clone(st), { kind: 'circuit', templateId: 'straight' });
  const tmp = V.State.clone(st);
  tmp.itemsById[part.id] = part;
  tmp.stash.push(part.id);
  const r = V.Circuit.preview(tmp, u.id, [{ itemId: part.id, x: outside[0], y: outside[1] }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('不在板面上')), JSON.stringify(r.errors));
});

test('异形板面上放得下的位置能通过几何校验', () => {
  const st = V.State.create(1357);
  const u = st.roster[0];
  const plate = V.Circuit.plateOf(u);
  const cells = [...plate.cells].map((k) => k.split(',').map(Number));
  /* 找一对相邻格放直导管 */
  let spot = null;
  for (const [x, y] of cells) {
    if (plate.cells.has((x + 1) + ',' + y)) { spot = [x, y]; break; }
    if (plate.cells.has(x + ',' + (y + 1))) { spot = [x, y, 'v']; break; }
  }
  assert.ok(spot, '板面上总该有相邻两格');

  const tmp = V.State.clone(st);
  const part = V.State.makePart(tmp, { kind: 'circuit', templateId: 'straight' });
  tmp.itemsById[part.id] = part;
  tmp.stash.push(part.id);
  const r = V.Circuit.preview(tmp, u.id, [{
    itemId: part.id, x: spot[0], y: spot[1], rotation: spot[2] === 'v' ? 1 : 0,
  }]);
  const geoErrors = (r.errors || []).filter((e) => e.includes('不在板面上') || e.includes('越界') || e.includes('重叠'));
  assert.deepEqual(geoErrors, [], `几何不应报错：${geoErrors.join(' / ')}`);
});

test('老存档走经典 4x4，坐标与终端保持原样', () => {
  const st = V.State.create(4242, { classicPlate: true });
  const u = st.roster[0];
  assert.equal(st.plateMode, 'classic');
  assert.ok(u.plateOverride, '经典模式应带板面覆写');
  const plate = V.Circuit.plateOf(u);
  assert.equal(plate.generated, false);
  assert.equal(plate.terminals.main.cell.join(','), V.Data.TERMINALS.main.cell.join(','));
  /* 预设在经典板面上不应被平移 */
  const placements = u.board.placements;
  assert.ok(placements.length > 0, '经典形态应该自带基础线路');
  assert.equal(placements[0].x, 0);
  assert.equal(placements[0].y, 1);
});

test('预设线路在异形板面上要么铺得下、要么留空，不会产生非法坐标', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const st = V.State.create(seed * 7919);
    st.roster.forEach((u) => {
      const plate = V.Circuit.plateOf(u);
      u.board.placements.forEach((p) => {
        const item = st.itemsById[p.itemId];
        if (!item) return;
        const tpl = V.Data.template(item.templateId);
        const tf = V.Circuit.transformTemplate(tpl, p.rotation || 0, !!p.mirrorY);
        tf.cells.forEach((c) => {
          assert.ok(plate.cells.has((c.x + p.x) + ',' + (c.y + p.y)),
            `seed ${seed * 7919} ${u.name} 的 ${tpl.name} 落在了板面外`);
        });
      });
    });
  }
});
