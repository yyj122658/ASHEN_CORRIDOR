'use strict';
/* 生成「蚀刻法清单」：docs/etching-inventory.md
 *
 * 为什么放在 scripts/ 而不是一次性脚本：这份清单是玩法调整的底表，
 * 每次改 data.js 里的 MANUSCRIPTS 都要能重出一遍。所有数字都从数据实算，
 * 手抄一遍必然漂移，所以这里没有一个字是手写的。
 *
 * 用法：node scripts/etching-inventory.cjs
 */
const fs = require('fs');
const path = require('path');
const { loadVeteran, ROOT } = require('../tests/helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;

const OUT = path.join(ROOT, 'docs', 'etching-inventory.md');

const TARGET_CN = {
  frontFoe: '前排单体',
  lowestHpFoe: '残血敌人',
  ally: '队友',
  self: '自己',
};
const COND_CN = {
  routed: '贯通',
  foeHpBelow: '敌人生命',
  attackCount: '普攻次数',
  energyAbove: '余裕下限',
  alliesHurt: '队友受伤',
  targetHasDot: '目标异常',
  afterTag: '连携',
  selfHasShield: '自身有盾',
  stressAbove: '高压',
  minTier: '共鸣阶',
};
const DOT_CN = { burn: '灼烧', poison: '中毒', bleed: '流血', corrode: '腐蚀', all: '全异常' };
const TIER_NUM = { 1: '一', 2: '二', 3: '三', 4: '四' };
const PASSIVE_CN = {
  dotMult: (v) => `持续伤害 +${Math.round(v * 100)}%`,
  detonateMult: (v) => `引爆 +${Math.round(v * 100)}%`,
  poisonOnBasic: (v) => `普攻追加锈毒 ${Math.round(v * 100)}% 攻击力`,
  bleedCritBonus: (v) => `对流血目标暴击 +${Math.round(v * 100)}%`,
  shieldGainMult: (v) => `护盾获取 +${Math.round(v * 100)}%`,
  comboCdr: (v) => `连携返还余裕 ${v}`,
};
/* 标签直接用机制词（2026-11-15 统一），不再有焚炉/蚀锈/裂锋/淬盾这些抽象轴名 */
const AXIS_CN = { burn: '灼烧', poison: '中毒', corrode: '腐蚀', bleed: '流血', ward: '护盾' };

const all = Object.values(D.MANUSCRIPTS);

function bbox(m) {
  const xs = m.cells.map((c) => c[0]);
  const ys = m.cells.map((c) => c[1]);
  return `${Math.max(...xs) - Math.min(...xs) + 1}×${Math.max(...ys) - Math.min(...ys) + 1}`;
}

function pct(v) {
  if (v == null) return '';
  const n = Math.round((v - 1) * 100);
  return `${n > 0 ? '+' : ''}${n}%`;
}

function absPct(v) {
  return v == null ? '' : `${Math.round(v * 100)}%`;
}

/**
 * 一条短语规范（UI 悬浮窗与这份清单同源）：
 *   条件 → 方括号短语：[贯通] [共鸣二阶] [连携·灼烧] [目标·中毒] [高压 ≥50] [普攻 ×3] [队友受伤] [余裕 ≥14]
 *   效果 → 动词在前：伤害 180% / 伤害 80% ×3 段 / 贯穿 2 / 溅射 50% / 灼烧 25%×3 /
 *          引爆灼烧 / 引爆全异常 / 护盾 20% / 治疗 150% / 强攻 4 次 +50% / 回压 8 / 降冷 1s
 */
function condTag(k, v) {
  if (k === 'routed') return v === false ? '[未贯通]' : '[贯通]';
  if (k === 'attackCount') return `[普攻 ×${v}]`;
  if (k === 'alliesHurt') return '[队友受伤]';
  if (k === 'energyAbove') return `[余裕 ≥${v}]`;
  if (k === 'foeHpBelow') return `[敌人生命 <${absPct(v)}]`;
  if (k === 'targetHasDot') return `[目标·${DOT_CN[v] || v}]`;
  if (k === 'afterTag') return `[连携·${v}]`;
  if (k === 'selfHasShield') return '[自身有盾]';
  if (k === 'stressAbove') return `[高压 ≥${v}]`;
  if (k === 'minTier') return `[共鸣${TIER_NUM[v] || v}阶]`;
  return `[${COND_CN[k] || k}]`;
}

function skillLine(s) {
  const e = s.effect || {};
  const parts = [];
  if (e.heal != null) parts.push(`治疗 ${absPct(e.heal)}`);
  else if (e.mult != null) parts.push(`伤害 ${absPct(e.mult)}`);
  if (e.hits) parts.push(`×${e.hits} 段`);
  if (e.pierce != null) parts.push(`贯穿 ${e.pierce}`);
  if (e.splash != null) parts.push(`溅射 ${absPct(e.splash)}`);
  if (e.shield != null) parts.push(`护盾 ${absPct(e.shield)}`);
  if (e.dot) parts.push(`${DOT_CN[e.dot.k] || '持续'} ${absPct(e.dot.dmgMult)}×${e.dot.hits}`);
  if (e.detonateDot) parts.push(e.detonateDot === 'all' ? '引爆全异常' : `引爆${DOT_CN[e.detonateDot] || e.detonateDot}`);
  if (e.shieldScale) parts.push(`盾击 ×${e.shieldScale}`);
  if (e.bonusIfDot) parts.push(`对${DOT_CN[e.bonusIfDot.k] || e.bonusIfDot.k}再 ×${e.bonusIfDot.mult}`);
  if (e.cdrOther) parts.push(`降冷 ${e.cdrOther}s`);
  if (e.stressDelta) parts.push(e.stressDelta < 0 ? `回压 ${-e.stressDelta}` : `增压 ${e.stressDelta}`);
  if (e.buffAttack) parts.push(`强攻 ${e.buffAttack.hits} 次 ${pct(e.buffAttack.mult)}`);
  const tgt = TARGET_CN[s.target] || s.target;
  const condOrder = ['routed', 'minTier', 'afterTag', 'targetHasDot', 'stressAbove',
    'attackCount', 'alliesHurt', 'energyAbove', 'selfHasShield', 'foeHpBelow'];
  const conds = Object.keys(s.cond || {})
    .sort((a, b) => (condOrder.indexOf(a) + 1 || 99) - (condOrder.indexOf(b) + 1 || 99))
    .map((k) => condTag(k, s.cond[k]));
  return `${tgt} ${parts.join(' · ')}${conds.length ? ` ${conds.join(' ')}` : ''}`;
}

function costLine(s) {
  const bits = [`${s.cost} 余裕`];
  if (s.castTime) bits.push(`引导 ${s.castTime}s`);
  bits.push(`冷却 ${s.cooldown}s`);
  return bits.join(' · ');
}

function passiveLine(m) {
  const p = m.passive || {};
  const bits = Object.keys(p).map((k) => (PASSIVE_CN[k] ? PASSIVE_CN[k](p[k]) : `${k} ${p[k]}`));
  return bits.join(' · ') || '—';
}

function tierLine(m) {
  return (m.tiers || []).map((t) => `${t.at}%${pct(t.effect.mainMult) || '—'}`).join(' / ');
}

/** 取向：这门是拿什么换什么。没招式又不强化普攻的，就是纯面板件 */
function orientation(m) {
  const atk = m.attack || {};
  const e = m.energy || {};
  const tags = [];
  if ((atk.intervalScale ?? 1) < 1) tags.push('快攻');
  if ((atk.mult ?? 1) > 1 || (atk.extraHits || 0) > 0) tags.push('重击');
  if ((atk.routedBonus || 0) > 0) tags.push('贯通增伤');
  if ((e.regen ?? 1) > 1) tags.push('回裕');
  if ((e.max ?? 16) > 16) tags.push('厚裕');
  if ((e.onHit || 0) > 0) tags.push('挨打回裕');
  if ((e.onAttack || 0) > 0) tags.push('出手回裕');
  if (!tags.length) tags.push((atk.mult ?? 1) < 1 ? '蓄势' : '素面');
  return tags.join('·');
}

/* ------------------------------ 体检 ------------------------------ */

const issues = [];
const push = (tag, msg) => issues.push({ tag, msg });
const dotSkills = [];

all.forEach((m) => {
  const name = `${m.name}（${m.id}）`;
  const e = m.energy || {};
  const atk = m.attack || {};

  if (!(m.skills || []).length) push('无招式', `${name} 没有任何招式，只能吃面板改动`);

  (m.skills || []).forEach((s) => {
    if (s.effect && s.effect.dot) dotSkills.push(name);
    if (e.max != null && s.cost > e.max) push('放不出', `${name}「${s.name}」消耗 ${s.cost} > 余裕上限 ${e.max}`);
    if (e.max && s.cost > e.max * 0.8) push('偏贵', `${name}「${s.name}」消耗 ${s.cost}，占上限 ${e.max} 的 ${Math.round((s.cost / e.max) * 100)}%`);
    if (s.cooldown && s.castTime && s.cooldown < s.castTime) push('节奏', `${name}「${s.name}」冷却 ${s.cooldown}s 短于引导 ${s.castTime}s`);
  });

  /* 纯亏：普攻更慢、更低、余裕不涨、也没有招式——那就是白占两格 */
  const pureLoss = (atk.mult ?? 1) < 1 && (atk.intervalScale ?? 1) >= 1
    && (e.regen ?? 1) <= 1 && (e.max ?? 16) <= 16 && !(m.skills || []).length;
  if (pureLoss) push('纯亏', `${name} 普攻更慢更低、余裕没涨、也没有招式`);

  if (m.load > 3 && m.rarity <= 2) push('负荷倒挂', `${name} ${m.rarity} 阶却要 ${m.load} 负荷`);
  if (!m.io || !m.io.clock) push('缺引导', `${name} 没有 clock 口`);
  if (!m.io || !m.io.main) push('缺主口', `${name} 没有 main 口`);
});

/* 同构：同阶 + 同负荷 + 同格数 + 同招式形状 */
const groups = {};
all.forEach((m) => {
  const k = [m.rarity, m.load, m.cells.length,
    (m.skills || []).map((s) => `${s.effect?.mult}:${s.effect?.heal}:${s.target}`).join(',')].join('|');
  (groups[k] ||= []).push(m);
});
Object.values(groups).filter((g) => g.length > 1).forEach((g) => {
  push('同构', `${g.map((m) => m.name).join('、')} 在「阶 / 负荷 / 格数 / 招式」四项上完全一致`);
});

/* 四种异常在蚀刻法库里的分布：太少的一轴等于不存在，太多的一轴等于唯一解 */
const dotCount = { burn: 0, poison: 0, bleed: 0, corrode: 0 };
all.forEach((m) => (m.skills || []).forEach((sk) => {
  const k = sk.effect && sk.effect.dot && sk.effect.dot.k;
  if (k && dotCount[k] != null) dotCount[k] += 1;
}));
const dotTotal = Object.values(dotCount).reduce((a, b) => a + b, 0);
Object.entries(dotCount).forEach(([k, n]) => {
  if (n < 4) push('异常失衡', `${DOT_CN[k]}只有 ${n} 个招式会用，这个方向基本玩不起来`);
});
if (dotTotal && Math.max(...Object.values(dotCount)) / dotTotal > 0.5) {
  push('异常失衡', `有一种异常占了全部异常招式的 ${Math.round((Math.max(...Object.values(dotCount)) / dotTotal) * 100)}%`);
}

/* 每门都该有自己的被动，否则「分方向」只是文档里的一句话 */
const noPassive = all.filter((m) => !m.passive || !Object.keys(m.passive).length);
if (noPassive.length) push('缺被动', `${noPassive.length} 门没有被动：${noPassive.map((m) => m.name).join('、')}`);
const noTag = all.filter((m) => !m.tags || !m.tags.length);
if (noTag.length) push('缺标签', `${noTag.length} 门没有流派标签`);

/* ------------------------------ 输出 ------------------------------ */

const L = [];
const P = (s = '') => L.push(s);

P('# 蚀刻法清单（80 门）');
P();
P('> 由 `scripts/etching-inventory.cjs` 从 `src/veteran/data.js` 的 `MANUSCRIPTS` 实算生成，**不要手改**。');
P('> 改了数据就 `node scripts/etching-inventory.cjs` 重出一遍。');
P();

P('## 1. 总览');
P();
const byRarity = {};
all.forEach((m) => (byRarity[m.rarity] ||= []).push(m));
const avg = (g, f) => (g.reduce((s, m) => s + f(m), 0) / g.length).toFixed(1);
P(`共 **${all.length}** 门。负荷合计 ${all.reduce((s, m) => s + m.load, 0)}，格数合计 ${all.reduce((s, m) => s + m.cells.length, 0)}。`);
P();
P('| 阶 | 门数 | 平均负荷 | 平均格数 | 带招式 | 平均共鸣阶 |');
P('|---|---|---|---|---|---|');
Object.keys(byRarity).map(Number).sort((a, b) => a - b).forEach((r) => {
  const g = byRarity[r];
  P(`| ${r} 阶 | ${g.length} | ${avg(g, (m) => m.load)} | ${avg(g, (m) => m.cells.length)} | ${g.filter((m) => (m.skills || []).length).length}/${g.length} | ${avg(g, (m) => m.tiers.length)} |`);
});
P();
P(`参照系：板面 77 格、负荷上限 **${Math.round(77 * D.DESIGN.generatedCapPerCell)} 点**`
  + `（${D.DESIGN.generatedCapPerCell} 格/点）、同时最多 ${D.DESIGN.manuscriptSlots} 门。`);
P('六标之后骨架按稀有度扩到 6~54 格：面积本身成了约束，而不只是负荷。');
P('一门 R7 骨卷会吃掉 70% 的板面，剩下的空格才轮到纹路说话——「刻哪一门」第一次有了空间代价。');
P();

P('## 2. 逐门清单');
P();
Object.keys(byRarity).map(Number).sort((a, b) => a - b).forEach((r) => {
  const g = byRarity[r];
  P(`### ${r} 阶（${g.length} 门）`);
  P();
  P('| 名 | id | 负荷 | 格 | 标签 | 被动 | 招式 | 消耗 | 面板 普攻/间隔/余裕 | 共鸣阶 |');
  P('|---|---|---|---|---|---|---|---|---|---|');
  g.forEach((m) => {
    const sk = (m.skills || []).map(skillLine).join('<br>');
    const cost = (m.skills || []).map(costLine).join('<br>');
    const pane = `${pct(m.attack?.mult) || '—'} / ×${m.attack?.intervalScale ?? 1}${m.attack?.extraHits ? `·+${m.attack.extraHits}段` : ''} / ${m.energy?.regen ?? '—'}·${m.energy?.max ?? '—'}`;
    const axisCell = `${AXIS_CN[m.axis] || '—'}${(m.tags || []).length > 1 ? `（${m.tags.join(' / ')}）` : ''}`;
    P(`| **${m.name}** | \`${m.id}\` | ${m.load} | ${m.cells.length} | ${axisCell} | ${passiveLine(m)} | ${sk || '—'} | ${cost || '—'} | ${pane} | ${tierLine(m)} |`);
  });
  P();
});

P('## 3. 自动体检');
P();
if (!issues.length) {
  P('没有发现问题。');
} else {
  const byTag = {};
  issues.forEach((i) => (byTag[i.tag] ||= []).push(i.msg));
  Object.keys(byTag).forEach((tag) => {
    P(`**${tag}**（${byTag[tag].length}）`);
    P();
    byTag[tag].forEach((msg) => P(`- ${msg}`));
    P();
  });
}

P('## 3.1 标签与异常分布');
P();
const axisCount = {};
all.forEach((m) => (axisCount[m.axis] = (axisCount[m.axis] || 0) + 1));
P('| 标签 | 门数 | 会用到的异常 | 招式数 |');
P('|---|---|---|---|');
Object.keys(AXIS_CN).forEach((k) => {
  const n = axisCount[k] || 0;
  const kinds = [...new Set(all.filter((m) => m.axis === k)
    .flatMap((m) => (m.skills || []).map((sk) => sk.effect && sk.effect.dot && sk.effect.dot.k).filter(Boolean)))];
  const sk = all.filter((m) => m.axis === k).reduce((a, m) => a + (m.skills || []).length, 0);
  P(`| ${AXIS_CN[k]} | ${n} | ${kinds.map((x) => DOT_CN[x] || x).join('、') || '—'} | ${sk} |`);
});
P();
P('| 异常 | 招式数 |');
P('|---|---|');
Object.keys(dotCount).forEach((k) => P(`| ${DOT_CN[k]} | ${dotCount[k]} |`));
P();
P('> 异常靠「招式挂上去」来分布，所以这张表就是四种异常在功法库里的真实供给量。');
P();

P('## 4. 取向分布');
P();
const oriCount = {};
all.forEach((m) => orientation(m).split('·').forEach((t) => (oriCount[t] = (oriCount[t] || 0) + 1)));
P('| 取向标签 | 门数 |');
P('|---|---|');
Object.entries(oriCount).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => P(`| ${k} | ${n} |`));
P();
P('> 一门可以同时有多个标签（例如「快攻·回裕」），所以加起来大于 80。');
P();

P('## 5. 风味句（`flavor.js` 摘录）');
P();
P('| 名 | 风味句 |');
P('|---|---|');
all.forEach((m) => {
  const f = String(V.Flavor.etching(m) || '').replace(/\|/g, '｜').replace(/\n/g, ' ');
  P(`| ${m.name} | ${f.slice(0, 58)} |`);
});
P();

fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(`wrote ${OUT}`);
console.log(`${all.length} 门，${issues.length} 条体检问题`);
