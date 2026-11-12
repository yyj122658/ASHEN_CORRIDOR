'use strict';
/* 敌人种类与事件的深度设计：每条机制都要能在真实战斗/真实状态机里复现。 */
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes } = require('../helpers/veteran-run.cjs');

/** 直接按指定物种造一场战斗，方便逐条验证敌人机制。 */
function battleWith(V, st, types, opts) {
  const units = types.map((type, slot) => {
    const meta = V.Data.ENEMIES[type];
    const bp = {
      enemyType: type, name: meta.name, slot, hp: 400, maxHp: 400,
      atk: 40, def: 10, spd: meta.spd, hits: 1,
      isBoss: !!meta.boss, isElite: !!(meta.elite || (opts && opts.elite)),
      sprite: meta.sprite || null, filter: meta.filter || null,
      skills: (meta.skills || []).map((sk) => ({ ...sk })),
      disrupt: meta.disrupt || null,
      phaseAt: meta.phaseAt || null,
      phaseBuff: meta.phaseBuff || null,
      phaseSkills: (meta.phaseSkills || []).map((sk) => ({ ...sk })),
      onDeathBurst: meta.onDeathBurst || null,
    };
    return bp;
  });
  const cr = V.Combat.create(st, { id: 'bp_test', kind: 'normal', floor: 5, units, seedTag: 1 }, 20261112);
  assert.ok(cr.ok, JSON.stringify(cr.error));
  const b = cr.state.run.battle;
  /* 冻结所有人，测试只让指定单位出手 */
  [...b.allies, ...b.enemies].forEach((u) => { u.atkTimer = -1e6; });
  return { st: cr.state, b };
}

function actOnly(V, st, unitId) {
  const b = st.run.battle;
  const u = [...b.allies, ...b.enemies].find((x) => x.id === unitId);
  u.atkTimer = 100;
  return V.Combat.step(st).state;
}

test('层域编成：招牌物种、精英本体在前、精英标记真实生效', () => {
  const { A, V, st } = boot(88);
  const run = startRun(A, st, 88);
  const byFloor = { 1: 'hound', 8: 'boneBell', 15: 'hulk', 22: 'shuffler', 29: 'wraithChoir', 36: 'hulkSlag', 43: 'wraith' };
  for (const [floor, signature] of Object.entries(byFloor)) {
    run.run.floor = Number(floor);
    const normal = V.Combat.generateEncounter(run, 'normal').enemyBlueprint;
    assert.ok(Array.from(normal.units, (u) => u.enemyType).includes(signature));
    assert.equal(normal.units.length, 3);
  }
  run.run.floor = 5;
  const elite = V.Combat.generateEncounter(run, 'elite').enemyBlueprint;
  assert.equal(elite.units[0].isElite, true, '精英本体必须站在最前');
  assert.ok(V.Data.ENEMIES[elite.units[0].enemyType].elite, '第一个单位应是精英物种');
  assert.ok(elite.units.slice(1).every((u) => !u.isElite), '随从不应被标成精英');
  assert.ok(elite.units[0].maxHp > elite.units[1].maxHp, '精英本体要比随从厚');
});

test('三个首领轮流出现，第二阶段追加自己的招式', () => {
  const { A, V, st } = boot(91);
  const run = startRun(A, st, 91);
  run.run.floor = 7;
  const seen = new Set();
  for (const index of [0, 1, 2]) {
    const tpl = V.Data.encounterTemplate('boss', index, 7);
    seen.add(tpl.bossId);
    const meta = V.Data.ENEMIES[tpl.bossId];
    assert.ok(meta.phaseSkills.length, `${tpl.bossId} 应有第二阶段招式`);
  }
  assert.equal(seen.size, 3);

  const { st: s, b } = battleWith(V, run, ['furnaceHeart']);
  const boss = b.enemies[0];
  boss.hp = Math.round(boss.maxHp * 0.4);
  boss.dodge = 0;
  boss.hits = 0;
  const before = boss.skills.length;
  /* 由我方打它一下才会触发阶段判定（阶段只看掉血，不看设置） */
  b.allies[0].atkTimer = 100;
  b.allies[0].hits = 1;
  b.allies[0].crit = 0;
  const next = V.Combat.step(s).state;
  const after = next.run.battle.enemies[0];
  assert.equal(after.bossPhase, 2);
  assert.ok(after.skills.length > before, '第二阶段要追加招式');
  assert.ok(after.skills.some((sk) => sk.id === 'overload'));
});

