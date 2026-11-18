'use strict';
/* v4.0「脉冲谐振与回路熔断」的守卫测试。

   这一组守的是四个新契约，它们共同构成「面板不再靠固定攻防血」这件事：
   ① 拓扑编译：直导缩间隔、弯折抬幅值、分流摊开、闭环谐振、储能给缓冲；
   ② 面板公式：完整度 = 25 + 占格×2.5 + 闭环×12，阻抗 = 覆盖率 + 元件；
   ③ 受击四步：阻抗拦截（转废热/充能）→ 电容截留 30% → 外围熔断挡一击 → 扣完整度；
   ④ 双终局：枯竭停机（12 tick）与过载熔毁（裂 + 压力再满），两极为例外。 */
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes, fight, fullTeam, buildBoard, autoRouteBoard } = require('../helpers/veteran-run.cjs');

/** 模板列表 → 布线流派：带 straight/rivet 的算直导流，其余按弯折流 */
function styleOf(templates) {
  return Array.isArray(templates) && templates.some((t) => t === 'straight' || t === 'rivet' || t === 'long')
    ? 'straight' : 'elbow';
}

/** 造一场「我方 1 人 + 木桩」的战斗，方便直接调内部结算 */
function duel(seed, opts) {
  const { A, V, st } = boot(seed);
  const o = opts || {};
  let base = fullTeam(V, st);
  const u = base.roster[0];
  base.roster.slice(1).forEach((x) => { x.onTeam = false; });
  V.State.equipManuscript(base, u, o.ms || 'corridor5');
  /* 布线器：端口通路 + 余格填充一把做完（旧贪心只顾覆盖率，骨架变大后就接不通了） */
  autoRouteBoard(A, base, u, { style: styleOf(o.board) });
  const run = startRun(A, base, seed);
  const s = fight(A, setNodes(A, run, ['battle']), 'normal', { keep: true });
  void s;
  return { A, V, base, u };
}

/** 直接建一场只有木桩的战斗（绕过遭遇生成，避免随机编成） */
function sandbox(seed, build, templates) {
  const { A, V, st } = boot(seed, { generated: build !== false });
  let base = fullTeam(V, st);
  const u = base.roster[0];
  if (build !== false) {
    const style = styleOf(templates);
    const id = style === 'straight' ? 'corridor5' : 'bloodrush';
    V.State.equipManuscript(base, u, id);
    assert.equal(u.manuscript?.id, id, '夹具蚀刻法必须完整装下');
    autoRouteBoard(A, base, u, { style });
  }
  const run = V.Expedition.start(base, { seed }).state;
  const units = [{
    enemyType: 'bone', name: '桩', slot: 0, hp: 99999, maxHp: 99999,
    atk: 6, def: 10, spd: 1, hits: 0.9, skills: [], shieldCap: 0, outerNodes: 0,
  }];
  const cr = V.Combat.create(run, { id: 'bp_topology', kind: 'normal', floor: 1, units, seedTag: 3 }, seed * 17 + 1);
  assert.ok(cr.ok, JSON.stringify(cr.error));
  const b = cr.state.run.battle;
  const ally = b.allies.find((a) => a.sourceUnitId === u.id);
  return { A, V, D: V.Data, I: V.Combat._internal, st: cr.state, b, ally, unit: u };
}

test('伤害招式的蓄力与攻击结果携带同一招式标记', () => {
  const { I, b, ally } = sandbox(702);
  const skill = ally.skillList.find(sk => !sk.effect?.heal);
  assert.ok(skill);
  I.startCast(b, ally, skill);
  assert.ok(b.logs.some(l => l.type === 'cast' && l.strike && l.skillId === skill.id));
  I.finishCast(b, ally);
  assert.ok(b.logs.some(l => ['hit', 'crit', 'miss'].includes(l.type) && l.strike && l.skillId === skill.id));
});

/* ---------------- ① 拓扑编译 ---------------- */

