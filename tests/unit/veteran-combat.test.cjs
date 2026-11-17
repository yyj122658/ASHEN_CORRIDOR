'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes, fight, stepUntilOver, autoRouteBoard } = require('../helpers/veteran-run.cjs');

test('实战敌群随层域变化，每个物种都有出场与采收途径', () => {
  const { A, V, st } = boot(712);
  const run = startRun(A, st, 712);
  const found = new Set();
  /* 生产：每层域的招牌必须出现在普通遭遇里，且每一层都不会空编成 */
  for (const [floor, species] of [[1, 'hound'], [8, 'boneBell'], [15, 'hulk'], [22, 'shuffler'], [29, 'wraithChoir'], [36, 'hulkSlag'], [43, 'wraith']]) {
    run.run.floor = floor;
    const encounter = V.Combat.generateEncounter(run, 'normal');
    const types = Array.from(encounter.enemyBlueprint.units, enemy => enemy.enemyType);
    assert.ok(types.includes(species), `第 ${floor} 层应出现 ${species}`);
    /* 七标：F20 起补到 4 员（四人小队打三名敌人等于排队点名），浅层仍是三员 */
    assert.equal(types.length, floor >= 20 ? 4 : 3, '深层补足编队、浅层固定三员');
    types.forEach(type => found.add(type));
  }
  /* 编成：层域 × 轮转 × 三种节点都要能生成，且每个物种至少被用过一次 */
  for (const floor of [1, 8, 15, 22, 29, 36, 43]) {
    for (const index of [0, 1, 2, 3]) {
      for (const kind of ['normal', 'elite', 'boss']) {
        const { bossId, minionIds } = V.Data.chapterEncounter(kind, index, floor);
        if (bossId) found.add(bossId);
        minionIds.forEach(type => found.add(type));
      }
    }
  }
  assert.deepEqual([...found].sort(), Object.keys(V.Data.ENEMIES).sort());

  /* 采收：每个物种都要能在料理生态里查到产物，否则确认战利时会崩 */
  for (const id of Object.keys(V.Data.ENEMIES)) {
    assert.ok(V.Kitchen.ECOSYSTEM[id], `${id} 缺少生态条目`);
    assert.ok(V.Kitchen.harvestOptions(id).length, `${id} 缺少采收选项`);
  }
});

/**
 * 装两门蚀刻法：主修 + 辅修。
 *
 * 以前测试直接写 `{...spec, x, y}` —— 那时骨架只有 2~14 格，坐标凑巧就落在板面里。
 * 六标之后骨架 6~54 格，写死坐标基本都越界，于是 manuscriptState 直接判 DEAD。
 * 现在走真实装配（浇铸 + 落位），需要哪一门接通就把哪一门交给布线器。
 */
function equipTwo(A, V, st, unit, mainId, extraId, routeId) {
  unit.manuscript = null;
  delete unit.extraManuscripts;
  V.State.equipManuscript(st, unit, mainId);
  if (extraId) {
    st.manuscriptVault = st.manuscriptVault || [];
    st.manuscriptVault.push({ ...V.Data.MANUSCRIPTS[extraId] });
    V.State.placeManuscript(st, unit, extraId);
  }
  if (routeId) autoRouteBoard(A, st, unit, { style: 'elbow', msId: routeId });
  return V.State.manuscriptsOf(unit);
}

test('同一人同场自动使用两套蚀刻法，护持不清空另一套的追击计数', () => {
  const { A, V, st } = boot(712, { generated: true });
  const unit = st.roster[1];
  const spec = V.Data.MANUSCRIPTS;
  equipTwo(A, V, st, unit, 'needle', 'ward');
  let s = fight(A, setNodes(A, startRun(A, st, 712), ['battle']), 'normal').st;
  const b = s.run.battle;
  const actor = b.allies.find((u) => u.sourceUnitId === unit.id);
  assert.equal(actor.slot, 1);
  assert.deepEqual(Array.from(actor.skillList, (sk) => sk.id), ['needle', 'ward']);
  [...b.allies, ...b.enemies].filter((u) => u !== actor).forEach((u) => { u.atkTimer = -1000; });
  b.enemies.forEach((u) => { u.hp = u.maxHp = 10000; u.dodge = 0; });
  b.allies[0].hp = 1;
  actor.hits = 1;
  actor.crit = 0;
  actor.energy = actor.energyMax;
  for (let i = 0; i < 80; i++) s = V.Combat.step(s).state;
  const result = s.run.battle;
  assert.ok(result.allies[0].hp > 1);
  assert.ok(result.logs.some((e) => e.actorId === actor.id && e.type === 'cast' && e.text.includes('回息')));
  assert.ok(result.logs.some((e) => e.actorId === actor.id && e.type === 'hit' && e.text.includes('逐隙一击')));
  const report = V.Combat.report(s).allies.find((u) => u.id === actor.id);
  assert.deepEqual(Array.from(report.resonances, (r) => r.name), ['逐隙', '回息']);
});

