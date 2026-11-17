'use strict';
/* v4.0 拓扑流派模拟器：三种鲜明构筑各打一批固定种子的战斗。
   用法：node scripts/simulate-veteran.cjs [每档局数]

   这里只回答三个问题：
     ① 三个流派在同层域下的胜率差多少；
     ② 一场要打几个回合（0.24s/tick，6 tick 一回合）；
     ③ 外围熔断触发得有多频繁（挡伤机制到底有没有在工作）。
   不做「平衡已完成」的宣称 —— 单一种子族的分布只能说明趋势。 */
const { loadVeteran } = require('../tests/helpers/load-veteran.cjs');
const { autoRouteBoard } = require('../tests/helpers/veteran-run.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;
const N = Number(process.argv[2] || 50);
const FLOORS = [1, 22, 36, 49];

/* 三种纯色流派 + 一队混编标准队。
   配方是「刻什么」，不是「装什么」—— v4.0 的面板与输出全部由这份配方编译出来。
   七标起每个预设是**成员数组**：纯色流派全员同一套配方，
   混编队按真实玩家的 1/2/3/4 号位各刻一条轴。 */
const PRESETS = [
  {
    id: 'A',
    name: '高频直导流',
    members: [{ body: 'agile', style: 'straight', ms: 'flurry' }],
    note: '直导每格 −4% 间隔，堆到 −30% 上限；靠出手次数吃饭',
  },
  {
    id: 'B',
    name: '九曲线圈炮',
    members: [{ body: 'corner', style: 'elbow', ms: 'inverse' }],
    note: '每个 90° 转折 +12%，回钩再 +20%，储能抬满再放电',
  },
  {
    id: 'C',
    name: '高温余烬超频流',
    members: [{ body: 'waist', style: 'ember', ms: 'ember12', overload: 0.35 }],
    note: '余烬吸压换幅值，闸门在高热时 ×1.65，两截再乘 1.45',
  },
  {
    id: 'Mix',
    name: '混编标准队',
    members: [
      { body: 'sturdy', style: 'capacitor', ms: 'wide14', role: '缓冲前排' },
      { body: 'agile', style: 'straight', ms: 'flurry', role: '高频直导' },
      { body: 'corner', style: 'elbow', ms: 'inverse', role: '九曲线圈炮' },
      { body: 'waist', style: 'ember', ms: 'ember12', role: '高温余烬' },
    ],
    note: '1 缓冲 / 2 直导 / 3 线圈炮 / 4 余烬 —— 全局难度标尺，不是天花板',
  },
];

/** 上阵人数按层域走：前一天只有两个人，深处才凑得满四个（和真实流程一致） */
function partySizeFor(floor) {
  return floor <= 7 ? 2 : floor <= 35 ? 3 : 4;
}

/** 混编队按顺序上人（前排先上），纯色流派全员同配方 */
function memberAt(preset, i) {
  return preset.members[i % preset.members.length];
}

function presetTag(preset) {
  if (preset.members.length === 1) {
    const m = preset.members[0];
    return `底盘 ${m.body} · 主修 ${D.MANUSCRIPTS[m.ms].name} · 布线 ${m.style}`;
  }
  return preset.members.map((m, i) => `${i + 1}号 ${m.role}(${m.style})`).join(' / ');
}

function compose(preset, seed, floor) {
  let st = V.State.create(seed);
  st.roster = [];
  st.team = [];
  const size = partySizeFor(floor);
  const skins = V.Data.SKINS.map((x) => x.id);
  for (let i = 0; i < size; i++) {
    const mb = memberAt(preset, i);
    /* 直接按流派底盘造人：先改老角色的 bodyPreset 会让已装蚀刻法的坐标落到新板面之外 */
    const u = V.State.makeUnit(st, {
      skinId: skins[i % skins.length],
      bodyPreset: mb.body,
      name: `${preset.id}${i + 1}${mb.role ? '-' + mb.role : ''}`,
    });
    st.roster.push(u);
    st.team.push(u.id);
    for (let s = 1; !u.manuscript && s < 200; s++) {
      V.State.equipManuscript(st, u, mb.ms);
      if (!u.manuscript) u.plateSeed = s;
    }
    /* 蚀刻法先落位，再交给端口图布线器：它会重新摆姿态、铺通路、填余格 */
    V.State.manuscriptsOf(u).forEach((m) => { V.State.placeManuscript(st, u, m.id); });
    const routed = autoRouteBoard(A, st, u, {
      style: mb.style,
      overload: mb.overload || 0,
    });
    if (!routed.ok) {
      if (!compose.failures) compose.failures = [];
      compose.failures.push(`${preset.id}${i + 1}: ${routed.reason}`);
    }
  }
  if (compose.failures && compose.failures.length) {
    console.error('布线失败：\n  ' + compose.failures.slice(0, 6).join('\n  '));
    compose.failures = [];
  }
  return st;
}

function fightOne(preset, seed, floor, bossId) {
  let st = compose(preset, seed, floor);
  const started = V.Expedition.start(st, { seed });
  if (!started.ok) return null;
  st = started.state;
  st.run.floor = floor;
  const kind = floor >= 49 ? 'boss' : (floor === 22 || floor === 36) ? 'elite' : 'battle';
  st.run.nodes = [{ id: 'n', type: kind, consumed: false }];
  const opened = V.Encounter.open(st, 'n', bossId ? { bossId } : undefined);
  if (!opened.ok) return null;
  let s = V.Encounter.startAttempt(opened.state).state;
  const b0 = s.run.battle;
  const slots = [...b0.allies, ...b0.enemies].length;
  /* 贯通率：路径为空说明「覆盖满了但没接通」，脉冲层的机制一律不生效 */
  const routedAllies = b0.allies.filter((a) => a.pulse && a.pulse.path && a.pulse.path.length).length;
  let guard = 0;
  let heatUnits = 0;
  let liveUnits = 0;
  while (!s.run.battle.over && guard++ < V.Combat.TICK_LIMIT + 10) {
    const r = V.Combat.step(s);
    if (!r.ok) break;
    s = r.state;
    /* 高热覆盖率：每 tick 数一次「压力 >=50 的存活单位 / 存活单位」 */
    const units = [...s.run.battle.allies, ...s.run.battle.enemies].filter((u) => u.alive !== false);
    liveUnits += units.length;
    heatUnits += units.filter((u) => (u.stress || 0) >= 50).length;
  }
  const b = s.run.battle;
  const logs = b.logs || [];
  /* 熔断要两边一起数：我方烧的是**板面纹路**（fusedNodes），
     敌方烧的是**外围节点层**（outerNodes 递减）—— 同一个机制的两个化身。
     七标之前只数了前者，于是「敌人被破壳」永远不出现在表里，
     看上去像保险丝整条没通电。 */
  const allyFused = b.allies.reduce((n, u) => n + ((u.fusedNodes || []).length), 0);
  const shellBurst = b.enemies.reduce((n, u, i) => {
    const before = (b0.enemies[i] && b0.enemies[i].outerNodes) || 0;
    return n + Math.max(0, before - (u.outerNodes || 0));
  }, 0);
  const fused = allyFused + shellBurst;
  const starved = [...b.allies, ...b.enemies].filter((u) => (u.starveTicks || 0) >= 6).length;
  /* 过程指标：从日志里数，不额外埋点 */
  const discharge = logs.filter((l) => l.text && l.text.includes('整仓放电')).length;
  const starveKill = logs.filter((l) => l.text && l.text.includes('枯竭停机')).length;
  const interrupted = logs.filter((l) => l.type === 'disrupt' && l.text && l.text.includes('被打断')).length;
  const heatRate = liveUnits ? heatUnits / liveUnits : 0;
  /* 通路画像：接通之后每家该有的差异，全在这四个数上 */
  const avg = (list, fn) => (list.length ? list.reduce((a, x) => a + fn(x), 0) / list.length : 0);
  const snap = {
    straight: avg(b0.allies, (a) => (a.pulse && a.pulse.straight) || 0),
    turns: avg(b0.allies, (a) => (a.pulse && a.pulse.turns) || 0),
    dodge: avg(b0.allies, (a) => a.dodge || 0),
    amp: avg(b0.allies, (a) => a.pulseAmp || 1),
    id: avg(b0.allies, (a) => a.attackInterval || 0),
  };
  return { win: !!b.win, rounds: b.round, fused, slots, starved, over: !!b.over, ticks: b.tick,
    discharge, starveKill, interrupted, heatRate, routed: routedAllies, allies: b0.allies.length, snap };
}

function run(preset) {
  return FLOORS.map((floor) => {
    let win = 0;
    let n = 0;
    let rounds = 0;
    let fused = 0;
    let slots = 0;
    let starved = 0;
    let timeouts = 0;
    let discharge = 0;
    let starveKill = 0;
    let interrupted = 0;
    let heat = 0;
    let routed = 0;
    let allySlots = 0;
    const snap = { straight: 0, turns: 0, dodge: 0, amp: 0, id: 0 };
    for (let i = 0; i < N; i++) {
      const r = fightOne(preset, 90000 + i * 37, floor);
      if (!r) continue;
      n += 1;
      if (r.win) win += 1;
      rounds += r.rounds;
      fused += r.fused;
      slots += r.slots;
      starved += r.starved;
      if (!r.over) timeouts += 1;
      discharge += r.discharge;
      starveKill += r.starveKill;
      interrupted += r.interrupted;
      heat += r.heatRate;
      routed += r.routed;
      allySlots += r.allies;
      Object.keys(snap).forEach((k) => { snap[k] += (r.snap && r.snap[k]) || 0; });
    }
    return {
      floor,
      n,
      win,
      rate: n ? win / n : 0,
      rounds: n ? rounds / n : 0,
      fuseRate: slots ? fused / slots : 0,
      starveRate: slots ? starved / slots : 0,
      timeouts,
      discharge: n ? discharge / n : 0,
      starveKill: n ? starveKill / n : 0,
      interrupted: n ? interrupted / n : 0,
      heat: n ? heat / n : 0,
      routed: allySlots ? routed / allySlots : 0,
      snap: Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, n ? v / n : 0])),
    };
  });
}