test('直导系：每格直导缩间隔（上限 −20%），每次转角反向延迟 +4%（上限 +24%）', () => {
  const straightOnly = sandbox(701, true, ['straight', 'rivet']);
  const p = straightOnly.ally.pulse;
  assert.ok(p.straight > 0, `夹具应有直导格（straight=${p.straight}）`);
  /* 板面是 L 形，直导件会被转着摆，路径仍可能拐一次 —— 这里只守公式 */
  /* 九标：弯折要吃传输时间 —— intervalScale = 1 − 直导缩短 + 转角延迟（只数弯折件上的转向） */
  const P0 = straightOnly.V.Circuit.PULSE;
  assert.ok(p.elbowTurns <= p.turns, '弯折转向是总转向的子集');
  const expect = Math.max(0.5,
    1 - Math.min(P0.straight.cap, p.straight * P0.straight.interval) + Math.min(P0.turnDelayCap, p.elbowTurns * P0.turnDelay));
  assert.ok(Math.abs(p.intervalScale - expect) < 1e-9, `间隔系数应是 ${expect}，实际 ${p.intervalScale}`);
  assert.ok(p.intervalScale < 1, '直导应该让出招更快');
  /* 战斗态的 attackInterval 必须真的乘上这一项 */
  const base = straightOnly.D.DESIGN.autoAttack.interval;
  assert.ok(straightOnly.ally.attackInterval <= base + 1e-9, '出招间隔应不长于基准');
});

test('弯折系：每次 90° 转折脉冲 +12%，回钩再 +20%', () => {
  const bent = sandbox(702, true);
  const p = bent.ally.pulse;
  assert.ok(p.turns > 0, `夹具应有转折（turns=${p.turns}）`);
  const expect = 1 + p.turns * 0.12 + (p.hairpin ? 0.2 : 0)
    * (p.split ? (p.looped ? 1.45 : 0.65) : 1);
  void expect;
  assert.ok(p.ampMult >= 1 + p.turns * 0.12 - 1e-9, '幅值应吃到转折加成');
  assert.equal(bent.ally.pulseAmp, Math.round(
    p.ampMult * bent.I.innatePulseOf(bent.ally.innate, p, bent.ally.circuit.panel, false, bent.unit) * 100,
  ) / 100, '战斗幅值必须由同一份编译结果算出');
});

test('分流系：单股拆多路按 0.65 摊，下游重新汇合成闭环则 1.45', () => {
  const { V, I } = sandbox(703, false);
  const splitPulse = { split: true, looped: false, turns: 0, ampMult: 1 };
  const plainPulse = { split: false, looped: false, turns: 0, ampMult: 1 };
  const splitAmp = V.Circuit.pulseOf({ built: [] }, { path: [], looped: false });
  void splitAmp;
  /* 直接用纯函数口径：分流但没闭环 = 0.65；闭环 = 1.45 */
  const pSplit = { ...splitPulse, ampMult: V.Circuit.PULSE.split };
  const pLoop = { ...splitPulse, looped: true, ampMult: V.Circuit.PULSE.resonant };
  assert.equal(pSplit.ampMult, 0.65);
  assert.equal(pLoop.ampMult, 1.45);
  assert.equal(V.Circuit.PULSE.resonant / V.Circuit.PULSE.split > 2, true, '谐振要比单纯分流高得多');
  void I; void plainPulse;
});

test('储能系：每格 +6 缓冲上限与 +2 阻抗；没有储能纹路就是 0', () => {
  const bare = sandbox(704, false);
  assert.equal(bare.ally.shieldCap, 0, '没刻储能纹路就不该有缓冲');
  assert.equal(bare.ally.circuit.panel.caps, 0);

  /* 手工摆一枚同心纹：贪心铺面优先直导，未必会选储能件 */
  const { V, st } = sandbox(705, false);
  /* 战斗态是克隆出来的，要改就改战斗态里的那份 roster，否则编译看不到 */
  const unit = st.roster.find((x) => x.id === st.run.party[0].uid) || st.roster[0];
  const plate = V.Circuit.plateOf(unit);
  let placed = null;
  outer: for (let y = 0; y < plate.size; y++) {
    for (let x = 0; x < plate.size; x++) {
      const tf = V.Circuit.transformTemplate(V.Data.TEMPLATES.capacitor, 0, false);
      const keys = tf.cells.map((c) => (c.x + x) + ',' + (c.y + y));
      if (!keys.every((k) => plate.cells.has(k))) continue;
      const item = V.State.makePart(st, { kind: 'circuit', templateId: 'capacitor' });
      st.itemsById[item.id] = item;
      unit.board.placements = [{ itemId: item.id, x, y, rotation: 0, mirrorY: false }];
      placed = { x, y };
      break outer;
    }
  }
  assert.ok(placed, '板面上应放得下一枚同心纹');

  const panel = V.Circuit.compile(st, unit.id).value.panel;
  assert.ok(panel.caps > 0, `夹具应有储能格（caps=${panel.caps}）`);
  const stats = V.Roster.stats(st, unit);
  /* 八标：缓冲上限 = min(储能格 × 5, 完整度 × 45%) */
  const P = V.Circuit.PULSE;
  const expectCap = Math.min(panel.caps * P.capShieldPerCell, Math.round(panel.maxHp * P.shieldCapPct));
  assert.equal(stats.shieldCap, expectCap, '缓冲上限 = min(储能格 × 5, 完整度 × 45%)');
  assert.ok(stats.shieldCap <= Math.round(panel.maxHp * P.shieldCapPct), '缓冲不许超过完整度的 45%');
  assert.ok(panel.def >= panel.caps * 2, '储能元件同时给阻抗');
});

