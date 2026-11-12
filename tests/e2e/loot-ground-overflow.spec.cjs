'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

function screenshotFixture() {
  const V = Ashen.Veteran, E = V.Expedition;
  let st = E.start(V.State.create(42), {seed:42}).state;
  st = E.chooseNode(st, st.run.nodes.find(n => n.type === 'chest').id).state;
  st.settings.reducedMotion = true;
  const r = st.run;
  r.packOrder = Array(24).fill(null);
  r.pendingLoot.forEach((id,i) => { st.itemsById[id].templateId = ['jack','rivet'][i]; });
  function place(token, origin) {
    for (const [x,y] of E.packShape(st,token)) r.packOrder[origin+x+6*y] = token;
  }
  function rune(templateId, origin) {
    const item = V.State.makePart(st,{kind:'circuit',templateId,acquiredRunId:r.id});
    st.itemsById[item.id] = item;
    r.bag.push(item.id);
    const token = 'part:' + item.id;
    if (origin != null) place(token,origin);
    return token;
  }
  const brazier = rune('brazier',0), rail = rune('rail',19), cross = rune('cross');
  r.ingredients = {lampKelp:1,sulfurLeaf:1,shellLichen:1,boneCap:1,heatBulb:1,mistJelly:1,hingeSnail:1,silverRush:2};
  for (const [id,origin] of Object.entries({lampKelp:2,sulfurLeaf:9,shellLichen:15,boneCap:5,heatBulb:12,mistJelly:17,hingeSnail:18})) place('food:'+id,origin);
  r.ingredientLoot = {boneCap:2,reedPith:1};
  const valid = V.State.validate(st);
  if (!valid.ok) throw new Error(valid.errors.join('，'));
  V.App.setState(st);
  return {brazier,rail,cross,used:E.bagUsed(st),overflow:E.packOverflow(st),groundRune:'part:'+r.pendingLoot[0]};
}