console.log(`v4.0 拓扑流派模拟：每档 ${N} 局，层域 ${FLOORS.join(' / ')}`);
console.log('规则：0.24s/tick，6 tick 一回合；敌人按「核心节点」量级（普通 45~85 血 / 首领 180~240）\n');

const summary = [];
PRESETS.forEach((preset) => {
  const rows = run(preset);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const wins = rows.reduce((a, r) => a + r.win, 0);
  const rounds = rows.reduce((a, r) => a + r.rounds * r.n, 0) / Math.max(1, total);
  const fuse = rows.reduce((a, r) => a + r.fuseRate * r.n, 0) / Math.max(1, total);
  const starve = rows.reduce((a, r) => a + r.starveRate * r.n, 0) / Math.max(1, total);
  const discharge = rows.reduce((a, r) => a + r.discharge * r.n, 0) / Math.max(1, total);
  const starveKill = rows.reduce((a, r) => a + r.starveKill * r.n, 0) / Math.max(1, total);
  const interrupted = rows.reduce((a, r) => a + r.interrupted * r.n, 0) / Math.max(1, total);
  const heat = rows.reduce((a, r) => a + r.heat * r.n, 0) / Math.max(1, total);
  const snap = ['straight', 'turns', 'dodge', 'amp', 'id'].reduce((acc, k) => {
    acc[k] = rows.reduce((a, r) => a + (r.snap[k] || 0) * r.n, 0) / Math.max(1, total);
    return acc;
  }, {});
  const routed = rows.reduce((a, r) => a + r.routed * r.n, 0) / Math.max(1, total);
  console.log(`=== 预设 ${preset.id}：${preset.name} ===`);
  console.log(presetTag(preset));
  console.log(`　${preset.note}`);
  console.log('　层域  局数  通关率  平均回合  熔断/人  放电/局  枯竭击杀  打断重铸  高热覆盖  贯通%');
  rows.forEach((r) => {
    console.log(`　F${String(r.floor).padStart(2)}  ${String(r.n).padStart(4)}  ${(r.rate * 100).toFixed(0).padStart(4)}%  ${r.rounds.toFixed(1).padStart(7)}  ${r.fuseRate.toFixed(2).padStart(7)}  ${r.discharge.toFixed(2).padStart(6)}  ${r.starveKill.toFixed(2).padStart(7)}  ${r.interrupted.toFixed(2).padStart(7)}  ${(r.heat * 100).toFixed(0).padStart(7)}%  ${(r.routed * 100).toFixed(0).padStart(5)}%`);
  });
  console.log(`　合计 ${total} 局 · 通关 ${wins}（${(wins / Math.max(1, total) * 100).toFixed(0)}%）· 平均 ${rounds.toFixed(1)} 回合 · 熔断 ${fuse.toFixed(2)}/人 · 停机 ${starve.toFixed(2)}/人`);
  console.log(`　　　 放电 ${discharge.toFixed(2)}/局 · 枯竭击杀 ${starveKill.toFixed(2)}/局 · 打断重铸 ${interrupted.toFixed(2)}/局 · 高热覆盖 ${(heat * 100).toFixed(0)}%`);
  const sn = snap;
  console.log(`　　　 通路：直导格 ${sn.straight.toFixed(1)} · 转角 ${sn.turns.toFixed(1)} · 闪避 ${(sn.dodge * 100).toFixed(1)}% · 幅值 ×${sn.amp.toFixed(2)} · 出手间隔 ${sn.id.toFixed(2)}s\n`);
  summary.push({
    id: preset.id, name: preset.name, rate: wins / Math.max(1, total), rounds, fuse, starve,
    discharge, starveKill, interrupted, heat, routed,
    straight: sn.straight, turns: sn.turns, dodge: sn.dodge, amp: sn.amp,
  });
});