test('鸣钟骨的眩光真的压低命中，而不是只写一条日志', () => {
  const { A, V, st } = boot(92);
  const run = startRun(A, st, 92);
  const plain = battleWith(V, run, ['bone']);
  const blind = battleWith(V, run, ['boneBell']);
  /* 双方命中率都拉满，只让「眩光」这一个变量起作用 */
  for (const fixture of [plain, blind]) {
    fixture.b.buffsApplied = true;
    fixture.b.allies.forEach((u) => { u.dodge = 0; u.hp = u.maxHp = 100000; });
    fixture.b.enemies.forEach((u) => { u.hits = 0.9; u.atk = 20; });
  }
  /* 先让鸣钟骨敲一次钟，给全队上眩光 */
  let s = actOnly(V, blind.st, blind.b.enemies[0].id);
  assert.ok(s.run.battle.allies.every((u) => u.buffs.some((x) => x.k === 'blind')), '敲钟应给全队上眩光');

  /* 同样的种子跑 240 步，统计落空条数：眩光版本必须更多 */
  const countMiss = (start, id) => {
    let state = start;
    let miss = 0;
    for (let i = 0; i < 240; i += 1) {
      state = actOnly(V, state, id);
      miss = state.run.battle.logs.filter((l) => l.type === 'miss' && l.actorId === id).length;
    }
    return miss;
  };
  const plainMiss = countMiss(plain.st, plain.b.enemies[0].id);
  const blindMiss = countMiss(s, blind.b.enemies[0].id);
  assert.ok(blindMiss > plainMiss, `眩光后落空应更多（${blindMiss} vs ${plainMiss}）`);
});

test('瘦犬越过前排咬后排，拖骸者抽余裕并剥盾，唱喑替同族回血', () => {
  const { A, V, st } = boot(93);
  const run = startRun(A, st, 93);

  const lean = battleWith(V, run, ['houndLean']);
  /* 瘦犬的第一招是断筋（打最残）；要验证扑背，单独把它换出来 */
  const leap = V.Data.ENEMIES.houndLean.skills.find((sk) => sk.target === 'backFoe');
  assert.ok(leap, '瘦犬应有打后排的招式');
  lean.b.enemies[0].skills = [{ ...leap }];
  const front = lean.b.allies[0];
  const back = lean.b.allies[lean.b.allies.length - 1];
  front.hp = front.maxHp; back.hp = back.maxHp;
  const next1 = actOnly(V, lean.st, lean.b.enemies[0].id);
  assert.equal(next1.run.battle.allies[0].hp, front.maxHp, '前排不该被扑到');
  assert.ok(next1.run.battle.allies[next1.run.battle.allies.length - 1].hp < back.maxHp, '后排应被咬');

  const drag = battleWith(V, run, ['shufflerDragger']);
  const target = drag.b.allies[0];
  const targetId = target.id;
  target.energy = 10;
  target.shield = 40;
  const next2 = actOnly(V, drag.st, drag.b.enemies[0].id);
  /* 拖链会先把人拖到最前，所以按 id 取人，不按槽位 */
  const hit = next2.run.battle.allies.find((u) => u.id === targetId);
  assert.equal(hit.shield, 0, '拖链应剥掉护盾');
  assert.equal(Math.round(hit.energy), 8, '拖链应抽走 2 点余裕');

  const choir = battleWith(V, run, ['bone', 'wraithChoir']);
  const healer = choir.b.enemies[1];
  choir.b.enemies[0].hp = 100;
  const next3 = actOnly(V, choir.st, healer.id);
  assert.ok(next3.run.battle.enemies[0].hp > 100, '唱喑应治疗受损的同族');
});

test('炉渣傀倒下时崩壳灼伤全队', () => {
  const { A, V, st } = boot(94);
  const run = startRun(A, st, 94);
  const { st: s, b } = battleWith(V, run, ['hulkSlag']);
  const before = b.allies.map((u) => u.hp);
  b.enemies[0].hp = 1;
  b.enemies[0].alive = true;
  const actor = b.allies[0];
  actor.atkTimer = 100;
  actor.hits = 1; actor.crit = 0;
  let next = V.Combat.step(s).state;
  assert.equal(next.run.battle.enemies[0].alive, false);
  const after = next.run.battle.allies.map((u) => u.hp);
  assert.ok(after.every((hp, i) => hp < before[i]), '崩壳应对全队造成伤害');
  assert.ok(next.run.battle.allies.some((u) => u.buffs.some((x) => x.k === 'burn')), '崩壳应留下灼烧');
});

