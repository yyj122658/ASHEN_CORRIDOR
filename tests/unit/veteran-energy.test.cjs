'use strict';
/* 接线模型（输入极 → 纹路 → 输出极 → 脉冲）已在 2026-11-13 整体删除：
   普通攻击改由时间轴驱动、余裕由蚀刻法给之后，这套东西没有任何读取方。
   这个文件守着「它不会悄悄回来」，同时确认装配校验仍然工作。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;

function mk(st, layout) {
  return layout.map((slot) => {
    const item = V.State.makePart(st, { kind: 'circuit', templateId: slot.templateId });
    st.itemsById[item.id] = item;
    return { itemId: item.id, x: slot.x, y: slot.y, rotation: slot.rotation || 0, mirrorY: !!slot.mirrorY };
  });
}

function baseState() {
  const st = V.State.create(777, { classicPlate: true });
  return { st, unit: st.roster[0] };
}

test('脉冲与接线 API 已从 Circuit 导出里移除', () => {
  ['buildGraph', 'pulse', 'token', 'emptyRuntime', 'outputTokens', 'consumeOutput', 'hasSurge', 'hasEmber', 'portKey']
    .forEach((name) => {
      assert.equal(V.Circuit[name], undefined, `V.Circuit.${name} 不应再存在`);
    });
});

test('preview 只返回几何与负荷结果，不含接线字段', () => {
  const { st, unit } = baseState();
  const placements = mk(st, [
    { templateId: 'straight', x: 0, y: 1 },
    { templateId: 'elbow', x: 2, y: 1 },
  ]);
  const r = V.Circuit.preview(st, unit.id, placements);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.reachableOutputs, undefined);
  assert.equal(r.graph, undefined);
  assert.equal(typeof r.load, 'number');
  assert.equal(typeof r.overload, 'number');
  assert.equal(typeof r.cap, 'number');
});

test('compile 结果可 JSON 序列化，且不再携带图', () => {
  const { st, unit } = baseState();
  const placements = mk(st, [{ templateId: 'straight', x: 0, y: 1 }]);
  const cc = V.Circuit.compile(st, unit.id, placements);
  assert.ok(cc.ok, JSON.stringify(cc.errors));
  const json = JSON.parse(JSON.stringify(cc.value));
  assert.equal(json.graph, undefined);
  assert.equal(json.reachableOutputs, undefined);
  assert.ok(json.placements.length === 1);
});

test('纹路端口仍然保留：增益靠端口与蚀刻法格子的对齐比例结算', () => {
  const { st, unit } = baseState();
  const placements = mk(st, [{ templateId: 'ember', x: 0, y: 1 }]);
  const lay = V.Circuit.layout(st, placements);
  assert.ok(lay.ports.length >= 2, '布局结果里应仍有端口（供对齐判定与画面刀口）');
  assert.ok(lay.ports.every((p) => p.dir && p.role));
  assert.equal(lay.edges.some((e) => String(e.from).startsWith('T:')), false, '不再有端子连线');
});

test('装配校验仍会拦下越界与重叠', () => {
  const { st, unit } = baseState();
  const oob = mk(st, [{ templateId: 'straight', x: 3, y: 3 }]);
  assert.equal(V.Circuit.preview(st, unit.id, oob).ok, false);

  const overlap = mk(st, [
    { templateId: 'straight', x: 1, y: 1 },
    { templateId: 'straight', x: 1, y: 1 },
  ]);
  assert.equal(V.Circuit.preview(st, unit.id, overlap).ok, false);
});
