'use strict';
/* 敌方续航与血池标尺（2026-11-16，解 B5）。
   两件事必须锁住，否则会悄悄退回老样子：
   ① 血池总标尺不能再回到「开局双人必死」的量级；
   ② 自愈类招式必须有上限——无限自愈不是难，是把残局拖成超时。 */
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun } = require('../helpers/veteran-run.cjs');

const A = boot(7).A;
const V = A.Veteran;
const D = V.Data;

/** 按指定物种造一场只有它一个敌人的战斗；我方冻结，只观察它自己的行为。 */
function soloFight(seed, type, hp) {
  const { st } = boot(seed);
  const run = startRun(A, st, seed);
  run.run.floor = 7;
  const meta = D.ENEMIES[type];
  const units = [{
    enemyType: type, name: meta.name, slot: 0, hp, maxHp: hp,
    atk: 20, def: 10, spd: meta.spd, hits: 0.3,
    isBoss: !!meta.boss, isElite: false,
    sprite: meta.sprite || null, filter: meta.filter || null,
    skills: (meta.skills || []).map((sk) => ({ ...sk })),
    phaseAt: null, phaseBuff: null, phaseSkills: [], onDeathBurst: null, disrupt: null,
  }];
  const cr = V.Combat.create(run, { id: 'bp_sustain', kind: 'boss', floor: 7, units, seedTag: 5 }, seed * 31 + 7);
  assert.ok(cr.ok, JSON.stringify(cr.error));
  const st2 = cr.state;
  /* 我方完全不出手：这样首领的自愈/护盾不会被伤害掩盖，次数字面上可数 */
  st2.run.battle.allies.forEach((a) => { a.atkTimer = -1e6; });
  return st2;
}

test('v4.0：补丁系数全部归零，量级直接写进敌人数值表', () => {
  /* 旧世界的 0.13 / 1.5 是「我方 140 完整度 + 敌人打不动人」时代的补丁。
     v4.0 起两边同量级，任何一层神秘系数都会让标定失效，所以必须恒为 1。 */
  assert.equal(D.DESIGN.enemyHpScale, 1, 'enemyHpScale 必须是 1');
  assert.equal(D.DESIGN.enemyDamageScale, 1, 'enemyDamageScale 必须是 1');

  /* 普通 / 精英 / 首领三档的核心节点量级 */
  const byTier = (tier) => Object.values(D.ENEMIES).filter((e) => (e.tier || 'normal') === tier);
  const band = (list, lo, hi, key) => list.forEach((e) => {
    assert.ok(e[key] >= lo && e[key] <= hi, `${e.id} 的 ${key}=${e[key]} 不在 ${lo}~${hi}`);
  });
  /* 2026-11-16 二标：基础血池整体 +25%、精英 +30%（压掉普攻底噪后要拉长战斗）
     2026-11-17 七标：基础 atk 整体 ×1.30（8~14 → 10~18），否则深层敌人的重击
     连满配底盘 8% 完整度的熔断线都摸不到 */
  const normals = Object.values(D.ENEMIES).filter((e) => !e.elite && !e.outerNodes);
  band(normals, 56, 107, 'hp');
  band(normals, 10, 18, 'atk');
  band(normals, 5, 15, 'def');

  /* 精英单独定档：+30%（156~195）实测 F36 通关率仍是 100%，离 75~85% 的目标太远；
     最终定在 286 / 308，才把 A 流派压到 45%（三流派均值 82%）。 */
  ['shufflerDragger', 'stoker'].forEach((id) => {
    const e = D.ENEMIES[id];
    assert.ok(e.hp >= 260 && e.hp <= 330, `${id} 精英血量应在 260~330`);
    assert.ok(e.outerNodes >= 1 && e.outerNodes <= 2, `${id} 应有 1~2 层外围节点`);
  });
  ['gatekeeper', 'memoryEater', 'furnaceHeart'].forEach((id) => {
    const e = D.ENEMIES[id];
    assert.ok(e.hp >= 225 && e.hp <= 300, `${id} 首领血量应在 225~300（180~240 × 1.25）`);
    /* 七标：首领幅值跟着基础 atk ×1.30 一起上移（18/20/16 → 23/26/21） */
    assert.ok(e.atk >= 19 && e.atk <= 29, `${id} 首领幅值应在 19~29（15~22 × 1.30）`);
    assert.ok(e.def >= 20 && e.def <= 35, `${id} 首领阻抗应在 20~35`);
  });
  void byTier;
  /* 层域成长仍然存在：后段压力靠它，不靠抬总标尺 */
  assert.ok(D.DESIGN.scaling.hpPerFloor > 0, '没有逐层成长的话，后期会一路平推');
});