test('祝福数值真正生效：锐利增伤、厚重减伤、缝补在层间回血', () => {
  const { A, V, st } = boot(95);
  const mk = (blessings) => {
    const base = startRun(A, V.State.clone(st), 95);
    base.run.blessings = blessings;
    const { st: s, b } = battleWith(V, base, ['bone']);
    const enemy = b.enemies[0];
    enemy.def = 0; enemy.dodge = 0; enemy.hp = enemy.maxHp = 100000;
    b.allies.forEach((u) => { u.hits = 1; u.crit = 0; });
    return { s, b };
  };
  const damageOnce = (fixture) => {
    const actor = fixture.b.allies[0];
    actor.atkTimer = 100;
    const next = V.Combat.step(fixture.s).state;
    return fixture.b.enemies[0].maxHp - next.run.battle.enemies[0].hp;
  };
  const plain = damageOnce(mk([]));
  const edged = damageOnce(mk(['edge']));
  assert.ok(edged > plain, `锐利应提高伤害（${edged} vs ${plain}）`);

  /* 减伤：让敌人打同一名队员，对比掉血 */
  const takeHit = (blessings) => {
    const fixture = battleWith(V, (() => {
      const base = startRun(A, V.State.clone(st), 95);
      base.run.blessings = blessings;
      return base;
    })(), ['bone']);
    const enemy = fixture.b.enemies[0];
    enemy.hits = 1; enemy.atk = 400;
    fixture.b.allies.forEach((u) => { u.dodge = 0; u.def = 0; });
    const cut = actOnly(V, fixture.st, enemy.id);
    return fixture.b.allies[0].maxHp - cut.run.battle.allies[0].hp;
  };
  assert.ok(takeHit(['guard']) < takeHit([]), '厚重应减少承受伤害');

  /* 缝补：层间回复叠加在基础回复之上 */
  const healAt = (blessings) => {
    let s = startRun(A, V.State.clone(st), 95);
    s.run.blessings = blessings;
    s.run.party.forEach((p) => { p.hp = 10; });
    V.Expedition.advance(s);
    return s.run.party[0].hp;
  };
  assert.ok(healAt(['mend']) > healAt([]), '缝补应让层间回血更多');
});

/* ------------------------------ 事件 ------------------------------ */

function eventAt(A, V, eventId, opts) {
  const o = opts || {};
  const { st } = boot(o.seed || 61);
  let s = startRun(A, st, o.seed || 61);
  s.run.floor = o.floor || 2;
  s = setNodes(A, s, ['event']);
  const open = V.Expedition.chooseNode(s, s.run.nodes[0].id);
  assert.ok(open.ok, JSON.stringify(open.error));
  s = open.state;
  s.run.event.eventId = eventId;
  s.run.event.resolved = false;
  return s;
}

test('事件池按层解锁，第二段事件不会自己冒出来', () => {
  const { A, V } = boot(62);
  const early = V.Data.eventPool(1);
  const deep = V.Data.eventPool(43);
  assert.ok(!early.includes('deepWell'), '第 1 层不该出现深井');
  assert.ok(!early.includes('paleSurgeon'), '第 1 层不该出现手术师');
  assert.ok(deep.includes('deepWell') && deep.includes('paleSurgeon'));
  assert.ok(!early.includes('ledgerPage'), '链式第二段只能由第一段接出来');
  assert.ok(!V.Data.EVENT_ORDER.includes('ledgerPage'));
  /* 每个随机事件都至少有一条无门槛选项，保守策略与自动模拟靠它收尾 */
  for (const id of V.Data.EVENT_ORDER) {
    const ev = V.Data.EVENTS[id];
    const last = ev.choices[ev.choices.length - 1];
    assert.ok(!last.need && !last.gamble && !last.combat, `${id} 的最后一条选项应无门槛`);
  }
});

test('门槛按金币/食材结算，不满足时明确拒绝且不改状态', () => {
  const { A, V } = boot(63);
  let s = eventAt(A, V, 'ledgerStall', { floor: 2 });
  s.gold = 10;
  const denied = V.Expedition.chooseEvent(s, 'sign');
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'need_not_met');
  assert.match(denied.error.message, /金币/);

  s.gold = 200;
  const paid = V.Expedition.chooseEvent(s, 'sign');
  assert.ok(paid.ok, JSON.stringify(paid.error));
  assert.equal(paid.state.gold, 140);
  assert.ok(paid.state.run.fieldManuscript, '签名应给一门战利谱');
  /* 多段事件：签名之后接上第二页，仍停在事件阶段 */
  assert.equal(paid.state.run.event.eventId, 'ledgerPage');
  assert.equal(paid.state.run.event.resolved, false);
  assert.equal(paid.state.run.stage, 'event');
  assert.ok(V.State.validate(paid.state).ok, JSON.stringify(V.State.validate(paid.state).errors));
});

