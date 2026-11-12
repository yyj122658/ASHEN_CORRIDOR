'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const touch of [false, true]) {
      const page = await browser.newPage({ viewport: { width: touch ? 390 : 1440, height: 950 }, hasTouch: touch });
      const touchInput = touch ? await page.context().newCDPSession(page) : null;
      const errors = [];
      page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
      await page.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
      await page.locator('[data-act=titleStart]').click();
      const fuse = await page.evaluate(() => {
        const V = Ashen.Veteran, E = V.Expedition;
        let s = E.start(V.State.create(42),{seed:42}).state;
        s = E.chooseNode(s,s.run.nodes.find(n=>n.type === 'chest').id).state;
        s.settings.reducedMotion = true;
        for (const id of [...s.run.pendingLoot]) s = E.resolveLoot(s,id,'discard').state;
        s.run.ingredientLoot = {};
        s.run.packOrder = Array(24).fill(null);
        for (const [id,at] of [['reed',0],['fuse',6]]) {
          const part = V.State.makePart(s,{templateId:id,acquiredRunId:s.run.id});
          s.itemsById[part.id] = part;
          s.run.bag.push(part.id);
          s.run.packOrder.fill('part:'+part.id,at,at+3);
        }
        V.App.setState(s);
        return s.run.packOrder[6];
      });
      const footprint = () => page.locator('[data-pack-slot][data-token="'+fuse+'"]').evaluateAll(els=>els.map(el=>Number(el.dataset.packSlot)));
      const sourceCell = n=>page.locator('.loot-pack [data-pack-slot="'+n+'"]');
      await sourceCell(6).click();
      await page.locator('[data-act=packRotate]').click();
      assert.deepEqual(await footprint(),[6,12,18]);
      await page.waitForFunction(()=>Ashen.Veteran.Storage.load().state?.run?.packOrder[18]);
      await page.reload();
      await page.locator('[data-act=titleStart]').click();
      assert.deepEqual(await footprint(),[6,12,18]);
      if (!touch) {
        const a = await sourceCell(12).boundingBox(), b = await sourceCell(9).boundingBox();
        await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
        await page.mouse.down();
        await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:5});
        await page.keyboard.press('r');
        assert.equal(await page.locator('.pack-slot.drop-target:not(.bad-fit)').count(),3);
        await page.mouse.up();
        assert.deepEqual(await footprint(),[8,9,10]);
      }
      if (!await page.locator('[data-act=packToGround]').count()) await sourceCell((await footprint())[0]).click();
      await page.locator('[data-act=packToGround]').click();
      const rotated = page.locator('[data-ground-item][data-token="'+fuse+'"]');
      const before = Number(await rotated.getAttribute('data-turn'));
      await page.locator('[data-ground-note="'+fuse+'"] [data-act=groundRotate]').click();
      assert.equal(Number(await rotated.getAttribute('data-turn')),(before+1)%4);
      const id = await page.evaluate(() => {
        const V = Ashen.Veteran, s = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
        s.run.stage = 'loot';
        s.settings.reducedMotion = true;
        const part = V.State.makePart(s, { kind: 'circuit', templateId: 'crook', acquiredRunId: s.run.id });
        s.itemsById[part.id] = part;
        s.run.pendingLoot = [part.id];
        s.run.ingredients = { boneCap: 3 };
        s.run.ingredientLoot = { boneCap: 6 };
        V.App.setState(s);
        return part.id;
      });
      const cell = i => page.locator('.loot-pack [data-pack-slot="' + i + '"]');
      async function drag(token, to, valid) {
        const source = page.locator('[data-ground-item][data-token="' + token + '"]');
        await source.scrollIntoViewIfNeeded();
        const a = await source.boundingBox(), b = await cell(to).boundingBox();
        const from = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
        const dest = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        if (touch) {
          await touchInput.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
          await touchInput.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...dest, id: 1 }] });
        } else {
          await page.mouse.move(from.x, from.y); await page.mouse.down();
          await page.mouse.move(dest.x, dest.y, { steps: 8 });
        }
        assert.ok(await page.locator('.loot-drop-ghost').isVisible());
        assert.equal(await page.locator('.pack-slot.drop-target.bad-fit').count() > 0, !valid);
        if (touch) await touchInput.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else await page.mouse.up();
      }
      await drag('part:' + id, 5, false);
      assert.equal(await page.locator('[data-ground-item][data-token="part:' + id + '"]').count(), 1);
      await drag('part:' + id, 8, true);
      assert.deepEqual(await page.evaluate(id => Ashen.Veteran.Expedition.packSlots(Ashen.Veteran.App.state).flatMap((v,i) => v === 'part:' + id ? [i] : []), id), [8,14,20,21]);
      await drag('food:boneCap', 0, true);
      assert.equal(await page.evaluate(() => Ashen.Veteran.Expedition.stackCount(Ashen.Veteran.App.state, 'food:boneCap')), 4);
      await drag('food:boneCap', 5, true);
      assert.equal(await cell(5).getAttribute('data-token'), 'food:boneCap#1');
      assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.run.ingredientLoot.boneCap), 1);
      await page.locator('[data-ground-item][data-token="food:boneCap"]').click();
      assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.run.ingredientLoot.boneCap || 0), 0, '点击拾取仍可用');

      await page.evaluate(() => {
        const V = Ashen.Veteran, s = V.State.clone(V.App.state);
        s.run.stage = 'camp'; s.run.ingredients = { boneCap: 3 }; s.run.meals = {}; s.run.packOrder = []; delete s.run.packStacks;
        s.settings.reducedMotion = false;
        V.App.setState(s);
      });
      assert.equal(await page.locator('.field-kitchen .pack-grid').count(), 1);
      assert.equal(await page.locator('.field-kitchen .k-sources, .field-kitchen .k-needs, .field-kitchen .k-pantry').count(), 0);
      await page.locator('.field-inscription summary').click();
      await page.locator('.field-kitchen [data-act=packSort]').click();
      assert.ok(await page.locator('.field-inscription').evaluate(el => el.open), '整理行囊不收起用户展开的烙印说明');
      await page.locator('.field-inscription summary').click();
      if (!touch) await page.waitForFunction(() => getComputedStyle(document.getElementById('toast')).opacity === '0');
      const cook = page.locator('.field-kitchen [data-act=cookRecipe][data-id=roastCap]');
      await cook.click();
      assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.run.meals.roastCap || 0), 0, '动画之前不能入包');
      assert.ok(await cook.isDisabled());
      if (!touch) await page.screenshot({ path: path.resolve(__dirname, '../../docs/verification/camp-cooking.png'), fullPage: true });
      await page.evaluate(() => { const A = Ashen.Veteran.App; A.dispatch({type:'cookRecipe',id:'roastCap'}); A.render(); });
      await page.waitForFunction(() => Ashen.Veteran.App.state.run.meals.roastCap === 1);
      assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.run.ingredients.boneCap), 2, '重复请求只做一份');
      assert.ok(await page.locator('.field-kitchen [data-pack-art="meal:roastCap"]').isVisible());
      await cook.click();
      await page.locator('[data-act=finishNode]').first().click();
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.run.meals.roastCap), 1, '离开营火取消尚未完成的制作');

      await page.evaluate(() => {
        const V = Ashen.Veteran, s = V.State.create(42); s.pantry = { boneCap: 2 }; s.settings.reducedMotion = true;
        V.App.setState(s); V.App.dispatch({type:'go',v:'kitchen'});
      });
      await page.locator('[data-act=cookRecipe][data-id=roastCap]').click();
      assert.equal(await page.locator('.k-pot b').evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.waitForFunction(() => Ashen.Veteran.App.state.packedMeals.roastCap === 1);
      assert.equal(await page.locator('.k-sources').count(), 0, '前哨厨房移除食材来源');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('通过鼠标/触屏战利品落点、非法回弹、堆叠、营火实包、制作时序、重复请求与导航取消。');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
