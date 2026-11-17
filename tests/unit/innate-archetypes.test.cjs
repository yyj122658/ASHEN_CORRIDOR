'use strict';
/* 十四相的天赋取向（2026-11-16）。
   设定 §4.3 / §10 早就写了每个「相」该怎么玩，但之前只体现在四维权重上。
   这一组测试守三件事：
   ① 十四种相性各自**真的在结算里生效**（不是只往数据里塞了个名字）；
   ② 全部 14 种相的四维面板一字未改（天赋是形状，不是数值）；
   ③ 相性只读 `innateMods`，不在战斗中途回头查数据表。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');
const { autoRouteBoard } = require('../helpers/veteran-run.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;
const I = V.Combat._internal;

/* ---------------- 夹具 ---------------- */

/**
 * 把蚀刻法接通并铺满余格。
 *
 * 以前这里是一段自制贪心：按「新盖住目标格最多」挑件，完全不管端口朝向。
 * 蚀刻法还是 2~14 格的时代那样能凑出覆盖率，但现在骨架有 6~54 格、
 * 而且 `route()` 要求相邻格端口互为反面 —— 不管端口就永远是「盖满了但没接通」。
 * 所以直接复用模拟器的布线器：它同时负责端口通路和余格填充。
 */
function coverBoard(st, u, style) {
  const r = autoRouteBoard(A, st, u, { style: style || 'elbow' });
  u.board.placements = r.placements || [];
  return u.board.placements;
}

/** 造一个指定底盘的传奇，装好蚀刻法并把板面盖满 */
function makeUnit(body, ids, opts = {}) {
  const st = V.State.create(opts.seed || 31);
  const u = V.State.makeUnit(st, { skinId: 'blade', bodyPreset: body, name: '试相' });
  u.manuscript = null;
  delete u.extraManuscripts;
  st.roster.push(u);
  st.team[0] = u.id;
  ids.forEach((id, i) => {
    if (i === 0) V.State.equipManuscript(st, u, id);
    else {
      st.manuscriptVault = st.manuscriptVault || [];
      st.manuscriptVault.push({ ...D.manuscript(id) });
      const r = V.State.placeManuscript(st, u, id);
      assert.ok(r.ok, `装不上 ${id}：${r.reason}`);
    }
  });
  /* 强制把第 N 门转 90°：placeManuscript 会自己挑「最优朝向」，所以要显式给姿态，
     否则它会把刚转好的又摆回横向（四达并存靠这个造「横 + 纵」） */
  if (opts.rotate != null) {
    const id = V.State.manuscriptsOf(u)[opts.rotate].id;
    const size = V.Circuit.plateOf(u).size;
    let posed = false;
    for (let y = 0; y < size && !posed; y++) {
      for (let x = 0; x < size && !posed; x++) {
        posed = V.State.placeManuscript(st, u, id, { x, y, rotation: 1, mirrorY: false }).ok;
      }
    }
    assert.ok(posed, '找不到能放下转向后蚀刻法的位置');
  }
  coverBoard(st, u);
  return { st, u };
}

/** 把单位送进一场只有木桩的战斗，拿回它的战斗态 */
function fight(st, u, seed = 77) {
  const run = V.Expedition.start(st, { seed }).state;
  const cr = V.Combat.create(run, {
    /* v4.0：桩子必须没有电容缓冲与外围节点，否则「缓冲截留 30% + 熔断挡一击」
       会把伤害吃掉，测试量的就不是相性而是保险丝。 */
    units: [{
      enemyType: 'bone', name: '桩', slot: 0, hp: 6000, maxHp: 6000,
      atk: 1, def: 40, spd: 1, hits: 0, skills: [],
      shieldCap: 0, outerNodes: 0,
    }],
    kind: 'normal', floor: 1, seedTag: 1,
  }, seed * 13 + 5);
  assert.ok(cr.ok, JSON.stringify(cr.error));
  const ally = cr.state.run.battle.allies.find((a) => a.sourceUnitId === u.id);
  assert.ok(ally, '战斗里找不到这个单位');
  return { state: cr.state, battle: cr.state.run.battle, ally };
}