console.log('=== 三流派对比 ===');
console.log('预设              通关率  平均回合  熔断/人  放电/局  枯竭杀  打断  高热%  贯通%');
summary.forEach((s) => {
  console.log(`${(s.id + ' ' + s.name).padEnd(16)}  ${(s.rate * 100).toFixed(0).padStart(4)}%  ${s.rounds.toFixed(1).padStart(7)}  ${s.fuse.toFixed(2).padStart(7)}  ${s.discharge.toFixed(2).padStart(6)}  ${s.starveKill.toFixed(2).padStart(6)}  ${s.interrupted.toFixed(2).padStart(5)}  ${(s.heat * 100).toFixed(0).padStart(5)}%  ${(s.routed * 100).toFixed(0).padStart(5)}%`);
});
console.log('');
console.log('通路画像          直导格  转角  闪避%  幅值×');
summary.forEach((s) => {
  console.log(`${(s.id + ' ' + s.name).padEnd(16)}  ${s.straight.toFixed(1).padStart(6)}  ${s.turns.toFixed(1).padStart(4)}  ${(s.dodge * 100).toFixed(1).padStart(5)}  ${s.amp.toFixed(2).padStart(5)}`);
});

/* ---------------- F49 分首领胜率矩阵 ----------------
   三位关底首领各带一条正交的防御法则（频次 / 破甲 / 压力）。
   这张矩阵要回答的不是「难不难」，而是「谁的天敌是谁」：
   如果三列对某个预设是同一个数，说明那条对位法则没有生效。 */
