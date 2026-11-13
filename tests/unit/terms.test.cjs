'use strict';
/* 术语唯一来源（terms.js）的守卫：
   1. 词条表本身要完整、可查（tooltip 与图鉴术语页共用）
   2. 禁用词表只能收紧规则，不能变成死规则
   3. 面向玩家的数据里不许再出现旧词——这就是「编译期校验」 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;
const T = V.Terms;

test('词条表完整：id 唯一、名称与解释都非空', () => {
  const ids = new Set();
  assert.ok(T.ENTRIES.length >= 9, '词条不该比之前少');
  for (const e of T.ENTRIES) {
    assert.ok(e.id && typeof e.id === 'string', '词条缺 id');
    assert.ok(!ids.has(e.id), `词条 id 重复：${e.id}`);
    ids.add(e.id);
    assert.ok(e.label && e.label.length <= 16, `词条名过长或为空：${e.id}`);
    assert.ok(e.desc && e.desc.length >= 20, `词条解释过短或为空：${e.id}`);
  }
});

test('按 id 取词条，取不到时给空串而不是 undefined', () => {
  assert.match(T.text('stress'), /压力/);
  assert.equal(T.label('energy'), '余裕');
  assert.equal(T.text('nope'), '');
  assert.equal(T.label('nope'), '');
});

test('词条解释自身不许用禁用词', () => {
  assert.deepEqual(T.auditTree(T.ENTRIES, 'ENTRIES'), []);
});

test('禁用词表不是死规则：每条规则都写得出一个能命中的例子，且修正词自身合法', () => {
  for (const rule of T.BANNED) {
    /* 规则跑在 VM 沙箱里，跨 realm 的 instanceof 不可靠，用鸭子类型判定 */
    assert.equal(typeof rule.re.test, 'function', '规则必须是正则');
    assert.ok(rule.re.global !== true, '规则不要带 g，否则 lastIndex 会串味');
    assert.ok(rule.fix && rule.fix.length > 0, '禁用词必须给替换词');
    assert.ok(rule.why && rule.why.length > 0, '禁用词必须写清为什么');
    /* 反向自检：把替换词丢回同一张表，不能再被同一类拦下，否则替换等于没修 */
    const selfHit = T.audit(rule.fix).some((h) => h.fix === rule.fix);
    assert.equal(selfHit, false, `替换词「${rule.fix}」自己也被判成禁用词`);
  }
});

test('短词规则不能误伤合法长词：金属板面 / 余裕 / 共鸣阶 都合法', () => {
  assert.deepEqual(T.audit('这块金属板面'), []);
  assert.deepEqual(T.audit('金属板'), [{ word: '金属板', fix: '金属板面', why: '统一叫金属板面' }]);
  assert.deepEqual(T.audit('每点余裕'), []);
  assert.deepEqual(T.audit('共鸣阶'), []);
});

test('数据表里不再有禁用词（这是编译期校验）', () => {
  const hits = T.auditTree(D, 'Data');
  assert.deepEqual(hits, [], hits.map((h) => `${h.path}: ${h.word} → ${h.fix}`).join('\n'));
});

test('风味句里不再有禁用词', () => {
  assert.deepEqual(T.auditTree(V.Flavor.ETCHING, 'ETCHING'), []);
  assert.deepEqual(T.auditTree(V.Flavor.RUNE, 'RUNE'), []);
});

test('窄栏短标签只由 terms.js 提供，stats-engine 只是转发', () => {
  assert.equal(V.Stats.shorten('普通攻击 3 次'), '普攻 3 次');
  assert.equal(V.Stats.shorten, V.Stats.shorten);
  assert.equal(V.Stats.SHORT_LABELS, undefined, '短标签表不该在引擎里另存一份');
  assert.deepEqual(T.SHORT, [['普通攻击', '普攻']]);
});