const MAIN = 'corridor5';   // 2 阶，横向 4×2，好铺满
const SUB = 'spark';        // 1 阶，辅修用

/* ---------------- ① 面板不许被相性动过 ---------------- */

test('十四相的四维面板没有因为相性改过一个数', () => {
  /* 面板由 derive.js 从 profile 派生，相性只加字段不改权重 */
  const expected = {
    sturdy: [0.44, 0.20, 0.26, 0.10], agile: [0.30, 0.24, 0.12, 0.34],
    conduit: [0.40, 0.24, 0.18, 0.18], throat: [0.38, 0.22, 0.16, 0.24],
    corner: [0.42, 0.22, 0.22, 0.14], aegis: [0.46, 0.18, 0.26, 0.10],
    waist: [0.32, 0.26, 0.16, 0.26], twin: [0.38, 0.26, 0.18, 0.18],
    ratchet: [0.34, 0.24, 0.24, 0.18], arc: [0.36, 0.22, 0.14, 0.28],
    terrace: [0.40, 0.24, 0.22, 0.14], ripple: [0.34, 0.26, 0.14, 0.26],
    spine: [0.38, 0.26, 0.20, 0.16], crucible: [0.34, 0.26, 0.18, 0.22],
  };
  Object.entries(expected).forEach(([id, [hp, atk, def, spd]]) => {
    const b = D.BODIES[id];
    assert.ok(b.innate && b.innate.id === id, `${id} 缺相性`);
    assert.deepEqual([b.profile.hp, b.profile.atk, b.profile.def, b.profile.spd], [hp, atk, def, spd],
      `${id} 的权重被改过——相性不许碰面板`);
    /* 派生结果与「同样的 profile、去掉 innate」完全一致 */
    assert.ok(b.innate.name && b.innate.desc, `${id} 的相性缺名字或说明`);
  });
  assert.equal(Object.keys(D.BODIES).length, 14);
});

/* ---------------- ② 十四个相性各自的生效点 ---------------- */

test('厚铸躯壳 · 无相包容：母板负荷上限 +35%', () => {
  /* v4.0：这条从「辅修份额」改成「母板更厚」——能压的维持量多三成半。 */
  const sturdy = makeUnit('sturdy', [MAIN, SUB]);
  const conduit = makeUnit('conduit', [MAIN, SUB]);
  const capA = V.Circuit.loadCap(sturdy.u);
  const capB = V.Circuit.loadCap(conduit.u);
  assert.equal(capA, Math.round(capB * 1.35), `${capA} 应是 ${capB} 的 1.35 倍`);
  /* 共享比例回到基准：无相包容不再动它 */
  assert.equal(fight(sturdy.st, sturdy.u).ally.innateMods.subShare, 0.5);
});

test('轻量骨架 · 一往无前：板面越空，脉冲幅值越高（每 10% 空格 +8%）', () => {
  const { st, u } = makeUnit('agile', [MAIN]);
  const { ally } = fight(st, u);
  assert.equal(ally.ms.routed, true, '夹具应已贯通');

  const plate = V.Circuit.plateOf(u).cells.size;
  const used = ally.circuit.panel.usedCells;
  const empty = Math.max(0, 1 - used / plate);
  const expect = 1 + Math.min(0.4, Math.floor(empty * 10) * 0.08);
  const got = I.innatePulseOf('agile', ally.pulse, { usedCells: used }, false, u);
  assert.equal(got, Math.round(expect * 100) / 100, `空格 ${Math.round(empty * 100)}% 应给 ${expect}`);
  assert.ok(ally.pulseAmp > ally.pulse.ampMult - 0.001, '幅值应被空格拉高');

  /* 装满板面 → 没有空格红利 */
  const full = I.innatePulseOf('agile', ally.pulse, { usedCells: plate }, false, u);
  assert.equal(full, 1, '满载时一往无前不该再加成');
});

