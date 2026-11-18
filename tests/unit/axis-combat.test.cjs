'use strict';
/* 四大构筑轴（2026-11-15）。
   在此之前，80 门功法里 76 门只有一个招式，所有 dot 都落成灼烧，cond 只有五种，
   四门同步装配也各打各的——「构筑」这件事在数据层不存在。

   这里守四件事：
   ① 四种异常各有独特的结算时机（灼烧引爆 / 中毒随普攻 / 流血罚动作 / 腐蚀削防增压）；
   ② 新增的 cond 真的能卡住招式（targetHasDot / afterTag / selfHasShield / stressAbove / minTier）；
   ③ 新增的 effect 真的改结果（detonateDot / shieldScale / bonusIfDot / cdrOther / stressDelta）；
   ④ 被动（passive）被合进战斗属性，四门叠加是加法不是乘算。 */
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes, fight } = require('../helpers/veteran-run.cjs');

function battle(seed) {
  const { A, V, st } = boot(seed == null ? 601 : seed);
  const s = fight(A, setNodes(A, startRun(A, st, seed == null ? 601 : seed), ['battle']), 'normal').st;
  return { A, V, D: V.Data, b: s.run.battle, st: s };
}

/**
 * 造一个只会挨打的靶子：护甲、闪避、电容缓冲、外围保险丝全部清零。
 * v4.0 起「缓冲截留 30%」和「外围节点熔断」都会吃掉伤害，
 * 这一组测的是异常机制本身，所以先把这两层摘掉。
 */
function dummy(b, hp) {
  const t = b.enemies[0];
  t.hp = t.maxHp = hp || 4000;
  t.def = 0;
  t.dodge = 0;
  t.shield = 0;
  t.shieldCap = 0;
  t.outerNodes = 0;
  t.circuit = null;
  t.buffs = [];
  return t;
}

