'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;
const T = V.Tactics;

function ctx(over) {
  return Object.assign({
    self: { id: 'a1', slot: 0, hp: 100, maxHp: 100, alive: true },
    allies: [
      { id: 'a1', slot: 0, hp: 100, maxHp: 100, alive: true },
      { id: 'a2', slot: 1, hp: 100, maxHp: 100, alive: true },
      { id: 'a3', slot: 2, hp: 100, maxHp: 100, alive: true },
    ],
    enemies: [
      { id: 'e1', slot: 0, hp: 80, maxHp: 80, alive: true },
    ],
    energy: { main: 4, support: 4 },
    weaponId: 'shortBlade',
  }, over || {});
}

test('默认规则：满血时走普通攻击', () => {
  const r = T.evaluate(ctx(), D.defaultGambits());
  assert.equal(r.action, 'main');
  assert.deepEqual(r.targetIds, ['e1']);
  assert.equal(r.cost, 0, '普通攻击不吃余裕');
});

test('默认不再自动护持：护持是玩家自己挂的取舍', () => {
  const c = ctx();
  c.allies[1].hp = 10;
  const r = T.evaluate(c, D.defaultGambits());
  assert.equal(r.action, 'main', '默认只攻击，否则全队会一直举盾不还手');
  assert.deepEqual(r.targetIds, ['e1']);
});

test('旧的护持规则在新版本降级为普通攻击，护盾只由蚀刻法招式给', () => {
  const c = ctx({ energy: { main: 0 } });
  c.allies[1].hp = 10;
  const rules = [{ id: 's', enabled: true, conditions: [{ type: 'allyHpBelow', value: 50 }], target: 'lowestHpAlly', action: 'support' }];
  const r = T.evaluate(c, rules);
  assert.equal(r.action, 'main');
  assert.ok(r.reasons.some((x) => x.reason.includes('蚀刻法')), JSON.stringify(r.reasons));
});

test('普通攻击不再受身位与武器限制', () => {
  const c = ctx({ weaponId: 'shortBlade' });
  c.self.slot = 2;
  c.allies[0].slot = 2;
  const r = T.evaluate(c, [{ id: 'g1', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action: 'main' }]);
  assert.equal(r.action, 'main');
  assert.equal(r.cost, 0);
});

test('余裕为 0 也照样普通攻击，余裕全留给招式', () => {
  const c = ctx({ energy: { main: 0 } });
  const r = T.evaluate(c, D.defaultGambits());
  assert.equal(r.action, 'main');
  assert.equal(r.cost, 0);
});

test('重炮在 4 号位只要 2 能量，别处要 4', () => {
  assert.equal(T.mainCost('heavyCannon', 3), 2);
  assert.equal(T.mainCost('heavyCannon', 0), 4);
  assert.equal(T.mainCost('shortBlade', 0), 2);
});

test('长矛只在 0/1 号位可用', () => {
  assert.equal(T.mainAllowed('longSpear', 0), true);
  assert.equal(T.mainAllowed('longSpear', 1), true);
  assert.equal(T.mainAllowed('longSpear', 2), false);
});

test('atSlot 与 enemyCharging 条件按身位和蓄力解析', () => {
  const c = ctx();
  c.enemies[0].charging = true;
  const r = T.evaluate(c, [{
    id: 'g1', enabled: true,
    conditions: [{ type: 'enemyCharging' }, { type: 'atSlot', value: 1 }],
    target: 'chargingFoe', action: 'main',
  }]);
  assert.equal(r.action, 'main');
  assert.deepEqual(r.targetIds, ['e1']);

  c.self.slot = 1;
  c.allies[0].slot = 1;
  const r2 = T.evaluate(c, [{
    id: 'g1', enabled: true, conditions: [{ type: 'atSlot', value: 2 }],
    target: 'frontFoe', action: 'guard',
  }]);
  assert.equal(r2.action, 'guard', '站在 2 号位应满足 atSlot=2');

  const r3 = T.evaluate(c, [{
    id: 'g1', enabled: true, conditions: [{ type: 'atSlot', value: 1 }],
    target: 'frontFoe', action: 'guard',
  }]);
  assert.equal(r3.action, 'basic', '站在 2 号位不该满足 atSlot=1');
});

test('validator 拒绝超槽、未知动作、三个条件、非法阈值', () => {
  assert.ok(T.validate(D.defaultGambits(), 2).ok);
  const twoRules = [D.defaultGambits()[0], { ...D.defaultGambits()[0], id: 'g2' }];
  assert.ok(!T.validate(twoRules, 1).ok, '超槽应拒绝');

  const badAction = [{ id: 'x', conditions: [{ type: 'always' }], target: 'frontFoe', action: 'nuke' }];
  assert.ok(!T.validate(badAction, 2).ok);

  const threeConds = [{
    id: 'x',
    conditions: [{ type: 'always' }, { type: 'selfHpBelow', value: 50 }, { type: 'enemyCharging' }],
    target: 'frontFoe', action: 'main',
  }];
  assert.ok(!T.validate(threeConds, 2).ok, '最多 AND 两个条件');

  const badThreshold = [{
    id: 'x', conditions: [{ type: 'selfHpBelow', value: 33 }],
    target: 'frontFoe', action: 'main',
  }];
  assert.ok(!T.validate(badThreshold, 2).ok, '阈值只能是 25/50/75');
});

test('禁用规则不参与求值', () => {
  const rules = [
    { id: 's', enabled: false, conditions: [{ type: 'allyHpBelow', value: 50 }], target: 'lowestHpAlly', action: 'support' },
    { id: 'm', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action: 'main' },
  ];
  const c = ctx();
  c.allies[1].hp = 5;
  const r = T.evaluate(c, rules);
  assert.equal(r.action, 'main', '停用的护持不该再生效');
});

test('没有敌人时退回基础攻击，不抛错', () => {
  const c = ctx({ enemies: [] });
  const r = T.evaluate(c, D.defaultGambits());
  assert.equal(r.action, 'basic');
  assert.deepEqual(r.targetIds, []);
  assert.ok(T.explain(r).length > 0);
});

test('求值是纯函数，不改入参', () => {
  const c = ctx();
  const before = JSON.stringify(c);
  T.evaluate(c, D.defaultGambits());
  assert.equal(JSON.stringify(c), before);
});