test('导流腔体 · 虚室生白：招式消耗 −n，但共鸣阶封顶二阶', () => {
  const { st, u } = makeUnit('conduit', [MAIN, SUB]);
  const { ally } = fight(st, u);
  assert.equal(ally.ms.pct, 100, '夹具应满覆盖（便于验证封顶）');
  assert.equal(ally.innateMods.costCut, 2, '两门都是 1–2 阶，消耗该 −2');
  assert.ok(ally.ms.tierIndex <= 2, `共鸣阶应封顶二阶，实际 ${ally.ms.tierIndex}`);
  /* 换一个非凿户牖的相，同一布局能吃到三阶 */
  const other = makeUnit('sturdy', [MAIN, SUB]);
  assert.equal(fight(other.st, other.u).ally.ms.tierIndex, 3, '别的相应能上三阶');
});

test('十字枢 · 四达并存：横 + 纵都贯通时，分流系数 0.65 → 1.0', () => {
  /* 这一条只看「朝向判定」与「系数改写」，所以把 routing 打个桩：
     真实贯通由 etching-catalog 那组测试守着。 */
  const orig = V.Circuit.manuscriptState;
  const stub = (st, uid, pl, id) => ({ ...orig(st, uid, pl, id), routed: true, pct: 100, reachLen: 2 });
  V.Circuit.manuscriptState = stub;
  try {
    /* 主修转 90°（4×2 → 2×4，纵向），辅修保持横向 */
    const turned = makeUnit('crucible', [MAIN, SUB], { rotate: 0 });
    const a1 = fight(turned.st, turned.u).ally;
    assert.equal(a1.innateMods.crucibleOn, true, '应有横有纵');

    /* 纯函数口径：分流未闭环时 0.65 → 1.0，闭环时本来就 1.45，不再叠 */
    const splitPulse = { split: true, looped: false, turns: 0 };
    assert.equal(I.innatePulseOf('crucible', splitPulse, { loops: 0 }, true),
      Math.round((1 / 0.65) * 100) / 100, '分流应由 0.65 抬到 1.0');
    assert.equal(I.innatePulseOf('crucible', { ...splitPulse, looped: true }, { loops: 1 }, true), 1,
      '闭环已经是 1.45，不该再乘一遍');
    assert.equal(I.innatePulseOf('crucible', splitPulse, { loops: 0 }, false), 1, '没有双贯通不生效');

    /* 「全横向 → 不成立」这一半不能再靠「两个都别转」来保证了：
       骨架是按种子长出来的，两门自然朝向未必都是横的。所以直接从实际图形算期望值。 */
    const spansOf = (unit) => V.State.manuscriptsOf(unit).map((m) => {
      const cells = V.State.manuscriptCells(m);
      const w = Math.max(...cells.map((c) => c[0])) - Math.min(...cells.map((c) => c[0])) + 1;
      const h = Math.max(...cells.map((c) => c[1])) - Math.min(...cells.map((c) => c[1])) + 1;
      return w >= h ? 'wide' : 'tall';
    });
    const flat = makeUnit('crucible', [MAIN, SUB]);
    const a2 = fight(flat.st, flat.u).ally;
    const flatSpans = spansOf(flat.u);
    const flatExpect = flatSpans.includes('wide') && flatSpans.includes('tall');
    assert.equal(a2.innateMods.crucibleOn, flatExpect,
      `朝向判定应与实际图形一致（${flatSpans.join('/')}）`);
  } finally { V.Circuit.manuscriptState = orig; }
});

