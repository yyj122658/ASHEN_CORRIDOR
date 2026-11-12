'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadVeteran, ROOT } = require('../helpers/load-veteran.cjs');

test('四类物品均有独立格位和可读的本地图集', () => {
  const V = loadVeteran().Veteran;
  const catalogs = { ingredient: V.Kitchen.INGREDIENTS, recipe: V.Kitchen.RECIPES, rune: V.Data.TEMPLATES, etching: V.Data.MANUSCRIPTS };
  const pages = new Set();
  const slots = new Set();
  for (const [kind, items] of Object.entries(catalogs)) {
    for (const id of Object.keys(items)) {
      const tile = V.CatalogueArt.lookup(kind, id);
      assert.ok(tile, kind + '/' + id);
      assert.ok(tile.x >= 0 && tile.x < tile.columns && tile.y >= 0 && tile.y < tile.rows);
      const slot = [tile.src, tile.x, tile.y].join('/');
      assert.ok(!slots.has(slot), slot);
      slots.add(slot);
      pages.add(tile.src);
    }
  }
  assert.equal(slots.size, 307);
  for (const src of pages) {
    const buf = fs.readFileSync(path.join(ROOT, src));
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
    assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  }
});