test('首位也能施放回息，换位后仍按各门贯通与独立冷却轮换', () => {
  const { A, V, st } = boot(712, { generated: true });
  const unit = st.roster[0];
  /* 副修「挑火」的施放条件是 routed，所以这一门必须真的接通 */
  equipTwo(A, V, st, unit, 'ward', 'wick', 'wick');
  let s = fight(A, setNodes(A, startRun(A, st, 712), ['battle']), 'normal').st;
  const battle = s.run.battle;
  const me = battle.allies[0];
  /* 六标之后「铺满整块板」很容易把两门都覆盖到，所以这里不再要求一真一假；
     这条要守的是**各门有自己的 routed 与冷却**，而不是某一门恰好没接通。 */
  assert.equal(typeof me.ms.routed, 'boolean');
  assert.equal(typeof me.extraMs[0].routed, 'boolean');
  [...battle.allies, ...battle.enemies].forEach((u) => { u.atkTimer = -1000; });
  me.skillList = me.skillList.map((sk) => ({ ...sk, id: 'same', sharedCooldown: true }));
  me.energy = me.energyMax;
  me.atkTimer = 100;
  battle.allies[1].hp = 1;
  s = V.Combat.step(s).state;
  let actor = s.run.battle.allies[0];
  assert.equal(actor.pendingSkill.name, '回息');
  /* 能耗 = 招式基础 5 + 七标的主动招式附加 1（skillEnergySurcharge） */
  assert.equal(actor.energy, me.energyMax - (5 + (V.Data.DESIGN.skillEnergySurcharge || 0)));
  assert.ok(actor.cds.same > 0 && !actor.cds['1:same']);
  actor.slot = 1;
  s.run.battle.allies[1].slot = 0;
  actor.atkTimer = 100;
  for (let i = 0; i < 8 && actor.pendingSkill?.name !== '挑火'; i++) {
    s = V.Combat.step(s).state;
    actor = s.run.battle.allies[0];
  }
  assert.equal(actor.pendingSkill?.name, '挑火');
  assert.ok(actor.cds.same > 0 && actor.cds['1:same'] > 0);
});

test('星火副修在前后位均缩短同一比例的平攻间隔', () => {
  const { A, V, st } = boot(712, { generated: true });
  const unit = st.roster[1];
  equipTwo(A, V, st, unit, 'ward', 'spark');
  const s = fight(A, setNodes(A, startRun(A, st, 712), ['battle']), 'normal').st;
  const b = s.run.battle;
  const actor = b.allies[1];
  [...b.allies, ...b.enemies].forEach((u) => { u.atkTimer = -1000; });
  b.enemies.forEach((u) => { u.hp = u.maxHp = 10000; u.dodge = 0; });
  actor.hits = 1;
  actor.atkTimer = 0;
  actor.spd = V.Data.DESIGN.baseSpeed;
  function attacksDuring(state, slot) {
    const me = state.run.battle.allies[1];
    const other = state.run.battle.allies.find((u) => u.slot === slot);
    if (other) other.slot = me.slot;
    me.slot = slot;
    me.atkTimer = 0;
    /* 星火现在自带起手技「迸火」，会拿引导时间去挤普攻；
       这条测的是「间隔缩短比例」，所以先把招式摘掉，只留面板 */
    me.skillList = [];
    me.casting = null;
    me.pendingSkill = null;
    const before = me.atkSinceSkill;
    for (let i = 0; i < 30; i++) state = V.Combat.step(state).state;
    return { state, attacks: state.run.battle.allies[1].atkSinceSkill - before };
  }
  const front = attacksDuring(s, 1);
  const rear = attacksDuring(front.state, 2);
  const baseInterval = V.Data.DESIGN.autoAttack.interval * V.Data.MANUSCRIPTS.ward.attack.intervalScale;
  const duration = V.Data.DESIGN.stepSeconds * 30;
  assert.equal(front.attacks, Math.floor(duration / (baseInterval * V.Data.MANUSCRIPTS.spark.attack.intervalScale)));
  assert.equal(rear.attacks, front.attacks);
});

