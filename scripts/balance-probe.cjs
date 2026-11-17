'use strict';
/* 平衡探针：固定策略（见下）跑完整七层，统计「活到第几层」。
 *
 * 用法：
 *   node scripts/balance-probe.cjs                 # 用当前 DESIGN.enemyHpScale
 *   node scripts/balance-probe.cjs 1.45 1.55 1.65  # 横向比几个档位
 *
 * 为什么要它：vetrean-balance 那条测试只跑一个种子（4242），单种子通过不代表标尺合适。
 * 这里一次跑一批种子，看的是分布：均值太低＝开局劝退，均值贴顶＝没有构筑检验。
 *
 * 策略是「尽可能往前推」：每层挑首领优先，打完就地撤退不捡东西——
 * 也就是「只测战斗能不能推进」，不混入资源管理与运气。
 */
const { loadVeteran } = require('../tests/helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;

const STRATEGY = '首领优先 + 打完即撤（只测战斗推进）';

function runOne(seed) {
  let st = V.State.create(seed, { classicPlate: true });
  st = V.Expedition.start(st, { seed }).state;
  let guard = 0;
  let wins = 0;
  let timeouts = 0;

  while (st.run && guard++ < 200) {
    const r = st.run;
    if (r.stage === 'map') {
      const left = r.nodes.filter((n) => !n.consumed);
      if (!left.length) break;
      const pick = left.find((n) => n.type === 'boss') || left[0];
      const c = V.Expedition.chooseNode(st, pick.id);
      if (!c.ok) break;
      st = c.state;
      continue;
    }
    if (r.stage === 'prebattle') {
      const a = V.Encounter.startAttempt(st);
      if (!a.ok) break;
      st = a.state;
      continue;
    }
    if (r.stage === 'battle') {
      let t = 0;
      while (st.run.battle && !st.run.battle.over && t < 4000) {
        st = V.Combat.step(st).state;
        t += 1;
      }
      if (t >= 4000) timeouts += 1;
      const prep = V.Combat.prepareResult(st);
      if (!prep.ok) break;
      if (prep.pendingResult.outcome === 'win') {
        wins += 1;
        st = V.Encounter.confirm(st).state;
      } else {
        /* 输了就撤，记录走到第几层 */
        const d = V.Expedition.retreat(st, 'defeat');
        st = d.state;
        break;
      }
      continue;
    }
    if (r.stage === 'loot') {
      let i = 0;
      while (st.run.pendingLoot.length && i++ < 12) {
        st = V.Expedition.resolveLoot(st, st.run.pendingLoot[0], 'discard').state;
      }
      const f = V.Expedition.finishNode(st);
      if (!f.ok) break;
      st = f.state;
      continue;
    }
    if (r.stage === 'camp' || r.stage === 'merchant') {
      const f = V.Expedition.finishNode(st);
      if (!f.ok) break;
      st = f.state;
      continue;
    }
    if (r.stage === 'blessing') {
      const c = V.Expedition.chooseBlessing(st, st.run.blessingOptions[0]);
      if (!c.ok) break;
      st = c.state;
      continue;
    }
    if (r.stage === 'event') {
      if (!st.run.event.resolved) {
        const ev = D.event(st.run.event.eventId);
        const c = V.Expedition.chooseEvent(st, ev.choices[ev.choices.length - 1].id);
        if (!c.ok) break;
        st = c.state;
        continue;
      }
      if (st.run.pendingLoot.length) {
        st = V.Expedition.resolveLoot(st, st.run.pendingLoot[0], 'discard').state;
        continue;
      }
      const f = V.Expedition.finishNode(st);
      if (!f.ok) break;
      st = f.state;
      continue;
    }
    break;
  }

  const depth = st.settlement ? st.settlement.depth : wins;
  return { depth: depth || 0, wins, timeouts, done: !st.run };
}

function measure(scale, seeds) {
  D.DESIGN.enemyHpScale = scale;
  const rows = seeds.map((s) => runOne(s));
  const depths = rows.map((r) => r.depth);
  const avg = depths.reduce((a, b) => a + b, 0) / depths.length;
  const full = depths.filter((d) => d >= 7).length;
  const stuck = depths.filter((d) => d <= 1).length;
  const timeouts = rows.reduce((a, r) => a + r.timeouts, 0);
  return {
    scale, n: seeds.length, avg: avg.toFixed(2), full, stuck, timeouts,
    hist: depths.reduce((h, d) => { h[d] = (h[d] || 0) + 1; return h; }, {}),
  };
}

const args = process.argv.slice(2).map(Number).filter((x) => x > 0);
const scales = args.length ? args : [D.DESIGN.enemyHpScale];
const seedCount = Number(process.env.SEEDS) || 20;
const seeds = process.env.SEED_LIST
  ? process.env.SEED_LIST.split(',').map(Number)
  : Array.from({ length: seedCount }, (_, i) => 4000 + i * 37);

console.log(`策略：${STRATEGY}`);
console.log(`种子：${seeds[0]} 起，共 ${seeds.length} 个`);
console.log();
console.log('| 血池标尺 | 均值层数 | 通关(7层) | 卡在第1层 | 超时局 | 层数分布 |');
console.log('|---|---|---|---|---|---|');
const base = D.DESIGN.enemyHpScale;
scales.forEach((s) => {
  const r = measure(s, seeds);
  const hist = Object.keys(r.hist).sort((a, b) => a - b).map((k) => `${k}层×${r.hist[k]}`).join(' ');
  console.log(`| ${r.scale} | **${r.avg}** | ${r.full}/${r.n} | ${r.stuck} | ${r.timeouts} | ${hist} |`);
});
D.DESIGN.enemyHpScale = base;
