'use strict';
/* 临时审校脚本：盘点面向玩家的描述文本与关键词用法。用完即删。 */
const fs = require('node:fs');
const path = require('node:path');
require('../src/veteran/data.js');
require('../src/veteran/flavor.js');
require('../src/veteran/stats-engine.js');
require('../src/veteran/kitchen.js');
const A = globalThis.Ashen.Veteran;
const D = A.Data;
const K = A.Kitchen;
const S = A.Stats;
const FL = A.Flavor;

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const SRC = ['src/veteran/data.js', 'src/veteran/ui.js', 'src/veteran/app.js', 'src/veteran/expedition.js',
  'src/veteran/combat.js', 'src/veteran/kitchen.js', 'src/veteran/state.js', 'src/veteran/encounter.js',
  'src/veteran/roster.js', 'src/veteran/positions.js', 'src/veteran/tactics.js', 'src/veteran/circuit.js',
  'src/veteran/manuscript.js', 'src/veteran/plate-gen.js', 'src/veteran/storage.js'];
const all = SRC.map((f) => ({ f, s: read(f) }));
const uiSrc = read('src/veteran/ui.js');
const appSrc = read('src/veteran/app.js');

const out = [];
const P = (s = '') => out.push(s);

P('# 灰烬回廊 · 面向玩家的描述文本盘点');
P('');
P('> 由 `scripts/audit-text.cjs` 直接读源码生成，改动文案后重跑即可刷新。');
P('> 词面统计口径为「源码字符串出现次数」，含注释里出现的同名中文，只用来看哪个说法是主流；条目原文以第 2～8 节为准。');
P('');
P(`> 规模：蚀刻法 ${Object.keys(D.MANUSCRIPTS).length} 门 · 纹路 ${Object.keys(D.TEMPLATES).length} 种 · 敌人 ${Object.keys(D.ENEMIES).length} 个 · 事件 ${Object.keys(D.EVENTS).length} 条 · 祝福 ${Object.keys(D.BLESSINGS).length} 条 · 食材 ${Object.keys(K.INGREDIENTS).length} 种 · 菜谱 ${Object.keys(K.RECIPES).length} 道 · 术语词条 8 条`);
P('');

/* ---------------- 词面统计 ---------------- */
const groups = {
  '攻击动作': ['平攻', '普攻', '平A', '普通攻击', '基础攻击', '平砍'],
  '战斗资源': ['余裕', '能量', '法力', '精力'],
  '蚀刻法/牌组': ['蚀刻法', '拓本', '纹章', '功法', '构件', '谱表'],
  '纹路/零件': ['纹路', '回路', '线路', '纹印'],
  '装配位次': ['主修', '合修', '主手', '副手', '副手槽', '辅修'],
  '覆盖率机制': ['纹路覆盖', '覆盖率', '覆盖', '共鸣', '共鸣增幅', '台阶', '贯通'],
  '金属板': ['板面', '生命金属', '金属板', '板'],
  '防护': ['护盾', '残影', '格挡', '减伤'],
  '生命': ['生命上限', '最大生命', '生命', '血量'],
  '持续伤害': ['灼烧', '流血', '中毒', '腐蚀'],
  '进度单位': ['回合', '轮次', '波次', '行动', '层', '节点', '章节', '回廊', '远征'],
};
P('## 0. 同概念词面统计（源码出现次数）');
for (const [g, words] of Object.entries(groups)) {
  const rows = [];
  for (const w of words) {
    let total = 0; const where = [];
    for (const { f, s } of all) {
      const n = s.split(w).length - 1;
      if (n) { total += n; where.push(`${path.basename(f)}×${n}`); }
    }
    if (total) rows.push(`| ${w} | ${total} | ${where.slice(0, 3).join('、')} |`);
  }
  if (!rows.length) continue;
  P(`\n**${g}**\n\n| 词面 | 次数 | 主要文件 |\n| --- | --- | --- |\n${rows.join('\n')}`);
}

/* ---------------- 一、术语表 ---------------- */
P('\n---\n\n## 1. 词条解释（现有唯一成体系的「关键词」资产，ui.js:32）\n');
const termsStart = uiSrc.indexOf('const terms = {');
const termsEnd = uiSrc.indexOf('\n  };', termsStart);
for (const line of uiSrc.slice(termsStart, termsEnd).split(/\r?\n/)) {
  const m = line.replace(/\r$/, '').match(/^\s*'([^']+)':\s*'(.*)',?$/);
  if (m) P(`- **${m[1]}**：${m[2]}`);
}