const BOSSES = [
  { id: 'gatekeeper', tag: '频次', short: '守门人' },
  { id: 'memoryEater', tag: '压力', short: '噬忆者' },
  { id: 'furnaceHeart', tag: '破甲', short: '炉心俑' },
];
const matrixN = Math.max(6, Math.min(N, 25));
console.log(`\n=== F49 分首领胜率矩阵（每格 ${matrixN} 局）===`);
console.log('预设      ' + BOSSES.map((b) => `${b.short}(${b.tag})`.padStart(14)).join(''));
const matrix = {};
PRESETS.forEach((preset) => {
  const cells = BOSSES.map((boss) => {
    let win = 0;
    let n = 0;
    let rounds = 0;
    for (let i = 0; i < matrixN; i++) {
      const r = fightOne(preset, 90000 + i * 37, 49, boss.id);
      if (!r) continue;
      n += 1;
      if (r.win) win += 1;
      rounds += r.rounds;
    }
    const rate = n ? win / n : 0;
    matrix[preset.id + ':' + boss.id] = rate;
    return `${(rate * 100).toFixed(0)}% ${(n ? rounds / n : 0).toFixed(1)}r`.padStart(14);
  });
  console.log(`${(preset.id + ' ' + preset.name).padEnd(10)}${cells.join('')}`);
});
console.log('');
console.log('判读：每个预设应有「一列高、一列低」。三列齐平说明对位没有咬合，');
console.log('      需要回到 data.js 检查 membrane / plating / onAction 是否真的挂到了单位上。');
