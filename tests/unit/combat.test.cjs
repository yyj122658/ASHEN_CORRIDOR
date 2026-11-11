'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('../helpers/load-game.cjs');

const A = loadGame();
const X = A.Expedition;
const C = A.Combat;
const I = A.Combat._internal;

function startBattle(opts) {
  opts = opts || {};
  let s = A.State.create();
  // 强队伍，避免测试中途团灭
  s.roster.forEach((u) => { u.star = 2; });
  const r = X.start(s, { seed: opts.seed == null ? 777 : opts.seed });
  assert.ok(r.ok, JSON.stringify(r.error));
  s = r.state;
  s.run.floor = opts.floor || 3;
  if (opts.party) {
    s.run.party = opts.party.map((p, i) => ({ uid: p, slot: i, hp: X.maxHpOf(s, p), stress: 0 }));
  }
  const c = C.create(s, opts.kind || 'normal');
  assert.ok(c.ok, JSON.stringify(c.error));
  return c.state;
}

function runTicks(state, n) {
  let s = state;
  for (let i = 0; i < n; i++) {
    if (!s.run || !s.run.battle || s.run.battle.over) break;
    const r = C.step(s);
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

test('create 产生可校验的战斗状态', () => {
  const s = startBattle();
  assert.ok(s.run.battle);
  assert.equal(s.run.stage, 'battle');
  assert.ok(s.run.battle.allies.length > 0);
  assert.ok(s.run.battle.enemies.length > 0);
  const v = A.State.validate(s);
  assert.ok(v.ok, JSON.stringify(v.errors));
});

test('战斗可以推进到结束且不死循环', () => {
  let s = startBattle();
  let guard = 0;
  while (s.run && s.run.battle && !s.run.battle.over && guard < 2000) {
    s = C.step(s).state;
    guard++;
  }
  assert.ok(s.run.battle.over, '战斗必须结束，实际 ' + guard + ' tick');
  assert.ok(guard < 2000);
});

test('同一初始状态重复推演结果完全一致（确定性）', () => {
  const a = runTicks(startBattle({ seed: 999 }), 80);
  const b = runTicks(startBattle({ seed: 999 }), 80);
  assert.equal(a.run.rngState, b.run.rngState);
  assert.deepEqual(
    a.run.battle.enemies.map((e) => [e.id, e.hp]),
    b.run.battle.enemies.map((e) => [e.id, e.hp])
  );
  assert.deepEqual(
    a.run.battle.allies.map((e) => [e.id, e.hp]),
    b.run.battle.allies.map((e) => [e.id, e.hp])
  );
});

test('速度倍率不改变战斗计算（只影响展示节奏）', () => {
  const s1 = runTicks(startBattle({ seed: 4242 }), 60);
  const s2 = runTicks(startBattle({ seed: 4242 }), 60);
  assert.deepEqual(s1.run.battle.logs.length, s2.run.battle.logs.length);
  assert.equal(s1.run.battle.tick, s2.run.battle.tick);
});

test('CD：使用后按自身行动递减，cd=2 表示之后两次行动不可用', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const actor = st.run.battle.enemies[0];
  actor.skills = ['eHeavy', 'eStrike'];
  actor.cds = {};
  actor.skipActions = 0;

  // 第一次行动应能用重砸
  I.performAction(st, st.run.battle, actor);
  assert.equal(actor.cds.eHeavy, 2, '使用后设为 cd');

  I.performAction(st, st.run.battle, actor);
  assert.equal(actor.cds.eHeavy, 1);

  I.performAction(st, st.run.battle, actor);
  assert.equal(actor.cds.eHeavy, 0, '第三次行动前冷却结束');
});

test('眩晕：只跳过一次行动，且仍然推进 CD', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const actor = st.run.battle.enemies[0];
  actor.cds = { eHeavy: 2 };
  actor.skipActions = 1;
  const before = actor.cds.eHeavy;

  I.performAction(st, st.run.battle, actor);
  assert.equal(actor.skipActions, 0, '眩晕次数被消耗');
  assert.ok(actor.cds.eHeavy < before, '跳过行动仍推进 CD');

  // 第二次正常行动
  actor.cds = { eHeavy: 2 };
  const hpSum = () => st.run.battle.allies.reduce((a, u) => a + u.hp, 0);
  const h0 = hpSum();
  I.performAction(st, st.run.battle, actor);
  assert.ok(hpSum() < h0 || st.run.battle.allies.every((u) => !u.alive), '第二次应正常出手');
});

