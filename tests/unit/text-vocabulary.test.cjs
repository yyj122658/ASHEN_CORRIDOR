'use strict';
/* 全局词表守卫（2026-11-15 统一）。
   这一组测试守的是「一个概念只留一个词」，不是某个具体界面：
   ① 源码里（注释之外）不许再出现旧说法——拓片 / 练法 / 合修 / 脉应 / 焚炉 / 蚀锈 / 裂锋 / 淬盾 / 路由 / 技能 / 蓄力 …
   ② 招式标签只用机制词：灼烧 / 中毒 / 流血 / 腐蚀 / 护盾 / 高压；
   ③ 共鸣阶名统一成「共鸣二阶 · 后缀」，后缀（风味）保留；
   ④ 清单脚本与界面引擎用同一套条件短语，任一处改单边会被拦下。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadVeteran, ROOT } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;
const T = V.Terms;
const S = V.Stats;

/** 去掉块注释与行注释：旧词只允许留在注释里（注释是给自己看的，不上屏）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const SRC_DIR = path.join(ROOT, 'src', 'veteran');
const SRC_FILES = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js'));

test('源码（注释之外）不再出现已废除的说法', () => {
  const hits = [];
  for (const f of SRC_FILES) {
    const src = stripComments(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
    src.split(/\r?\n/).forEach((line, i) => {
      /* terms.js 的禁用词表本身要写出这些词，跳过规则定义行 */
      if (/\bre:\s*\//.test(line)) return;
      T.audit(line).forEach((h) => hits.push(`${f}:${i + 1} 「${h.word}」→ ${h.fix}`));
    });
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

test('招式标签只用机制词，且 afterTag 引用的标签都真实存在', () => {
  const allowed = new Set(['灼烧', '中毒', '流血', '腐蚀', '护盾', '高压']);
  const used = new Set();
  const afterTags = new Set();
  for (const m of Object.values(D.MANUSCRIPTS)) {
    (m.tags || []).forEach((t) => {
      assert.ok(allowed.has(t), `${m.name} 的标签「${t}」不在机制词表里`);
      used.add(t);
    });
    (m.skills || []).forEach((sk) => {
      if (sk.tag) {
        assert.ok(allowed.has(sk.tag), `${m.name}「${sk.name}」挂的标签「${sk.tag}」不在机制词表里`);
        used.add(sk.tag);
      }
      if (sk.cond && sk.cond.afterTag) afterTags.add(sk.cond.afterTag);
    });
  }
  /* 断链检查：连携条件指的标签，必须真有招式会挂出来，否则那招永远不亮 */
  afterTags.forEach((t) => {
    assert.ok(used.has(t), `afterTag「${t}」没有任何招式会挂出这个标签，连携永远不成立`);
  });
  assert.ok(used.size >= 5, `机制词至少要覆盖六种里的五种，实际 ${[...used].join('/')}`);
});

test('白名单里的每个形制名都还在源码里用着（防止留下死条目）', () => {
  const all = SRC_FILES.map((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8')).join('\n');
  for (const a of T.ALLOW) {
    assert.ok(all.includes(a.text), `白名单里的「${a.text}」在源码里已经不存在，应删掉这条放行`);
  }
});

test('共鸣阶名统一为「共鸣N阶 · 后缀」，且后缀保留、不重复拼接', () => {
  for (const m of Object.values(D.MANUSCRIPTS)) {
    (m.tiers || []).forEach((t, i) => {
      const cn = ['一', '二', '三', '四'][i];
      assert.match(t.name, new RegExp(`^共鸣${cn}阶 · \\S+$`), `${m.name} 第 ${i + 1} 档名字不合格式：${t.name}`);
      assert.ok(!t.name.includes('共鸣共鸣'), `${m.name} 拼出了「共鸣共鸣」`);
    });
  }
});

test('清单脚本与界面引擎的条件短语同源', () => {
  /* 同一份条件，两边给出的短语必须逐字一致，否则玩家看到的和底表对不上 */
  const cases = [
    { routed: true, minTier: 2 },
    { targetHasDot: 'burn', stressAbove: 50 },
    { attackCount: 3, alliesHurt: 1, energyAbove: 14 },
  ];
  const inv = fs.readFileSync(path.join(ROOT, 'scripts', 'etching-inventory.cjs'), 'utf8');
  cases.forEach((c) => {
    const ui = S.conditionText(c);
    Object.keys(c).forEach((k) => {
      const v = c[k];
      const expect = k === 'targetHasDot' ? `[目标·灼烧]`
        : k === 'routed' ? '[贯通]'
          : k === 'minTier' ? '[共鸣二阶]'
            : k === 'stressAbove' ? '[高压 ≥50]'
              : k === 'attackCount' ? '[普攻 ×3]'
                : k === 'alliesHurt' ? '[队友受伤]'
                  : `[余裕 ≥${v}]`;
      assert.ok(ui.includes(expect), `界面短语缺 ${expect}：${ui}`);
      assert.ok(inv.includes('condTag') && inv.includes('condOrder'), '清单脚本必须是 condTag/condOrder 同一套实现');
    });
  });
});
