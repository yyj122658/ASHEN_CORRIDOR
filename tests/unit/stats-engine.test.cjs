'use strict';
/* 数值引擎与风味文本的分工守卫：
   1. 数值一律由 stats-engine 从机制数据算出来，不写在文案里
   2. 风味句里不允许出现数字（否则又变成两份数据）
   3. 改机制数据，文案要跟着变 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;
const S = V.Stats;
const F = V.Flavor;

test('纹路数值来自 boost 字段，不来自描述文本', () => {
  const tpl = D.template('straight');
  const f = S.runeFacts(tpl);
  assert.equal(f.size[0].value, '2 格');
  assert.equal(f.size[1].value, '1');
  assert.deepEqual(f.effects.map((e) => `${e.label} ${e.value}`), ['余裕恢复 +0.10/s']);
  assert.equal(f.flavor, '一缕亮丝横贯两格。');
});

test('负向增益标为代价，正向标为收益', () => {
  const f = S.runeFacts(D.template('capacitor'));
  const regen = f.effects.find((e) => e.label === '余裕恢复');
  assert.equal(regen.value, '−0.20/s');
  assert.equal(regen.tone, 'cost');
  const skill = f.effects.find((e) => e.label === '招式伤害');
  assert.equal(skill.value, '+25%');
  assert.equal(skill.tone, 'gain');
});

test('改 boost 数值后，文案自动跟着变（文案里没有硬编码）', () => {
  const tpl = { ...D.template('straight'), boost: { regen: 0.42 } };
  const f = S.runeFacts(tpl);
  assert.equal(f.effects[0].value, '+0.42/s');
});

test('蚀刻法数值事实：主修间隔、余裕、招式、共鸣阶齐全', () => {
  const f = S.manuscriptFacts(D.manuscript('corridor5'));
  assert.equal(f.flavor, '一线穿喉，余势不断，前排没有谁能独自站着。');
  assert.deepEqual(f.main.map((x) => `${x.label} ${x.value}`), ['普通攻击间隔 1.10s', '余裕恢复 +1/s', '余裕上限 20']);
  /* 2 阶起每门都有两个招式：核心招 + 异常/连携追击招（2026-11-15 分轴改造） */
  assert.equal(f.skills.length, 2);
  assert.deepEqual(f.skills.map((x) => x.name), ['一线穿心', '续裂']);
  const sk = f.skills[0];
  assert.equal(sk.name, '一线穿心');
  assert.equal(sk.condition, '余裕足够时');
  assert.equal(sk.effect, '伤害 180% · 贯穿 2');
  assert.equal(sk.cost, '6 余裕');
  assert.equal(sk.cooldown, '冷却 4s');
  assert.deepEqual(f.tiers.map((t) => t.at), ['40%', '80%', '100%']);
  assert.match(f.tiers[2].effects, /×1\.24/);
});

test('招式条件译成玩家能判断的时机', () => {
  assert.equal(S.conditionText({}), '余裕足够时');
  /* 条件统一成方括号短语（2026-11-15 词表统一），与清单脚本同一套写法 */
  assert.equal(S.conditionText({ alliesHurt: true }), '[队友受伤]');
  assert.equal(S.conditionText({ attackCount: 4, foeHpBelow: 0.5 }), '[普攻 ×4] [敌人生命 <50%]');
  assert.equal(S.conditionText({ afterTag: '流血', minTier: 2 }), '[共鸣二阶] [连携·流血]');
  assert.equal(S.conditionText({ stressAbove: 50, selfHasShield: true }), '[高压 ≥50] [自身有盾]');
});

test('工坊招式保留短标签，悬停说明交代数值基准和作用对象', () => {
  const lock = S.skillTooltip(D.manuscript('rivet').skills[0]);
  assert.match(lock.condition, /累计普攻至少 3 次/);
  assert.match(lock.effects.find(e => e.label === '伤害 75%').hint, /施术者自身幅值的 75%/);
  assert.match(lock.effects.find(e => e.label === '护盾 12%').hint, /给自己.*自身生命上限的 12%.*缓冲上限/);
  const pierce = S.skillTooltip(D.manuscript('corridor5').skills[0]);
  assert.match(pierce.effects.find(e => e.label === '伤害 180%').hint, /施术者自身幅值的 180%/);
  assert.match(pierce.effects.find(e => e.label === '贯穿 2').hint, /敌方最前面的 2 名存活敌人/);
});

