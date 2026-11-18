'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');
const V = loadVeteran().Veteran;

function pulse(archetype, path, pieces, options = {}) {
  const plate = V.PlateGen.generate({ archetype });
  const built = pieces.map(([id, ...cells]) => ({ tpl: V.Data.TEMPLATES[id], abs: cells.map(([x, y]) => ({x, y})) }));
  return V.Circuit.pulseOf({ built, edges: [] }, { path: path.map(String), looped: options.looped }, plate);
}

test('直导、弯折、分流和闸系只在适配元件经过锚点时改写脉冲', () => {
  const column = Array.from({length: 10}, (_, y) => [5, y]);
  assert.equal(pulse('xianghu', column, [['straight', ...column]]).intervalScale, .72);
  assert.equal(pulse('xianghu', column, [['straight', ...column.filter((c) => ![3, 7].includes(c[1]))]]).intervalScale, .80);

  const elbow = [[2, 4], [3, 4], [3, 3]];
  assert.equal(pulse('suhui', elbow, [['jack', elbow[1]]]).ampMult, 1.22);
  assert.equal(pulse('suhui', elbow, [['jack', elbow[0]]]).ampMult, 1.12);

  const cross = [[3, 5], [4, 5], [5, 5], [6, 5]];
  assert.equal(pulse('zaohuyou', cross, [['tee', cross[1]]]).ampMult, 1);
  assert.equal(pulse('zaohuyou', cross, [['tee', cross[2]]]).ampMult, .65);
  assert.equal(pulse('zaohuyou', cross, [['tee', cross[1]]], { looped: true }).ampMult, 1.45);
  assert.equal(pulse('sida', cross, [['pinValve', cross[2]]]).gateBonus, .15);
  assert.equal(pulse('sida', cross, [['pinValve', cross[1]]]).gateBonus, 0);
});

test('路径贴着内壁增幅，储能纹路跨过层界时扩充缓冲', () => {
  assert.equal(pulse('jiansui', [[4, 3], [5, 3], [6, 3]], []).ampMult, 1.12);
  assert.equal(pulse('jiansui', [[6, 3], [7, 3]], []).ampMult, 1);
  const layers = [[4, 2], [4, 3], [4, 4]];
  assert.equal(pulse('jiuceng', layers, [['capacitor', ...layers.slice(0, 2)]]).shieldScale, 1.25);
  assert.equal(pulse('jiuceng', layers, [['capacitor', ...layers.slice(1)]]).shieldScale, 1);
});

function board(bodyPreset) {
  const st = V.State.create(12);
  const u = V.State.makeUnit(st, { skinId: 'blade', bodyPreset, name: '试相' });
  st.roster.push(u);
  u.manuscript = null;
  u.extraManuscripts = [];
  const plate = V.Circuit.plateOf(u);
  const add = ([x, y], rotation = 0, templateId = 'rivet') => {
    const part = V.State.makePart(st, { kind: 'circuit', templateId });
    st.itemsById[part.id] = part;
    return { itemId: part.id, x, y, rotation };
  };
  return { st, u, plate, add };
}

test('并蒂双核各自接到汇合锚点，断开一边即失去入场缓冲', () => {
  const { st, u, add } = board('twin');
  u.manuscript = { ...V.Data.manuscript('shutter'), x: 3, y: 8 };
  const path = V.Circuit.autoLoadout(st, u).filter(({x}) => x > 3 && x < 7);
  const leftPort = add([2, 4]);
  const rightPort = add([8, 4]);
  const lines = [leftPort, rightPort, add([3, 4], 0, 'flint'), add([7, 4], 2, 'jack'),
    add([3, 9], 1, 'clevis'), add([7, 9], 1, 'clevis')];
  for (const x of [3, 7]) for (let y = 5; y < 9; y++) lines.push(add([x, y], 1));
  const assembled = V.Circuit.compile(st, u.id, [...path, ...lines]);
  assert.ok(assembled.ok, assembled.errors?.join(' '));
  assert.equal(assembled.value.pulse.shutter.twinShield, 6);
  assert.equal(assembled.value.panel.twinShield, 6);
  const opened = V.Circuit.compile(st, u.id, [...path, ...lines.filter((part) => part !== rightPort)]);
  assert.ok(opened.ok, opened.errors?.join(' '));
  assert.deepEqual(opened.value.pulse.shutter.path, assembled.value.pulse.shutter.path);
  assert.equal(opened.value.pulse.shutter.twinShield, 0);
});

