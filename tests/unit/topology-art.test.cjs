'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadVeteran, ROOT } = require('../helpers/load-veteran.cjs');

test('所有运行时美术注册与角色条带使用新的 v4 图源', () => {
  const A = loadVeteran();
  assert.ok(A.SpriteAnim.init());
  const sources = [
    ...Object.keys(A.Art.ART).map(id => A.Art.getArt(id).src),
    ...Object.values(A.SpriteAnim.atlas.characters).map(actor => actor.animations.idle.sheet),
    ...Object.values(A.Veteran.Kitchen.INGREDIENTS).map(item => A.Veteran.CatalogueArt.lookup('ingredient', item.id).src),
  ];
  for (const src of new Set(sources)) {
    assert.match(src, /^assets\/art\/topology-v4\//);
    assert.ok(fs.existsSync(path.join(ROOT, src)), src);
  }
});

test('v4 徽章与逐帧图集覆盖数据目录且注册路径可读', async () => {
  const A = loadVeteran();
  const D = A.Veteran.Data;
  const keys = [
    ...Object.keys(D.TEMPLATES).map(id => 'rune.' + id),
    ...['straight','elbow','splitter','capacitor','threshold','ember'].map(id => 'family.' + id),
    ...Object.values(D.BODIES).map(body => 'plate.' + body.archetype),
    ...['battle','elite','chest','event','camp','merchant','boss'].map(id => 'node.' + id),
    'vfx.topology',
  ];
  for (const id of keys) {
    const art = A.Art?.getArt(id);
    assert.match(art?.src || '', /^assets\/art\/topology-v4\//, id);
    assert.ok(fs.existsSync(path.join(ROOT, art.src)), id);
  }
  assert.equal(await A.SpriteAnim.preloadEffects(), true);
  const draws = [];
  const ctx = { drawImage: (...args) => draws.push(args) };
  for (const id of ['pulse','overheat','corrosion','impact','impactHot','impactCrack','fuse','shield','membrane','interrupt','brazier']) {
    assert.equal(A.SpriteAnim.drawEffect(ctx, id, 0.7, 18, 18, 36, 36), true, id);
  }
  assert.equal(new Set(draws.map(args => args[2])).size, 11);
  assert.ok(draws.every(args => args[1] > 0));
});