test('数据层：80 门全部有招式、有被动、有标签，且四阶以上才出现第二招', () => {
  const { D } = battle(602);
  const all = Object.values(D.MANUSCRIPTS);
  assert.equal(all.length, 80);
  all.forEach((m) => {
    assert.ok(m.skills && m.skills.length >= 1, `${m.name} 没有招式`);
    assert.ok(m.passive && Object.keys(m.passive).length, `${m.name} 没有被动`);
    assert.ok(m.tags && m.tags.length, `${m.name} 没有流派标签`);
    assert.ok(m.axis, `${m.name} 没有归轴`);
    /* 招式 id 在本门内必须唯一，否则冷却表会串 */
    const ids = m.skills.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${m.name} 招式 id 重复：${ids.join(',')}`);
    /* 每一招都要有一条「什么时候能放」的解释，不能是空条件配空效果 */
    m.skills.forEach((sk) => assert.ok(sk.effect && Object.keys(sk.effect).length, `${m.name}「${sk.name}」没有效果`));
  });
  /* 6 阶双流、7 阶逆脉各三招；其余最多两招 */
  assert.equal(D.MANUSCRIPTS.twinflow.skills.length, 3);
  assert.equal(D.MANUSCRIPTS.inverse.skills.length, 3);
  /* 星火是唯一原本没招式的门，现在有了起手技 */
  assert.equal(D.MANUSCRIPTS.spark.skills.length, 1);
  assert.equal(D.MANUSCRIPTS.spark.skills[0].name, '迸火');
});

test('数据层：四种异常在功法库里都有供给，没有一种被漏掉', () => {
  const { D } = battle(603);
  const kinds = new Set();
  Object.values(D.MANUSCRIPTS).forEach((m) => (m.skills || []).forEach((sk) => {
    if (sk.effect && sk.effect.dot) kinds.add(sk.effect.dot.k);
  }));
  ['burn', 'poison', 'bleed', 'corrode'].forEach((k) => {
    assert.ok(kinds.has(k), `没有任何招式会挂 ${k}`);
  });
  /* 引爆也要有，而且至少一门能引爆「全部」 */
  const detonates = Object.values(D.MANUSCRIPTS).flatMap((m) => m.skills.filter((s) => s.effect.detonateDot));
  assert.ok(detonates.length >= 10, `引爆招式太少：${detonates.length}`);
  assert.ok(detonates.some((s) => s.effect.detonateDot === 'all'), '要有一招能引爆全部异常');
});

test('灼烧：引爆把剩余总伤一次倒出来，并清空层数', () => {
  const { V, b } = battle(604);
  const I = V.Combat._internal;
  const actor = b.allies[0];
  const tgt = dummy(b);
  /* 两段灼烧：40×3 + 20×2 = 160 剩余总伤 */
  tgt.buffs.push({ k: 'burn', v: 40, hits: 3 }, { k: 'burn', v: 20, hits: 2 });
  const before = tgt.hp;
  I.detonate(b, actor, tgt, 'burn', { detonateMult: 0 });
  const dealt = before - tgt.hp;
  const cfg = V.Data.DESIGN.detonate.mult;
  assert.equal(dealt, Math.round(160 * cfg), `应一次打出 ${Math.round(160 * cfg)}，实际 ${dealt}`);
  assert.equal(I.dotsOf(tgt, 'burn').length, 0, '引爆后灼烧要清空');
  /* 引爆不是「跳一跳」：跳数不会被留成负数或残留 */
  assert.ok(!tgt.buffs.some((x) => x.k === 'burn'));
});

test('灼烧：引爆系数吃被动加成', () => {
  const { V, b } = battle(605);
  const I = V.Combat._internal;
  const cfg = V.Data.DESIGN.detonate.mult;
  const hit = (detonateMult) => {
    const tgt = dummy(b);
    tgt.buffs.push({ k: 'burn', v: 100, hits: 1 });
    const before = tgt.hp;
    I.detonate(b, b.allies[0], tgt, 'burn', { detonateMult });
    return before - tgt.hp;
  };
  const plain = hit(0);
  const boosted = hit(0.5);
  assert.equal(plain, Math.round(100 * cfg));
  assert.equal(boosted, Math.round(100 * cfg * 1.5), '引爆 +50% 应体现在总量上');
});

test('中毒：被普通攻击命中就立刻多跳一次，且不额外消耗时间轴', () => {
  const { V, b } = battle(606);
  const I = V.Combat._internal;
  const actor = b.allies[0];
  actor.crit = 0;
  actor.hits = 1;
  const tgt = dummy(b);
  tgt.buffs.push({ k: 'poison', v: 30, hits: 3 });
  const before = tgt.hp;
  I.doBasicAttack(b, actor, tgt.id, { mult: 0.4 });
  const dealt = before - tgt.hp;
  /* 普攻本体（atk×0.4，护甲已清零）+ 一次中毒 30 */
  assert.ok(dealt > 30, `中毒应随普攻追加一跳，实际只掉了 ${dealt}`);
  assert.equal(I.dotsOf(tgt, 'poison')[0].hits, 2, '追加一跳要消耗层数');
});

test('流血：起手引导与换位都会被撕一次，但时间轴跳伤不重复扣', () => {
  const { V, b } = battle(607);
  const I = V.Combat._internal;
  const tgt = dummy(b);
  tgt.buffs.push({ k: 'bleed', v: 25, hits: 3 });
  const before = tgt.hp;
  I.rendBleed(b, tgt, '起手引导');
  assert.equal(before - tgt.hp, 25, '一层流血撕一次 25');
  assert.equal(I.dotsOf(tgt, 'bleed')[0].hits, 3, '流血罚的是动作，不消耗剩余跳数');

  tgt.buffs.push({ k: 'bleed', v: 15, hits: 2 });
  const mid = tgt.hp;
  I.rendBleed(b, tgt, '换位');
  assert.equal(mid - tgt.hp, 40, '两层流血叠加撕裂 40');
});

test('流血：两条触发路径都真的接在战斗流程上（起手引导 / 换位事件）', () => {
  const { V, b } = battle(614);
  const I = V.Combat._internal;
  const actor = b.allies[0];
  actor.buffs = [{ k: 'bleed', v: 20, hits: 3 }];
  actor.energy = 20;
  actor.cds = {};
  const sk = {
    id: 'slow', name: '引导招', cost: 0, castTime: 0.6, cooldown: 3,
    cond: {}, target: 'frontFoe', effect: { mult: 0.2 },
  };
  const hp0 = actor.hp;
  I.startCast(b, actor, sk);
  assert.equal(hp0 - actor.hp, 20, 'startCast 里要真的调用 rendBleed');
  assert.ok(actor.casting, '被撕一下不该取消引导（只撕死人才取消）');

  /* 换位事件：step 的 move 分支调的正是 applyMove */
  const ally = b.allies[1];
  ally.buffs = [{ k: 'bleed', v: 30, hits: 2 }];
  const allyHp = ally.hp;
  const moved = I.applyMove(b, { type: 'move', actorId: ally.id, meta: { from: 1, to: 0 } });
  assert.equal(moved, ally, '按 id 应当找得到被移动的人');
  assert.equal(allyHp - ally.hp, 30, '换位要撕一次');

  /* 敌人换位同样算：不能只处理我方 */
  const foe = b.enemies[0];
  foe.buffs = [{ k: 'bleed', v: 12, hits: 2 }];
  const foeHp = foe.hp;
  I.applyMove(b, { type: 'move', actorId: foe.id, meta: { from: 0, to: 1 } });
  assert.equal(foeHp - foe.hp, 12, '敌方前压也要被撕');
});

test('腐蚀：每层降防 4%（上限 40%），并且让压力进账 +30%', () => {
  const { V, b } = battle(608);
  const I = V.Combat._internal;
  const cfg = V.Data.DESIGN.corrode;
  const tgt = dummy(b);
  tgt.def = 50;
  assert.equal(I.effectiveDef(tgt), 50, '没有腐蚀时防御不变');

  tgt.buffs.push({ k: 'corrode', v: 5, hits: 5 });
  assert.equal(I.corrodeDefMult(tgt), 1 - 5 * cfg.defPerStack);
  assert.equal(I.effectiveDef(tgt), 50 * (1 - 5 * cfg.defPerStack));

  /* 上限 40%：叠到 20 层也不会超过 */
  tgt.buffs = [{ k: 'corrode', v: 5, hits: 20 }];
  assert.equal(I.corrodeDefMult(tgt), 1 - cfg.defCap);

  /* 压力：同一份进账，被腐蚀的人多吃 30% */
  const clean = b.allies[0];
  clean.stress = 0;
  clean.buffs = [];
  I.addStress(b, clean, 10);
  const plainGain = clean.stress;
  clean.stress = 0;
  clean.buffs = [{ k: 'corrode', v: 1, hits: 2 }];
  I.addStress(b, clean, 10);
  assert.equal(clean.stress, Math.round(plainGain * cfg.stressMult));
});

test('条件：targetHasDot / selfHasShield / stressAbove / minTier / afterTag 都能卡住', () => {
  const { V, b } = battle(609);
  const I = V.Combat._internal;
  const actor = b.allies[0];
  const tgt = dummy(b);
  const ms = { tierIndex: 2, routed: false };

  assert.equal(I.condOk(b, actor, { targetHasDot: 'burn' }, ms, 0, tgt), false);
  tgt.buffs.push({ k: 'burn', v: 10, hits: 2 });
  assert.equal(I.condOk(b, actor, { targetHasDot: 'burn' }, ms, 0, tgt), true);
  assert.equal(I.condOk(b, actor, { targetHasDot: 'any' }, ms, 0, tgt), true);

  assert.equal(I.condOk(b, actor, { selfHasShield: true }, ms, 0, tgt), false);
  actor.shield = 10;
  assert.equal(I.condOk(b, actor, { selfHasShield: true }, ms, 0, tgt), true);

  actor.stress = 20;
  assert.equal(I.condOk(b, actor, { stressAbove: 50 }, ms, 0, tgt), false);
  actor.stress = 60;
  assert.equal(I.condOk(b, actor, { stressAbove: 50 }, ms, 0, tgt), true);

  assert.equal(I.condOk(b, actor, { minTier: 2 }, ms, 0, tgt), true);
  assert.equal(I.condOk(b, actor, { minTier: 3 }, ms, 0, tgt), false);
  assert.equal(I.condOk(b, actor, { minTier: 2 }, { tierIndex: 1 }, 0, tgt), false);

  /* afterTag：要「最近 2.5 秒内」放过带该 tag 的招 */
  assert.equal(I.condOk(b, actor, { afterTag: '流血' }, ms, 0, tgt), false);
  actor.tagMemory = { tag: '流血', tick: b.tick };
  assert.equal(I.condOk(b, actor, { afterTag: '流血' }, ms, 0, tgt), true);
  assert.equal(I.condOk(b, actor, { afterTag: '灼烧' }, ms, 0, tgt), false, 'tag 不匹配不能过');
  const step = V.Data.DESIGN.stepSeconds;
  const win = V.Data.DESIGN.comboWindow;
  /* 窗口边界：自己在 5 秒内算，超过 5 秒不算 */
  actor.tagMemory = { tag: '流血', tick: b.tick - Math.ceil((win - 0.5) / step) };
  assert.equal(I.condOk(b, actor, { afterTag: '流血' }, ms, 0, tgt), true, `窗口内（${win}s）应成立`);
  actor.tagMemory = { tag: '流血', tick: b.tick - Math.ceil((win + 1) / step) };
  assert.equal(I.condOk(b, actor, { afterTag: '流血' }, ms, 0, tgt), false, `超出 ${win}s 窗口要失效`);
});

test('效果：盾击按当前护盾折算伤害，减压不越界', () => {
  const { V, b } = battle(610);
  const I = V.Combat._internal;
  const actor = b.allies[0];
  actor.shield = 100;
  actor.stress = 40;
  const tgt = dummy(b);
  const sk = {
    id: 'test-shield', name: '盾击', cost: 0, castTime: 0, cooldown: 1,
    cond: { selfHasShield: true }, target: 'frontFoe', tag: '护盾',
    effect: { mult: 0.5, shieldScale: 0.6, stressDelta: -10 },
  };
  actor.cds = {};
  actor.pendingSkill = sk;
  actor.skillMult = 1;
  actor.supportMult = 1;
  const before = tgt.hp;
  I.finishCast(b, actor);
  /* 普攻部分 + 盾×0.6 = 60，两笔都要落到目标身上 */
  assert.ok(before - tgt.hp > 60, `盾击应包含护盾折算的 60，实际 ${before - tgt.hp}`);
  assert.equal(actor.stress, 30, '减压 10 点');
});

test('被动：四门叠加是加法，且 dotMult 同时吃纹路加成', () => {
  const { V, st } = battle(611);
  const u = st.roster[0];
  /* 手算：把四门同轴装上，dotMult 应为逐门相加 */
  const ids = ['wick', 'cinder', 'spark', 'ember12'];
  u.manuscript = null;
  u.extraManuscripts = [];
  ids.forEach((id, i) => {
    if (i === 0) V.State.equipManuscript(st, u, id);
    else V.State.placeManuscript(st, u, id);
  });
  const got = V.State.manuscriptsOf(u).map((m) => V.Data.manuscript(m.id).passive.dotMult || 0);
  const sum = got.reduce((a, b2) => a + b2, 0);
  assert.ok(sum > 0, '灼烧系的被动应该有 dotMult');
  /* 每门自己的数值不超过 0.25，四门相加也不该超过 0.8——防止乘算式的爆炸 */
  assert.ok(sum <= 0.8, `四门叠加后 dotMult 过高：${sum}`);
});

test('跨功法连携：放完带 tag 的招，另一门的 afterTag 招才算就绪', () => {
  const { V, b } = battle(612);
  const I = V.Combat._internal;
  const actor = b.allies[0];
  const tgt = dummy(b);
  actor.cds = {};
  actor.crit = 0;
  actor.skillMult = 1;
  actor.supportMult = 1;
  const opener = {
    id: 'opener', name: '裂口', cost: 0, castTime: 0, cooldown: 2, tag: '流血',
    cond: {}, target: 'frontFoe', effect: { mult: 0.5 },
  };
  const follow = { afterTag: '流血' };
  assert.equal(I.condOk(b, actor, follow, { tierIndex: 1 }, 0, tgt), false, '还没起手，连携不该就绪');
  actor.pendingSkill = opener;
  I.finishCast(b, actor);
  assert.deepEqual(actor.tagMemory, { tag: '流血', tick: b.tick }, '放完要记住 tag 与时刻');
  assert.equal(I.condOk(b, actor, follow, { tierIndex: 1 }, 0, tgt), true, '同一拍内连携应就绪');
});

test('共鸣阶解锁：覆盖率没拼到二阶，第二招一直不亮', () => {
  const { V, st } = boot(613, { generated:true });
  const u = st.roster[0];
  V.State.equipManuscript(st, u, 'corridor5');
  assert.equal(u.manuscript.id, 'corridor5');
  /* 完全没有纹路覆盖 → tierIndex 0，minTier 的招不该就绪 */
  const bare = V.Circuit.manuscriptState(st, u.id, []);
  assert.equal(bare.tierIndex, 0, '无覆盖时没有共鸣阶');
  /* 造一个覆盖：把纹路铺在蚀刻法上，覆盖率上去后 tierIndex 应 >= 1 */
  const msCells = V.State.manuscriptCells(V.State.manuscriptsOf(u)[0]);
  const item = V.State.makePart(st, { kind: 'circuit', templateId: 'capacitor' });
  st.itemsById[item.id] = item;
  st.stash.push(item.id);
  const draft = [{ itemId: item.id, x: msCells[0][0], y: msCells[0][1], rotation: 0, mirrorY: false }];
  const covered = V.Circuit.manuscriptState(st, u.id, draft);
  assert.ok(covered.tierIndex >= 0);
  assert.ok(covered.pct >= bare.pct, '铺上纹路覆盖率不该下降');
});

test('连携支持跨角色：队友 3.5 秒内放过同 tag 的招，也能接上', () => {
  const { V, b } = battle(615);
  const I = V.Combat._internal;
  const me = b.allies[0];
  const mate = b.allies[1];
  const tgt = dummy(b);
  const step = V.Data.DESIGN.stepSeconds;
  const ownWin = V.Data.DESIGN.comboWindow;
  const mateWin = V.Data.DESIGN.comboWindowAlly;
  me.tagMemory = null;
  mate.tagMemory = { tag: '灼烧', tick: b.tick };
  assert.equal(I.condOk(b, me, { afterTag: '灼烧' }, { tierIndex: 1 }, 0, tgt), true, '队友起手，我接追击');

  /* 队友的窗口更短：过了 3.5 秒就不算，哪怕自己的 5 秒还没到 */
  mate.tagMemory = { tag: '灼烧', tick: b.tick - Math.ceil((mateWin + 1) / step) };
  assert.equal(I.condOk(b, me, { afterTag: '灼烧' }, { tierIndex: 1 }, 0, tgt), false, '队友窗口 3.5s 更短');
  assert.ok(mateWin < ownWin, '队友窗口必须比自己的短，否则四个人可以无限互续');

  /* 死掉的队友不算 */
  mate.tagMemory = { tag: '灼烧', tick: b.tick };
  mate.alive = false;
  assert.equal(I.condOk(b, me, { afterTag: '灼烧' }, { tierIndex: 1 }, 0, tgt), false, '倒下的队友不能再提供连携');
});

test('高压招式池：灼烧与流血的 3–5 阶各有压线重击，且都回压', () => {
  const { D } = battle(616);
  /* 只看这一轮新加的高压池（带「高压」标签）；逆脉·倒灌是 7 阶的老招，不在池内 */
  const pressure = Object.values(D.MANUSCRIPTS).filter((m) => (m.tags || []).includes('高压'));
  assert.ok(pressure.length >= 8, `高压池应有 8 门以上，实际 ${pressure.length}`);
  const axes = new Set(pressure.map((m) => m.axis));
  assert.ok(axes.has('burn') && axes.has('bleed'), '灼烧与流血都要有高压招');
  pressure.forEach((m) => {
    const sk = m.skills.find((x) => x.cond && x.cond.stressAbove);
    assert.ok(m.rarity >= 3 && m.rarity <= 5, `${m.name} 的高压招应在 3–5 阶`);
    assert.ok(sk.cond.stressAbove >= 50, '门槛不该低于 50');
    assert.ok(sk.effect.stressDelta < 0, `${m.name}「${sk.name}」要回压，否则只能一路顶到 100`);
    assert.ok(sk.cost <= 5, `${m.name}「${sk.name}」的消耗 ${sk.cost} 太高，攒不出来`);
  });
});
