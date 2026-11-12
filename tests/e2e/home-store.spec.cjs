'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel:'chrome' });
  try {
    for (const width of [360, 1440]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(pathToFileURL(path.resolve(__dirname,'../../index.html')).href);
      await page.locator('[data-act="titleStart"]').click();
      await page.evaluate(() => {
        const V = Ashen.Veteran, s = V.State.create(77);
        s.pantry = {boneCap:3,lampKelp:3,houndShank:2,shellLichen:3,mistJelly:2};
        s.packedMeals = {roastCap:2};
        V.App.setState(s);
      });
      await page.locator('.hero-actions [data-v="stash"]').click();
      const shelf = name => page.locator('[data-act="stashShelf"][data-id="'+name+'"]');
      const transfer = direction => page.locator('[data-act="transferMeal"][data-v="'+direction+'"][data-id="roastCap"]');
      const grid = page.locator('.store-grid'), slot = id => grid.locator('[data-id="'+id+'"]');
      assert.equal(await grid.locator('.pack-slot').count(),24);
      await page.locator('[data-act="storeUpgrade"][data-id="rack"]').click();
      assert.equal(await grid.locator('.pack-slot').count(),36);
      await page.locator('[data-act="storeUpgrade"][data-id="bins"]').click();
      await grid.locator('[data-token="food:boneCap"]').first().click();
      await slot(30).click();
      assert.equal(await slot(30).getAttribute('data-token'),'food:boneCap');
      await slot(30).dragTo(slot(31));
      assert.equal(await slot(31).getAttribute('data-token'),'food:boneCap');
      await shelf('part').click();
      assert.ok(await grid.locator('[data-pack-art]').count());
      const wire = await grid.locator('[data-pack-art]').first().getAttribute('data-pack-art');
      await grid.locator('[data-token="'+wire+'"]').first().click();
      await slot(24).click();
      await page.locator('[data-act="storeRotate"]').click();
      assert.equal(await page.evaluate(t=>Ashen.Veteran.App.state.storePlaces.part[t].turn,wire),1);
      await shelf('etch').click();
      assert.ok(await grid.locator('[data-pack-art]').count());
      await shelf('meal').click();
      await transfer('store').click();
      await transfer('store').click();
      assert.ok(await transfer('store').isDisabled());
      await transfer('pack').click();
      const stocks = await page.evaluate(() => {
        const V = Ashen.Veteran;
        const saved = V.Storage.decode(V.Storage.encode(V.App.state));
        return saved.ok && [saved.state.packedMeals.roastCap,saved.state.mealStore.roastCap,saved.state.pantry.boneCap];
      });
      assert.deepEqual(stocks, [1,1,3]);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
      await page.locator('[data-act="openSettings"]').click();
      await page.locator('.term-guide summary').click();
      assert.match(await page.locator('.term-guide').innerText(), /0–100/);
      assert.match(await page.locator('.term-guide').innerText(), /保护/);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('前哨仓库四类库存、料理存取、读档与玩法词条通过。');
  } finally { await browser.close(); }
})().catch(err => {console.error(err); process.exitCode=1;});
