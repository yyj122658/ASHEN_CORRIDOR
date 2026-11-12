'use strict';
/* 真实浏览器验证形态入口、瘢痕激活反馈、招募与窄屏布局。 */
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
    assert.equal(await page.locator('.metal-party .metal-card').count(), 4);
    const selectedId = await page.locator('.metal-card [data-v="workshop"]').nth(1).getAttribute('data-id');
    await page.locator('.metal-card [data-v="workshop"]').nth(1).click();
    assert.equal(await page.evaluate(() => Ashen.Veteran.App.ui.wsUnit), selectedId);

    const scarPartId = await page.evaluate(() => {
      const V = Ashen.Veteran;
      const st = V.App.state;
      const u = st.roster.find((x) => x.id === V.App.ui.wsUnit);
      const occupied = V.Circuit.layout(st, u.board.placements).cells;
      const used = new Set(occupied.map((c) => c.x + ',' + c.y));
      const m = V.Manuscript.orient(V.Manuscript.normalize(u.manuscript), u.manuscript.rotation || 0, !!u.manuscript.mirrorY);
      m.cells.forEach(([x, y]) => used.add((x + u.manuscript.x) + ',' + (y + u.manuscript.y)));
      const msCells = new Set(m.cells.map(([x,y]) => (x + u.manuscript.x) + ',' + (y + u.manuscript.y)));
      const bare = occupied.find((c) => !msCells.has(c.x + ',' + c.y));
      const owner = V.Circuit.layout(st, u.board.placements).built.find((b) => b.abs.some((c) => c.x === bare.x && c.y === bare.y)).item.id;
      const empty = V.Circuit.plateOf(u).cellsList.find(([x, y]) => !used.has(x + ',' + y));
      u.scars = [bare, { x: empty[0], y: empty[1] }].map((c) => ({ x: c.x, y: c.y, templateId: 'ember', source: '余烬纹', floor: 1, runId: 'visual-fixture' }));
      V.App.render();
      return owner;
    });
    assert.equal(await page.locator('svg.board .scar-cell.active').count(), 1);
    assert.equal(await page.locator('svg.board .scar-cell:not(.active)').count(), 1);
    assert.equal(await page.locator('svg.board .scar-mark').count(), 2);
    assert.match(await page.locator('.scar-key').innerText(), /瘢痕 2/);
    await page.locator('[data-act="wsFilmView"]').click();
    assert.ok(await page.locator('.film-view .ms-contour.focused').isVisible());
    assert.ok(Number(await page.locator('.film-view .ms-field').first().evaluate(el => getComputedStyle(el).fillOpacity)) >= 0.7);
    await page.locator('svg.board .scar-cell.active').focus();
    assert.match(await page.locator('#scar-tooltip').innerText(), /生效/);
    if (process.env.METAL_PREVIEW) await page.locator('.ws-board').screenshot({path:process.env.METAL_PREVIEW});
    await page.locator('[data-act="wsFilmView"]').click();
    assert.ok((await page.locator('.scar-cell').first().getAttribute('data-scar-tooltip')).includes('被余烬纹蚀刻'));
    await page.locator(`[data-act="wsRemove"][data-id="${scarPartId}"]`).click();
    assert.equal(await page.locator('.scar-cell.active').count(), 0);
    assert.equal(await page.locator('.scar-cell').count(), 2);
    await page.locator('[data-act="wsUndo"]').click();
    assert.equal(await page.locator('.scar-cell.active').count(), 1);
    await page.evaluate(() => {
      const V = Ashen.Veteran;
      const st = V.App.state;
      const u = st.roster.find((x) => x.id === V.App.ui.wsUnit);
      u.board.placements.forEach((p) => st.stash.push(p.itemId));
      u.board.placements = [];
      V.App.ui.wsDraft = [];
      const m = V.Manuscript.orient(V.Manuscript.normalize(u.manuscript), u.manuscript.rotation || 0, !!u.manuscript.mirrorY);
      const [mx, my] = m.cells[0];
      const sx = mx + u.manuscript.x, sy = my + u.manuscript.y;
      const used = new Set(V.Circuit.layout(st, u.board.placements).cells.map((c) => c.x + ',' + c.y));
      const free = V.Circuit.plateOf(u).cellsList.filter(([x, y]) => !used.has(x + ',' + y));
      const target = V.Manuscript.placements(m, free).find(([x, y]) => !m.cells.some(([dx, dy]) => dx + x === sx && dy + y === sy));
      if (!target) throw new Error('测试板面没有蚀刻法可移动位置');
      u.scars = [{ x: sx, y: sy, templateId: 'ember', source: '余烬纹', floor: 1, runId: 'visual-fixture' }];
      V.App.dispatch({ type: 'wsMsMove', ox: target[0], oy: target[1] });
    });
    assert.equal(await page.locator('.scar-cell.active').count(), 0, '移动蚀刻法时立即预览底层瘢痕停用');
    await page.locator('[data-act="wsSave"]').click();
    for (const action of ['wsMsRotate', 'wsMsFlip', 'wsMsShift']) {
      const control = page.locator(`[data-act="${action}"]`);
      if (!(await control.isEnabled())) continue;
      await control.click();
      const expected = await page.evaluate(() => {
        const V = Ashen.Veteran, u = V.App.state.roster.find((x) => x.id === V.App.ui.wsUnit);
        const ms = V.UI.resolveManuscript(u, V.Circuit.plateOf(u), V.App.ui, V.Circuit.layout(V.App.state, V.App.ui.wsDraft));
        return { x: ms.ox, y: ms.oy, rotation: ms.rot, mirrorY: ms.mir };
      });
      await page.locator('[data-act="wsSave"]').click();
      const actual = await page.evaluate(() => {
        const V = Ashen.Veteran, m = V.App.state.roster.find((x) => x.id === V.App.ui.wsUnit).manuscript;
        return { x: m.x, y: m.y, rotation: m.rotation || 0, mirrorY: !!m.mirrorY };
      });
      assert.deepEqual(actual, expected, `${action} 的预览必须被真实保存`);
    }

    await page.locator('#nav [data-v="recruit"]').click();
    await page.locator('[data-act="refreshShop"]').click();
    assert.equal(await page.locator('.recruit-card .legend-portrait').count(), 3);
    const seed = await page.evaluate(() => Ashen.Veteran.App.state.shop[0].plateSeed);
    await page.locator('[data-act="recruitOffer"]').first().click();
    assert.equal(await page.evaluate(() => Ashen.Veteran.App.state.roster.at(-1).plateSeed), seed);

    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const screen of ['camp', 'team', 'workshop', 'recruit']) {
        await page.locator(`#nav [data-v="${screen}"]`).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 1, `${screen} 在 ${width}px 横溢出 ${overflow}px`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#nav [data-v="camp"]').click();
    await page.locator('[data-act="startRun"]').click();
    assert.equal(await page.evaluate(() => Ashen.Veteran.App.ui.screen), 'map');
    assert.deepEqual(errors, []);

    const fallback = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    await fallback.route('**/assets/**', (route) => route.abort());
    await fallback.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
    await fallback.locator('[data-act="titleStart"]').click();
    await fallback.locator('#nav [data-v="workshop"]').click();
    assert.ok(await fallback.locator('svg.board').isVisible());
    assert.ok(await fallback.locator('[data-act="wsSave"]').isEnabled());
    console.log('通过：真实形态入口、瘢痕填充/卸下/撤销、来源记录、招募 seed、16 组页面宽度、远征入口与无资源降级。');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