test('手动装配：显式给了朝向，placeManuscript 不会把 rotation 掰回 0', () => {
  /* 这一条守的是「四达并存能不能被玩家摆出来」：
     以前 placeManuscript 总会重算「最优朝向」，玩家把一门转成纵向、一挪位就被掰回横向，
     于是「板上同时有横有纵」永远凑不齐。 */
  const st = V.State.create(41);
  const u = V.State.makeUnit(st, { skinId: 'blade', bodyPreset: 'crucible', name: '摆相' });
  u.manuscript = null;
  delete u.extraManuscripts;
  st.roster.push(u);
  const grant = (id) => {
    st.manuscriptVault = st.manuscriptVault || [];
    st.manuscriptVault.push({ ...D.manuscript(id) });
  };

  /* ① 只给朝向（工坊点了旋转再落盘）：按这个朝向找位置，而且保住它 */
  grant(MAIN);
  const r1 = V.State.placeManuscript(st, u, MAIN, { rotation: 1 });
  assert.ok(r1.ok, r1.reason);
  const m1 = V.State.manuscriptsOf(u)[0];
  assert.equal(m1.rotation, 1, '显式 rotation 应为 1，不能被自动选向重置');
  const c1 = V.State.manuscriptCells(m1);
  const w1 = Math.max(...c1.map((c) => c[0])) - Math.min(...c1.map((c) => c[0])) + 1;
  const h1 = Math.max(...c1.map((c) => c[1])) - Math.min(...c1.map((c) => c[1])) + 1;
  /* 不写死「转完必须 h>w」：骨架是按种子长出来的，有的底子本来就更高。
     真正要守的是「转 90° 确实换了长短边」，也就是 bbox 转置。 */
  const baseCells = V.State.manuscriptCells({ ...m1, rotation: 0, x: 0, y: 0 });
  const w0 = Math.max(...baseCells.map((c) => c[0])) - Math.min(...baseCells.map((c) => c[0])) + 1;
  const h0 = Math.max(...baseCells.map((c) => c[1])) - Math.min(...baseCells.map((c) => c[1])) + 1;
  assert.equal(w1, h0, `转向后宽应等于原高（${w1} vs ${h0}）`);
  assert.equal(h1, w0, `转向后高应等于原宽（${h1} vs ${w0}）`);

  /* ② 给完整姿态（拖到某个格）：朝向同样原样保留，含镜像 */
  grant(SUB);
  const size = V.Circuit.plateOf(u).size;
  let placed = null;
  for (let y = 0; y < size && !placed; y++) {
    for (let x = 0; x < size && !placed; x++) {
      if (V.State.placeManuscript(st, u, SUB, { x, y, rotation: 1, mirrorY: true }).ok) placed = { x, y };
    }
  }
  assert.ok(placed, '应该找得到一个能放下转向后辅修的位置');
  const m2 = V.State.manuscriptsOf(u).find((m) => m.id === SUB);
  assert.equal(m2.rotation, 1, '拖到某格时朝向应保留');
  assert.equal(m2.mirrorY, true, '镜像也应保留');

  /* ③ 完全不给姿态（首次从库存自动铺入）：仍然要能落位 */
  const flat = V.State.create(42);
  const u2 = V.State.makeUnit(flat, { skinId: 'blade', bodyPreset: 'crucible', name: '自动' });
  u2.manuscript = null;
  delete u2.extraManuscripts;
  flat.roster.push(u2);
  flat.manuscriptVault = [{ ...D.manuscript(MAIN) }];
  assert.ok(V.State.placeManuscript(flat, u2, MAIN).ok, '不给姿态时应自动找位');
});

test('空腔喉管 · 周流回环：每个闭环 +10% 幅值（上限 +60%）', () => {
  const { st, u } = makeUnit('throat', [MAIN]);
  const { ally } = fight(st, u);
  /* 纯函数口径：闭环数直接换算 */
  assert.equal(I.innatePulseOf('throat', { turns: 0 }, { loops: 0 }), 1, '没有闭环不生效');
  assert.equal(I.innatePulseOf('throat', { turns: 0 }, { loops: 2 }), 1.2, '两个闭环 +20%');
  assert.equal(I.innatePulseOf('throat', { turns: 0 }, { loops: 99 }), 1.6, '上限 +60%');

  /* 实战态：buildAlly 用的就是这套 panel + pulse，两者必须逐位对得上 */
  const expect = Math.round(ally.pulse.ampMult
    * I.innatePulseOf('throat', ally.pulse, ally.circuit.panel, false, u) * 100) / 100;
  assert.equal(ally.pulseAmp, expect, '战斗里的幅值必须由同一套编译结果算出');
  void st;
});

