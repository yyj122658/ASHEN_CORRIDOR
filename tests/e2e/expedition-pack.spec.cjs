'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [360, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
      const act = name => page.locator('[data-act="' + name + '"]');
      await act('titleStart').click();
      const { id, cost, shape, limit } = await page.evaluate(() => {
        const V = Ashen.Veteran, E = V.Expedition;
        let s = E.start(V.State.create(42), { seed: 42 }).state;
        s.run.nodes = [{ ...V.Data.nodeType('chest'), id:'packChest', type:'chest', consumed:false }];
        s = E.chooseNode(s, 'packChest').state;
        const [id] = s.run.pendingLoot;
        for (const partId of s.run.pendingLoot) s.itemsById[partId].templateId = 'crook';
        const shape = E.packShape(s,'part:'+id);
        const limit = E.foodPack('boneCap').limit;
        s.run.ingredients = { boneCap:limit-1, houndShank:2, lampKelp:3 };
        s.run.ingredientLoot = { boneCap:3, mistJelly:2 };
        V.App.setState(s);
        return { id, cost:shape.length, shape, limit };
      });
      const dialog = page.locator('.loot-pack'), ground = page.locator('.loot-ground');
      const left = await dialog.boundingBox(), right = await ground.boundingBox();
      assert.ok(left.x + left.width <= right.x + 1);
      const slot = i => dialog.locator('[data-pack-slot="'+i+'"]');
      assert.equal(await dialog.locator('[data-pack-slot]').count(), 24);
      const take = ground.locator('[data-act="lootTake"][data-id="'+id+'"]');
      const mist = ground.locator('[data-ground-item][data-token="food:mistJelly"]');
      assert.notEqual(await mist.getAttribute('data-scan'), 'revealed');
      assert.ok(await mist.isDisabled());
      await ground.locator('[data-ground-item][data-token="food:mistJelly"][data-scan="revealed"]').waitFor();
      await take.click();
      assert.equal(await mist.getAttribute('data-scan'), 'revealed');
      const rune = dialog.locator('[data-token="part:'+id+'"][data-pack-slot]');
      const indices = await rune.evaluateAll(els=>els.map(el=>Number(el.dataset.packSlot)));
      assert.equal(indices.length, cost);
      const x = Math.min(...indices.map(i=>i%6)), y = Math.floor(indices[0]/6);
      assert.deepEqual(indices.map(i=>[i%6-x, Math.floor(i/6)-y]).sort(), shape.sort());
      assert.equal(await dialog.locator('[data-pack-art="part:'+id+'"]').count(),1);
      const artBounds = await dialog.locator('[data-pack-art="part:'+id+'"]').boundingBox();
      const firstBounds = await slot(indices[0]).boundingBox(), lastBounds = await slot(indices.at(-1)).boundingBox();
      assert.ok(Math.abs(artBounds.y-firstBounds.y) < 2 && Math.abs(artBounds.y+artBounds.height-lastBounds.y-lastBounds.height) < 2);
      const bone = ground.locator('[data-act="takeIngredient"][data-id="boneCap"]').first();
      await bone.click();
      assert.match(await dialog.locator('[data-token="food:boneCap"] small').innerText(),new RegExp('×'+limit));
      await bone.click();
      const second = dialog.locator('[data-token="food:boneCap#1"][data-pack-slot]').first();
      await second.click();
      await act('packToGround').click();
      assert.equal(await second.count(),0);
      assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.run.ingredientLoot.boneCap), 2);
      const { from, to } = await page.evaluate(() => {
        const V = Ashen.Veteran, s = V.App.state, slots = V.Expedition.packSlots(s);
        const from = slots.indexOf('food:boneCap');
        const to = slots.findIndex((v,i)=>!v && V.Expedition.movePack(s,from,i).ok);
        return {from,to};
      });
      assert.ok(to >= 0);
      if (width === 1440) await slot(from).dragTo(slot(to));
      else { await slot(from).click(); await slot(to).click(); }
      assert.equal(await slot(to).getAttribute('data-token'),'food:boneCap');
      const persisted = await page.evaluate(() => {
        const V = Ashen.Veteran;
        const saved = V.Storage.decode(V.Storage.encode(V.App.state));
        return saved.ok && JSON.stringify(V.Expedition.packSlots(saved.state)) === JSON.stringify(V.Expedition.packSlots(V.App.state));
      });
      assert.ok(persisted, '手动调整的布局应当随存档还原');
      await act('packSort').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (width === 1440 && process.env.PACK_SCREENSHOT) {
        await dialog.locator('[data-token="part:' + id + '"][data-pack-slot]').first().click();
        await page.screenshot({ path: process.env.PACK_SCREENSHOT });
      }
      await act('finishNode').click();
      if (await act('chooseBlessing').count()) await act('chooseBlessing').first().click();
      await act('extractNow').click();
      assert.ok(await page.evaluate(id => Ashen.Veteran.App.state.stash.includes(id), id));
      await act('settleClose').click();
      await page.locator('.camp-pack summary').click();
      await act('upgradePack').click();
      assert.match(await page.locator('.camp-pack summary').innerText(), /30 格/);
      assert.ok(await act('upgradePack').isDisabled());
      await act('startRun').click();
      await act('openPack').click();
      assert.equal(await page.locator('.pack-dialog [data-pack-slot]').count(), 30);
      if (width === 1440) {
        await page.locator('.pack-dialog [data-act="closeModal"]').click();
        const token = await page.evaluate(() => {
          const V = Ashen.Veteran, s = V.State.clone(V.App.state);
          const spec = Object.values(V.Data.TEMPLATES).find(t => t.name === '叠浪纹');
          const item = V.State.makePart(s, {kind:'circuit', templateId:spec.id, acquiredRunId:s.run.id, acquiredSeq:1});
          s.itemsById[item.id] = item;
          s.run.bag.push(item.id);
          V.App.setState(s);
          const native = DataTransfer.prototype.setDragImage;
          DataTransfer.prototype.setDragImage = function(el,x,y) {
            window.packDragImage = {token:el.dataset.packArt,width:el.getBoundingClientRect().width,x};
            return native.call(this,el,x,y);
          };
          return 'part:' + item.id;
        });
        await act('openPack').click();
        const cell = i => page.locator('.pack-dialog [data-pack-slot="'+i+'"]');
        const from = await cell(1).boundingBox(), dest = await cell(7).boundingBox();
        const x = from.x + from.width/2;
        await page.mouse.move(x,from.y + from.height/2);
        await page.mouse.down();
        await page.mouse.move(x,dest.y + dest.height/2,{steps:8});
        await page.mouse.move(x+1,dest.y + dest.height/2);
        const ghost = await page.evaluate(() => window.packDragImage);
        assert.equal(ghost.token,token);
        assert.ok(ghost.width >= 3*from.width-1 && ghost.x > from.width && ghost.x < 2*from.width);
        assert.equal(await page.locator('.pack-slot.drop-target:not(.bad-fit)').count(),3);
        await page.mouse.up();
        assert.equal(await cell(6).getAttribute('data-token'),token);
        assert.equal(await cell(8).getAttribute('data-token'),token);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('通过窄屏与桌面远征背包的丢弃、换位、整理、搜刮与撤离。');
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