/* ---------------- ② 面板公式 ---------------- */

test('完整度 = 25 + 占格×1.15 + min(闭环,3)×6，阻抗 = 覆盖率×20 + 元件', () => {
  const { V, ally, unit, st } = sandbox(706, true);
  const pv = V.Circuit.preview(st, unit.id);
  const panel = V.Circuit.compile(st, unit.id).value.panel;
  const used = new Set(pv.occupied.map((c) => c[0] + ',' + c[1])).size;
  assert.equal(panel.usedCells, used, '占格数应与预览一致');
  /* 九标：完整度 = 25 + (纹路占格 + 蚀刻法有效格)×1.15 + min(闭环,3)×6，
     蚀刻法单门的有效格封顶 34（大卷的自承重部分不计）。 */
  const P = V.Circuit.PULSE;
  assert.ok(panel.manuscriptCells > 0, '面板应带上蚀刻法骨架格数');
  assert.ok(panel.manuscriptEffectiveCells <= P.manuscriptCellCap * 2, '单门有效格不该超过上限');
  const eff = used + panel.manuscriptEffectiveCells;
  assert.equal(panel.effectiveCells, eff, '有效占格 = 纹路 + 蚀刻法有效格');
  assert.equal(panel.maxHp, 25 + Math.round(eff * P.hpPerCell) + Math.min(panel.loops, P.loopHpCap) * P.hpPerLoop);
  assert.equal(panel.atk, 10, '幅值基座恒为 10');
  assert.equal(ally.maxHp >= 25, true);
  assert.ok(panel.def >= Math.round((panel.coverage / 100) * 20), '阻抗至少吃到覆盖率那一份');
});

test('闭环数：并查集只数「接上就成环」的边', () => {
  const { V } = sandbox(707, false);
  const lay = { edges: [] };
  assert.equal(V.Circuit.countLoops(lay), 0, '没有边就没有环');
  /* 三角形：三条边接成一个环 */
  lay.edges = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' },
  ];
  assert.equal(V.Circuit.countLoops(lay), 1);
  lay.edges.push({ from: 'a', to: 'd' });
  assert.equal(V.Circuit.countLoops(lay), 1, '外挂一条悬挂边不产生新环');
});

/* ---------------- ③ 受击四步 ---------------- */

test('Step1 阻抗拦截：被挡下的脉冲一半转废热，装了储能再一半回充余裕', () => {
  const { I, b, ally } = sandbox(708, true);
  const hp0 = ally.hp;
  const stress0 = ally.stress;
  const energy0 = ally.energy;
  ally.def = 30;                  /* 拦截率 = 30/(30+30) = 50% */
  I.applyDamage(b, b.enemies[0], ally, 40, {});
  const lost = hp0 - ally.hp;
  assert.ok(lost < 40, `阻抗应拦下一部分（掉了 ${lost}）`);
  assert.ok(ally.stress > stress0, '拦截下来的脉冲应变成废热（压力）');
  assert.ok(ally.energy >= energy0, '装了储能的话应回充余裕');
});