/* ---------------- 二、系统名词 ---------------- */
P('\n---\n\n## 2. 系统名词（属性 / 资源 / 目标 / 条件 / 行动）\n');
P('**属性**：生命 / 攻击 / 防御 / 速度（战斗面板另称 生命·攻击·防御）');
P(`\n**行动（ACTIONS）**：${D.ACTIONS.map((a) => a.name).join('、')}`);
P(`\n**目标（TARGETS）**：${D.TARGETS.map((t) => t.name).join('、')}`);
P(`\n**条件（CONDITIONS）**：${D.CONDITIONS.map((c) => c.name).join('、')}`);
P(`\n**身体**：\n`);
for (const b of Object.values(D.BODIES)) P(`- **${b.name}**（生命 ${b.hp}／攻 ${b.atk}／防 ${b.def}／速 ${b.spd}）：${b.desc}`);
P('\n**武器（主手输出）**：');
for (const w of Object.values(D.WEAPONS)) P(`- **${w.name}**：${w.desc} ｜输出：${w.main.desc} ｜特性「${w.trait.name}」：${w.trait.desc}`);
P(`\n**防御**：${D.GUARD.desc}`);

/* ---------------- 三、蚀刻法 ---------------- */
P('\n---\n\n## 3. 蚀刻法（80 门：风味句 + 数值行）\n');
P('| 名称 | 阶 | 格 | 负荷 | 风味句 | 数值行 | 招式 | 共鸣阶 |');
P('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const m of Object.values(D.MANUSCRIPTS)) {
  const skills = (m.skills || []).map((s) => {
    const e = s.effect || {};
    const eff = [e.heal ? `治疗${Math.round(e.heal * 100)}%攻击` : `${Math.round((e.mult || 0) * 100)}%攻击`,
      e.pierce ? `贯穿前${e.pierce}位` : '', e.hits ? `${e.hits}段` : '', e.shield ? `护盾${Math.round(e.shield * 100)}%` : '',
      e.dot ? '附灼烧' : '', e.buffAttack ? `平攻强化${e.buffAttack.seconds}s` : ''].filter(Boolean).join('/');
    const cond = [s.cond?.routed ? '纹路贯通' : '', s.cond?.alliesHurt ? '同伴<60%' : '', s.cond?.foeHpBelow ? `敌<${s.cond.foeHpBelow * 100}%` : '',
      s.cond?.attackCount ? `平攻${s.cond.attackCount}次后` : '', s.cond?.energyAbove ? `余裕>${s.cond.energyAbove}` : ''].filter(Boolean).join('·') || '无条件';
    return `${s.name}（${cond}｜${eff}｜${s.cost}余裕·${s.cooldown ?? 0}s）`;
  }).join('<br>') || '—';
  const mf = S.manuscriptFacts(m);
  P(`| ${m.name} | ${m.rarity} | ${m.cells.length} | ${m.load} | ${FL.etching(m)} | ${mf.main.map(x => x.label + x.value).join("、")} | ${skills} | ${(m.tiers || []).map((t) => `${t.at}%${t.name ? '·' + t.name : ''}`).join(' / ')} |`);
}

/* ---------------- 四、纹路 ---------------- */
P('\n---\n\n## 4. 纹路（回路零件，30 种：风味句 + 数值行）\n');
P('| 名称 | 旧称 | 格 | 负荷 | 风味句 | 数值行 |');
P('| --- | --- | --- | --- | --- | --- |');
for (const t of Object.values(D.TEMPLATES)) {
  const rf = S.runeFacts(t);
  P(`| ${t.name} | ${t.legacyName || ''} | ${t.cells.length} | ${t.load} | ${FL.rune(t)} | ${rf.effects.map(e => e.label + ' ' + e.value).join('、')} |`);
}

/* ---------------- 五、身法与祝福 ---------------- */
P('\n---\n\n## 5. 身法（站位特性，3 条）\n');
for (const m of Object.values(D.MODS)) P(`- **${m.name}**：${m.desc}`);
P('\n**祝福**：');
for (const b of Object.values(D.BLESSINGS)) P(`- **${b.name}**：${b.desc}`);

/* ---------------- 六、敌人 ---------------- */
P('\n---\n\n## 6. 敌人与招式（14+）\n');
const EXTRA_TARGETS = { allFoe: '全体敌人', backFoe: '后排敌人', allAlly: '全体友军' };
const targetName = (id) => (D.TARGETS.find((t) => t.id === id) || {}).name || EXTRA_TARGETS[id] || id;
P('| 名称 | 生命 | 攻 | 防 | 速 | 描述 | 招式 |');
P('| --- | --- | --- | --- | --- | --- | --- |');
for (const e of Object.values(D.ENEMIES)) {
  const sk = (e.skills || []).map((s) => `${s.name}（${s.mult ? Math.round(s.mult * 100) + '%' : ''}${s.healAllies ? `治疗全体${Math.round(s.healAllies * 100)}%` : ''}${s.healSelf ? `自疗${Math.round(s.healSelf * 100)}%` : ''}${s.selfShield ? `自身护盾${Math.round(s.selfShield * 100)}%` : ''}${s.target ? '→' + targetName(s.target) : ''}${s.cd ? `｜cd${s.cd}` : ''}${s.energy ? `｜${s.energy}能量` : ''}）`).join('<br>');
  P(`| ${e.name} | ${e.hp} | ${e.atk} | ${e.def} | ${e.spd} | ${e.desc || ''} | ${sk} |`);
}