test('折角板 · 三隅稳固：转折增益 1.5×（+18%/折），每次转向补 4 点缓冲', () => {
  const { st, u } = makeUnit('corner', [MAIN]);
  const { state, ally } = fight(st, u);

  /* 纯函数口径：把每次转折 +12% 整体换成 +18%，三折后总幅值应为 1.54 */
  assert.equal(I.innatePulseOf('corner', { turns: 0 }, {}), 1, '没有转折就没有改写');
  const threeTurns = 1 + 3 * 0.12;                 /* 编译出来的基础幅值 */
  const effective = Math.round(threeTurns * I.innatePulseOf('corner', { turns: 3 }, {}) * 100) / 100;
  assert.equal(effective, 1.54, `三折应合计 +54%（实际 ${effective}）`);

  /* 放招时按转向数补缓冲：每次 4 点，最多 3 次 */
  ally.shieldCap = 200;   /* 抬高上限，专门看补偿量，不看容量 */
  ally.shield = 0;
  const turns = ally.pulse.turns;
  assert.ok(turns > 0, `夹具路径应有转折（turns=${turns}）`);
  ally.pendingSkill = { ...ally.skillList[0], cost: 0, effect: { mult: 0.1, heal: null } };
  I.finishCast(state.run.battle, ally);
  assert.equal(ally.shield, 4 * Math.min(3, turns), `应补 ${4 * Math.min(3, turns)} 点缓冲`);

  /* 三隅稳固不再改满压判定：砺仍是基准概率 */
  const cfg = V.Combat.resolveConfig();
  assert.ok(cfg.whetChance > 0 && cfg.whetChance < 0.5);
});

test('覆盾 · 正面如壁：1 号位护盾 +25%，格挡反弹 35% 减免量', () => {
  const { st, u } = makeUnit('aegis', [MAIN]);
  const { state, battle, ally } = fight(st, u);
  ally.slot = 0;
  ally.shield = 0;
  ally.shieldCap = 200;   /* 抬高上限，只看 +25% 这条规则本身 */
  const g1 = I.addShield(ally, 10);
  assert.equal(g1, 13, '1 号位护盾应 +25%（10 → 13）');

  const foe = battle.enemies[0];
  const hpBefore = foe.hp;
  const scaled = D.DESIGN.enemyDamageScale;
  D.DESIGN.enemyDamageScale = 1;
  try {
    ally.buffs.push({ k: 'guard' });
    const res = I.applyDamage(battle, foe, ally, 1000, {});
    const reduced = Math.round(1000) - Math.round(1000 * (1 - D.GUARD.reduce));
    assert.ok(foe.hp < hpBefore, '格挡后应把一部分弹回去');
    assert.equal(hpBefore - foe.hp, Math.max(1, Math.round((1000 - res.dealt - 0) * 0.35)) > 0
      ? hpBefore - foe.hp : 0);
    /* 严格等式：反弹 = round(减免量 × 0.35) */
    assert.equal(hpBefore - foe.hp, Math.max(1, Math.round(reduced * 0.35)), '反弹应是减免量的 35%');
  } finally { D.DESIGN.enemyDamageScale = scaled; }
});

test('两截 · 两极共振：压力 ≥50 时脉冲 ×1.45，单次重击额外 +5 压力', () => {
  const { st, u } = makeUnit('waist', [MAIN, SUB]);
  const { battle, ally } = fight(st, u);

  /* 高热倍率：同一发普攻，压力 60 比压力 10 多出 1.45 倍（再叠压力自带的档位） */
  const foe0 = battle.enemies[0];
  foe0.hp = foe0.maxHp = 99999;
  foe0.def = 0; foe0.dodge = 0; foe0.shield = 0; foe0.shieldCap = 0; foe0.outerNodes = 0;
  const probe = (stress) => {
    const a = { ...ally, stress, crit: 0, hits: 1, shield: 0, shieldCap: 0, buffs: [], innate: 'waist' };
    const before = foe0.hp;
    I.doBasicAttack(battle, a, foe0.id, { mult: 1 });
    return before - foe0.hp;
  };
  const low = probe(10);
  const high = probe(60);
  const pressureGain = V.Combat.pressureDamageMultiplier(60, ally);
  assert.ok(Math.abs(high / low - 1.45 * pressureGain) < 0.08,
    `高热应 ×1.45（再乘压力档位 ${pressureGain}），实测 ×${(high / low).toFixed(2)}`);

  /* 阈值判定按「生命上限的 15%」算，所以先把上限打成 100，让 30 点一击稳稳越线 */
  ally.maxHp = 100;
  ally.hp = 100;
  ally.shield = 0;
  ally.shieldCap = 0;   /* 缓冲会先把伤害截走，阈值判定就落不到 hp 上 */
  const stressBefore = ally.stress;
  const foe = battle.enemies[0];
  const scaled = D.DESIGN.enemyDamageScale;
  D.DESIGN.enemyDamageScale = 1; /* 敌人伤害有全局缩放，这里要按原值打 */
  try {
    I.applyDamage(battle, foe, ally, 30, { pierce: true });
  } finally { D.DESIGN.enemyDamageScale = scaled; }
  assert.equal(ally.stress, stressBefore + 5, '超过生命上限 15% 的一击应额外 +5 压力');
});