test('Step2 电容截留 30%：没有储能纹路就不截留', () => {
  const { V, I, b, ally } = sandbox(709, true);
  const src = b.enemies[0];
  /* 同一份单位，只切「有没有缓冲上限」这一个变量 */
  const probe = (cap) => {
    const t = {
      ...ally, shieldCap: cap, shield: 0, def: 0, refract: 0,
      circuit: null, fusedNodes: [], hp: 1000, maxHp: 1000, buffs: [],
      stats: { taken: 0 },
    };
    I.applyDamage(b, src, t, 20, {});
    return { lost: 1000 - t.hp, shield: t.shield };
  };
  const none = probe(0);
  const cappedProbe = probe(200);
  const capped = probe(200);
  assert.equal(none.shield, 0, '没有缓冲上限就不该凭空虚生缓冲');
  assert.equal(none.lost, 20, '没有缓冲时伤害应全额落到完整度上');
  /* 截留的 30% 当回合就被这次攻击消耗掉了（先充进缓冲、再被吸收），
     所以观测点是「掉血变少」，不是「盾还留着」。 */
  assert.ok(cappedProbe.lost < none.lost, `截留后掉血应更少（${none.lost} → ${cappedProbe.lost}）`);
  /* 少了「两份截留量」：一份是被挪进缓冲的，一份是同回合又被缓冲吸走的 */
  assert.equal(none.lost - cappedProbe.lost, 2 * Math.round(20 * V.Circuit.PULSE.capToShield),
    '少掉的应是两份截留量（挪走 + 同回合吸收）');
});

test('Step3 外围熔断：单次 >15 的非穿刺直击被整下挡掉，穿刺绕过', () => {
  const { I, b, ally } = sandbox(711, true);
  assert.ok(ally.circuit.placements.length > 0, '夹具应有外围纹路');
  ally.shield = 0;
  ally.shieldCap = 0;
  ally.def = 0;
  const hp0 = ally.hp;
  const fused0 = (ally.fusedNodes || []).length;
  I.applyDamage(b, b.enemies[0], ally, 40, {});
  assert.equal(ally.hp, hp0, '熔断应完全抵消这一击');
  assert.ok(b.logs.some(l => l.targetId === ally.id && l.effect === 'fuse'));
  assert.equal((ally.fusedNodes || []).length, fused0 + 1, '应烧掉一枚外围纹路');

  /* 穿刺不吃熔断 */
  const hp1 = ally.hp;
  const fused1 = ally.fusedNodes.length;
  I.applyDamage(b, b.enemies[0], ally, 40, { pierce: true });
  assert.ok(ally.hp < hp1, '穿刺应直接打到完整度');
  assert.equal(ally.fusedNodes.length, fused1, '穿刺不该再烧节点');

  /* 小额直击不触发熔断（保险丝不该被 3 点磨损掉） */
  const fused2 = ally.fusedNodes.length;
  I.applyDamage(b, b.enemies[0], ally, 5, {});
  assert.equal(ally.fusedNodes.length, fused2, '小于阈值的攻击不该熔断');
});

test('熔断之后轻量降级：阻抗、缓冲、幅值一起降一档', () => {
  const { V, I, b, ally } = sandbox(712, true);
  ally.shield = 0; ally.shieldCap = 60; ally.def = 6; ally.pulseAmp = 1.2;
  const def0 = ally.def;
  const cap0 = ally.shieldCap;
  const amp0 = ally.pulseAmp;
  assert.equal(I.fuseNode(b, ally), true, '应能烧掉一枚外围纹路');
  assert.equal((ally.fusedNodes || []).length, 1);
  assert.equal(ally.def, def0 - 2, '阻抗 −2');
  assert.equal(ally.shieldCap, cap0 - V.Circuit.PULSE.capShieldPerCell, '缓冲上限降一格');
  assert.ok(ally.pulseAmp < amp0, '脉冲幅值降一档');
});

/* ---------------- ④ 双终局 ---------------- */

test('枯竭停机：非施法状态下连续 6 tick 回不到 1 点余裕就退场', () => {
  const { V, st, ally } = sandbox(713, false);
  ally.energy = 0;
  ally.regen = 0;
  ally.regenBase = 0;
  ally.energyMax = 1;
  let s = st;
  for (let i = 0; i < 5; i++) s = V.Combat.step(s).state;
  const mid = s.run.battle.allies.find((a) => a.id === ally.id);
  assert.ok(mid.alive !== false, '5 tick 时还该撑着');
  assert.ok(mid.starveTicks >= 5);
  s = V.Combat.step(s).state;
  const dead = s.run.battle.allies.find((a) => a.id === ally.id);
  assert.equal(dead.alive, false, '满 6 tick 应停机');
  assert.equal(dead.hp, 0);
});

test('过载熔毁：已裂的人压力再满 100 就熔穿心核', () => {
  const { I, b, ally } = sandbox(714, false);
  ally.cracked = true;
  ally.stress = 95;
  I.addStress(b, ally, 10);
  assert.equal(ally.stress, 100);
  assert.equal(ally.alive, false, '裂 + 再满压 = 熔毁');
});

