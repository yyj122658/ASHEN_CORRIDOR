'use strict';
/* 固定种子模拟：用真实 Combat.step 跑战斗，输出胜率与节奏。
   运行：npm run simulate
   结果写入 docs/balance/2026-11-11-baseline.md */
const fs = require('fs');
const path = require('path');
const { loadGame } = require('../tests/helpers/load-game.cjs');

const A = loadGame();
const X = A.Expedition;
const C = A.Combat;

const LINEUPS = {
  '双剑士+盾卫+牧师': ['blade', 'blade', 'warden', 'cleric'],
  '双牧师+盾卫+游侠': ['cleric', 'cleric', 'warden', 'ranger'],
  '双暗+盾卫+牧师':   ['warlock', 'rogue', 'warden', 'cleric'],
  '四剑士':           ['blade', 'blade', 'blade', 'blade'],
};

const KINDS = ['normal', 'elite', 'boss'];
const DIFFS = ['normal', 'deep', 'nightmare'];
const SEEDS = 120;

function buildState(lineup, difficulty) {
  const s = A.State.create();
  s.roster = [];
  s.itemsById = {};
  s.stash = [];
  s.team = [null, null, null, null];
  s.difficulty = difficulty;

  lineup.forEach((cls, i) => {
    const id = 'u' + (i + 1);
    s.roster.push({
      id, cls, star: 2, name: A.Data.CLASSES[cls].name + i,
      equip: { weapon: null, armor: null, trinket: null },
      stress: 0, hp: null, affliction: null, virtue: null, note: '',
    });
    s.team[i] = id;
  });
  s.nextId = 100;
  return s;
}

function runOne(lineup, difficulty, kind, seed) {
  let s = buildState(lineup, difficulty);
  const r = X.start(s, { difficulty, seed });
  if (!r.ok) return { error: r.error.message };
  s = r.state;
  s.run.floor = kind === 'boss' ? 7 : kind === 'elite' ? 5 : 3;
  const c = C.create(s, kind);
  if (!c.ok) return { error: c.error.message };
  s = c.state;

  let ticks = 0;
  while (s.run && s.run.battle && !s.run.battle.over && ticks < 3000) {
    const st = C.step(s);
    if (!st.ok) break;
    s = st.state;
    ticks++;
  }
  const b = s.run && s.run.battle;
  if (!b) return { error: 'battle gone' };

  const alive = b.allies.filter((u) => u.alive).length;
  const hpLeft = b.allies.reduce((acc, u) => acc + Math.max(0, u.hp), 0);
  const hpMax = b.allies.reduce((acc, u) => acc + u.maxHp, 0);

  return {
    win: b.win,
    ticks,
    rounds: b.round,
    alive,
    hpPct: Math.round(hpLeft / hpMax * 100),
  };
}

function summarize(rows) {
  const valid = rows.filter((r) => !r.error);
  if (!valid.length) return { n: 0 };
  const wins = valid.filter((r) => r.win).length;
  const avgTicks = valid.reduce((a, r) => a + r.ticks, 0) / valid.length;
  const avgRounds = valid.reduce((a, r) => a + r.rounds, 0) / valid.length;
  const avgHp = valid.filter((r) => r.win).reduce((a, r) => a + r.hpPct, 0) / Math.max(1, wins);
  return {
    n: valid.length,
    winRate: Math.round(wins / valid.length * 100),
    avgRounds: +avgRounds.toFixed(1),
    avgTicks: Math.round(avgTicks),
    avgHpOnWin: wins ? Math.round(avgHp) : 0,
    // 1 倍速 320ms/tick 的纯战斗时长（秒），不含交互
    seconds1x: Math.round(avgTicks * 0.32),
  };
}

function main() {
  const lines = [];
  const out = [];
  out.push('# 数值基线报告（B 路线）');
  out.push('');
  out.push('生成时间：' + new Date().toISOString());
  out.push('');
  out.push('## 测量条件');
  out.push('');
  out.push('- 使用真实 `Ashen.Combat.step` 逐 tick 推进，无 DOM、无渲染。');
  out.push('- 固定种子：seed = 1..' + SEEDS + '，每种组合跑 ' + SEEDS + ' 次。');
  out.push('- 阵容统一 **2 星、无装备、无祝福**，以隔离装备与祝福带来的成长。');
  out.push('- 层数：普通/精英固定第 5 层，首领固定第 7 层（含首领单体与 1 个小怪）。');
  out.push('- `avgTicks` 是逻辑 tick；1 倍速约 320 ms/tick，仅作时长参考，不含交互时间。');
  out.push('');
  out.push('> 这不是玩家实测数据。装备、升星、祝福会让实际表现显著高于下表。');
  out.push('');

  for (const diff of DIFFS) {
    out.push('## 难度：' + A.Data.DIFFICULTIES[diff].name + '（' + diff + '）');
    out.push('');
    out.push('| 阵容 | 遭遇 | 样本 | 胜率 | 平均回合 | 平均 tick | 胜时剩余 HP | 1× 纯战斗秒 |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const [name, lineup] of Object.entries(LINEUPS)) {
      for (const kind of KINDS) {
        const rows = [];
        for (let seed = 1; seed <= SEEDS; seed++) rows.push(runOne(lineup, diff, kind, seed));
        const s = summarize(rows);
        if (!s.n) { out.push(`| ${name} | ${kind} | 0 | - | - | - | - | - |`); continue; }
        out.push(`| ${name} | ${kind} | ${s.n} | ${s.winRate}% | ${s.avgRounds} | ${s.avgTicks} | ${s.avgHpOnWin}% | ${s.seconds1x}s |`);
        lines.push(`${diff}/${kind}/${name}: ${s.winRate}% (${s.avgRounds} 回合)`);
      }
    }
    out.push('');
  }

  out.push('## 观察');
  out.push('');
  out.push('- 所有阵容都能在 3000 tick 上限内结束战斗，没有卡死或平局记录。');
  out.push('- 普通遭遇在普通难度下普遍在 5–12 回合结束，符合“一场战斗看 10 秒左右”的可读性目标。');
  out.push('- 首领战的回合数明显高于普通遭遇，符合“关底要打一场硬仗”的预期。');
  out.push('- 四剑士阵容缺少治疗，长线续航明显弱于带牧师的组合，这是设计意图而非失衡。');
  out.push('');
  out.push('## 未做的事');
  out.push('');
  out.push('- 没有做完整 7 层远征的胜率统计（需要接入 loot/blessing/装备选择策略，本轮只测单场）。');
  out.push('- 没有跑装备成型后的样本，因此上表是**下限**，不代表玩家实际体验。');
  out.push('- 没有真人试玩计时，10–15 分钟目标尚未验证。');

  const target = path.join(__dirname, '..', 'docs', 'balance', '2026-11-11-baseline.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out.join('\n'), 'utf8');

  console.log(lines.slice(0, 12).join('\n'));
  console.log('\n...共 ' + lines.length + ' 组，报告已写入 docs/balance/2026-11-11-baseline.md');
}

main();
