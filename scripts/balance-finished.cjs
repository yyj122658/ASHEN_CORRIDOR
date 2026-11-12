'use strict';
/* 固定种子控制实验：比较同一队伍的纹路、身位与成长，不以模拟代替真人评价。 */
const assert = require('node:assert/strict');
const { loadVeteran } = require('../tests/helpers/load-veteran.cjs');
const V = loadVeteran().Veteran;

/** 执行一次真实遭遇并检查状态。@param {number} seed @param {number} floor @param {string} mode @returns {object} */
function sample(seed, floor, mode) {
  let st = V.State.create(seed);
  if (mode === 'blank') st.roster.forEach((u) => {
    u.board.placements.forEach((p) => st.stash.push(p.itemId));
    u.board.placements = [];
  });
  if (mode === 'position') st.team.reverse();
  if (mode === 'advanced') st.roster.forEach((u) => V.State.equipManuscript(st, u, 'inverse'));
  st = V.Expedition.start(st, { seed }).state;
  st.run.floor = floor;
  const kind = floor % 7 === 0 ? 'boss' : 'normal';
  const generated = V.Combat.generateEncounter(st, kind);
  st = V.Combat.create(generated.state, generated.enemyBlueprint, generated.combatRngStart).state;
  for (let i = 0; !st.run.battle.over && i < 4201; i++) st = V.Combat.step(st).state;
  const b = st.run.battle;
  assert.ok(b.over, '战斗必须有界结束');
  const valid = V.State.validate(st);
  assert.equal(valid.ok, true, valid.errors.join('；'));
  return { win: b.win, seconds: b.tick * V.Data.DESIGN.stepSeconds,
    hp: b.allies.reduce((n, u) => n + u.hp, 0) / b.allies.reduce((n, u) => n + u.maxHp, 0),
    healing: b.stats.healing || 0 };
}

const results = [];
for (const [mode, label] of [['starter', '完整入门构筑'], ['blank', '移除刻印'], ['position', '逆序编队'], ['advanced', '高阶功法控制组']]) {
  for (const floor of [1, 22, 49]) {
    const rows = [3, 9, 17, 31].map((seed) => sample(seed * 7919, floor, mode));
    results.push({ mode: label, floor, samples: rows.length, wins: rows.filter((r) => r.win).length,
      seconds: +(rows.reduce((n, r) => n + r.seconds, 0) / rows.length).toFixed(1),
      hpPct: Math.round(rows.reduce((n, r) => n + r.hp, 0) / rows.length * 100),
      healing: Math.round(rows.reduce((n, r) => n + r.healing, 0) / rows.length) });
  }
}
console.log(JSON.stringify({ seeds: [3, 9, 17, 31], results }, null, 2));