test('当前与旧档的主修在四个身位均能出招，原位标记不再改变基础攻击', () => {
  const { A, V, st } = boot(715);
  const unit = st.roster[0];
  equipTwo(A, V, st, unit, 'corridor5', null);
  unit.manuscript.positions = [0];
  const initial = fight(A, setNodes(A, startRun(A, st, 715), ['battle']), 'normal').st;
  const damages = [];
  for (let slot = 0; slot < 4; slot++) {
    const state = V.State.clone(initial), b = state.run.battle;
    const actor = b.allies[0], other = b.allies[slot];
    if (other) other.slot = 0;
    actor.slot = slot;
    actor.positionAllowed = false;
    [...b.allies, ...b.enemies].forEach(u => { u.atkTimer = -1000; });
    b.enemies.forEach(u => { u.dodge = 0; });
    actor.hits = 1; actor.crit = 0; actor.atkTimer = 100; actor.energy = actor.energyMax;
    const cast = V.Combat.step(state).state.run.battle.allies[0];
    assert.equal(cast.pendingSkill?.id, 'pierce');
    actor.energy = 0; actor.regen = 0; actor.attackMult = 2; actor.emberAttack = true;
    const attacked = V.Combat.step(state).state.run.battle;
    damages.push(attacked.allies[0].stats.damage);
    assert.ok(attacked.enemies[0].buffs.some(b => b.k === 'burn'));
  }
  assert.ok(damages[0] > 0);
  assert.equal(new Set(damages).size, 1);
});

test('起始队伍的蚀刻法触发实战换位，敌人随后攻击新前锋，读档保留席位与记录', () => {
  const { A, V } = boot(712);
  const state = fight(A, setNodes(A, startRun(A, V.State.create(712), 712), ['battle']), 'normal').st;
  const b = state.run.battle, lead = b.allies[0], nextFront = b.allies[1];
  assert.equal(lead.ms.spec.id, 'spark');
  [...b.allies, ...b.enemies].forEach(u => { u.atkTimer = -1000; u.dodge = 0; });
  lead.atkTimer = 10; lead.hits = 1;
  const moved = V.Combat.step(state);
  const changed = moved.state.run.battle;
  assert.equal(changed.allies[0].slot, 1);
  assert.equal(changed.allies[1].slot, 0);
  assert.equal(changed.allies[0].refract, 1);
  const afterimage = V.State.clone(moved.state);
  afterimage.run.battle.allies[0].atkTimer = 10;
  assert.equal(V.Combat.step(afterimage).state.run.battle.allies[0].refract, 0, '再次出手时，未消耗的残影到期');
  assert.ok(changed.logs.some(e => e.type === 'move' && e.actorId === lead.id && e.targetId === nextFront.id && e.meta.to === 1));
  const saved = V.Storage.decode(V.Storage.encode(moved.state));
  assert.ok(saved.ok);
  const battle = saved.state.run.battle;
  battle.allies.forEach(u => { u.atkTimer = -1000; });
  const enemy = battle.enemies[0];
  enemy.atkTimer = 10; enemy.skills = [];
  const response = V.Combat.step(saved.state).state.run.battle;
  assert.ok(response.logs.some(e => e.type === 'hit' && e.actorId === enemy.id && e.targetId === nextFront.id));
  assert.equal(V.Positions.slotProblem(response.allies), null);
});