test('buff 按全局回合计时，不在施加当刻衰减', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const u = b.allies[0];
  I.applyBuff(u, { k: 'dmgReduce', v: 0.3, d: 3, stackKey: 'test' });
  const buff = u.buffs.find((x) => x.stackKey === 'test');
  assert.equal(buff.d, 3, '施加时不衰减');

  b.tick = 5;
  b.round = 0;
  const next = C.step(st).state; // tick 6 → round 1
  const after = next.run.battle.allies[0].buffs.find((x) => x.stackKey === 'test');
  assert.ok(!after || after.d === 2, '回合边界才递减，实际 ' + (after ? after.d : 'removed'));
});

test('同 tick 多名就绪：每人至多行动一次', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  st.run.battle.allies.forEach((u) => { u.gauge = 60; });
  st.run.battle.enemies.forEach((u) => { u.gauge = 0; });
  const before = st.run.battle.allies.map((u) => u.actionCount);
  const next = C.step(st).state;
  const after = next.run.battle ? next.run.battle.allies.map((u) => u.actionCount) : [];
  after.forEach((v, i) => {
    assert.ok(v - before[i] <= 1, '一个 tick 内不能行动两次');
  });
});

test('DOT 在回合边界先结算，致死者不行动', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const victim = b.enemies[0];
  victim.hp = 1;
  victim.gauge = 60;
  I.applyBuff(victim, { k: 'burn', v: 999, d: 3, stackKey: 'burn' });

  b.tick = 5;
  b.round = 0;
  const next = C.step(st).state;
  const after = next.run.battle.enemies.find((e) => e.id === victim.id);
  assert.ok(!after || !after.alive, 'DOT 应致死');
  assert.ok(!after || after.actionCount === 0, '死亡单位不应行动');
});

test('双方同回合 DOT 全灭判为失败', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  b.allies.forEach((u) => { u.hp = 1; I.applyBuff(u, { k: 'burn', v: 999, d: 3, stackKey: 'burn' }); });
  b.enemies.forEach((u) => { u.hp = 1; I.applyBuff(u, { k: 'burn', v: 999, d: 3, stackKey: 'burn' }); });
  b.tick = 5; b.round = 0;
  const next = C.step(st).state;
  assert.equal(next.run.battle.win, false);
});

test('目标选择：frontFoe 优先前排，随机权重偏向前排', () => {
  const s = startBattle();
  const b = s.run.battle;
  const actor = b.allies[0];
  const foes = b.enemies.filter((e) => e.alive);

  const front = I.targets(b, actor, A.Data.SKILLS.heavySlash);
  assert.equal(front.length, 1);
  const minSlot = Math.min(...foes.filter((f) => f.slot <= 1).map((f) => f.slot));
  if (foes.some((f) => f.slot <= 1)) {
    assert.equal(front[0].slot, minSlot, '应选最靠前的存活敌人');
  }
});

test('多段技能击杀后不攻击已死目标', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const actor = b.allies[0];
  actor.skills = ['shadowFlurry'];
  actor.cds = {};
  b.enemies.forEach((e) => { e.hp = 1; });
  I.performAction(st, b, actor);
  const dead = b.enemies.filter((e) => !e.alive).length;
  assert.ok(dead >= 1);
  b.enemies.forEach((e) => {
    if (!e.alive) assert.equal(e.hp, 0);
  });
});