test('共鸣增幅与结算同顺序：共鸣阶 × 贯通（负荷不返利）', () => {
  const ms = {
    cov: { tier: { name: '共鸣三阶 · 圆满', effect: { mainMult: 1.24 } } },
    rt: { ok: true },
    spec: { load: 2 },
  };
  const r = S.resonance(ms);
  /* 1.24 × 1.15 = 1.43。负荷价已删，界面也不能再显示那一行 */
  assert.equal(r.total, 1.43);
  assert.equal(r.pct, 43);
  assert.deepEqual(r.parts, ['共鸣三阶 · 圆满 ×1.24', '贯通 ×1.15']);
});

test('风味句里不允许出现数字：文案与数值彻底分开', () => {
  for (const [id, text] of Object.entries(F.ETCHING)) {
    assert.ok(!/\d/.test(text), `蚀刻法风味句不该有数字：${id}「${text}」`);
  }
  for (const [id, text] of Object.entries(F.RUNE)) {
    assert.ok(!/\d/.test(text), `纹路风味句不该有数字：${id}「${text}」`);
  }
});

test('所有蚀刻法与纹路都有风味句', () => {
  for (const m of Object.values(D.MANUSCRIPTS)) {
    assert.ok(F.etching(m), `蚀刻法缺风味句：${m.id}`);
  }
  for (const t of Object.values(D.TEMPLATES)) {
    assert.ok(F.rune(t), `纹路缺风味句：${t.id}`);
  }
});

/* ---------------- 窄栏短标签（A3） ---------------- */

/** 把一份 facts 里所有面向玩家的字符串摊平，供断言扫描。 */
function factsText(f) {
  const at = (k) => f[k] || [];
  return [
    f.flavor,
    ...at('size').map((x) => `${x.label} ${x.value}`),
    ...at('main').map((x) => `${x.label} ${x.value}`),
    ...at('effects').map((x) => `${x.label} ${x.value}`),
    ...at('skills').flatMap((s) => [s.name, s.condition, s.effect]),
    ...at('tiers').flatMap((t) => [t.name, t.effects]),
  ].join(' ');
}

test('窄栏版只缩长术语：数字、名称、风味句都不动', () => {
  const spec = D.manuscript('corridor5');
  const full = S.manuscriptFacts(spec);
  const comp = S.manuscriptFacts(spec, { compact: true });
  assert.equal(full.main[0].label, '普通攻击间隔');
  assert.equal(comp.main[0].label, '普攻间隔');
  assert.equal(comp.flavor, full.flavor, '风味句不参与缩写');
  assert.equal(comp.skills[0].name, full.skills[0].name, '招式名不参与缩写');
  /* 数字必须一模一样：窄版只是换词，不是换算法 */
  const digits = (s) => (s.match(/[\d.]+/g) || []).join(',');
  assert.equal(digits(comp.skills[0].effect), digits(full.skills[0].effect));
  assert.equal(digits(comp.tiers.map((t) => t.effects).join(' ')), digits(full.tiers.map((t) => t.effects).join(' ')));
});

test('短标签只出现在窄栏版：全称输出里不得出现「普攻」', () => {
  /* 条件短语里的 [普攻 ×N] 是标准写法（2026-11-15 词表统一），
     所以先把方括号段摘掉，再查正文里有没有漏进短标签 */
  const prose = (t) => t.replace(/\[[^\]]*\]/g, '');
  for (const m of Object.values(D.MANUSCRIPTS)) {
    assert.ok(!prose(factsText(S.manuscriptFacts(m))).includes('普攻'), `全称版混进了短标签：${m.id}`);
  }
  for (const t of Object.values(D.TEMPLATES)) {
    assert.ok(!prose(factsText(S.runeFacts(t))).includes('普攻'), `纹路全称版混进了短标签：${t.id}`);
  }
});

test('窄栏版里不再残留长术语，且风味句全程干净', () => {
  for (const m of Object.values(D.MANUSCRIPTS)) {
    const comp = S.manuscriptFacts(m, { compact: true });
    assert.ok(!factsText(comp).includes('普通攻击'), `窄栏版仍有长术语：${m.id}`);
  }
});

test('短标签表里没有死词条，缩小后确实变了', () => {
  const pool = Object.values(D.MANUSCRIPTS).map((m) => factsText(S.manuscriptFacts(m))).join(' ');
  for (const [full, brief] of V.Terms.SHORT) {
    assert.notEqual(full, brief);
    assert.ok(pool.includes(full), `短标签表里的「${full}」在文案中根本没用上`);
    assert.equal(S.shorten(`前缀${full}后缀`), `前缀${brief}后缀`);
  }
});
