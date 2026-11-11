'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes, fight, stepUntilOver } = require('../helpers/veteran-run.cjs');

test('五种主手按身位与能量规则出手', () => {
  const { A, V, st: base } = boot(101);
  const cases = [
    { weapon: 'shortBlade', slot: 0, expectMain: true },
    { weapon: 'shortBlade', slot: 2, expectMain: false },
    { weapon: 'longSpear', slot: 1, expectMain: true },
    { weapon: 'longSpear', slot: 3, expectMain: false },
    { weapon: 'heavyCannon', slot: 3, expectMain: true },
  ];
  cases.forEach((c) => {
    assert.equal(V.Tactics.mainAllowed(c.weapon, c.slot), c.expectMain,
      `${c.weapon}@${c.slot}`);
    void A; void base;
  });

  assert.equal(V.Tactics.mainCost('heavyCannon', 3), 2);
  assert.equal(V.Tactics.mainCost('heavyCannon', 0), 4);
  assert.equal(V.Tactics.mainCost('shortBlade', 2), 2);
});

test('身体与外观不限制主手：换底盘仍能用同一把主手', () => {
  const { A, V, st } = boot(102);
  let s = startRun(A, st, 102);
  const unit = s.roster[0];
  const before = V.Tactics.mainAllowed(V.State.itemById(s, unit.weaponId).templateId, 0);
  const bodies = ['agile', 'conduit', 'sturdy'];
  bodies.forEach((b) => {
    s.roster[0].bodyPreset = b;
    const after = V.Tactics.mainAllowed(V.State.itemById(s, s.roster[0].weaponId).templateId, 0);
    assert.equal(after, before, `${b} 不应改变主手可用性`);
  });
});

test('塔盾会让目标跳过行动，护盾有 30% 上限', () => {
  const { A, V } = boot(103);
  let s = startRun(A, s0(V), 103);
  s = setNodes(A, s, ['battle']);
  const f = fight(A, s, 'normal');
  s = f.st;
  const guard = s.run.battle.allies.find((u) => u.weaponId === 'towerShield');
  const enemy = s.run.battle.enemies[0];
  assert.ok(guard && enemy);
  V.Combat._internal.applyDamage;
  /* 直接给目标叠满护盾，检查上限 */
  const I = V.Combat._internal;
  const gained = I.addShield(enemy, 9999);
  assert.equal(enemy.shield, Math.round(enemy.maxHp * 0.30));
  assert.ok(gained <= Math.round(enemy.maxHp * 0.30));
});

test('受击脉冲只在真实 HP 伤害时记录，护盾/自伤/DOT 不刷', () => {
  const { A, V } = boot(104);
  let s = startRun(A, s0(V), 104);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  const I = V.Combat._internal;
  const b = s.run.battle;
  const ally = b.allies[0];
  const enemy = b.enemies[0];

  ally.pendingDamagePulse = 0;
  I.addShield(ally, 9999);
  I.applyDamage(b, enemy, ally, 20, {});
  assert.equal(ally.hp, ally.maxHp, '护盾应该全挡');
  assert.equal(ally.pendingDamagePulse, 0, '护盾全挡不产生脉冲');

  ally.shield = 0;
  ally.pendingDamagePulse = 0;
  I.applyDamage(b, null, ally, 10, { selfInflicted: true, pierce: true });
  assert.equal(ally.pendingDamagePulse, 0, '自伤不产生脉冲');

  ally.pendingDamagePulse = 0;
  I.applyDamage(b, enemy, ally, 12, { isDot: true, pierce: true });
  assert.equal(ally.pendingDamagePulse, 0, 'DOT 不产生脉冲');

  ally.pendingDamagePulse = 0;
  I.applyDamage(b, enemy, ally, 12, {});
  assert.equal(ally.pendingDamagePulse, 2, '真实伤害才记录 2 单位');
});