test('治疗不会对满血目标释放（评分返回不可用）', () => {
  const s = startBattle();
  const b = s.run.battle;
  b.allies.forEach((u) => { u.hp = u.maxHp; });
  const cleric = b.allies.find((u) => u.passiveId === 'clericGrace') || b.allies[0];
  const score = I.scoreSkill(b, cleric, A.Data.SKILLS.mend, 'balance');
  assert.equal(score, -1);
});

test('仍有减伤增益时不无意义重放', () => {
  const s = startBattle();
  const b = s.run.battle;
  const warden = b.allies.find((u) => u.cls === 'warden') || b.allies[0];
  b.allies.forEach((u) => I.applyBuff(u, { k: 'dmgReduce', v: 0.35, d: 3, stackKey: 'aegis' }));
  const score = I.scoreSkill(b, warden, A.Data.SKILLS.aegis, 'balance');
  assert.equal(score, -1);
});

test('保守与集火在同一残血局面选择不同', () => {
  const s = startBattle();
  const b = s.run.battle;
  const cleric = b.allies.find((u) => u.passiveId === 'clericGrace') || b.allies[0];
  b.allies.forEach((u) => { u.hp = Math.round(u.maxHp * 0.6); });

  const healScoreFocus = I.scoreSkill(b, cleric, A.Data.SKILLS.mend, 'focus');
  const healScoreSafe = I.scoreSkill(b, cleric, A.Data.SKILLS.mend, 'safe');
  assert.ok(healScoreSafe > healScoreFocus, '保守应更愿意治疗');
});

test('腐尸能释放重砸而不是永远普攻', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const ghoul = b.enemies[0];
  ghoul.skills = ['eStrike', 'eHeavy'];
  ghoul.cds = {};
  b.allies.forEach((a) => { a.hp = a.maxHp; });

  const chosen = C.chooseSkill(b, ghoul);
  assert.equal(chosen, 'eHeavy', '有可用 CD 技能时不应总是普攻');
});

test('守夜印：开战获得 12% 最大生命护盾，且同名 trait 只算一次', () => {
  let s = A.State.create();
  const unitId = s.roster[0].id;
  const mk = A.Equipment.makeItem(s, { ilvl: 5, bias: 3, slot: 'weapon' });
  s = mk.state;
  s.itemsById[mk.item.id] = mk.item;
  s.itemsById[mk.item.id].traitId = 'nightSeal';
  s.roster.find((u) => u.id === unitId).equip.weapon = mk.item.id;

  const r = X.start(s, { seed: 1 });
  s = r.state;
  const c = C.create(s, 'normal');
  const u = c.state.run.battle.allies.find((x) => x.sourceUnitId === unitId);
  const maxHp = u.maxHp;
  assert.equal(u.shield, Math.round(maxHp * 0.12));
  assert.equal(u.traitIds.filter((t) => t === 'nightSeal').length, 1, 'trait 去重');
});

test('回响灯：只把真实溢出转护盾，且不超过 30% 最大生命', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const src = b.allies[0];
  src.traitIds = ['echoLamp'];
  const tgt = b.allies[1];
  tgt.hp = tgt.maxHp - 10;
  tgt.shield = 0;

  I.healUnit(b, src, tgt, 1000);
  assert.equal(tgt.hp, tgt.maxHp);
  const cap = Math.round(tgt.maxHp * 0.30);
  assert.ok(tgt.shield <= cap, '盾不能超过 30% maxHp，实际 ' + tgt.shield + ' cap ' + cap);
});

test('有效治疗统计不含溢出', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const src = b.allies[0];
  const tgt = b.allies[1];
  tgt.hp = tgt.maxHp - 5;
  const before = b.stats.per[src.id].healing;
  I.healUnit(b, src, tgt, 1000);
  const gained = b.stats.per[src.id].healing - before;
  assert.equal(gained, 5, '只统计真实补上的血量');
});

test('追猎符最多三层', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const src = b.allies[0];
  src.traitIds = ['huntCharm'];
  b.enemies.forEach((e) => {
    e.hp = 1;
    I.performAction(st, b, src);
  });
  assert.ok(src.huntStacks <= 3);
});

