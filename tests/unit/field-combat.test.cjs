'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

function setup() {
  const A = loadVeteran();
  const V = A.Veteran;
  let state = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
  const node = state.run.nodes.find(n => n.type === 'battle');
  state = V.Encounter.open(state, node.id).state;
  state = V.Encounter.startAttempt(state).state;
  return {V, state};
}

test('固定时间轴推进近战追击，弓手留在阵位', () => {
  const {V, state} = setup();
  const initial = state.run.battle;
  const blade = initial.allies.find(u => u.skinId === 'blade');
  const ranger = initial.allies.find(u => u.skinId === 'ranger');
  assert.equal(V.Positions.style(blade).mode, 'melee');
  assert.equal(V.Positions.style(ranger).mode, 'ranged');
  assert.equal(initial.field[blade.id], V.Positions.homeX(blade));
  const advanced = V.Combat.step(state).state.run.battle;
  assert.ok(advanced.field[blade.id] > initial.field[blade.id]);
  assert.equal(advanced.field[ranger.id], initial.field[ranger.id]);
  assert.equal(advanced.allies.find(u => u.id === blade.id).slot, blade.slot);
  assert.ok(advanced.enemies.some(u => advanced.field[u.id] < initial.field[u.id]));
});

test('近战按实际距离索敌，自动跳过已倒下的目标', () => {
  const {V, state} = setup();
  const b = state.run.battle;
  const blade = b.allies.find(u => u.skinId === 'blade');
  const [first, second] = b.enemies;
  b.field[blade.id] = 220;
  b.field[first.id] = 249;
  b.field[second.id] = 235;
  b.fieldY[second.id] = 0;
  assert.equal(V.Positions.nearestFoe(b, blade).id, second.id);
  assert.ok(V.Positions.inReach(b, blade, second));
  assert.ok(!V.Positions.inReach(b, blade, first));
  second.alive = false;
  assert.equal(V.Positions.nearestFoe(b, blade).id, first.id);
  V.Positions.advanceField(b, u => u.id === blade.id ? first : null);
  assert.ok(V.Positions.inReach(b, blade, first));
  assert.ok(b.field[blade.id] < b.field[first.id]);
});

test('旧版战斗档补齐初始站位，新版读回保存的实际位置', () => {
  const {V, state} = setup();
  const env = JSON.parse(V.Storage.encode(state));
  env.schemaVersion = 1;
  delete env.state.run.battle.field;
  delete env.state.run.battle.fieldY;
  env.state.run.encounter.preparation.formation = [env.state.run.party[0].uid, env.state.run.party[1].uid, null, null];
  const restored = V.Storage.decode(JSON.stringify(env));
  assert.ok(restored.ok, restored.errors.join(' '));
  const b = restored.state.run.battle;
  const unit = b.allies[0];
  assert.equal(b.field[unit.id], V.Positions.homeX(unit));
  assert.equal(restored.state.run.encounter.preparation.formation, undefined);
  b.field[unit.id] += 23;
  assert.equal(V.Storage.decode(V.Storage.encode(restored.state)).state.run.battle.field[unit.id], b.field[unit.id]);
  const previous = JSON.parse(V.Storage.encode(restored.state));
  previous.schemaVersion = 2;
  delete previous.state.run.battle.fieldY;
  assert.equal(V.Storage.decode(JSON.stringify(previous)).state.run.battle.field[unit.id], b.field[unit.id]);

  previous.schemaVersion = 3;
  previous.state.run.party[0].cell = 7;
  const grid = V.Storage.decode(JSON.stringify(previous));
  assert.ok(grid.ok, grid.errors.join(' '));
  assert.equal(grid.state.run.party[0].deployment.x, 31);
  assert.equal(grid.state.run.party[0].deployment.y, -22);
});

test('战场落点影响实际纵深与号位，回转和读档后仍然生效', () => {
  const {V, state} = setup();
  const prep = V.Encounter.rewind(state).state;
  const [front, rear] = prep.run.party;
  const uid = front.uid;
  const move = {uid, x: 47, y: -39};
  const edited = V.Encounter.editPreparation(prep, {move});
  assert.ok(edited.ok);
  const started = V.Encounter.startAttempt(edited.state).state;
  const b = started.run.battle;
  const unit = b.allies.find(u => u.sourceUnitId === uid);
  assert.equal(unit.slot, rear.slot);
  assert.equal(V.Positions.fieldX(b, unit), move.x);
  assert.equal(V.Positions.fieldY(b, unit), move.y);
  assert.equal(JSON.stringify(V.Encounter.rewind(started).state.run.party), JSON.stringify(edited.state.run.party));
  const saved = V.Storage.decode(V.Storage.encode(started));
  assert.ok(saved.ok, saved.errors.join(' '));
  assert.equal(saved.state.run.battle.fieldY[unit.id], b.fieldY[unit.id]);
  saved.state.run.battle.fieldY[unit.id] = 500;
  assert.equal(V.Storage.decode(V.Storage.encode(saved.state)).ok, false);
  assert.equal(V.Encounter.editPreparation(prep, {move: {...move, x: 220}}).ok, false);
  assert.equal(V.Encounter.editPreparation(prep, {move: {uid, x: V.Positions.homeX(rear), y: V.Positions.homeY(rear)}}).ok, false);
});

