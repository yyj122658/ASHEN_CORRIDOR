'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;

/** 现造指定布局的纹路实例，返回 placements（只含这些新件）。 */
function mk(st, layout) {
  return layout.map((slot) => {
    if (slot.itemId) return { itemId: slot.itemId, x: slot.x, y: slot.y, rotation: slot.rotation || 0, mirrorY: !!slot.mirrorY };
    const item = V.State.makePart(st, { kind: 'circuit', templateId: slot.templateId });
    st.itemsById[item.id] = item;
    return { itemId: item.id, x: slot.x, y: slot.y, rotation: slot.rotation || 0, mirrorY: !!slot.mirrorY };
  });
}

function fresh() { return V.State.create(4242, { classicPlate: true }); }

test('基础线路在三个底盘上都合法，5 格 / load 2', () => {
  const st = fresh();
  st.roster.forEach((u) => {
    const r = V.Circuit.preview(st, u.id, u.board.placements);
    assert.ok(r.ok, `${u.bodyPreset}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.occupied.length, 5, `${u.bodyPreset} 占格`);
    assert.equal(r.load, 2, `${u.bodyPreset} 负荷`);
    /* 接线模型已删除：装配只校验几何、重叠与负荷 */
    assert.equal(r.reachableOutputs, undefined, 'preview 不再产出接线结果');
  });
});

test('蓄能预设三底盘合法（文档写 6 格/load3；模板表 capacitor 为 4 格，实际 7 格/load3）', () => {
  const st = fresh();
  st.roster.forEach((u) => {
    const onlyNew = mk(st, [
      { templateId: 'capacitor', x: 0, y: 1 },
      { templateId: 'elbow', x: 2, y: 1 },
    ]);
    const r = V.Circuit.preview(st, u.id, onlyNew);
    assert.ok(r.ok, `${u.bodyPreset}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.occupied.length, 7, 'capacitor(4 格)+elbow(3 格)');
    assert.equal(r.load, 3, 'capacitor(load2)+elbow(load1)');
  });
});

test('mirrored elbow(0,2)+straight(2,2) 在三底盘上都放得下', () => {
  const st = fresh();
  st.roster.forEach((u) => {
    const onlyNew = mk(st, [
      { templateId: 'elbow', x: 0, y: 2, mirrorY: true },
      { templateId: 'straight', x: 2, y: 2 },
    ]);
    const r = V.Circuit.preview(st, u.id, onlyNew);
    assert.ok(r.ok, `${u.bodyPreset}: ${JSON.stringify(r.errors)}`);
  });
});

test('splitter(0,0) 的左上角仍是空格', () => {
  const st = fresh();
  st.roster.forEach((u) => {
    const onlyNew = mk(st, [
      { templateId: 'splitter', x: 0, y: 0 },
      { templateId: 'straight', x: 2, y: 0 },
      { templateId: 'straight', x: 2, y: 2 },
    ]);
    const r = V.Circuit.preview(st, u.id, onlyNew);
    assert.ok(r.ok, `${u.bodyPreset}: ${JSON.stringify(r.errors)}`);
    assert.ok(!r.occupied.some(([x, y]) => x === 0 && y === 0), 'splitter 的 (0,0) 不该被算作占格');
  });
});

test('旋转四次与上下翻转两次都还原模板', () => {
  Object.values(D.TEMPLATES).forEach((tpl) => {
    const base = V.Circuit.transformTemplate(tpl, 0, false);
    const rot4 = V.Circuit.transformTemplate(tpl, 4, false);
    assert.deepEqual(rot4.cells, base.cells, `${tpl.id} 旋转四次`);
    assert.deepEqual(rot4.ports.map((p) => [p.id, p.dir, p.cell.join(',')]),
      base.ports.map((p) => [p.id, p.dir, p.cell.join(',')]), `${tpl.id} 端口还原`);

    const m1 = V.Circuit.transformTemplate(tpl, 0, true);
    const m2 = V.Circuit.transformTemplate({ cells: m1.cells.map((c) => [c.x, c.y]), ports: m1.ports, links: m1.links }, 0, true);
    assert.deepEqual(m2.cells, base.cells, `${tpl.id} 翻转两次`);
  });
});