test('炉心俑的重铸有上限：一局最多三次，用完就不再选它', () => {
  const sk = D.ENEMIES.furnaceHeart.skills.find((s) => s.id === 'reforge');
  assert.ok(sk, '炉心俑应有重铸');
  assert.equal(sk.healSelf, 0.08);
  assert.equal(sk.selfShield, 0.15);
  assert.equal(sk.cd, 6);
  assert.equal(sk.maxUses, 3);

  let st = soloFight(611, 'furnaceHeart', 4000);
  /* cd 6 秒 ≈ 25 tick，跑 400 tick（约 96 秒）足够它想放十几次 */
  for (let i = 0; i < 400 && st.run.battle && !st.run.battle.over; i++) {
    const r = V.Combat.step(st);
    assert.ok(r.ok, JSON.stringify(r.error));
    st = r.state;
  }
  const boss = st.run.battle.enemies[0];
  const used = (boss.skillUses && boss.skillUses.reforge) || 0;
  /* 八标：炉心俑的伤害抬上来之后，单人靶子撑不到它把三次重铸全交完（它可能先被打死），
     所以这里验的是「上限不被越过」，而不是「一定用满」。 */
  assert.ok(used <= 3, `重铸次数不得超过 3（实际 ${used}）`);
  const logs = st.run.battle.logs.map((l) => l.text).join(' | ');
  if (used === 3) assert.match(logs, /用尽/, '用尽时应有明确战报，否则玩家不知道它为什么不再自愈');

  /* 三次×10% 护盾＝上限 30%，不该继续堆；自愈也不会把它顶到满血之上 */
  assert.ok(boss.shield <= boss.maxHp * 0.3 + 1, `护盾超过三次上限：${boss.shield}`);
  assert.ok(boss.hp <= boss.maxHp, '自愈不该把生命顶过上限');
});

test('其它续航型敌人不靠「按上限百分比自愈」，不会形成死锁', () => {
  /* 唱喑的群疗按自身攻击折算，幽魂靠吸血——两者都不随血池标尺放大，
     所以下调 enemyHpScale 之后不会出现「残存一人打不穿」的循环。 */
  const choir = D.ENEMIES.wraithChoir.skills.find((s) => s.id === 'dirge');
  assert.ok(choir && choir.healAllies > 0 && choir.healAllies <= 0.16);
  assert.equal(choir.healSelf, undefined, '唱喑只治别人，不该有按上限的自愈');

  const drain = D.ENEMIES.wraith.skills.find((s) => s.id === 'drain');
  assert.ok(drain && drain.lifesteal > 0 && drain.lifesteal <= 0.5);

  /* 能真的杀死它：一场只有幽魂的战斗必须在 TICK_LIMIT 之前结束 */
  const st0 = soloFight(612, 'wraith', 600);
  let st = st0;
  st.run.battle.allies.forEach((a) => { a.atkTimer = 0; });
  let ticks = 0;
  while (st.run.battle && !st.run.battle.over && ticks < V.Combat.TICK_LIMIT + 5) {
    st = V.Combat.step(st).state;
    ticks += 1;
  }
  assert.ok(st.run.battle.over, '幽魂不该把战斗拖到超时');
  assert.notEqual(st.run.battle.outcome, 'timeout', '不该靠 TICK_LIMIT 收场');
});