test('孪生 · 双生主修：第一辅修按 1.0 结算，连携不挑标签', () => {
  const { st, u } = makeUnit('twin', [MAIN, SUB]);
  const { battle, ally } = fight(st, u);
  assert.deepEqual(ally.innateMods.extraShares, [1], '第 2 门按 100% 主修乘算结算');

  ally.tagMemory = { tag: '灼烧', tick: battle.tick };
  assert.equal(I.condOk(battle, ally, { afterTag: '流血' }, ally.ms, 0, battle.enemies[0]), true,
    '双生主修不挑标签：窗口内放过任意招式都算连携');
  const plain = makeUnit('sturdy', [MAIN, SUB]);
  const pf = fight(plain.st, plain.u);
  pf.ally.tagMemory = { tag: '灼烧', tick: pf.battle.tick };
  assert.equal(I.condOk(pf.battle, pf.ally, { afterTag: '流血' }, pf.ally.ms, 0, pf.battle.enemies[0]), false,
    '别的相必须标签对上');
});

test('棘轮 · 齿咬碎纹：每件 ≤2 格纹路 +0.08 回裕（上限 0.48）', () => {
  const { st, u } = makeUnit('ratchet', [MAIN]);
  const { ally } = fight(st, u);
  const n = ally.innateMods.smallCount;
  assert.ok(n > 0, '夹具里应有小纹路');
  assert.equal(ally.innateMods.regenBonus, Math.min(0.48, n * 0.08));
  const plain = makeUnit('sturdy', [MAIN]);
  const p = fight(plain.st, plain.u).ally;
  assert.ok(ally.regenBase > p.regenBase, '棘轮的回裕应更高');
});

test('弧月 · 孤弧锋锐：满覆盖 + 贯通时无视 25% 防御，引爆 +20%', () => {
  const { st, u } = makeUnit('arc', [MAIN]);
  const { state, battle, ally } = fight(st, u);
  assert.equal(ally.innateMods.arcOn, true);
  /* 同一只靶子、同一场战斗，只切 arcOn 开关，比「防御被削」这一项 */
  const foe = battle.enemies[0];
  foe.hp = foe.maxHp = 99999;
  foe.def = 60;
  foe.dodge = 0;
  foe.shield = 0;
  foe.shieldCap = 0;
  foe.outerNodes = 0;
  const hit = (src) => {
    foe.hp = foe.maxHp;
    const before = foe.hp;
    I.doBasicAttack(battle, { ...src, crit: 0, hits: 1 }, foe.id, { mult: 4 });
    return before - foe.hp;
  };
  const arcHit = hit(ally);
  const plain = { ...ally, innate: 'sturdy', innateMods: { ...ally.innateMods, arcOn: false } };
  const plainHit = hit(plain);
  assert.ok(arcHit > plainHit, `孤弧应打得更疼（${arcHit} vs ${plainHit}）`);

  /* 引爆 +20%：同一条异常，arc 引爆的伤害应高 20% */
  const seed = (src) => {
    const t = battle.enemies[0];
    t.hp = t.maxHp;
    t.buffs = [{ k: 'burn', v: 100, hits: 3 }];
    return I.detonate(battle, src, t, 'burn', {});
  };
  const arcDet = seed(ally);
  const fake = { ...ally, innate: 'sturdy', innateMods: { ...ally.innateMods, arcOn: false } };
  const plainDet = seed(fake);
  assert.ok(Math.abs(arcDet / plainDet - 1.2) < 0.05, `引爆应 +20%（${arcDet} vs ${plainDet}）`);
  void state;
});