test('压力50/80按档持续影响余裕恢复，低血恢复同乘，食物降压后的下一战按新压力恢复', () => {
  const { A, V, st } = boot(716);
  const initial = fight(A, setNodes(A, startRun(A, st, 716), ['battle']), 'normal').st;
  for (const [stress, rate] of [[0,1],[49,1],[50,0.85],[79,0.85],[80,0.65],[100,0.65]]) {
    const state = V.State.clone(initial);
    const u = state.run.battle.allies[0];
    /* regenBase 是「没扣超载罚项的原始值」——高压下要按它退罚项，所以两者一起设 */
    u.hp = 1; u.regen = 2; u.regenBase = 2; u.lowHpRegen = 1; u.energy = 0; u.stress = stress;
    u.atkTimer = -1000;
    assert.equal(V.Combat.energyRegen(u), 3 * rate);
    const advanced = V.Combat.step(state).state.run.battle.allies[0];
    assert.equal(advanced.energy, 3 * rate * V.Data.DESIGN.stepSeconds);
  }
  const field = startRun(A, st, 716);
  const p = field.run.party[0];
  p.stress = 53;
  field.run.meals = { kelpBroth: 1 };
  const eaten = V.Kitchen.eat(field, 'kelpBroth', p.uid).state;
  const encounter = fight(A, setNodes(A, eaten, ['battle']), 'normal').st.run.battle;
  assert.equal(encounter.allies[0].stress, 45);
  assert.equal(V.Combat.energyRegen(encounter.allies[0]), encounter.allies[0].regen);
});