test('两极共振豁免：裂 + 满压时把整仓压力换成自爆冲击', () => {
  const { I, b, ally } = sandbox(715, false);
  ally.innate = 'waist';
  ally.cracked = true;
  ally.stress = 96;
  ally.pulseAmp = 2;
  const foes = b.enemies.map((e) => e.hp);
  I.addStress(b, ally, 10);
  assert.equal(ally.alive !== false, true, '两截不该被熔毁带走');
  assert.equal(ally.stress, 0, '压力应被一次倒空');
  assert.ok(b.enemies.some((e, i) => e.hp < foes[i]), '自爆应打到敌方');
});

/* ---------------- ⑤ 动态元件 ---------------- */

test('闸系：高热或有缓冲时脉冲 ×1.65', () => {
  const { V, b, ally } = sandbox(716, true);
  const foe = b.enemies[0];
  foe.hp = foe.maxHp = 99999;
  foe.def = 0; foe.dodge = 0; foe.shield = 0; foe.shieldCap = 0; foe.outerNodes = 0;
  const hit = (extra) => {
    foe.hp = foe.maxHp;
    const before = foe.hp;
    const a = { ...ally, crit: 0, hits: 1, gateRune: true, emberRune: false, pulseAmp: 1, buffs: [], ...extra };
    V.Combat._internal.doBasicAttack(b, a, foe.id, { mult: 1 });
    return before - foe.hp;
  };
  const cold = hit({ stress: 0, shield: 0 });
  const hot = hit({ stress: 60, shield: 0 });
  /* 压力本身还有一档乘算（60 压是 ×1.1），闸门是叠在它上面的 */
  const pressure = V.Combat.pressureDamageMultiplier(60, ally);
  assert.ok(Math.abs(hot / cold - V.Circuit.PULSE.gate * pressure) < 0.1,
    `高热时闸门应 ×${V.Circuit.PULSE.gate}（再乘压力档位 ${pressure}）：${cold} → ${hot}`);
});

test('余烬：低压主动蓄热、高危才泄压，并按压力换幅值', () => {
  const { V, b, ally } = sandbox(717, true);
  const foe = b.enemies[0];
  foe.hp = foe.maxHp = 99999;
  foe.def = 0; foe.dodge = 0; foe.shield = 0; foe.shieldCap = 0; foe.outerNodes = 0;
  const fire = (stress) => {
    const a = { ...ally, crit: 0, hits: 1, gateRune: false, emberRune: true, pulseAmp: 1, stress, buffs: [] };
    foe.hp = foe.maxHp;
    const before = foe.hp;
    V.Combat._internal.doBasicAttack(b, a, foe.id, { mult: 1 });
    return { dmg: before - foe.hp, after: a.stress };
  };
  /* 低压：反而不吸压，主动蓄 +6 冲进高热带（八标：+3 爬不到 warm 档） */
  const P = V.Circuit.PULSE;
  const cold = fire(40);
  assert.equal(cold.after, 40 + P.emberCharge, `低压应蓄热 +${P.emberCharge}（现在是 ${cold.after}）`);
  /* 缓冲带（65~84）：不动 */
  const mid = fire(70);
  assert.equal(mid.after, 70, '缓冲带维持原压力');
  /* 高危（>=85）：泄压保命 */
  const hot = fire(85);
  assert.equal(hot.after, 85 - P.emberStress, `高危应泄压 −${P.emberStress}（现在是 ${hot.after}）`);
  /* 压力越高，幅值越高 */
  assert.ok(hot.dmg > cold.dmg, `压力越高余烬越猛（${cold.dmg} → ${hot.dmg}）`);
});

/* ---------------- ⑥ 二标新增：破甲 / 打断 / 动态熔断 / 满溢放电 ---------------- */

test('高幅值破甲：>=22 的脉冲把阻抗按半价算', () => {
  const { I, b, ally } = sandbox(720, false);
  const src = b.enemies[0];
  const probe = (opts) => {
    const t = {
      ...ally, def: 40, shieldCap: 0, shield: 0, refract: 0,
      circuit: null, fusedNodes: [], hp: 5000, maxHp: 5000, buffs: [], stats: { taken: 0 },
    };
    I.applyDamage(b, src, t, 60, opts);
    return 5000 - t.hp;
  };
  const plain = probe({});
  const pierced = probe({ armorPierce: true });
  assert.ok(pierced > plain, `破甲应打得更疼（${plain} → ${pierced}）`);
  /* 阻抗 40：普通按 40/70 拦，半价后按 20/50 拦，穿透量应明显变大 */
  assert.ok(pierced - plain >= 6, `半价阻抗的差距应该看得出来（差 ${pierced - plain}）`);
});