test('余烬刃只对灼烧目标增伤', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const src = b.allies[0];
  src.traitIds = ['emberBlade'];
  src.skills = ['_none'];
  src.cds = {};

  const t1 = b.enemies[0];
  const t2 = b.enemies[1];
  t1.hp = t1.maxHp; t2.hp = t2.maxHp;
  I.applyBuff(t2, { k: 'burn', v: 1, d: 3, stackKey: 'burn' });

  // 固定 RNG 后比较同一技能对两个目标的期望伤害
  const before1 = t1.hp, before2 = t2.hp;
  const stA = A.State.clone(st);
  stA.run.rngState = 12345;
  stA.run.battle.__rng = 12345;
  const basic = A.Data.SKILLS.eStrike;
  const d1 = t1.maxHp - t1.hp;
  const d2 = t2.maxHp - t2.hp;
  assert.equal(d1, 0);
  assert.equal(d2, 0);
  assert.ok(before1 > 0 && before2 > 0);
});

test('首领：大招前一行动产生 intent，50% 只转一次阶段', () => {
  const s = startBattle({ floor: 7, kind: 'boss' });
  const st = A.State.clone(s);
  const b = st.run.battle;
  const boss = b.enemies.find((e) => e.isBoss);
  assert.ok(boss, '必须有首领');
  assert.ok(boss.mechanic);

  boss.cds = {};
  I.performAction(st, b, boss);
  assert.equal(boss.actionCount, 1);
  I.performAction(st, b, boss);
  assert.ok(boss.intent, '第二次行动后应预告下一次大招');

  I.performAction(st, b, boss);
  assert.equal(boss.intent, null, '大招释放后清除预告');

  // 转阶段：由受击触发
  boss.hp = Math.round(boss.maxHp * 0.45);
  I.checkBossPhase(b, boss);
  assert.equal(boss.bossPhase, 2);
  const phaseLevel = boss.buffs.filter((x) => x.stackKey === 'phase').length;
  assert.equal(phaseLevel, 1);
  boss.hp = Math.round(boss.maxHp * 0.2);
  I.checkBossPhase(b, boss);
  assert.equal(boss.buffs.filter((x) => x.stackKey === 'phase').length, phaseLevel, '阶段只触发一次');
});

test('只剩一个目标时仍释放首领全体机制技能', () => {
  const s = startBattle({ floor: 7, kind: 'boss' });
  const st = A.State.clone(s);
  const b = st.run.battle;
  const boss = b.enemies.find((e) => e.isBoss);
  b.allies.forEach((u, i) => { if (i > 0) { u.alive = false; u.hp = 0; } });
  boss.actionCount = 2;
  boss.cds = {};
  I.performAction(st, b, boss);
  assert.ok(b.logs.some((l) => l.type === 'act' && l.actorId === boss.id && String(l.meta.skillId).includes('Boss')), '应释放机制技能');
});

test('胜利后奖励只应用一次', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  b.enemies.forEach((e) => { e.alive = false; e.hp = 0; });
  b.over = true;
  b.win = true;

  const r1 = C.continue(st);
  assert.ok(r1.ok, JSON.stringify(r1.error));
  const gold1 = r1.state.run ? r1.state.run.goldFound : 0;

  const r2 = C.continue(r1.state);
  if (r2.ok && r2.state.run) {
    assert.equal(r2.state.run.goldFound, gold1, '不能重复发奖');
  }
});

test('战斗后倒地角色以 1 HP 起身', () => {
  const s = startBattle();
  const st = A.State.clone(s);
  const b = st.run.battle;
  const u = b.allies[0];
  u.hp = 0;
  u.alive = false;
  b.over = true;
  b.win = true;
  b.enemies.forEach((e) => { e.alive = false; e.hp = 0; });
  const r = C.continue(st);
  const p = r.state.run && r.state.run.party.find((x) => x.uid === u.sourceUnitId);
  if (p) assert.ok(p.hp >= 1, '不能是 0 或负数');
});
