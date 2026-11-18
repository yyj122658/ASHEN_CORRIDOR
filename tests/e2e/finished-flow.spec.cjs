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
    const missing = new Set();
    const legacyAssets = new Set();
    page.on('requestfailed', req => {
      // Going to the next screen can cancel lazy image requests before decoding.
      if (req.failure()?.errorText !== 'net::ERR_ABORTED') missing.add(req.url());
    });
    page.on('request', req => {
      if (/\/assets\/art\/(?!topology-v4\/)/.test(req.url())) legacyAssets.add(req.url());
    });
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
        if (fixture.screen === 'map' || fixture.screen === 'battle') {
          const console = page.locator('.topology-console');
          assert.equal(await console.locator('.plate-cell-bed').count(), 77);
          assert.equal(await console.locator('.plate-datum').count(), 77);
          assert.equal(await console.locator('.plate-forge-grain').count(), 1);
          assert.equal(await console.locator('.plate-cell-bed').first().evaluate(el => getComputedStyle(el).strokeWidth), '1px');
          assert.equal(await console.locator('.ex-depth [aria-current="step"]').count(), 1);
          assert.equal(await console.locator('.topology-crew-list > *').count(), 4);
          const cards = console.locator('[data-act="selectTopologyUnit"]');
          await cards.nth(1).click();
          assert.equal(await cards.nth(1).getAttribute('aria-pressed'), 'true');
          assert.ok(await console.locator('.topology-extract').isEnabled());
          assert.equal(await console.evaluate(el => getComputedStyle(el).getPropertyValue('--accent-bright').trim()), '#EC963F');
          await page.waitForFunction(() => {
            const field = document.querySelector('.topology-flow');
            if (!field) return false;
            const ctx = field.getContext('2d', { willReadFrequently: true });
            return ctx.getImageData(0, 0, field.width, field.height).data.some((value, i) => i % 4 === 3 && value);
          });
        }
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
    // 战后板面沿用当场的脉冲和熔断，热态在战斗结算前随压力即时切换。
    await page.setViewportSize({ width: 390, height: 900 });
    const damaged = await page.evaluate(battle => {
      const V = Ashen.Veteran;
      const state = V.State.clone(battle);
      const ally = state.run.battle.allies.find(u => u.ms?.routed && u.ms.pulse.path.length >= 3);
      const unit = V.State.unitById(state, ally.sourceUnitId);
      const layout = V.Circuit.layout(state, state.run.fieldLayouts?.[unit.id] || unit.board.placements);
      const last = ally.ms.pulse.path.at(-1);
      const fuse = layout.built.find(b => b.abs.some(c => c.x + ',' + c.y === last)).item.id;
      V.App.ui.topologyUnit = unit.id;
      V.App.ui.paused = true;
      V.App.setState(state);
      return { unit: unit.id, fuse };
    }, fixtures.find(f => f.screen === 'battle').state);
    await page.waitForFunction(() => document.querySelector('.conduit-mask')?.getAttribute('d'));
    const full = await page.locator('.conduit-mask').getAttribute('d');
    await page.evaluate(({unit}) => {
      Ashen.Veteran.App.state.run.battle.allies.find(a => a.sourceUnitId === unit).stress = 50;
    }, damaged);
    await page.locator('.board.is-hot .conduit-hot').first().waitFor({state: 'visible'});
    await page.evaluate(({unit, fuse}) => {
      Ashen.Veteran.App.state.run.battle.allies.find(a => a.sourceUnitId === unit).fusedNodes = [fuse];
    }, damaged);
    await page.locator('.conduit-fuses image').first().waitFor({state:'visible'});
    assert.notEqual(await page.locator('.conduit-mask').getAttribute('d'), full);
    await page.evaluate(({review, damaged}) => {
      const V = Ashen.Veteran;
      const state = V.State.clone(review);
      state.run.battle.allies.find(a => a.sourceUnitId === damaged.unit).fusedNodes = [damaged.fuse];
      V.App.setState(state);
    }, {review: fixtures.find(f => f.screen === 'review').state, damaged});
    await page.locator('.topology-review summary').first().click();
    await page.locator('.topology-review .conduit-fuses image').first().waitFor({state:'visible'});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

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
    assert.deepEqual([...missing], []);
    assert.deepEqual([...legacyAssets], []);
    console.log(`通过 ${fixtures.length * 4} 组全流程视口检查，所有样例状态合法，页面无 JS 异常。`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