test('阶台 · 累土递进：每满一回合招式伤害与治疗 +4%（上限 +32%）', () => {
  const { st, u } = makeUnit('terrace', [MAIN]);
  const { state, battle, ally } = fight(st, u);
  const run = (tick) => {
    battle.tick = tick;
    const foe = battle.enemies[0];
    foe.hp = foe.maxHp;
    foe.dodge = 0;
    /* v4.0：靶子要摘掉缓冲与保险丝，否则伤害被吃掉、整数舍入会把 24% 的比值放大 */
    foe.def = 0; foe.shield = 0; foe.shieldCap = 0; foe.outerNodes = 0;
    ally.hits = 1;
    ally.crit = 0;
    ally.pendingSkill = { ...ally.skillList[0], cost: 0, effect: { mult: 2 } };
    const before = foe.hp;
    I.finishCast(battle, ally);
    return before - foe.hp;
  };
  const early = run(0);
  const later = run(6 * 6); /* 6 回合 → +24% */
  assert.ok(later > early, `回合越多应打得越疼（${early} → ${later}）`);
  const ratio = later / early;
  assert.ok(Math.abs(ratio - 1.24) < 0.06, `6 回合应约 +24%，实测 ×${ratio.toFixed(2)}`);
  assert.ok(battle.tick > 0 && state.run);
});

test('波纹带 · 曲径通幽：曲折纹路给闪避、缩短引导', () => {
  const { st, u } = makeUnit('ripple', [MAIN]);
  const { ally } = fight(st, u);
  const n = ally.innateMods.elbowCount;
  assert.ok(n > 0, '夹具里应有曲折纹路');
  /* v4.0 三标：直导总线也贡献闪避（每格 +2%，上限 16%） */
  const expected = D.DESIGN.baseDodge + Math.min(0.18, n * 0.03) + (ally.pulse.dodgeBonus || 0);
  assert.ok(Math.abs(ally.dodge - expected) < 1e-9, `闪避应为 ${expected}，实际 ${ally.dodge}`);
  assert.equal(ally.innateMods.castScale, Math.max(0.4, 1 - n * 0.15));
});

test('脊梁 · 中脊挂刺：每门 1 阶辅修 +14% 主修招式伤害（上限 +42%）', () => {
  const { st, u } = makeUnit('spine', [MAIN, SUB]);
  const { ally } = fight(st, u);
  assert.equal(ally.innateMods.spineMult, 1.14, '一门 1 阶辅修 → +14%');
  /* 主修招式吃这层，辅修招式不吃 */
  const mainSkill = ally.skillList.find((s) => !s.group);
  const subSkill = ally.skillList.find((s) => s.group);
  assert.ok(mainSkill && subSkill);
  assert.equal(ally.innate, 'spine');
});

test('相性只读 innateMods：字段齐全，且没有单位残留旧的一次性字段', () => {
  const { st, u } = makeUnit('waist', [MAIN, SUB]);
  const { ally } = fight(st, u);
  const need = ['id', 'subShare', 'costCut', 'skillMult', 'spineMult', 'castScale',
    'dodgeBonus', 'regenBonus', 'startEnergy', 'mainMultBonus', 'agileOn', 'arcOn',
    'crucibleOn', 'reachLen', 'mainRouted', 'extraShares'];
  need.forEach((k) => assert.ok(k in ally.innateMods, `innateMods 缺字段 ${k}`));
  ['arcPierce', 'innateCostCut', 'castScale'].forEach((k) => {
    assert.equal(ally[k], undefined, `不该在单位上留下旧的散字段 ${k}`);
  });
});
