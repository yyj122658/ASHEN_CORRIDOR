'use strict';
/* 用真实领域命令构造全流程页面，验证移动端与桌面均可操作。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
    await page.locator('[data-act="titleStart"]').click();
    const fixtures = await page.evaluate(() => {
      const V = Ashen.Veteran;
      const clone = (s) => V.State.clone(s);
      const rows = [];
      const add = (screen, state) => { rows.push({ screen, state: clone(state) }); };
      let st = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
      add('map', st);
      const node = st.run.nodes.find((n) => n.type === 'battle' || n.type === 'elite');
      st = V.Encounter.open(st, node.id).state;
      add('prebattle', st);
      st = V.Encounter.startAttempt(st).state;
      add('battle', st);
      for (let i = 0; !st.run.battle.over && i < 4201; i++) st = V.Combat.step(st).state;
      V.Combat.prepareResult(st);
      st.run.stage = 'battleReview';
      add('review', st);
      const confirmed = V.Encounter.confirm(st);
      if (!confirmed.ok) throw new Error('样例战斗必须成功');
      add('loot', confirmed.state);

      const nodeState = (type, floor = 1) => {
        let s = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
        s.run.floor = floor;
        s.run.nodes = [{ ...V.Data.nodeType(type), id: 'fixture-' + type, type, consumed: false }];
        const r = V.Expedition.chooseNode(s, s.run.nodes[0].id);
        if (!r.ok) throw new Error(r.error.message);
        return r.state;
      };
      add('event', nodeState('event'));
      add('campNode', nodeState('camp'));
      add('merchant', nodeState('merchant'));
      add('loot', nodeState('chest', 1));
      add('blessing', V.Expedition.finishNode(nodeState('chest', 2), true).state);
      const third = V.Expedition.finishNode(nodeState('chest', 3), true).state;
      add('settlement', V.Expedition.extract(third, false).state);
      return rows;
    });
    for (const fixture of fixtures) {
      const valid = await page.evaluate((s) => Ashen.Veteran.State.validate(s), fixture.state);
      assert.equal(valid.ok, true, `${fixture.screen}: ${valid.errors.join('；')}`);
      for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        const rendered = await page.evaluate((state) => {
          const V = Ashen.Veteran;
          V.App.ui.paused = true;
          V.App.setState(V.State.clone(state));
          return { screen: V.App.ui.screen, overflow: document.documentElement.scrollWidth - innerWidth };
        }, fixture.state);
        assert.equal(rendered.screen, fixture.screen);
        assert.ok(rendered.overflow <= 1, `${fixture.screen}@${width} 横溢出 ${rendered.overflow}px`);
        if (fixture.screen === 'loot' && fixture.state.run.activeNodeId === 'fixture-chest') {
          const ids = fixture.state.run.pendingLoot;
          assert.equal(ids.length, 2);
          assert.equal(await page.locator('[data-act="lootTake"]').count(), ids.length);
          const leave = page.locator('[data-act="finishNode"]');
          assert.ok(await leave.isEnabled());
          // 桌面取齐、窄屏不取、中等宽度只拿一件。未取走的纹路留在地面。
          const count = width === 1440 ? ids.length : width === 360 ? 0 : 1;
          for (const id of ids.slice(0, count)) await page.locator(`[data-act="lootTake"][data-id="${id}"]`).click();
          await leave.click();
          const result = await page.evaluate(ids => {
            const st = Ashen.Veteran.App.state;
            return { stage: st.run.stage, bag: st.run.bag, pending: st.run.pendingLoot,
              registered: ids.filter(id => st.itemsById[id]) };
          }, ids);
          assert.equal(result.stage, 'map');
          assert.deepEqual(result.bag, ids.slice(0,count));
          assert.deepEqual(result.registered, result.bag);
          assert.deepEqual(result.pending, []);
        }
      }
    }
    // 使用旧版开箱时的实际档案结构，从浏览器存储走一次完整的载入和领取。
    const oldIds = await page.evaluate(() => {
      const V = Ashen.Veteran, s = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
      s.run.nodes = [{ ...V.Data.nodeType('chest'), id: 'legacy-chest', type: 'chest', consumed: false }];
      s.run.activeNodeId = 'legacy-chest';
      s.run.stage = 'loot';
      s.run.chestChoices = V.Expedition.rngShuffle(s, V.Data.TEMPLATE_ORDER).slice(0, 2).map(templateId => {
        const part = V.State.makePart(s, {kind:'circuit',templateId});
        s.itemsById[part.id] = part;
        return part.id;
      });
      V.App.setState(s);
      return s.run.chestChoices;
    });
    await page.reload();
    await page.locator('[data-act="titleStart"]').click();
    assert.deepEqual(await page.locator('[data-act="lootTake"]').evaluateAll(els => els.map(el => el.dataset.id)), oldIds);
    for (const id of oldIds) await page.locator(`[data-act="lootTake"][data-id="${id}"]`).click();
    await page.locator('[data-act="finishNode"]').click();
    assert.deepEqual(await page.evaluate(() => Ashen.Veteran.App.state.run.bag), oldIds);
    await page.evaluate(() => {
      const V = Ashen.Veteran, s = V.State.clone(V.App.state);
      s.run.floor = 43;
      s.run.completedFloors = 42;
      s.run.finishedFloors = Array.from({length:42},(_,i)=>i+1);
      V.Expedition.genNodes(s);
      V.App.setState(s);
    });
    await page.reload();
    await page.locator('[data-act="titleStart"]').click();
    assert.match(await page.locator('.ex-header-text').innerText(), /第 7 章 · 黑炉核心 · 1\/7/);
    assert.equal(await page.locator('.ex-depth li').count(),7);
    await page.locator('[data-act="extractNow"]').click();
    assert.equal(await page.evaluate(()=>Ashen.Veteran.App.state.settlement.depth),42);
    assert.deepEqual(errors, []);
    console.log(`通过 ${fixtures.length * 4} 组全流程视口检查，所有样例状态合法，页面无 JS 异常。`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
