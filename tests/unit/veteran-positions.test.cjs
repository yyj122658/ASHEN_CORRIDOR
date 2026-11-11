'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;

function units(specs) {
  return specs.map((s, i) => Object.assign({
    id: s.id || ('u' + i), slot: s.slot != null ? s.slot : i,
    hp: 100, maxHp: 100, alive: true, buffs: [],
    movementUsedRound: -1, coverUsedRound: -1,
  }, s));
}

test('insertFront 让原 0/1 依次后移，不是只交换 0 和 i', () => {
  const u = units([{ id: 'a', slot: 0 }, { id: 'b', slot: 1 }, { id: 'c', slot: 2 }, { id: 'd', slot: 3 }]);
  const r = V.Positions.insertFront(u, 'c');
  assert.ok(r.ok, r.reason);
  const byId = (id) => r.units.find((x) => x.id === id).slot;
  assert.equal(byId('c'), 0);
  assert.equal(byId('a'), 1);
  assert.equal(byId('b'), 2);
  assert.equal(byId('d'), 3, '3 号位不该被动');
});

test('swap 只交换两位，空位保留', () => {
  const u = units([{ id: 'a', slot: 0 }, { id: 'b', slot: 3 }]);
  const r = V.Positions.swap(u, 'a', 'b');
  assert.ok(r.ok);
  assert.equal(r.units.find((x) => x.id === 'a').slot, 3);
  assert.equal(r.units.find((x) => x.id === 'b').slot, 0);
});

test('anchored 不参与交换与插入', () => {
  const u = units([{ id: 'a', slot: 0, anchored: true }, { id: 'b', slot: 1 }, { id: 'c', slot: 2 }]);
  const r1 = V.Positions.swap(u, 'a', 'b');
  assert.ok(!r1.ok);
  assert.ok(r1.reason.includes('钉住'), r1.reason);

  const r2 = V.Positions.insertFront(u, 'c');
  assert.ok(!r2.ok, '前插会挤到 anchored 的 a');
  assert.ok(r2.reason.includes('挡住'), r2.reason);

  const anchoredSelf = V.Positions.insertFront(u, 'a');
  assert.ok(!anchoredSelf.ok);
});

test('位置变化不会触发位置变化（一次调用最多一层）', () => {
  const u = units([
    { id: 'a', slot: 0 }, { id: 'b', slot: 1 }, { id: 'c', slot: 2, modId: 'shadowAdvance' }, { id: 'd', slot: 3 },
  ]);
  const battle = { allies: u, enemies: [], round: 1 };
  const r = V.Positions.resolveAfterAction(battle, { actorId: 'c', side: 'ally', action: 'main', dealtDamage: true });
  const moves = r.events.filter((e) => e.type === 'move');
  assert.equal(moves.length, 1, '一次根行动最多一个主动换位');
  assert.equal(r.battle.allies.find((x) => x.id === 'c').slot, 0);
});

test('shadowAdvance 只在 3/4 号位且完成主手伤害后触发，每回合一次', () => {
  const mk = () => units([
    { id: 'a', slot: 0 }, { id: 'b', slot: 1 }, { id: 'c', slot: 2, modId: 'shadowAdvance' }, { id: 'd', slot: 3 },
  ]);
  let battle = { allies: mk(), enemies: [], round: 3 };

  const noDamage = V.Positions.resolveAfterAction(battle, { actorId: 'c', side: 'ally', action: 'main', dealtDamage: false });
  assert.equal(noDamage.events.filter((e) => e.type === 'move').length, 0, '没打出伤害不该移动');

  const first = V.Positions.resolveAfterAction(battle, { actorId: 'c', side: 'ally', action: 'main', dealtDamage: true });
  assert.equal(first.events.filter((e) => e.type === 'move').length, 1);
  assert.equal(first.battle.allies.find((x) => x.id === 'c').slot, 0);

  const second = V.Positions.resolveAfterAction(first.battle, { actorId: 'c', side: 'ally', action: 'main', dealtDamage: true });
  assert.equal(second.events.filter((e) => e.type === 'move').length, 0, '同一全局回合只能一次');
});

test('refractRetreat 在 1 号位后撤并给一层残影', () => {
  const battle = {
    allies: units([
      { id: 'a', slot: 0, modId: 'refractRetreat' }, { id: 'b', slot: 1 }, { id: 'c', slot: 2 }, { id: 'd', slot: 3 },
    ]),
    enemies: [], round: 1,
  };
  const r = V.Positions.resolveAfterAction(battle, { actorId: 'a', side: 'ally', action: 'main', dealtDamage: true });
  const a = r.battle.allies.find((x) => x.id === 'a');
  assert.equal(a.slot, 1);
  assert.equal(a.refract, 1);
  assert.equal(r.battle.allies.find((x) => x.id === 'b').slot, 0);
});

test('ironCover：多个候选只选一个，且只在前方友军残血时触发', () => {
  const mk = (frontHp) => units([
    { id: 'front', slot: 0, hp: frontHp, maxHp: 100 },
    { id: 'g1', slot: 1, modId: 'ironCover' },
    { id: 'g2', slot: 2, modId: 'ironCover' },
    { id: 'back', slot: 3 },
  ]);
  let battle = { allies: mk(80), enemies: [{ id: 'e', slot: 0, alive: true }], round: 2 };
  const none = V.Positions.resolveAfterAction(battle, { actorId: 'e', side: 'enemy', action: 'main', dealtDamage: true });
  assert.equal(none.events.filter((e) => e.type === 'move').length, 0, '80% 血不该援护');

  battle = { allies: mk(20), enemies: [{ id: 'e', slot: 0, alive: true }], round: 2 };
  const yes = V.Positions.resolveAfterAction(battle, { actorId: 'e', side: 'enemy', action: 'main', dealtDamage: true });
  const moves = yes.events.filter((e) => e.type === 'move');
  assert.equal(moves.length, 1, '一次根行动最多一个援护');
  assert.equal(moves[0].actorId, 'g1', '多个候选取 slot 最小的');
});

test('ironCover 转移灼烧与流血', () => {
  const battle = {
    allies: units([
      { id: 'front', slot: 0, hp: 10, maxHp: 100, buffs: [{ k: 'burn', v: 4, d: 2 }, { k: 'bleed', v: 3, d: 1 }] },
      { id: 'g', slot: 1, modId: 'ironCover' },
      { id: 'c', slot: 2 },
    ]),
    enemies: [{ id: 'e', slot: 0, alive: true }], round: 4,
  };
  const r = V.Positions.resolveAfterAction(battle, { actorId: 'e', side: 'enemy', action: 'main', dealtDamage: true });
  const front = r.battle.allies.find((x) => x.id === 'front');
  const guard = r.battle.allies.find((x) => x.id === 'g');
  assert.equal(front.buffs.length, 0, '状态应被转走');
  assert.equal(guard.buffs.length, 2);
  assert.ok(r.events.some((e) => e.type === 'statusTransfer'));
});

test('我方行动不会触发援护检查', () => {
  const battle = {
    allies: units([{ id: 'front', slot: 0, hp: 10 }, { id: 'g', slot: 1, modId: 'ironCover' }]),
    enemies: [], round: 1,
  };
  const r = V.Positions.resolveAfterAction(battle, { actorId: 'front', side: 'ally', action: 'main', dealtDamage: true });
  assert.equal(r.events.filter((e) => e.type === 'move').length, 0);
});