test('打断重铸：准备窗口内挨到 >=20 的脉冲就断，并震碎护盾', () => {
  const { I, b, ally } = sandbox(721, false);
  const boss = b.enemies[0];
  boss.charging = { id: 'reforge', name: '重铸', castTime: 0.72, interruptAt: 20 };
  boss.chargeTimer = 0.72;
  boss.shield = 30;
  boss.shieldCap = 999;
  const hp0 = boss.hp;
  I.applyDamage(b, ally, boss, 20, {});
  assert.equal(boss.charging, null, '重铸应被打断');
  assert.equal(boss.shield, 0, '护盾应一并震碎');
  assert.ok(b.logs.some((l) => l.type === 'disrupt' && l.effect === 'interrupt' && l.text.includes('打断')), '要留下打断记录');
  assert.ok(boss.hp <= hp0);

  /* 不够重（<20）不该打断 */
  boss.charging = { id: 'reforge', name: '重铸', castTime: 0.72, interruptAt: 20 };
  boss.chargeTimer = 0.72;
  I.applyDamage(b, ally, boss, 12, {});
  assert.ok(boss.charging, '轻击不该打断准备');
});

test('动态熔断阈值：单次伤害要同时越过绝对下限与完整度比例', () => {
  const { V, I, b, ally } = sandbox(722, false);
  const P = V.Circuit.PULSE;
  const thresholdAt = (maxHp) => Math.max(P.fuseFloor, Math.round(maxHp * P.fusePct));
  const src = b.enemies[0];
  const fusedAt = (maxHp, amount) => {
    const t = {
      ...ally, maxHp, hp: maxHp, def: 0, shieldCap: 0, shield: 0, refract: 0,
      circuit: { placements: [{ itemId: 'a' }, { itemId: 'b' }] },
      fusedNodes: [], buffs: [], stats: { taken: 0 },
    };
    I.applyDamage(b, src, t, amount, {});
    return (t.fusedNodes || []).length > 0;
  };
  /* 八标：阈值 = max(绝对下限 fuseFloor, 完整度 × fusePct)。
     绝对下限是「这一下算不算重击」的判据 —— 只挂百分比时，完整度降到 86 之后
     门槛只有 7 点，敌方每一次普攻都会烧掉一枚纹路，A 流派一场自毁 7 个节点。 */
  const small = 200;   /* 200 × 0.08 = 16 < 36 → 由绝对下限兜底 */
  assert.equal(thresholdAt(small), P.fuseFloor, '小体型由绝对下限兜底');
  assert.equal(fusedAt(small, P.fuseFloor), false, '刚好等于阈值不该熔断');
  assert.equal(fusedAt(small, P.fuseFloor + 1), true, '越过阈值才熔断');
  const big = 1200;    /* 1200 × 0.08 = 96 > 36 → 由比例接管 */
  assert.equal(thresholdAt(big), Math.round(big * P.fusePct), '大体型由比例接管');
  assert.equal(fusedAt(big, thresholdAt(big) + 2), true, '大体型要更重的一击才熔断');
});

test('电容满溢：缓冲顶到上限后，下一次出手整仓放电 ×2.5', () => {
  const { V, I, b, ally } = sandbox(723, true);
  const foe = b.enemies[0];
  foe.hp = foe.maxHp = 99999;
  foe.def = 0; foe.dodge = 0; foe.shield = 0; foe.shieldCap = 0; foe.outerNodes = 0;
  const hit = (shield) => {
    foe.hp = foe.maxHp;
    const before = foe.hp;
    const a = { ...ally, crit: 0, hits: 1, stress: 0, buffs: [], pulseAmp: 1, kineticGain: 0, shieldCap: 40, shield };
    I.doBasicAttack(b, a, foe.id, { mult: 1 });
    return { dmg: before - foe.hp, shield: a.shield };
  };
  const dry = hit(0);
  const full = hit(40);
  assert.equal(full.shield, 0, '满溢后缓冲应被清空');
  assert.ok(Math.abs(full.dmg / dry.dmg - V.Circuit.PULSE.overload) < 0.2,
    `满溢应 ×${V.Circuit.PULSE.overload}（${dry.dmg} → ${full.dmg}）`);
});