test('旋转只改朝向，不改变占格数量', () => {
  Object.values(D.TEMPLATES).forEach((tpl) => {
    for (let r = 0; r < 4; r++) {
      const tf = V.Circuit.transformTemplate(tpl, r, false);
      assert.equal(tf.cells.length, tpl.cells.length, `${tpl.id} r${r}`);
      assert.equal(tf.ports.length, tpl.ports.length);
    }
  });
});

test('相邻但没有匹配端口时不导通', () => {
  const st = fresh();
  const u = st.roster[0];
  const placements = mk(st, [
    { templateId: 'straight', x: 0, y: 0 },
    { templateId: 'straight', x: 2, y: 1 },
  ]);
  const r = V.Circuit.preview(st, u.id, placements);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.reachableOutputs, undefined, '接线模型已删除，凌空端口不影响合法性');
});

test('越界 / 屏蔽格 / 重叠 / 超负荷都给出具体原因', () => {
  const st = fresh();
  const agile = st.roster.find((u) => u.bodyPreset === 'agile');

  const oob = mk(st, [{ templateId: 'straight', x: 3, y: 3 }]);
  const rOob = V.Circuit.preview(st, agile.id, oob);
  assert.ok(!rOob.ok);
  assert.ok(rOob.errors.some((m) => m.includes('越界')), JSON.stringify(rOob.errors));

  const blk = mk(st, [{ templateId: 'straight', x: 2, y: 3 }]);
  const rBlk = V.Circuit.preview(st, agile.id, blk);
  assert.ok(!rBlk.ok);
  assert.ok(rBlk.errors.some((m) => m.includes('屏蔽格')), JSON.stringify(rBlk.errors));

  const overlap = mk(st, [
    { templateId: 'straight', x: 1, y: 1 },
    { templateId: 'straight', x: 1, y: 1 },
  ]);
  const rOv = V.Circuit.preview(st, agile.id, overlap);
  assert.ok(!rOv.ok);
  assert.ok(rOv.errors.some((m) => m.includes('重叠')), JSON.stringify(rOv.errors));

  const cap = D.BODIES.sturdy.loadCap;
  D.BODIES.sturdy.loadCap = 2;
  try {
    const sturdy = st.roster.find((u) => u.bodyPreset === 'sturdy');
    const heavy = mk(st, [
      { templateId: 'capacitor', x: 0, y: 1 },
      { templateId: 'capacitor', x: 2, y: 1 },
    ]);
    const rLoad = V.Circuit.preview(st, sturdy.id, heavy);
    /* 负荷超限不再拦装配：要能算出超载量，交给战斗结算 */
    assert.equal(rLoad.ok, true, JSON.stringify(rLoad.errors));
    assert.ok(rLoad.overload > 0, `超载量应大于 0（load ${rLoad.load} / cap ${rLoad.cap}）`);
  } finally {
    D.BODIES.sturdy.loadCap = cap;
  }
});

test('非法板面不修改 state', () => {
  const st = fresh();
  const u = st.roster[0];
  const bad = mk(st, [{ templateId: 'straight', x: 9, y: 9 }]);
  const before = JSON.stringify(st);
  const r = V.Circuit.preview(st, u.id, bad);
  assert.ok(!r.ok);
  assert.equal(JSON.stringify(st), before, 'preview 不应写 state');
});

test('saveLoadout 允许保存不连通的半成品板面', () => {
  const st = fresh();
  const u = st.roster[0];
  /* 只有一块顺丝纹、接不到任何输出：几何合法就该能存 */
  const half = mk(st, [
    { templateId: 'straight', x: 0, y: 0 },
  ]);
  const r1 = V.Circuit.saveLoadout(st, u.id, half);
  assert.ok(r1.ok, `不连通也应可保存：${JSON.stringify(r1.errors)}`);
  assert.equal(r1.state.roster[0].board.placements.length, 1);

  const ok = V.Circuit.saveLoadout(st, u.id, u.board.placements);
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(ok.state.roster[0].board.placements.length, 2);
});

