'use strict';
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

function compiled(st, unitId, layout) {
  const placements = mk(st, layout);
  const c = V.Circuit.compile(st, unitId, placements);
  assert.ok(c.ok, JSON.stringify(c.errors));
  return c.value;
}

function baseState() {
  const st = V.State.create(777);
  return { st, unit: st.roster[0] };
}

test('基础直供：一次 clock 脉冲 2 单位到主手', () => {
  const { st, unit } = baseState();
  const cc = V.Circuit.compile(st, unit.id, unit.board.placements);
  assert.ok(cc.ok, JSON.stringify(cc.errors));
  let rt = V.Circuit.emptyRuntime();
  const r1 = V.Circuit.route(cc.value, rt, { clock: V.Circuit.pulse(2) }, { hpPct: 1 });
  rt = r1.runtime;
  assert.equal(V.Circuit.outputTokens(rt, 'main').length, 2);
  assert.equal(V.Circuit.outputTokens(rt, 'support').length, 0);
});

test('分流器把 2 单位分成 1+1，绝不复制，且连续脉冲公平轮转', () => {
  const { st, unit } = baseState();
  const cc = compiled(st, unit.id, [
    { templateId: 'splitter', x: 0, y: 0 },
    { templateId: 'straight', x: 2, y: 0 },
    { templateId: 'straight', x: 2, y: 2 },
  ]);
  let rt = V.Circuit.emptyRuntime();
  const r1 = V.Circuit.route(cc, rt, { clock: V.Circuit.pulse(2) }, { hpPct: 1 });
  rt = r1.runtime;
  const main1 = V.Circuit.outputTokens(rt, 'main').length;
  const sup1 = V.Circuit.outputTokens(rt, 'support').length;
  assert.equal(main1 + sup1, 2, '总量必须还是 2');
  assert.deepEqual([main1, sup1], [1, 1]);

  const r2 = V.Circuit.route(cc, rt, { clock: V.Circuit.pulse(2) }, { hpPct: 1 });
  rt = r2.runtime;
  assert.equal(V.Circuit.outputTokens(rt, 'main').length, 2);
  assert.equal(V.Circuit.outputTokens(rt, 'support').length, 2);
});

test('蓄能腔要两次 2 单位才发出一次 4 单位 surge', () => {
  const { st, unit } = baseState();
  const cc = compiled(st, unit.id, [
    { templateId: 'capacitor', x: 0, y: 1 },
    { templateId: 'elbow', x: 2, y: 1 },
  ]);
  let rt = V.Circuit.emptyRuntime();
  rt = V.Circuit.route(cc, rt, { clock: V.Circuit.pulse(2) }, { hpPct: 1 }).runtime;
  assert.equal(V.Circuit.outputTokens(rt, 'main').length, 0, '第一次只蓄能');

  const r2 = V.Circuit.route(cc, rt, { clock: V.Circuit.pulse(2) }, { hpPct: 1 });
  rt = r2.runtime;
  const toks = V.Circuit.outputTokens(rt, 'main');
  assert.equal(toks.length, 4, '一次发出 4 单位');
  assert.ok(toks.every((t) => t.tags.includes('surge')), '应带 surge 标签');
  assert.ok(r2.events.some((e) => e.type === 'capacitorSurge'));
});

test('输出储存上限 4，溢出消散但不复制', () => {
  const { st, unit } = baseState();
  const cc = V.Circuit.compile(st, unit.id, unit.board.placements).value;
  let rt = V.Circuit.emptyRuntime();
  for (let i = 0; i < 5; i++) {
    rt = V.Circuit.route(cc, rt, { clock: V.Circuit.pulse(2) }, { hpPct: 1 }).runtime;
  }
  assert.equal(V.Circuit.outputTokens(rt, 'main').length, 4);
  assert.ok(rt.dissipated >= 2, '溢出应记消散');
});

