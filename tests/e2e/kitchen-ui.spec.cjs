'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [360, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 360 });
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
      const act = (name, id) => page.locator(`[data-act="${name}"]${id ? `[data-id="${id}"]` : ''}`);
      await act('titleStart').click();
      if (width === 1440) {
        const missing = await page.evaluate(async () => {
          const V = Ashen.Veteran;
          const inventories = { ingredient: V.Kitchen.INGREDIENTS, recipe: V.Kitchen.RECIPES, rune: V.Data.TEMPLATES, etching: V.Data.MANUSCRIPTS };
          const sheets = new Set();
          const failures = [];
          for (const [kind, records] of Object.entries(inventories)) {
            for (const id of Object.keys(records)) {
              const tile = V.CatalogueArt.lookup(kind, id);
              if (tile) sheets.add(tile.src);
              else failures.push(kind + '/' + id);
            }
          }
          await Promise.all(Array.from(sheets, async src => {
            const image = new Image();
            image.src = src;
            try { await image.decode(); } catch { failures.push(src); }
          }));
          return failures;
        });
        assert.deepEqual(missing, [], '每个收录条目都应有可在离线浏览器解码的图集');
      }
      const battle = await page.evaluate(() => {
        const V = Ashen.Veteran;
        const state = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
        state.run.ingredients.boneCap = 1;
        V.App.setState(state);
        return state.run.nodes.find(n => n.type === 'battle').id;
      });
      await page.locator('.k-biome summary').click();
      assert.match(await page.locator('.k-biome').innerText(), /骨犬/);
      await act('chooseNode', battle).click();
      assert.match(await page.locator('.enemy-list').innerText(), /骨伞/);
      await page.evaluate(() => {
        const V = Ashen.Veteran;
        let s = V.Encounter.startAttempt(V.App.state).state;
        while (!s.run.battle.over) s = V.Combat.step(s).state;
        V.Combat.prepareResult(s);
        s.run.stage = 'battleReview';
        V.App.setState(s);
      });
      await act('confirmResult').click();
      await page.locator('[data-ground-item][data-token="food:boneCap"][data-scan="revealed"]').waitFor();
      await act('takeIngredient', 'boneCap').click();
      await act('takeIngredient', 'houndShank').click();
      await page.locator('.loot-pack [data-token="food:houndShank"]').first().click();
      await act('packToGround').click();
      assert.deepEqual(await page.evaluate(() => Ashen.Veteran.App.state.run.ingredients), { boneCap: 2 });
      await act('finishNode').click();
      const initialHp = await page.evaluate(() => {
        const V = Ashen.Veteran;
        const s = V.State.clone(V.App.state);
        const p = s.run.party[1];
        p.hp = 25;
        p.stress = 90;
        V.State.unitById(s, p.uid).stress = p.stress;
        s.run.nodes = [{ ...V.Data.nodeType('camp'), id: 'kitchenCamp', type: 'camp', consumed: false }];
        V.App.setState(s);
        return p.hp;
      });
      await act('chooseNode', 'kitchenCamp').click();
      assert.equal(await page.locator('.k-recipe').first().locator('button').getAttribute('data-id'), 'roastCap');
      await act('cookRecipe', 'roastCap').click();
      await page.waitForFunction(() => Ashen.Veteran.App.state.run.meals.roastCap === 1);
      assert.deepEqual(await page.evaluate(() => {
        const r = Ashen.Veteran.App.state.run;
        return [r.party[1].hp, r.meals.roastCap];
      }), [initialHp, 1], '做菜装包，队员尚未用餐');
      const others = () => page.evaluate(() => Ashen.Veteran.App.state.run.party.filter((p,i) => i !== 1).map(p => [p.uid,p.hp,p.stress]));
      const fieldOthers = await others();
      const pack = page.locator('.field-kitchen .loot-pack, .pack-dialog');
      const dish = pack.locator('[data-pack-slot][data-token="meal:roastCap"]').first();
      const diner = pack.locator('[data-act=packEat]').nth(1);
      assert.ok(await pack.locator('[data-pack-art="meal:roastCap"] .catalogue-icon').isVisible());
      if (width === 1440) { await diner.scrollIntoViewIfNeeded(); await dish.dragTo(diner); }
      else if (width === 360) { await dish.tap(); await diner.tap(); }
      else { await dish.click(); await diner.click(); }
      assert.ok(await page.evaluate(() => Ashen.Veteran.App.state.run.party[1].hp) > initialHp, `营火分餐 ${width}px`);
      assert.deepEqual(await others(), fieldOthers);
      assert.equal(await dish.count(), 0);
      await act('campRest').click();
      assert.equal(await act('campRest').isDisabled(), true);
      await act('finishNode').click();
      await act('chooseBlessing').first().click();
      await act('extractNow').click();
      assert.match(await page.locator('.k-pantry-door').innerText(), /骨伞\s*×1/);
      await act('settleClose').click();
      assert.ok(await page.locator('[data-v="kitchen"]').isVisible());
      await page.locator('nav [data-v="stash"]').click();
      await page.locator('.archive-catalogue summary').click();
      await page.locator('[data-catalogue-filter]').selectOption('rune');
      await page.locator('[data-catalogue-query]').fill('同心纹');
      assert.equal(await page.locator('.catalogue-entry:visible').count(), 1);
      assert.equal(await page.locator('.catalogue-entry:visible .catalogue-icon').count(), 1);
      assert.ok(await page.locator('.catalogue-entry:visible .mini-shape .rune-port-cut').count() >= 2);
      await page.locator('[data-catalogue-filter]').selectOption('etching');
      await page.locator('[data-catalogue-query]').fill('墨斗');
      assert.equal(await page.locator('.catalogue-entry:visible .catalogue-icon').count(), 1);
      assert.ok(await page.locator('.catalogue-entry:visible .etch-mark rect').count() >= 2);
      await page.locator('[data-v="kitchen"]').click();
      assert.equal(await page.locator('.k-sources').count(), 0);
      const campRecipe = page.locator('.k-recipe').filter({ has: act('cookRecipe', 'roastCap') });
      assert.doesNotMatch(await campRecipe.innerText(), /生命/);
      await act('cookRecipe', 'roastCap').click();
      await page.waitForFunction(() => Ashen.Veteran.App.state.cookedRecipes.roastCap === 2);
      assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.cookedRecipes.roastCap), 2);
      const homeStress = await page.evaluate(() => Ashen.Veteran.App.state.roster.map(u => u.stress));
      assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.packedMeals.roastCap), 1);
      await page.locator('#hud [data-act=openPack]').click();
      assert.match(await pack.locator('h2').innerText(), /前哨背包/);
      if (width === 1440) await dish.dragTo(diner);
      else if (width === 360) { await dish.tap(); await diner.tap(); }
      else { await dish.click(); await diner.click(); }
      const fed = await page.evaluate(() => Ashen.Veteran.App.state.roster.map(u => u.stress));
      assert.ok(fed[1] < homeStress[1], '给前哨选定的角色降压');
      assert.deepEqual(fed.filter((_,i)=>i!==1),homeStress.filter((_,i)=>i!==1));
      assert.equal(await dish.count(), 0);
      await pack.locator('[data-act=closeModal]').click();
      assert.ok(await act('cookRecipe', 'roastCap').isDisabled());
      await page.locator('[data-catalogue-more]').click();
      assert.equal(await page.locator('.k-recipe:visible').count(), Math.min(16, await page.locator('.k-recipe').count()));
      await page.locator('[data-catalogue-query]').fill('骨伞');
      await page.locator('[data-catalogue-filter]').selectOption('cooked');
      assert.equal(await page.locator('.k-recipe:visible').count(), 1);
      assert.match(await page.locator('.k-recipe:visible').innerText(), /石板骨伞/);
      const replacement = await page.evaluate(() => {
        const V = Ashen.Veteran;
        const it = Object.values(V.Kitchen.INGREDIENTS).find(it => it.id !== 'boneCap' && V.Kitchen.acceptsIngredient('boneCap', it.id));
        const s = V.State.clone(V.App.state);
        s.pantry = { [it.id]: 2 };
        V.State.unitById(s, s.team[0]).stress = 50;
        V.App.setState(s);
        return { id: it.id, name: it.name };
      });
      await page.locator('[data-catalogue-query]').fill(replacement.name);
      await page.locator('[data-catalogue-filter]').selectOption('stocked');
      assert.ok(await campRecipe.isVisible());
      assert.match(await campRecipe.locator('.recipe-use').innerText(), new RegExp(replacement.name + '\\s*×1'));
      await campRecipe.locator('.recipe-swaps summary').click();
      assert.ok((await campRecipe.locator('.recipe-swaps').innerText()).includes(replacement.name));
      for (const selector of ['.k-recipe-head', '.k-needs', '.recipe-use']) {
        const icon = campRecipe.locator(selector + ' .catalogue-icon').first();
        assert.ok(await icon.isVisible());
        assert.notEqual(await icon.evaluate(el => getComputedStyle(el).backgroundImage), 'none');
      }
      await act('cookRecipe', 'roastCap').click();
      await page.waitForFunction(() => !Ashen.Veteran.App.ui.cooking);
      assert.equal(await page.evaluate(id => Ashen.Veteran.App.state.pantry[id], replacement.id), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('通过三个视口的战后取材、行囊取舍、烹饪装盒、从背包点击或拖拽给指定角色、撤离入库与营地开火。');
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
