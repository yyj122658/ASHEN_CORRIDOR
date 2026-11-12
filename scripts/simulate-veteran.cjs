'use strict';
/* 老兵回路数值模拟：固定种子，不生成长篇报告文件，只在终端输出。
   用法：node scripts/simulate-veteran.cjs [每格种子数]
   注意：这里只做“同一策略下的分布”，不用胜率宣称平衡已完成。 */
const { loadVeteran } = require('../tests/helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;
const N = Number(process.argv[2] || 40);

function applyPreset(st, unitId, presetId) {
  const preset = D.PRESETS[presetId];
  const draft = preset.layout.map((slot) => {
    const part = V.State.makePart(st, { kind: 'circuit', templateId: slot.templateId });
    st.itemsById[part.id] = part;
    return { itemId: part.id, x: slot.x, y: slot.y, rotation: 0, mirrorY: false };
  });
  const r = V.Roster.saveBoard(st, unitId, draft);
  return r.ok ? r.state : st;
}

function setFormation(st, order) {
  const ids = order.map((i) => st.roster[i].id);
  const next = V.State.clone(st);
  next.team = ids.slice();
  return next;
}

function customGambits(st) {
  const next = V.State.clone(st);
  next.roster.forEach((u) => {
    u.gambits = [
      { id: 'a', enabled: true, conditions: [{ type: 'allyHpBelow', value: 50 }], target: 'lowestHpAlly', action: 'support' },
      { id: 'b', enabled: true, conditions: [{ type: 'always' }], target: 'lowestHpFoe', action: 'main' },
      { id: 'c', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action: 'guard' },
    ].slice(0, u.logicSlots);
  });
  return next;
}

function fight(seed, kind, floor, cfg) {
  let st = V.State.create(seed);
  if (cfg.preset) {
    st = applyPreset(st, st.roster[0].id, cfg.preset);
    st = applyPreset(st, st.roster[1].id, cfg.preset);
  }
  if (cfg.formation) st = setFormation(st, cfg.formation);
  if (cfg.gambits === 'custom') st = customGambits(st);

  const started = V.Expedition.start(st, { seed });
  if (!started.ok) return { error: started.error };
  st = started.state;
  st.run.floor = floor;

  const inst = V.State.clone(st);
  inst.run.nodes = [{ id: 'n', type: kind === 'boss' ? 'boss' : kind === 'elite' ? 'elite' : 'battle', consumed: false }];
  const opened = V.Encounter.open(inst, 'n');
  if (!opened.ok) return { error: opened.error };
  const att = V.Encounter.startAttempt(opened.state);
  if (!att.ok) return { error: att.error };
  st = att.state;

  let ticks = 0;
  while (st.run.battle && !st.run.battle.over && ticks < 4000) {
    const r = V.Combat.step(st);
    if (!r.ok) return { error: r.error };
    st = r.state;
    ticks += 1;
  }
  const b = st.run.battle;
  const totalMax = b.allies.reduce((s, x) => s + x.maxHp, 0);
  const v = V.State.validate(st);
  return {
    win: b.win,
    outcome: b.outcome,
    rounds: b.round,
    ticks,
    takenPct: Math.round(((b.stats.taken || 0) / totalMax) * 100),
    healPct: Math.round(((b.stats.healing || 0) / totalMax) * 100),
    bothAlive: b.allies.filter((x) => x.alive).length,
    legal: v.ok,
    illegal: v.ok ? null : v.errors[0],
  };
}

const CONFIGS = [
  { id: 'A 默认阵型 + 基础直供 + 默认指令', formation: [0, 1, 2, 3], preset: 'basic', gambits: 'default' },
  { id: 'B 默认阵型 + 蓄能回路 + 默认指令', formation: [0, 1, 2, 3], preset: 'charge', gambits: 'default' },
  { id: 'C 默认阵型 + 基础直供 + 定制指令', formation: [0, 1, 2, 3], preset: 'basic', gambits: 'custom' },
];

console.log(`固定种子 1–${N}，每种配置 × 三种遭遇\n`);

const rows = [];
let illegalCount = 0;

for (const cfg of CONFIGS) {
  for (const [kind, floor] of [['normal', 1], ['normal', 22], ['elite', 36], ['boss', 49]]) {
    let n = 0;
    let win = 0;
    let rounds = 0;
    let taken = 0;
    let heal = 0;
    let errors = 0;
    for (let seed = 1; seed <= N; seed++) {
      const r = fight(seed * 7919, kind, floor, cfg);
      if (r.error) { errors += 1; continue; }
      if (!r.legal) illegalCount += 1;
      n += 1;
      if (r.win) win += 1;
      rounds += r.rounds;
      taken += r.takenPct;
      heal += r.healPct;
    }
    rows.push({
      cfg: cfg.id,
      kind,
      floor,
      win: Math.round((win / n) * 100),
      rounds: (rounds / n).toFixed(1),
      taken: Math.round(taken / n),
      heal: Math.round(heal / n),
      errors,
    });
  }
}

console.table(rows.map((r) => ({
  配置: r.cfg.slice(0, 1),
  遭遇: `${r.kind}@${r.floor}`,
  胜率: r.win + '%',
  回合: r.rounds,
  承伤: r.taken + '%',
  治疗: r.heal + '%',
  错误: r.errors,
})));

/* ---------------- 七层端到端 ---------------- */

function fullRun(seed, policy) {
  let st = V.State.create(seed);
  const started = V.Expedition.start(st, { seed });
  if (!started.ok) return { error: started.error };
  st = started.state;
  const log = { confirm: 0, retry: 0, inscribe: 0, extract: null, depth: 0, illegal: null };

  for (let guard = 0; guard < 400; guard++) {
    if (!st.run) break;
    const r = st.run;

    if (r.stage === 'map') {
      const hp = r.party.reduce((acc, p) => {
        const u = st.roster.find((x) => x.id === p.uid);
        const max = V.Roster.stats(st, u).maxHp;
        return acc + (p.hp == null ? max : p.hp) / max;
      }, 0) / Math.max(1, r.party.length);

      if (hp < policy.extractBelow && r.completedFloors >= 1) {
        const ex = V.Expedition.extract(st, false);
        log.extract = ex.ok ? 'extract' : 'extract_fail';
        if (ex.ok) st = ex.state;
        break;
      }
      const pick = r.nodes.find((n) => !n.consumed && policy.prefer.includes(n.type))
        || r.nodes.find((n) => !n.consumed);
      if (!pick) { log.extract = 'stuck'; break; }
      const c = V.Expedition.chooseNode(st, pick.id);
      if (!c.ok) { log.illegal = c.error.message; break; }
      st = c.state;
      continue;
    }

    if (r.stage === 'prebattle') {
      const a = V.Encounter.startAttempt(st);
      if (!a.ok) { log.illegal = a.error.message; break; }
      st = a.state;
      continue;
    }

    if (r.stage === 'battle') {
      let ticks = 0;
      while (st.run && st.run.battle && !st.run.battle.over && ticks < 4000) {
        const s = V.Combat.step(st);
        if (!s.ok) { log.illegal = s.error.message; break; }
        st = s.state;
        ticks += 1;
      }
      if (log.illegal) break;
      const prep = V.Combat.prepareResult(st);
      if (!prep.ok) { log.illegal = prep.error.message; break; }
      const outcome = prep.pendingResult.outcome;
      /* 战败重试一次，再败就认 */
      if (outcome !== 'win' && log.retry < policy.maxRetry) {
        log.retry += 1;
        const rw = V.Encounter.rewind(st);
        if (!rw.ok) { log.illegal = rw.error.message; break; }
        st = rw.state;
        continue;
      }
      if (outcome === 'win') {
        const c = V.Encounter.confirm(st);
        if (!c.ok) { log.illegal = c.error.message; break; }
        st = c.state;
        log.confirm += 1;
        continue;
      }
      const d = V.Expedition.retreat(st, 'defeat');
      if (!d.ok) { log.illegal = d.error.message; break; }
      st = d.state;
      log.extract = 'defeat';
      break;
    }

    if (r.stage === 'loot') {
      for (const id of r.pendingLoot) {
        if (!V.Expedition.canPack(st, 'part:' + id)) continue;
        const taken = V.Expedition.resolveLoot(st, id, 'take');
        if (!taken.ok) { log.illegal = taken.error.message; break; }
        st = taken.state;
      }
      if (log.illegal) break;
      const f = V.Expedition.finishNode(st, true);
      if (!f.ok) { log.illegal = f.error.message; break; }
      st = f.state;
      continue;
    }

    if (r.stage === 'event') {
      const ev = r.event;
      if (!ev.resolved) {
        const def = D.event(ev.eventId);
        const c = V.Expedition.chooseEvent(st, def.choices[def.choices.length - 1].id);
        if (!c.ok) { log.illegal = c.error.message; break; }
        st = c.state;
        continue;
      }
      if (st.run.pendingLoot.length) {
        const fix = V.Expedition.resolveLoot(st, st.run.pendingLoot[0], 'discard');
        if (fix.ok) { st = fix.state; continue; }
      }
      const f = V.Expedition.finishNode(st);
      if (!f.ok) { log.illegal = f.error.message; break; }
      st = f.state;
      continue;
    }

    if (r.stage === 'camp') {
      /* 玩家会看血线决定要不要休息 */
      const avgHp = r.party.reduce((acc, p) => {
        const u = st.roster.find((x) => x.id === p.uid);
        const max = V.Roster.stats(st, u).maxHp;
        return acc + (p.hp == null ? max : p.hp) / max;
      }, 0) / Math.max(1, r.party.length);
      if (avgHp < 0.72) {
        const rest = V.Expedition.campRest(st);
        if (rest.ok) { st = rest.state; log.rest = (log.rest || 0) + 1; }
      }
      /* 有本局新构件就尝试一次烙印 */
      const hasNew = r.bag.some((id) => st.itemsById[id] && st.itemsById[id].acquiredRunId === r.id);
      if (hasNew && log.inscribe === 0 && policy.inscribe) {
        const unit = st.roster.find((u) => u.id === r.party[0].uid);
        const gate = V.Expedition.inscribable(st, unit.id);
        if (gate.ok) {
          const itemId = r.bag.find((id) => st.itemsById[id] && st.itemsById[id].acquiredRunId === r.id);
          const park = D.STRAIGHT_PARK[unit.bodyPreset];
          const draft = unit.board.placements.map((p) => (
            p.x === 0 && p.y === 1 ? { ...p, x: park.x, y: park.y } : { ...p }
          ));
          draft.push({ itemId, x: 0, y: 1, rotation: 0, mirrorY: false });
          const ins = V.Expedition.inscribe(st, unit.id, itemId, draft);
          if (ins.ok) { st = ins.state; log.inscribe += 1; }
        }
      }
      const f = V.Expedition.finishNode(st);
      if (!f.ok) { log.illegal = f.error.message; break; }
      st = f.state;
      continue;
    }

    if (r.stage === 'merchant') {
      const f = V.Expedition.finishNode(st);
      if (!f.ok) { log.illegal = f.error.message; break; }
      st = f.state;
      continue;
    }

    if (r.stage === 'blessing') {
      const pick = V.Expedition.chooseBlessing(st, st.run.blessingOptions[0]);
      if (!pick.ok) { log.illegal = pick.error.message; break; }
      st = pick.state;
      continue;
    }

    if (r.stage === 'battleReview') {
      const c = V.Encounter.confirm(st);
      if (c.ok) { st = c.state; log.confirm += 1; continue; }
      const d = V.Expedition.retreat(st, 'defeat');
      if (!d.ok) { log.illegal = d.error.message; break; }
      st = d.state;
      log.extract = 'defeat';
      break;
    }

    log.illegal = 'unknown stage ' + r.stage;
    break;
  }

  const v = V.State.validate(st);
  if (!v.ok) log.illegal = v.errors[0];
  log.depth = st.settlement ? st.settlement.depth : (st.run ? st.run.completedFloors : 0);
  log.mode = st.settlement ? st.settlement.mode : null;
  log.eligible = st.settlement ? st.settlement.eligible : false;
  return log;
}

const POLICIES = [
  { id: '稳健（40% 撤离，偏好战斗）', extractBelow: 0.4, prefer: ['battle', 'elite', 'camp', 'chest'], maxRetry: 1, inscribe: true },
  { id: '贪心（不主动撤离，偏好战斗）', extractBelow: 0.0, prefer: ['battle', 'elite', 'boss', 'chest'], maxRetry: 1, inscribe: true },
  { id: '保守（65% 撤离，偏好安全节点）', extractBelow: 0.65, prefer: ['camp', 'chest', 'event', 'battle'], maxRetry: 0, inscribe: false },
];

const runRows = [];
for (const p of POLICIES) {
  let n = 0;
  let clear = 0;
  let extract = 0;
  let defeat = 0;
  let bad = 0;
  let depth = 0;
  for (let seed = 1; seed <= Math.min(N, 30); seed++) {
    const r = fullRun(seed * 104729, p);
    if (r.error || r.illegal) { bad += 1; if (r.illegal) console.log('  ! 非法状态：', r.illegal); continue; }
    n += 1;
    depth += r.depth;
    if (r.mode === 'clear') clear += 1;
    else if (r.mode === 'extract') extract += 1;
    else if (r.mode === 'defeat') defeat += 1;
  }
  runRows.push({
    策略: p.id,
    局数: n,
    通关: clear,
    撤离: extract,
    败退: defeat,
    平均完成层: (depth / Math.max(1, n)).toFixed(1),
    非法状态: bad,
  });
}

console.log(`\n七层端到端（每策略 ${Math.min(N, 30)} 局）：`);
console.table(runRows);
console.log(`\n单场战斗中出现的非法状态总数：${illegalCount}`);