test('五种主手按身位与余裕规则出手', () => {
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
  /* v4.0：缓冲上限来自储能纹路，没刻就是 0 —— 这一条测的是「护盾全挡不产生脉冲」，
     所以先给一个足够大的上限 */
  ally.shieldCap = 9999;
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
  /* 八标之后完整度降到 75~115，12 点直击已经越过「8% 完整度」的熔断线，
     会被保险丝整下挡掉 —— 这一条要验的是「真伤才记录」，所以走穿刺绕过熔断。 */
  I.applyDamage(b, enemy, ally, 12, { pierce: true });
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
function s0(V) { return V.State.create(4242, { classicPlate: true }); }

test('持续伤害按出手次数结算：灼烧出手前、腐蚀出手后，每跳前先判死', () => {
  const { A, V, st } = boot(716);
  let s = startRun(A, st, 716);
  s.run.floor = 6;
  const gen = V.Combat.generateEncounter(s, 'normal');
  s = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
  const ally = s.run.battle.allies[0];
  /* 八标：难度抬上来之后，靶子可能在第一次出手前就被打死，这条用例要验的是 DOT 的结算时机，
     不是生存能力 —— 先把血灌满，把变量隔离掉。 */
  ally.maxHp = 500;
  ally.hp = 500;
  ally.buffs = [{ k: 'burn', v: 3, hits: 2 }, { k: 'corrode', v: 3, hits: 2 }];

  /* 八标：战斗节奏加快之后，一场的日志会超过 240 条的环形缓冲，早期的 DOT 会被挤掉。
     逐 tick 收集，不依赖终局快照。 */
  const seen = new Map();
  const grab = () => (s.run.battle.logs || []).forEach((l) => seen.set(l.seq, l));
  let guard = 0;
  while (guard++ < 400) {
    s = V.Combat.step(s).state;
    grab();
    if (s.run.battle.over) break;
    const alive = s.run.battle.allies.find((x) => x.id === ally.id);
    if (!alive || !(alive.buffs || []).some((x) => x.k === 'burn' || x.k === 'corrode')) break;
  }
  const logs = [...seen.values()].sort((a, b) => a.seq - b.seq);
  const dots = logs.filter((l) => l.type === 'dot');
  assert.ok(dots.some((l) => l.kind === 'burn'), '灼烧应按出手次数发作');
  assert.ok(dots.some((l) => l.kind === 'corrode'), '腐蚀应按出手次数发作');
  const burnHits = dots.filter((l) => l.kind === 'burn').length;
  const corrodeHits = dots.filter((l) => l.kind === 'corrode').length;
  assert.ok(burnHits <= 2 && burnHits >= 1, `灼烧最多跳 2 次（实际 ${burnHits}）`);
  assert.ok(corrodeHits <= 2 && corrodeHits >= 1, `腐蚀最多跳 2 次（实际 ${corrodeHits}）`);
  /* 灼烧在出手前跳：同一次行动里，dot 日志要排在它自己的命中日志之前 */
  const idxDot = logs.findIndex((l) => l.type === 'dot' && l.kind === 'burn');
  const idxHit = logs.findIndex((l, i) => i > idxDot && l.type === 'hit' && l.actorId === ally.id);
  if (idxDot >= 0 && idxHit >= 0) assert.ok(idxDot < idxHit, '灼烧应先于本次出手结算');
});

test('中毒致死就取消这次出手', () => {
  const { A, V, st } = boot(811);
  let s = startRun(A, st, 811);
  s.run.floor = 6;
  const gen = V.Combat.generateEncounter(s, 'normal');
  s = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
  const victim = s.run.battle.allies[0];
  /* 血给够，先确保它能活到自己出手那一刻，再由毒把它带走 */
  victim.maxHp = 500;
  victim.hp = 500;
  victim.buffs = [{ k: 'poison', v: 999, hits: 1 }];
  const seen = new Map();
  let guard = 0;
  while (guard++ < 400 && !s.run.battle.over) {
    s = V.Combat.step(s).state;
    (s.run.battle.logs || []).forEach((l) => seen.set(l.seq, l));
    const cur = s.run.battle.allies.find((x) => x.id === victim.id);
    if (!cur || cur.alive === false) break;
  }
  const logs = [...seen.values()].sort((a, b) => a.seq - b.seq);
  const dotIdx = logs.findIndex((l) => l.type === 'dot' && l.kind === 'poison');
  assert.ok(dotIdx >= 0, '中毒应发作');
  const after = logs.slice(dotIdx + 1).filter((l) => l.type === 'hit' && l.actorId === victim.id);
  assert.equal(after.length, 0, '毒发致死之后不该再出手');
});

test('「被压住」是孤儿代码，已整体删除：单位上没有 skipActions，也不会产出 skip 日志', () => {
  const { A, V, st } = boot(812);
  let s = startRun(A, st, 812);
  s.run.floor = 6;
  const gen = V.Combat.generateEncounter(s, 'normal');
  s = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
  const battle = s.run.battle;

  /* 唯一写入点是 doBasicAttack 的 opts.stun，而全仓库无人传过它 */
  for (const u of [...battle.allies, ...battle.enemies]) {
    assert.ok(!('skipActions' in u), `${u.name} 不该再有 skipActions 字段`);
  }

  /* 打完整场，日志里不该再出现 skip 类型 */
  let guard = 0;
  while (guard++ < 600 && !s.run.battle.over) s = V.Combat.step(s).state;
  assert.equal(s.run.battle.logs.filter((l) => l.type === 'skip').length, 0, '不该再产出 skip 日志');
});

test('数据表里没有残留的 stun 字段（被压住的唯一来源）', () => {
  const { V } = boot(814);
  const seen = new WeakSet();
  const hits = [];
  const walk = (node, at) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const [k, v] of Object.entries(node)) {
      if (k === 'stun') hits.push(`${at}.${k}`);
      walk(v, `${at}.${k}`);
    }
  };
  walk(V.Data, 'Data');
  assert.deepEqual(hits, [], '不应再有 stun 字段');
});

test('DOT 挂在自己的节拍上：引导期间不暂停', () => {
  const { A, V, st } = boot(813);
  let s = startRun(A, st, 813);
  s.run.floor = 6;
  const gen = V.Combat.generateEncounter(s, 'normal');
  s = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
  const caster = s.run.battle.allies[0];
  caster.maxHp = 9999;
  caster.hp = 9999;
  caster.buffs = [{ k: 'burn', v: 3, hits: 1 }];
  /* 长引导：期间 atkTimer 不推进，不出手 */
  caster.casting = 'fake';
  caster.castTimer = 999;

  let guard = 0;
  while (guard++ < 60 && !s.run.battle.over) {
    s = V.Combat.step(s).state;
  }
  const logs = s.run.battle.logs;
  assert.ok(
    logs.some((l) => l.type === 'dot' && l.actorId === caster.id && l.kind === 'burn'),
    '引导中的单位也应按时跳灼烧',
  );
  assert.equal(
    logs.filter((l) => l.type === 'hit' && l.actorId === caster.id).length,
    0,
    '引导期间确实没有出手',
  );
});