test('玄璜的镰刃两端可通过蚀刻法外的纹路接入同一条贯通路径', () => {
  const { st, u, add } = board('arc');
  u.manuscript = { ...V.Data.manuscript('spark'), x: 2, y: 0 };
  const path = V.Circuit.autoLoadout(st, u);
  const terminal = add([10, 0], 1);
  const lines = [terminal, add([1, 1], 2, 'jack'), add([1, 8], 1, 'jack'), add([2, 8]),
    add([3, 8], 0, 'flint'), add([3, 9], 1), add([3, 10], 1, 'jack'), add([10, 1], 0, 'jack')];
  for (let y = 2; y < 8; y++) lines.push(add([1, y], 1));
  for (let x = 4; x <= 10; x++) lines.push(add([x, 10]));
  for (let x = 6; x < 10; x++) lines.push(add([x, 1]));
  const assembled = V.Circuit.compile(st, u.id, [...path, ...lines]);
  assert.ok(assembled.ok, assembled.errors?.join(' '));
  assert.equal(assembled.value.pulse.spark.dotStacks, 2);
  const opened = V.Circuit.compile(st, u.id, [...path, ...lines.filter((part) => part !== terminal)]);
  assert.equal(opened.value.pulse.spark.dotStacks, 1);
});

test('盾锚和边缘锚点按纹路占位结算，中脊仅保护覆盖锚点的纹路', () => {
  for (const body of ['aegis', 'corner', 'spine']) {
    const { st, u, plate, add } = board(body);
    const anchored = add(plate.innateNodes[0]);
    const ordinary = add(plate.clockCore[0]);
    const a = V.Circuit.compile(st, u.id, [anchored]).value;
    const baseline = V.Circuit.compile(st, u.id, [ordinary]).value;
    if (body === 'aegis') assert.equal(a.panel.def, baseline.panel.def + 6);
    if (body === 'corner') {
      assert.equal(a.panel.maxHp, baseline.panel.maxHp + 3);
      assert.equal(a.panel.shieldCap, baseline.panel.shieldCap + 2);
    }
    if (body === 'spine') {
      const combat = { circuit: a, def: 8, shieldCap: 0, name: '中脊' };
      assert.equal(V.Combat._internal.fuseNode({}, combat), false);
      assert.equal(combat.def, 8);
      assert.equal(baseline.protectedNodes.length, 0);
    }
  }
});

test('齿锚倍增对齐的小纹路，起手布线跳过越界蚀刻法且无泄漏', () => {
  const { st, u, plate, add } = board('ratchet');
  const [x, y] = plate.innateNodes[0];
  const ms = { id: 'anchor-fixture', cells: [[0, 0], [0, 1]], entry: [0, 0], exits: [[0, 1]], veins: { '0,0': ['N'], '0,1': ['S'] }, x, y };
  u.manuscript = ms;
  const first = add([x, y], 1);
  const second = add([x, y + 1], 1);
  const state = V.Circuit.manuscriptState(st, u.id, [first, second]);
  assert.equal(state.routed, true);
  assert.equal(state.effects.boost.regen, .18);

  u.manuscript = { ...ms, id: 'outside-fixture', y: -1 };
  const before = Object.keys(st.itemsById).length;
  assert.equal(V.Circuit.autoLoadout(st, u), null);
  assert.equal(Object.keys(st.itemsById).length, before);
  u.extraManuscripts = [ms];
  assert.equal(V.Circuit.autoLoadout(st, u).length, 2);
  assert.equal(Object.keys(st.itemsById).length, before + 2);
});

test('脉冲穿过两个腰锚也只加一次压力，双端异常产生两层独立状态', () => {
  const { st, u } = board('waist');
  st.team[0] = u.id;
  const run = V.Expedition.start(st, { seed: 20 }).state;
  const { state } = V.Combat.create(run, {
    id: 'anchor-battle', kind: 'normal', floor: 1,
    units: [0, 1].map((slot) => ({enemyType: 'bone', name: '木桩', slot, hp: 9999, maxHp: 9999, atk: 1, def: 0, spd: 1, skills: []})),
  }, 33);
  const b = state.run.battle;
  const actor = b.allies.find((a) => a.sourceUnitId === u.id);
  assert.ok(actor);
  const target = b.enemies[0];
  actor.stress = 0;
  actor.hits = 1;
  actor.pulse = pulse('chuyao', [[5, 5], [6, 5]], []);
  V.Combat._internal.doBasicAttack(b, actor, target.id);
  assert.equal(actor.stress, 10);
  actor.pendingSkill = { id: 'anchor-pierce-fixture', target: 'enemy', effect: { hits: 2, pierce: 2 } };
  V.Combat._internal.finishCast(b, actor);
  assert.equal(actor.stress, 30);

  actor.pulse = pulse('xuanhuang', V.PlateGen.generate({archetype: 'xuanhuang'}).innateNodes, []);
  actor.pendingSkill = { id: 'anchor-status-fixture', target: 'enemy', effect: {dot: {k: 'burn', hits: 2}} };
  V.Combat._internal.finishCast(b, actor);
  const stacks = V.Combat._internal.dotsOf(target, 'burn');
  assert.equal(stacks.length, 2);
  assert.equal(stacks[0].hits, 2);
  assert.notEqual(stacks[0], stacks[1]);
});