/* ---------------- 七、事件 ---------------- */
P('\n---\n\n## 7. 事件文本（现场 / 选项 / 结果，11 条）\n');
for (const ev of Object.values(D.EVENTS)) {
  P(`### ${ev.title}`);
  P(`> ${ev.text}`);
  for (const c of ev.choices || []) {
    P(`- **${c.label}**（提示：${c.hint || '—'}）${c.text ? ` → ${c.text}` : ''}`);
  }
  P('');
}

/* ---------------- 八、章节与节点 ---------------- */
P('\n---\n\n## 8. 章节 / 节点 / 生态\n');
P(`**章节**：${D.CHAPTERS.map((c, i) => `第${i + 1}章 ${c.name}`).join('、')}`);
P('\n**节点**：');
for (const [k, n] of Object.entries(D.NODE_TYPES)) P(`- ${n.name}（${k}）：${n.desc || ''}`);
P('\n**生态（战斗侧）**：');
for (const b of D.BIOMES) P(`- ${b.name}：${b.note || ''}`);
P('\n**生态（厨房侧）**：');
for (const f of [1, 3, 5]) { const b = K.biome(f); P(`- ${b.name}：${b.desc}`); }
P('\n**食材**：');
for (const i of Object.values(K.INGREDIENTS)) P(`- ${i.name}（${i.source}）：${i.desc}`);
P('\n**菜谱**（名称｜回复/安抚｜做法）：');
for (const r of Object.values(K.RECIPES)) P(`- ${r.name}｜${Math.round(r.heal * 100)}% / ${r.calm}｜${r.method}`);

/* ---------------- 九、界面文案 ---------------- */
P('\n---\n\n## 9. 界面固定文案\n');
const collect = (src, re) => {
  const set = new Map();
  for (const m of src.matchAll(re)) set.set(m[1], (set.get(m[1]) || 0) + 1);
  return set;
};
const btns = collect(uiSrc, /btn\(\s*'([^'<]{1,30})'/g);
P(`**按钮**（${btns.size} 种）：${[...btns.keys()].join('、')}`);
const toasts = collect(appSrc, /toast\(\s*'([^']{2,60})'/g);
P(`\n**提示消息 toast**（${toasts.size} 条）：`);
P([...toasts.keys()].map((t) => `- ${t}`).join('\n'));
const panels = collect(uiSrc, /panel\(\s*'([^']{1,30})'/g);
P(`\n**面板标题**（${panels.size} 种）：${[...panels.keys()].join('、')}`);

/* ---------------- 十、排版写法 ---------------- */
const joined = all.map((x) => x.s).join('\n');
const count = (re) => (joined.match(re) || []).length;
P('\n---\n\n## 10. 数字 / 单位 / 标点写法现状（自动统计）\n');
P('| 写法 | 次数 | 说明 |');
P('| --- | --- | --- |');
P(`| 「3秒」中文单位 | ${count(/\d+\s*秒/g)} | 冷却/持续时间 |`);
P(`| 「3s」英文单位 | ${count(/\d+\s*s(?![a-zA-Z])/g)} | 同一含义的另一种写法 |`);
P(`| 「1 号位」带空格 | ${count(/\d\s号位/g)} | 位置 |`);
P(`| 「第一位」中文序数 | ${count(/第[一二三四五]位/g)} | 位置，与号位混用 |`);
P(`| 「+0.10/s」精确小数 | ${count(/\+\d+\.\d+\/s/g)} | 纹路增益 |`);
P(`| 「15%」紧贴数字 | ${count(/\d+%(?![0-9])/g)} | 百分比 |`);
P(`| 「50 %」带空格 | ${count(/\d+\s+%/g)} | 百分比 |`);
P(`| 「×」乘号 | ${count(/×/g)} | 倍率 |`);

fs.writeFileSync(path.resolve(__dirname, '../docs/text-inventory.md'), out.join('\n'), 'utf8');
console.log('行数：', out.join('\n').split('\n').length, '字节：', out.join('\n').length);