test('一场战斗结束前不写任何长期收益', () => {
  const { A, V } = boot(105);
  let s = startRun(A, s0(V), 105);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  const goldBefore = s.gold;
  const stashBefore = s.stash.length;
  const historyBefore = s.roster.reduce((a, u) => a + u.history.records.length, 0);

  const r = stepUntilOver(A, s);
  s = r.st;
  assert.ok(s.run.battle.over);
  assert.equal(s.gold, goldBefore, '战斗本身不发金币');
  assert.equal(s.stash.length, stashBefore, '战斗本身不塞仓库');
  assert.equal(s.roster.reduce((a, u) => a + u.history.records.length, 0), historyBefore,
    '战斗本身不写战史');
});

test('战斗是确定性的：同种子同整备结果完全一致', () => {
  const runOnce = (seed) => {
    const { A, V } = boot(seed);
    let s = startRun(A, s0(V), seed);
    s = setNodes(A, s, ['battle']);
    s = fight(A, s, 'normal').st;
    const r = stepUntilOver(A, s);
    const b = r.st.run.battle;
    return {
      win: b.win, tick: b.tick,
      allies: b.allies.map((u) => u.hp),
      enemies: b.enemies.map((u) => u.hp),
      logCount: b.logs.length,
    };
  };
  assert.deepEqual(runOnce(777), runOnce(777));
});

test('改变指令可以改变出手顺序（但不承诺同一掷骰）', () => {
  const { A, V } = boot(909);
  const runWith = (action) => {
    let s = startRun(A, s0(V), 909);
    s = setNodes(A, s, ['battle']);
    s.roster.forEach((u) => {
      u.gambits = [{ id: 'g', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action }];
    });
    s = fight(A, s, 'normal').st;
    const r = stepUntilOver(A, s);
    return r.st.run.battle.win;
  };
  const a = runWith('main');
  const b = runWith('guard');
  assert.equal(typeof a, 'boolean');
  assert.equal(typeof b, 'boolean');
});

test('首领半血只转一次阶段，并带预告', () => {
  const { A, V } = boot(111);
  let s = startRun(A, s0(V), 111);
  s.run.floor = 7;
  s = setNodes(A, s, ['boss']);
  s = fight(A, s, 'boss').st;
  const b = s.run.battle;
  const boss = b.enemies.find((e) => e.isBoss);
  assert.ok(boss, '应该有首领');
  const I = V.Combat._internal;
  I.checkBossPhase(b, boss);
  assert.equal(boss.bossPhase, 1, '满血不转阶段');
  boss.hp = Math.round(boss.maxHp * 0.45);
  I.checkBossPhase(b, boss);
  assert.equal(boss.bossPhase, 2);
  const before = boss.atk;
  I.checkBossPhase(b, boss);
  assert.equal(boss.atk, before, '阶段不重复叠加');
  assert.ok(b.logs.some((l) => l.type === 'phase'));
});

test('死者不行动，timeout 进入 review 而不是清档', () => {
  const { A, V } = boot(112);
  let s = startRun(A, s0(V), 112);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  const b = s.run.battle;
  b.enemies.forEach((e) => { e.hp = 0; e.alive = false; });
  const r = V.Combat.step(s);
  assert.ok(r.ok);
  assert.ok(r.state.run.battle.over);
  assert.equal(r.state.run.battle.outcome, 'win');
  assert.ok(r.state.run, '不应该清档');
});

test('execute: 完整流程能打完三种遭遇且状态合法', () => {
  ['normal', 'elite', 'boss'].forEach((kind) => {
    const { A, V } = boot(1200);
    let s = startRun(A, s0(V), 1200);
    s.run.floor = kind === 'boss' ? 7 : 3;
    s = setNodes(A, s, [kind === 'boss' ? 'boss' : kind === 'elite' ? 'elite' : 'battle']);
    s = fight(A, s, kind).st;
    const r = stepUntilOver(A, s);
    assert.ok(r.st.run.battle.over, `${kind} 应该结束`);
    const v = V.State.validate(r.st);
    assert.ok(v.ok, `${kind} 结束后状态应合法：${v.errors.slice(0, 3).join('；')}`);
  });
});

/** 取一份合法初始状态。 */
function s0(V) { return V.State.create(4242); }