test('阈值闸：满血时能量消散，半血以下才通过', () => {
  const { st, unit } = baseState();
  const cc = compiled(st, unit.id, [
    { templateId: 'threshold', x: 0, y: 1 },
    { templateId: 'elbow', x: 2, y: 1 },
  ]);
  let rt = V.Circuit.emptyRuntime();
  const blocked = V.Circuit.route(cc, rt, { clock: V.Circuit.pulse(2) }, { hpPct: 0.9 });
  assert.equal(V.Circuit.outputTokens(blocked.runtime, 'main').length, 0);
  assert.ok(blocked.events.some((e) => e.type === 'gateBlocked'));

  const pass = V.Circuit.route(cc, V.Circuit.emptyRuntime(), { clock: V.Circuit.pulse(2) }, { hpPct: 0.3 });
  assert.equal(V.Circuit.outputTokens(pass.runtime, 'main').length, 2);
});

test('余烬导管给流经的能量打 ember 标记', () => {
  const { st, unit } = baseState();
  const cc = compiled(st, unit.id, [
    { templateId: 'ember', x: 0, y: 1 },
    { templateId: 'elbow', x: 2, y: 1 },
  ]);
  const r = V.Circuit.route(cc, V.Circuit.emptyRuntime(), { clock: V.Circuit.pulse(2) }, { hpPct: 1 });
  const toks = V.Circuit.outputTokens(r.runtime, 'main');
  assert.equal(toks.length, 2);
  assert.ok(toks.every((t) => t.tags.includes('ember')));
  assert.ok(V.Circuit.hasEmber(toks));
});

test('damage 极也能送能量到主手（基础线之外的第二条路）', () => {
  const { st, unit } = baseState();
  const cc = compiled(st, unit.id, [
    { templateId: 'elbow', x: 0, y: 2, mirrorY: true },
    { templateId: 'straight', x: 2, y: 2 },
  ]);
  const r = V.Circuit.route(cc, V.Circuit.emptyRuntime(), { damage: V.Circuit.pulse(2) }, { hpPct: 1 });
  assert.equal(V.Circuit.outputTokens(r.runtime, 'main').length, 2);
});

test('consumeOutput 不足时返回 null，足够时正确扣减', () => {
  const rt = V.Circuit.emptyRuntime();
  rt.outputs.main = V.Circuit.pulse(2, ['ember']);
  const bad = V.Circuit.consumeOutput(rt, 'main', 4);
  assert.equal(bad, null);
  const got = V.Circuit.consumeOutput(rt, 'main', 2);
  assert.ok(got);
  assert.equal(got.used.length, 2);
  assert.equal(got.runtime.outputs.main.length, 0);
  assert.equal(rt.outputs.main.length, 2, '不修改入参');
});

test('调谐返还只放回输出储存，不产生新脉冲', () => {
  const rt = V.Circuit.emptyRuntime();
  rt.outputs.main = V.Circuit.pulse(1);
  const next = V.Circuit.refund(rt, 'main', ['refund']);
  assert.equal(next.outputs.main.length, 2);
  assert.equal(rt.outputs.main.length, 1);
  assert.equal(next.dissipated, rt.dissipated);
});

test('同输入两次路由结果完全一致', () => {
  const { st, unit } = baseState();
  const cc = compiled(st, unit.id, [
    { templateId: 'splitter', x: 0, y: 0 },
    { templateId: 'straight', x: 2, y: 0 },
    { templateId: 'straight', x: 2, y: 2 },
  ]);
  const a = V.Circuit.route(cc, V.Circuit.emptyRuntime(), { clock: V.Circuit.pulse(2) }, { hpPct: 1 });
  const b = V.Circuit.route(cc, V.Circuit.emptyRuntime(), { clock: V.Circuit.pulse(2) }, { hpPct: 1 });
  assert.deepEqual(a.runtime, b.runtime);
  assert.deepEqual(a.events, b.events);
});

test('编译结果可 JSON 序列化，无函数/循环引用', () => {
  const { st, unit } = baseState();
  const cc = V.Circuit.compile(st, unit.id, unit.board.placements);
  assert.ok(cc.ok);
  const json = JSON.stringify(cc.value);
  assert.ok(json.length > 0);
  assert.deepEqual(JSON.parse(json).reachableOutputs, ['main']);
});