test('近战根据纵深选择较近的目标，并斜向追击', () => {
  const {V, state} = setup();
  const b = state.run.battle;
  const blade = b.allies.find(u => u.skinId === 'blade');
  const [nearX, nearPlane] = b.enemies;
  Object.assign(b.field, {[blade.id]: 160, [nearX.id]: 186, [nearPlane.id]: 190});
  Object.assign(b.fieldY, {[blade.id]: -20, [nearX.id]: 0, [nearPlane.id]: -15});
  assert.equal(V.Positions.nearestFoe(b, blade).id, nearPlane.id);
  V.Positions.advanceField(b, u => u === blade ? nearPlane : null);
  assert.ok(V.Positions.fieldY(b, blade) > -20);
  assert.ok(V.Positions.inReach(b, blade, nearPlane));
});

function isolateRanger(state) {
  const b = state.run.battle;
  const ranger = b.allies.find(u => u.skinId === 'ranger');
  const [foe, ...others] = b.enemies;
  for (const u of [...others, ...b.allies.filter(u => u !== ranger)]) {
    u.alive = false;
    u.hp = 0;
  }
  foe.enemyType = 'boneBell';
  foe.skills = [{id: 'brace', target: 'allFoe', selfShield: .1}];
  foe.atkTimer = -100;
  ranger.skillList = [];
  ranger.hits = 1;
  foe.dodge = 0;
  b.fieldY[foe.id] = b.fieldY[ranger.id] = 0;
  return {b, ranger, foe};
}

test('弓手超距时蓄好普攻并接近，进入长射程后站定出手', () => {
  const {V, state} = setup();
  const {b, ranger, foe} = isolateRanger(state);
  ranger.atkTimer = 100;
  b.field[ranger.id] = 32;
  b.field[foe.id] = 286;

  const hits = battle => battle.logs.filter(l => l.actorId === ranger.id && l.strike);
  assert.equal(V.Positions.inReach(b, ranger, foe), false);
  let next = V.Combat.step(state).state;
  assert.equal(hits(next.run.battle).length, 0);
  assert.ok(next.run.battle.field[ranger.id] > 32);
  for (let tick = 0; tick < 12 && !hits(next.run.battle).length; tick++) next = V.Combat.step(next).state;

  const entered = next.run.battle;
  const shotX = entered.field[ranger.id];
  assert.equal(hits(entered).length, 1);
  assert.ok(V.Positions.inReach(entered, ranger, foe));
  assert.ok(entered.field[foe.id] - shotX >= 130, '弓手应该停在远处而不是贴脸');
  assert.equal(V.Combat.step(next).state.run.battle.field[ranger.id], shotX);
});

test('法师引导完成后遇到目标跑出射程，进入距离后才释放已经就绪的招式', () => {
  const {V, state} = setup();
  const {b, ranger, foe} = isolateRanger(state);
  ranger.skinId = 'warlock';
  ranger.skillList = [{id: 'bolt', name: '术弹', target: 'frontFoe', castTime: .2, cost: 1, effect: {mult: 1}}];
  ranger.energy = 4;
  ranger.atkTimer = 100;
  b.field[ranger.id] = 70;
  b.field[foe.id] = 161;
  let next = V.Combat.step(state).state;
  assert.equal(next.run.battle.allies.find(u => u.id === ranger.id).casting, 'bolt');
  assert.equal(next.run.battle.field[ranger.id], 70);
  next.run.battle.field[foe.id] = 280;

  next = V.Combat.step(next).state;
  const held = next.run.battle.allies.find(u => u.id === ranger.id);
  const struck = battle => battle.logs.some(l => l.type !== 'cast' && l.strike && l.actorId === ranger.id && l.skillId === 'bolt');
  assert.equal(held.castTimer, 0);
  assert.equal(held.casting, 'bolt');
  assert.equal(struck(next.run.battle), false);
  for (let tick = 0; tick < 8 && !struck(next.run.battle); tick++) next = V.Combat.step(next).state;
  assert.ok(struck(next.run.battle));
  const finished = next.run.battle;
  assert.ok(finished.field[foe.id] - finished.field[ranger.id] >= 100);
});