test('赌局是确定性的：同一状态重放得到同一分支', () => {
  const { A, V } = boot(64);
  const s = eventAt(A, V, 'bellSlack', { floor: 3 });
  const a = V.Expedition.chooseEvent(s, 'ring');
  const b = V.Expedition.chooseEvent(V.State.clone(s), 'ring');
  assert.ok(a.ok && b.ok);
  assert.equal(a.state.run.event.branch, b.state.run.event.branch);
  assert.equal(a.state.gold, b.state.gold);
  assert.equal(a.state.run.party[0].hp, b.state.run.party[0].hp);
  assert.ok(['win', 'lose'].includes(a.state.run.event.branch));
  assert.ok(a.state.run.event.resultText.length > 0);
});

test('事件收益落到真实系统：耗食材回血、降压力换生命上限、食材进包可校验', () => {
  const { A, V } = boot(65);
  let s = eventAt(A, V, 'hungerPot', { floor: 2 });
  s.run.ingredients = { lampKelp: 2 };
  s.run.party.forEach((p) => { p.hp = 40; });
  const shared = V.Expedition.chooseEvent(s, 'share');
  assert.ok(shared.ok, JSON.stringify(shared.error));
  assert.equal(shared.state.run.ingredients.lampKelp, 1, '应只消耗 1 份');
  assert.ok(shared.state.run.party[0].hp > 40, '应回血');
  assert.ok(V.State.validate(shared.state).ok, JSON.stringify(V.State.validate(shared.state).errors));

  const choir = eventAt(A, V, 'boneChoir', { floor: 3 });
  choir.run.party.forEach((p) => { p.stress = 40; });
  const joined = V.Expedition.chooseEvent(choir, 'join');
  assert.ok(joined.ok);
  assert.ok(joined.state.run.party[0].stress < 40, '压力应下降');
  assert.ok(joined.state.run.maxHpModifiers[joined.state.run.party[0].uid] < 1, '本趟生命上限应下调');

  const moth = eventAt(A, V, 'mothLantern', { floor: 2 });
  const took = V.Expedition.chooseEvent(moth, 'take');
  assert.ok(took.ok, JSON.stringify(took.error));
  assert.equal(Object.values(took.state.run.ingredients).reduce((a, n) => a + n, 0), 3);
  assert.ok(V.State.validate(took.state).ok, JSON.stringify(V.State.validate(took.state).errors));

  const well = eventAt(A, V, 'deepWell', { floor: 5 });
  const bucket = V.Expedition.chooseEvent(well, 'bucket');
  assert.ok(bucket.ok);
  assert.equal(Object.values(bucket.state.run.ingredients).reduce((a, n) => a + n, 0), 2);
});

test('事件界面拿到的是可判定选项：禁用项带原因，收益能列出来', () => {
  const { A, V } = boot(66);
  const s = eventAt(A, V, 'ledgerStall', { floor: 2 });
  s.gold = 0;
  const choices = V.Expedition.eventChoices(s);
  const sign = choices.find((c) => c.id === 'sign');
  assert.equal(sign.ok, false);
  assert.match(sign.reason, /金币/);
  const read = choices.find((c) => c.id === 'read');
  assert.equal(read.ok, true);
  assert.equal(read.effects.gold, 25);
  assert.equal(choices.find((c) => c.id === 'pass').ok, true);
});

test('每条事件的每个非战斗选项都能结算出合法状态', () => {
  const { A, V } = boot(67);
  for (const id of Object.keys(V.Data.EVENTS)) {
    const ev = V.Data.EVENTS[id];
    for (const choice of ev.choices) {
      if (choice.combat) continue; /* 战斗分支另有专门的用例 */
      const s = eventAt(A, V, id, { floor: Math.max(ev.minFloor || 1, 2), seed: 67 });
      s.gold = 300;
      s.run.ingredients = { lampKelp: 3 };
      const r = V.Expedition.chooseEvent(s, choice.id);
      assert.ok(r.ok, `${id}/${choice.id} 应能结算：${JSON.stringify(r.error)}`);
      const check = V.State.validate(r.state);
      assert.ok(check.ok, `${id}/${choice.id} 结算后状态非法：${check.errors.join('；')}`);
    }
  }
});

test('拓本匣只有一格：已经有拓本时换拓本的选项禁用', () => {
  const { A, V } = boot(68);
  const s = eventAt(A, V, 'ledgerStall', { floor: 4 });
  s.gold = 300;
  s.run.fieldManuscript = 'tinThread';
  const choices = V.Expedition.eventChoices(s);
  const sign = choices.find((c) => c.id === 'sign');
  assert.equal(sign.ok, false);
  assert.match(sign.reason, /拓本匣/);
  const denied = V.Expedition.chooseEvent(s, 'sign');
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'need_not_met');
});