async function runViewport(browser, touch) {
  const page = await browser.newPage({ viewport:{width:touch?390:1440,height:touch?844:950},hasTouch:touch });
  const input = touch ? await page.context().newCDPSession(page) : null;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const uri = pathToFileURL(path.resolve(__dirname,'../../index.html')).href;
    await page.goto(uri);
    const start = page.locator('[data-act=titleStart]');
    await start.click();
    const f = await page.evaluate(screenshotFixture);
    assert.equal(f.used,19);
    assert.deepEqual(f.overflow,[f.cross,'food:silverRush']);
    const pack = n => page.locator('.loot-pack [data-pack-slot="' + n + '"]');
    const floor = n => page.locator('.ground-grid [data-ground-slot="' + n + '"]');
    const item = token => page.locator('[data-ground-item][data-token="' + token + '"]');
    const reserve = token => page.locator('[data-pack-overflow][data-token="' + token + '"]');
    async function coords(el) {
      const b = await el.boundingBox();
      assert.ok(b, '物件或落点未出现在页面');
      return {x:b.x+b.width/2,y:b.y+b.height/2};
    }
    async function drag(source, target) {
      await source.waitFor();
      await target.waitFor();
      const handle = await source.getAttribute('data-pack-overflow') !== null ? source.locator('.catalogue-icon').first() : source;
      const a = await coords(handle), b = await coords(target);
      await page.evaluate(([y1,y2]) => {
        if (Math.min(y1,y2)<30 || Math.max(y1,y2)>innerHeight-30) window.scrollBy(0,(y1+y2-innerHeight)/2);
      },[a.y,b.y]);
      const from = await coords(handle), dest = await coords(target);
      assert.ok([from,dest].every(p=>p.y>0 && p.y<page.viewportSize().height),'真实拖放需要两个格位同屏');
      if (touch) {
        await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});
        for (let i=1;i<=6;i++) await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{
          x:from.x+(dest.x-from.x)*i/6,y:from.y+(dest.y-from.y)*i/6,id:1,
        }]});
        await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else {
        await page.mouse.move(from.x,from.y); await page.mouse.down();
        await page.mouse.move(dest.x,dest.y,{steps:8}); await page.mouse.up();
      }
    }
    async function state() {
      return page.evaluate(() => {
        const V = Ashen.Veteran, s = V.App.state;
        return {bag:s.run.bag,pending:s.run.pendingLoot,slots:V.Expedition.packSlots(s),overflow:V.Expedition.packOverflow(s),
          food:s.run.ingredients,finds:s.run.ingredientLoot};
      });
    }
    async function origin(token) {
      return item(token).evaluate(el=>Number(el.dataset.groundX)+6*Number(el.dataset.groundY));
    }
    await page.locator('[data-ground-item][data-scan="revealed"]').first().waitFor();
    assert.ok(await item(f.groundRune).isEnabled(),'有待整理物品时，已辨认的地面轮廓也应能拖动');
    assert.equal(await page.locator('.ground-grid').getAttribute('data-ground-columns'),'6');
    const gridSize = await page.locator('.ground-grid [data-ground-slot]').count();
    assert.ok(gridSize >= 48,'地面应比原 18 格和当前 24 格背包更大');
    assert.match(await page.locator('.loot-pack .pack-count').innerText(),/19\s*\/\s*24/);
    assert.ok(await reserve(f.cross).isVisible());
    assert.ok(await reserve('food:silverRush').isVisible());
    if (!touch && process.env.PACK_OVERFLOW_SCREENSHOT) await page.screenshot({path:process.env.PACK_OVERFLOW_SCREENSHOT,fullPage:true});

    // 从异形物的第一格抓起时保持格内偏移，待整理行则从左上原点放入。
    await drag(item(f.groundRune),floor(4));
    assert.equal(await origin(f.groundRune),4,'背包仍有两件待整理时也可以移动地面物品');
    const initial = await state();
    await drag(reserve(f.cross),floor(0));
    assert.deepEqual(await state(),initial,'碰到地面已有物件的异形轮廓应整件留在待整理区');
    await drag(reserve(f.cross),floor(18));
    const placed = (await state()).pending.includes(f.cross.slice(5));
    assert.ok(placed, (touch ? '触屏' : '桌面') + '拖出十字星纹应加入现场物品');
    assert.ok(!(await state()).bag.includes(f.cross.slice(5)));
    assert.equal(await origin(f.cross),18);
    await drag(reserve('food:silverRush'),floor(22));
    assert.equal((await state()).finds.silverRush,2,'暂放整堆应保留两份');
    assert.deepEqual((await state()).overflow,[]);

    await drag(pack(1),floor(33));
    assert.equal(await origin(f.brazier),32);
    assert.ok(await page.locator('.ground-grid [data-ground-slot]').count() > gridSize,'在地面底部暂放物品后应留出新的空行');
    assert.ok((await state()).pending.includes(f.brazier.slice(5)));
    await drag(item(f.cross),floor(25));
    assert.equal(await origin(f.cross),24,'可在扩大的地面区域重新摆放');
    const before = await state();
    await page.waitForFunction(snapshot=>{
      const V=Ashen.Veteran, disk=V.Storage.load();
      return disk.ok && JSON.stringify(disk.state.run.pendingLoot) === JSON.stringify(snapshot.pending)
        && JSON.stringify(disk.state.run.groundPositions) === JSON.stringify(V.App.state.run.groundPositions);
    },before);
    await page.reload(); await start.click();
    assert.deepEqual(await state(),before,'读档应保留现场和背包双方的归属');
    assert.equal(await origin(f.cross),24,'读档应还原地面落点');
    assert.equal(await origin(f.brazier),32);

    await drag(item(f.brazier),pack(1));
    assert.equal((await state()).slots[1],f.brazier,'随身纹路可从地面再捡回原格');
    await drag(pack(1),floor(33));
    await drag(item(f.cross),pack(1));
    assert.deepEqual((await state()).slots.flatMap((token,i)=>token===f.cross?[i]:[]),[1,6,7,8,13]);
    await drag(pack(19),floor(12));
    await drag(item('food:silverRush'),pack(14));
    const result = await state();
    assert.equal(result.food.silverRush,2);
    assert.equal(result.finds.silverRush || 0,0);
    assert.deepEqual(result.slots.flatMap((token,i)=>token==='food:silverRush'?[i]:[]),[14,20]);
    assert.equal(result.pending.includes(f.cross.slice(5)),false);
    assert.equal(result.bag.filter(id=>id===f.cross.slice(5)).length,1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({channel:'chrome'});
  try {
    await runViewport(browser,false);
    await runViewport(browser,true);
    console.log('桌面及触屏通过 19/24 格现场、待整理双向拾放、地面换位与刷新恢复。');
  } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1;});