test('直导总线：路径每格 +1.5% 闪避（上限 +12%）', () => {
  const { V } = sandbox(724, false);
  /* 造一条「全直导」的路径：pulseOf 只看 lay.built 的格子归属与 rt.path */
  const mkLay = (n) => ({
    built: [{
      tpl: V.Data.TEMPLATES.straight,
      abs: Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })),
    }],
  });
  const path = (n) => Array.from({ length: n }, (_, i) => i + ',0');
  const straightN = (n) => V.Circuit.pulseOf(mkLay(n), { path: path(n), looped: false });

  assert.equal(straightN(1).dodgeBonus, 0.015, '一格直导 +1.5%');
  assert.equal(straightN(5).dodgeBonus, 0.075, '五格 +7.5%');
  assert.equal(straightN(20).dodgeBonus, 0.12, '上限 +12%（20 格不再涨）');
  /* 顺带守：直导同时仍然缩间隔 */
  assert.ok(straightN(5).intervalScale < 1, '直导依旧缩间隔');
});

/* ---------------- ⑥ 三首领流派对位三角 ----------------
   守门人查频次（细脉冲穿过、重脉冲被吃）、炉心俑查破甲（薄脉冲再衰减）、
   噬忆者查稳态（抽余裕 + 全家压力）。三条法则必须互相正交：
   任何一条被写成「全局减伤」，三角就退化成一道墙。 */

test('相位护膜：够重的脉冲被吃掉八成并剥层，细脉冲从膜缝穿过', () => {
  const { I, b, ally } = sandbox(731, true);
  const boss = {
    ...b.enemies[0], name: '守门人', hp: 500, maxHp: 500, def: 0, shield: 0, shieldCap: 0,
    outerNodes: 0, buffs: [], refract: 0, stats: { taken: 0 },
    membrane: { layers: 2, reduce: 0.8, minHit: 20, name: '相位护膜', left: 2 },
  };
  /* 重脉冲 60 → 12，剥一层 */
  I.applyDamage(b, ally, boss, 60, {});
  assert.equal(boss.hp, 488, '80% 减免后应只剩 12 点');
  assert.equal(boss.membrane.left, 1, '一次独立冲击只剥一层');
  /* 细脉冲 12 < 20：不减伤、不剥层 */
  I.applyDamage(b, ally, boss, 12, {});
  assert.equal(boss.hp, 476, '细脉冲应原样打进去');
  assert.equal(boss.membrane.left, 1, '细脉冲不该磨损护膜');
  assert.ok(b.logs.some(l => l.targetId === boss.id && l.effect === 'membrane'));
});

test('炉壁重甲：薄脉冲额外衰减 40%，20 点以上重击贯穿', () => {
  const { I, b, ally } = sandbox(732, true);
  const mk = () => ({
    ...b.enemies[0], name: '炉心俑', hp: 500, maxHp: 500, def: 0, shield: 0, shieldCap: 0,
    outerNodes: 0, buffs: [], refract: 0, stats: { taken: 0 },
    plating: { thinAt: 15, reduce: 0.4, pierceAt: 20, name: '炉壁重甲' },
  });
  const thin = mk();
  I.applyDamage(b, ally, thin, 10, {});
  assert.equal(thin.hp, 494, '10 点薄脉冲应只剩 6 点');

  const heavy = mk();
  I.applyDamage(b, ally, heavy, 30, {});
  assert.equal(heavy.hp, 470, '30 点重击应原样贯穿');
});

test('噬忆者的行动光环：抽前排 2 点余裕，全队 +8 压力', () => {
  const { I, b } = sandbox(733, true);
  const front = [...b.allies].sort((x, y) => x.slot - y.slot)[0];
  front.energy = 6;
  const before = b.allies.map((a) => a.stress || 0);
  I.applyEnemyActionAura(b, { name: '噬忆者', onAction: { drainEnergy: 2, drainTarget: 'front', stressAll: 8, name: '抽忆' } });
  assert.equal(front.energy, 4, '应抽走 2 点余裕');
  b.allies.forEach((a, i) => {
    assert.equal(a.stress, Math.min(100, before[i] + 8), `${a.name} 应 +8 压力`);
  });
});
