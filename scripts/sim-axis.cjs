'use strict';
/* 实战手感模拟：统计「第 1 / 2 / 3 招」的真实上场率。
 *
 * 为什么要有这个脚本：招式数量是纸面设计，能不能放出来是另一回事。
 * 第二招靠 targetHasDot / afterTag，第三招靠 minTier 或 stressAbove——
 * 这些门槛只要定得紧一点，招式就会常年不亮，而单测完全看不出来。
 *
 * 做法：四人小队（四轴各一）→ 主修 4 阶、辅修 3 阶（含 7 阶逆脉）→
 * 用纹路把蚀刻法铺到共鸣二/三阶 → 打到战斗结束 → 数战报里的 cast 日志（带 slot）。
 *
 * 用法：node scripts/sim-axis.cjs [场数]
 */
const { loadVeteran } = require('../tests/helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;

const ROUNDS = Number(process.argv[2]) || 36;
/* 模拟是压力测试台，不是游戏：把敌血钉在一个固定绝对值上（旧版 2.6 × 1.8 = 4.68），
   这样 `DESIGN.enemyHpScale` 怎么调都不影响「单场出手次数」的横向可比性。
   要测真游戏的血量，用 scripts/balance-probe.cjs。 */
const SIM_ENEMY_HP = 4.68;

/* 四轴各一：主修取 4 阶（够触发 minTier 2），辅修取 3 阶（给 afterTag 提供同轴起手）。
   第三位用 7 阶逆脉，专门验「三阶解锁」的终极招能不能放出来。 */
const SQUAD = [
  { skin: 'warden', body: 'sturdy', name: '焰手', primary: 'coalSeam', extra: 'wick' },
  { skin: 'blade', body: 'agile', name: '锋手', primary: 'quarrySaw', extra: 'razor' },
  { skin: 'warlock', body: 'throat', name: '蚀手', primary: 'inverse', extra: 'awl' },
  { skin: 'cleric', body: 'twin', name: '盾手', primary: 'silverTap', extra: 'tide' },
];

/** 蚀刻法格子坐标（绝对） */
function msCells(u) {
  const out = new Set();
  V.State.manuscriptsOf(u).forEach((ms) => V.State.manuscriptCells(ms).forEach((c) => out.add(c.join(','))));
  return out;
}

/**
 * 用纹路把蚀刻法盖住。贪心：每个还没盖住的格子，试遍「模板 × 旋转 × 镜像 × 锚点」，
 * 选能盖最多目标格且不与已有纹路冲突的那一个。负荷到上限就停。
 */
/** 高压队：把负荷顶到上限之上，用「超载 = 开局压力」把自己压到 50+。
    这才是高压流的真装配——不是靠受击攒压力，而是上阵前就背着。 */
function overpressure(st, u, targetOverload) {
  const plate = V.Circuit.plateOf(u);
  const used = new Set(V.Circuit.layout(st, u.board.placements).cells.map((c) => c.x + ',' + c.y));
  const tf = V.Circuit.transformTemplate(D.TEMPLATES.capacitor, 0, false);
  let added = 0;
  const overloadNow = () => V.Circuit.preview(st, u.id, u.board.placements).overload;
  while (overloadNow() < targetOverload && added < 14) {
    let placed = false;
    for (let y = 0; y < plate.size && !placed; y++) {
      for (let x = 0; x < plate.size && !placed; x++) {
        const keys = tf.cells.map((c) => (c.x + x) + ',' + (c.y + y));
        if (!keys.every((k) => plate.cells.has(k))) continue;
        if (keys.some((k) => used.has(k))) continue;
        keys.forEach((k) => used.add(k));
        const item = V.State.makePart(st, { kind: 'circuit', templateId: 'capacitor' });
        st.itemsById[item.id] = item;
        st.stash.push(item.id);
        u.board.placements.push({ itemId: item.id, x, y, rotation: 0, mirrorY: false });
        added += 1;
        placed = true;
      }
    }
    if (!placed) break;
  }
  return added;
}

function coverBoard(st, u) {
  const plate = V.Circuit.plateOf(u);
  const targets = msCells(u);
  const cap = V.Circuit.loadCap(u);
  const used = new Set();
  const placements = [];
  let load = 0;

  const tpls = ['straight', 'elbow', 'capacitor', 'rivet'];
  const pieces = [];
  for (const id of tpls) {
    for (const rot of [0, 1, 2, 3]) {
      for (const mir of [false, true]) {
        const tf = V.Circuit.transformTemplate(D.TEMPLATES[id], rot, mir);
        pieces.push({ id, tf, load: D.TEMPLATES[id].load });
      }
    }
  }

  for (const cell of targets) {
    if (used.has(cell)) continue;
    const [tx, ty] = cell.split(',').map(Number);
    let best = null;
    for (const p of pieces) {
      for (const anchor of p.tf.cells) {
        const ox = tx - anchor.x;
        const oy = ty - anchor.y;
        const keys = p.tf.cells.map((c) => (c.x + ox) + ',' + (c.y + oy));
        if (!keys.every((k) => plate.cells.has(k))) continue;
        if (keys.some((k) => used.has(k))) continue;
        const gain = keys.filter((k) => targets.has(k) && !used.has(k)).length;
        if (!gain) continue;
        if (load + p.load > cap) continue;
        const score = gain * 10 - p.load;
        if (!best || score > best.score) best = { ...p, ox, oy, keys, gain, score };
      }
    }
    if (!best) continue;
    best.keys.forEach((k) => used.add(k));
    load += best.load;
    const item = V.State.makePart(st, { kind: 'circuit', templateId: best.id });
    st.itemsById[item.id] = item;
    st.stash.push(item.id);
    placements.push({ itemId: item.id, x: best.ox, y: best.oy, rotation: 0, mirrorY: false });
  }
  u.board.placements = placements;
  return { placements, load };
}

function buildSquad(seed, opts) {
  const st = V.State.create(seed);
  const party = [];
  SQUAD.forEach((cfg, i) => {
    const u = V.State.makeUnit(st, { skinId: cfg.skin, bodyPreset: cfg.body, name: cfg.name });
    u.manuscript = null;
    u.extraManuscripts = [];
    st.roster.push(u);
    st.team[i] = u.id;
    V.State.equipManuscript(st, u, cfg.primary);
    V.State.placeManuscript(st, u, cfg.extra);
    coverBoard(st, u);
    if (opts.pressure) overpressure(st, u, opts.pressure);
    party.push(u);
  });
  return st;
}

function runOne(seed, floor, opts) {
  const st = buildSquad(seed, opts);
  let s = null;
  try {
    const r = V.Expedition.start(st, { seed });
    if (!r.ok) return null;
    s = r.state;
    s.run.floor = floor;
    /* 压力是跨场保留的（撤离 +10、败退 +20、营火烙印 +40）：
       高压流真实的样子是「带着上一场攒下的 50~70 压力进来」，而不是开局硬堆超载。
       超载那套同时扣回裕，实测会把出手次数压到 1/场，反而不成立。 */
    if (opts.startStress) s.run.party.forEach((p) => { p.stress = opts.startStress; });
    V.Expedition.genNodes(s);
    const node = s.run.nodes.find((n) => n.type === 'boss')
      || s.run.nodes.find((n) => n.type === 'elite')
      || s.run.nodes.find((n) => n.type === 'battle');
    if (!node) return null;
    s = V.Encounter.open(s, node.id).state;
    if (!s || !s.run) return null;
    s = V.Encounter.startAttempt(s).state;

    const tiers = s.run.battle.allies.map((a) => ({
      name: a.name,
      ms: a.ms && a.ms.spec ? a.ms.spec.name : '(无)',
      tier: a.ms ? a.ms.tierIndex : 0,
      pct: a.ms ? a.ms.pct : 0,
      startStress: a.stress,
    }));
    let maxStress = 0;

    if (process.env.DBG) {
      s.run.battle.allies.forEach((a) => {
        const ru = s.roster.find((x) => x.id === a.sourceUnitId);
        const pl = (s.run.fieldLayouts && s.run.fieldLayouts[a.sourceUnitId]) || (ru && ru.board.placements) || [];
        const pv = V.Circuit.preview(s, a.sourceUnitId, pl);
        console.log('DBG', a.name, 'load', pv.load, 'cap', pv.cap, 'over', pv.overload, 'stress', a.stress, 'regen', a.regen);
      });
    }
    let guard = 0;
    /* 引擎自己有 TICK_LIMIT（4200）超时判负，guard 必须比它大，
       否则「被炉心俑拖死」这种局会被当成「没打完」而漏掉 */
    while (!s.run.battle.over && guard++ < V.Combat.TICK_LIMIT + 10) {
      const r2 = V.Combat.step(s);
      if (!r2.ok) { if (process.env.DBG) console.log('STEP_NOT_OK', r2); break; }
      s = r2.state;
      s.run.battle.allies.forEach((a) => { if ((a.stress || 0) > maxStress) maxStress = a.stress; });
    }
    const b = s.run.battle;
    if (process.env.DBG && !b.over) console.log('RECENT', (b.logs || []).slice(-6).map((l) => l.text).join(' | '));
    const casts = b.logs.filter((l) => l.type === 'cast');
    return { tiers, casts, win: b.win, ticks: b.tick, over: b.over, maxStress, outcome: b.outcome };
  } catch (e) {
    if (process.env.DBG) console.log('SIM_ERROR', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : e);
    return null;
  }
}

/* ------------------------------ 跑 ------------------------------ */

function scenario(label, opts) {
  const bySlot = { 1: 0, 2: 0, 3: 0 };
  const bySkill = new Map();
  const tierSeen = new Map();
  let battles = 0, wins = 0, ticks = 0, stressSum = 0, startStressSum = 0, timeouts = 0;

  const hpScale = D.DESIGN.enemyHpScale;
  D.DESIGN.enemyHpScale = Math.round(SIM_ENEMY_HP * (opts.hpMult || 1) * 100) / 100;
  try {
    for (let i = 0; i < ROUNDS; i++) {
      const seed = 77000 + i * 137;
      const floor = 28 + (i % 4) * 7;
      const r = runOne(seed, floor, opts);
      if (!r || !r.over) {
        if (process.env.DBG) console.log('NOT_OVER seed', seed, 'r', r && { ticks: r.ticks, over: r.over, win: r.win });
        continue;
      }
      battles += 1;
      if (r.win) wins += 1;
      if (r.outcome === 'timeout') timeouts += 1;
      ticks += r.ticks;
      stressSum += r.maxStress;
      startStressSum += r.tiers.reduce((a, t) => a + (t.startStress || 0), 0) / Math.max(1, r.tiers.length);
      r.tiers.forEach((t) => {
        const k = `${t.ms} ${t.tier}阶(${t.pct}%)`;
        tierSeen.set(k, (tierSeen.get(k) || 0) + 1);
      });
      r.casts.forEach((c) => {
        const slot = c.slot || 1;
        bySlot[slot] = (bySlot[slot] || 0) + 1;
        const key = `${slot}|${c.tag || '—'}|${c.skillId || c.text}`;
        bySkill.set(key, (bySkill.get(key) || 0) + 1);
      });
    }
  } finally { D.DESIGN.enemyHpScale = hpScale; }

  const total = bySlot[1] + bySlot[2] + bySlot[3];
  console.log(`\n=== ${label} ===`);
  console.log(`场次 ${battles}（胜 ${wins}，超时判负 ${timeouts}），平均 ${(ticks / Math.max(1, battles)).toFixed(0)} tick，`
    + `起始压力均值 ${(startStressSum / Math.max(1, battles)).toFixed(0)}、全程峰值均值 ${(stressSum / Math.max(1, battles)).toFixed(0)}`);
  console.log('装配与共鸣阶：' + [...tierSeen.entries()].sort().map(([k, n]) => `${k}×${n}`).join('　'));
  [1, 2, 3].forEach((sl) => {
    const n = bySlot[sl] || 0;
    console.log(`  第 ${sl} 招：${n} 次，场均 ${(n / Math.max(1, battles)).toFixed(2)}，占比 ${total ? Math.round((n / total) * 100) : 0}%`);
  });
  const low = [];
  [...bySkill.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
    const [slot, tag, id] = k.split('|');
    const per = n / Math.max(1, battles);
    console.log(`    slot${slot} [${tag}] ${id}：${n} 次，场均 ${per.toFixed(2)}`);
    if (per < 0.5) low.push(`${id}(slot${slot})`);
  });
  return { bySlot, bySkill, battles, low };
}

/* LEGACY=1：把超载罚项与导通门槛退回改造前（−0.08/点、没有导通），
   用同一份代码跑出「改之前」的对照数，免得拿旧版本的记忆去比 */
if (process.env.LEGACY) {
  D.DESIGN.overload = { stressPerPoint: 8, regenPerPoint: 0.08, heatThreshold: 999 };
}

const normal = scenario('常规队（压力 0 进场）', {});
scenario(process.env.LEGACY ? '高压队 A（改造前：−0.08/点、无导通）' : '高压队 A：靠超载压上去（−0.04/点 + 高热）',
  { pressure: 6, hpMult: 1.8 });
scenario('高压队 B：带上一场的压力进场（+55）', { startStress: 55, hpMult: 1.8 });
