'use strict';
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
    await page.locator('[data-act=titleStart]').click();
    /* 新游戏由周岳和巴图尔出发。 */
    assert.equal(await page.locator('.metal-party .legend-portrait').count(), 2);
    assert.equal(await page.locator('.metal-party .metal-portrait').count(), 0);
    assert.ok(!/功法|构件|刻印/.test(await page.locator('body').innerText()));
    await page.locator('#nav [data-v=workshop]').click();
    assert.equal(await page.locator('.ws-left .panel-h').first().innerText(), '蚀刻法');
    assert.equal(await page.locator('.layout-tools').count(), 0);
    assert.ok(await page.getByRole('button', {name:/蚀刻法库存/}).isVisible());
    assert.match(await page.locator('.plate-readout span').first().getAttribute('title'), /生命上限/);
    assert.match(await page.locator('.ws-right .panel-h').first().innerText(), /纹路/);
    /* A3：208px 左栏用短标签，全称只留在宽处（图鉴） */
    const narrowText = await page.locator('.ws-left').innerText();
    assert.match(narrowText, /普攻间隔/, '窄栏应使用短标签');
    assert.ok(!narrowText.includes('普通攻击'), '208px 左栏不该出现全称「普通攻击」');
    await page.locator('[data-act=wsCodex]').click();
    const codexText = await page.locator('.codex-book').innerText();
    assert.match(codexText, /普通攻击间隔/, '图鉴是宽处，保留全称');
    assert.ok(!codexText.includes('普攻'), '图鉴不该出现短标签');
    /* A4：术语页与 tooltip 同源，词条全部上屏 */
    const termsBlock = page.locator('[data-terms]');
    assert.equal(await termsBlock.count(), 1, '图鉴应有术语页');
    await termsBlock.locator('summary').click();
    const termCount = await termsBlock.locator('dt').count();
    assert.equal(termCount, await page.evaluate(() => Ashen.Veteran.Terms.ENTRIES.length), '词条应全部渲染');
    assert.match(await termsBlock.innerText(), /共鸣增幅/, '术语页要能看到词条解释');
    await page.locator('[data-act=wsCodex]').click();
    await page.evaluate(() => Ashen.Veteran.App.dispatch({type:'wsMsPick', id:'inverse'}));
    assert.match(await page.locator('[data-ms-reason]').innerText(), /轮廓不兼容/);
    await page.locator('.ms-chip[data-source=board]').first().click();
    assert.ok(await page.locator('.ms-chip .ms-skeleton').first().isVisible());
    const help = page.getByRole('button', {name:'蚀刻法规则'});
    await help.focus();
    const helpTip = page.locator('#ws-etch-hint');
    assert.ok(await helpTip.isVisible());
    assert.match(await helpTip.innerText(), /贯通需要/);
    const rune = page.locator('.ws-right [data-stash="1"]').first();
    const blueprint = await rune.locator('svg.rune-blueprint').boundingBox();
    assert.deepEqual([blueprint.width, blueprint.height], [44, 44]);
    assert.ok(await rune.locator('.mini-shape .rune-port-cut').count() >= 2);
    assert.ok(await rune.locator('.ws-rune-quantity').isVisible());
    const placedRow = page.locator('.ws-right [data-watch-rune]').first();
    const placedId = await placedRow.getAttribute('data-watch-rune');
    const boardRune = page.locator(`svg.board [data-act=wsGrab][data-id="${placedId}"]`);
    await placedRow.hover();
    assert.match(await boardRune.getAttribute('class'), /is-row-hovered/);
    await placedRow.locator('.ws-rune-select').focus();
    assert.match(await boardRune.getAttribute('class'), /is-row-focused/);
    assert.equal(await page.locator('.scar-list').count(), 0);

    const expectedMembrane = (id, rotation, mirrorY) => page.evaluate(({id, rotation, mirrorY}) => {
      const V = Ashen.Veteran, m = V.Manuscript.orient(V.Manuscript.normalize(V.Data.manuscript(id)), rotation, mirrorY);
      return { veins: Object.entries(m.veins).flatMap(([cell, dirs]) => dirs.map(dir => cell + '/' + dir)).sort(),
        ports: Object.entries(m.io).map(([pid, p]) => ((pid === 'clock' || pid === 'damage') ? 'in' : 'out') + '/' + p.dir).sort() };
    }, { id, rotation, mirrorY });
    const drawnMembrane = locator => locator.evaluate(el => ({
      veins: [...el.querySelectorAll('[data-vein]')].map(p => p.closest('[data-etch-cell]').dataset.etchCell + '/' + p.dataset.vein).sort(),
      ports: [...el.querySelectorAll('.membrane-port')].map(p => p.dataset.role + '/' + p.dataset.dir).sort(),
    }));
    const installedMark = page.locator('svg.board [data-ms-shape]').first();
    const markId = await installedMark.getAttribute('data-ms-shape');
    const originalPose = await installedMark.locator('.layer-ms-hit').evaluate(el => [Number(el.dataset.rot), el.dataset.mir === '1']);
    assert.deepEqual(await drawnMembrane(installedMark), await expectedMembrane(markId, ...originalPose));
    assert.equal(await installedMark.locator('.wax-membrane .ms-field').count(), 1);
    assert.equal(await installedMark.locator('.wax-membrane .wax-grain').count(), 1);
    assert.ok(await installedMark.locator('.wax-membrane mask path[stroke="black"]').getAttribute('d'));
    assert.equal(await installedMark.locator('.etch-groove, rect.ms-field').count(), 0);
    assert.ok(await page.locator('svg.board .beacon-entry image').count() > 0);
    assert.ok(await page.locator('svg.board .beacon-exit image').count() > 0);
    assert.equal(await page.locator('svg.board .layer-runes text, svg.board .rune image[href*="rune-set-"], svg.board .part-label').count(), 0);
    await page.locator('svg.board [data-rune-tooltip]').first().focus();
    assert.match(await page.locator('.rune-tooltip').innerText(), /系 · 负荷 \d+/);
    await page.keyboard.press('Escape');
    const reliefs = page.locator('svg.board .rune .etch-relief image');
    assert.equal(await reliefs.count(), await page.locator('svg.board .rune .etched-grain').count());
    await reliefs.evaluateAll(images => Promise.all(images.map(node => {
      const img = new Image();
      img.src = node.getAttribute('href');
      return img.decode();
    })));
    assert.ok(await page.locator('svg.board .rune .etched-grain').count() > 0);

    // 确认旋转后的烘焙外形、接口与最小矢量降级使用同一套膜格。
    const etchedShapes = await page.evaluate(() => {
      const V = Ashen.Veteran;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const samples = Object.values(V.Data.MANUSCRIPTS);
      for (const spec of samples) for (const rotation of [0,1,2,3]) for (const mirror of [false,true]) {
        const m = V.Manuscript.orient(V.Manuscript.normalize(spec), rotation, mirror);
        svg.innerHTML = V.UI.membraneEngraving(m, 60, {catalogue: true});
        const drawn = [...svg.querySelectorAll('[data-etch-cell]')].map(el => el.dataset.etchCell);
        if (drawn.join(';') !== m.cells.map(c => c.join(',')).join(';')) throw Error(spec.id + ' 膜格不符');
        if (svg.querySelectorAll('.etch-asset').length !== 1 || svg.querySelector('text')) throw Error(spec.id + ' 缺少美术或出现金属刻字');
        if (svg.querySelectorAll('[data-etch-terminal]').length !== m.exits.length + 1) throw Error(spec.id + ' 起止端不符');
        svg.innerHTML = V.UI.membraneEngraving(m, 60, {terminals: false});
        const film = svg.querySelector('path.ms-field');
        if (!film || film.getAttribute('d') !== V.RuneArt.contourPath(m.cells, 60) || svg.querySelector('.etch-groove')) {
          throw Error(spec.id + ' 蜡膜轮廓不完整');
        }
        if (svg.querySelector('.wax-membrane').classList.contains('arcane') !== (spec.rarity >= 5)) throw Error(spec.id + ' 蜡膜颜色不符');
      }
      return samples.length;
    });
    assert.equal(etchedShapes, 80);

    // 高度受限时 SVG 存在留白，拖拽仍须使用实际变换后的格子尺寸。
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => {
        const svg = document.querySelector('svg.board');
        svg.style.width = '100%'; svg.style.height = '260px'; svg.style.maxHeight = '260px';
      });
      const chip = page.locator('.ms-chip[data-ms-drag="1"]').first();
      await chip.scrollIntoViewIfNeeded();
      const box = await chip.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, { steps: 4 });
      const sizes = await page.evaluate(() => {
        const svg = document.querySelector('svg.board'), ctm = svg.getScreenCTM();
        return { actual: document.querySelector('.drag-ghost i').getBoundingClientRect().width, expected: Math.hypot(ctm.a, ctm.b) * Number(svg.dataset.cell) };
      });
      assert.ok(Math.abs(sizes.actual - sizes.expected) < 0.6, `${width}: ${JSON.stringify(sizes)}`);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      const V = Ashen.Veteran;
      V.App.ui.wsDraft = []; V.App.ui.wsPick = null; V.App.render();
    });
    const membrane = page.locator('[data-act=wsMsGrab]').first();
    await membrane.scrollIntoViewIfNeeded();
    const grabOffset = await membrane.evaluate(el => {
      const [x, y] = el.dataset.id.split(',').map(Number);
      const { msOx, msOy } = el.closest('.layer-ms-hit').dataset;
      return [x - Number(msOx), y - Number(msOy)];
    });
    const membraneBox = await membrane.boundingBox();
    await page.mouse.move(membraneBox.x + membraneBox.width / 2, membraneBox.y + membraneBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(membraneBox.x + membraneBox.width / 2 + 12, membraneBox.y + membraneBox.height / 2 + 12, { steps: 3 });
    const dragId = await membrane.getAttribute('data-ms-id');
    const cellCount = await page.evaluate(id => Ashen.Veteran.Manuscript.normalize(Ashen.Veteran.Data.manuscript(id)).cells.length, dragId);
    assert.equal(await page.locator('.drag-ghost i').count(), cellCount, '已装蚀刻法也有真实格子拖影');
    const beforeRotate = await page.locator('.drag-ghost').boundingBox();
    await page.keyboard.press('r');
    const afterRotate = await page.locator('.drag-ghost').boundingBox();
    assert.ok(Math.abs(beforeRotate.width - afterRotate.height) < 0.6);
    assert.ok(Math.abs(beforeRotate.height - afterRotate.width) < 0.6);
    await page.keyboard.press('f');
    assert.equal(await page.locator('.drag-ghost i').count(), cellCount);
    assert.deepEqual(await drawnMembrane(page.locator('.drag-ghost')), await expectedMembrane(dragId, 1, true));
    const landing = await page.evaluate(([grabDx, grabDy]) => {
      const V = Ashen.Veteran, u = V.App.state.roster.find((u) => u.id === V.App.ui.wsUnit);
      const ms = V.Manuscript.orient(V.Manuscript.normalize(u.manuscript), 1, true);
      const [x, y] = V.Manuscript.placements(ms, V.Circuit.plateOf(u).cellsList)[0];
      const svg = document.querySelector('svg.board'), pt = svg.createSVGPoint();
      pt.x = Number(svg.dataset.gx) + (x + grabDx + 0.5) * Number(svg.dataset.cell);
      pt.y = Number(svg.dataset.gy) + (y + grabDy + 0.5) * Number(svg.dataset.cell);
      const screen = pt.matrixTransform(svg.getScreenCTM());
      return { x: screen.x, y: screen.y, ox: x, oy: y };
    }, grabOffset);
    await page.mouse.move(landing.x, landing.y, { steps: 6 });
    assert.deepEqual(await drawnMembrane(page.locator('svg.board .drop-ghost')), await expectedMembrane(dragId, 1, true));
    assert.equal(await page.locator('svg.board .drop-ghost-cell.bad').count(), 0);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => Ashen.Veteran.App.ui.wsMsRot), 1);
    assert.equal(await page.evaluate(() => Ashen.Veteran.App.ui.wsMsMir), true);
    await page.locator('[data-act=wsSave]').click();
    assert.deepEqual(await page.evaluate(() => {
      const V = Ashen.Veteran, m = V.App.state.roster.find((u) => u.id === V.App.ui.wsUnit).manuscript;
      return { x: m.x, y: m.y, rotation: m.rotation, mirrorY: m.mirrorY };
    }), { x: landing.ox, y: landing.oy, rotation: 1, mirrorY: true });

    const copies = await page.evaluate(() => {
      const V = Ashen.Veteran, st = V.App.state, u = st.roster.find((u) => u.id === V.App.ui.wsUnit);
      st.manuscriptVault.push(V.State.clone(u.manuscript), V.State.clone(u.manuscript));
      const before = st.manuscriptVault.length;
      V.App.dispatch({ type: 'wsMsEquipAt', id: u.manuscript.id, ox: u.manuscript.x, oy: u.manuscript.y, rotation: u.manuscript.rotation || 0, mirrorY: !!u.manuscript.mirrorY });
      return { before, after: V.App.state.manuscriptVault.length };
    });
    assert.equal(copies.after, copies.before, '移动已装蚀刻法不能吞掉同种库存副本');

    const equipped = () => page.evaluate(() => {
      const V = Ashen.Veteran;
      const unit = V.App.state.roster.find((u) => u.id === V.App.ui.wsUnit);
      return V.State.manuscriptsOf(unit).map(({id, x, y, rotation, mirrorY}) => ({id, x, y, rotation, mirrorY}));
    });
    const [primary] = await equipped();
    const pick = async (id) => {
      const option = page.locator(`.ms-chip[data-id="${id}"]`);
      if (!await option.isVisible()) await page.locator('[data-act=wsMsVault]').click();
      await option.click();
    };
    await pick('rivet');
    await page.locator('[data-act=wsMsEquip]').click();
    const installed = await equipped();
    assert.equal(installed.length, 2);
    assert.deepEqual(installed[0], primary);
    assert.equal(installed[1].id, 'rivet');
    assert.equal(await page.locator('[data-ms-shape]').count(), 2);
    assert.equal(await page.locator('.ms-chip[data-source=board]').count(), 2);
    const rejected = await page.evaluate(() => {
      const V = Ashen.Veteran, st = V.App.state, u = st.roster.find((v) => v.id === V.App.ui.wsUnit);
      const [x, y] = V.State.manuscriptCells(u.manuscript)[0];
      V.App.dispatch({ type: 'wsMsEquipAt', id: 'rivet', ox: x, oy: y, rotation: 0, mirrorY: false });
      return V.App.state === st && V.App.ui.wsErrors.length > 0;
    });
    assert.ok(rejected, '重叠时保留原有装配和库存');
    await page.locator('[data-act=wsMsRotate]').click();
    await pick(primary.id);
    assert.equal(await page.locator('[data-ms-outline]').getAttribute('data-ms-outline'), primary.id);
    await pick('rivet');
    assert.equal(await page.locator('[data-ms-outline]').getAttribute('data-ms-outline'), 'rivet');
    await page.locator('[data-act=wsSave]').click();
    const moved = await equipped();
    assert.equal(moved[1].rotation, (installed[1].rotation + 1) % 4, '切换选中项保留副门的旋转草稿');
    assert.deepEqual(moved[0], primary);
    await page.locator('[data-act=wsMsPromote]').click();
    assert.deepEqual(await equipped(), [moved[1], primary], '主修交换只改次序');
    await page.waitForTimeout(350);
    await page.reload();
    await page.locator('[data-act=titleStart]').click();
    await page.locator('#nav [data-v=workshop]').click();
    assert.deepEqual(await equipped(), [moved[1], primary]);
    await pick(primary.id);
    await page.locator('[data-act=wsMsUnequip]').click();
    assert.deepEqual(await equipped(), [moved[1]], '卸下所选辅修，另一套保留');
    assert.match(await page.locator(`.ms-chip[data-source=vault][data-id="${primary.id}"]`).innerText(), /库存 ×3/);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      const V = Ashen.Veteran, u = V.App.state.roster.find((u) => u.id === V.App.ui.wsUnit);
      const [x, y] = V.Circuit.plateOf(u).cellsList[0];
      u.scars = [{ x, y, templateId: 'ember', source: '余烬纹', floor: 2, runId: 'tooltip-test' }];
      V.App.render();
    });
    const mark = page.locator('.scar-cell');
    await mark.scrollIntoViewIfNeeded();
    const pt = await mark.boundingBox();
    await page.mouse.move(pt.x + pt.width / 2, pt.y + pt.height / 2);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#scar-tooltip').count(), 0, '短暂划过不弹提示');
    await page.locator('#scar-tooltip').waitFor();
    assert.match(await page.locator('#scar-tooltip').innerText(), /被余烬纹蚀刻/);
    assert.match(await page.locator('#scar-tooltip').innerText(), /攻击 \+2.*防御 -1/);
    await page.mouse.move(10, 10);
    assert.equal(await page.locator('#scar-tooltip').count(), 0);
    await mark.focus();
    assert.ok(await page.locator('#scar-tooltip').isVisible(), '键盘焦点可查看');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#scar-tooltip').count(), 0);

    await page.locator('#nav [data-v=recruit]').click();
    await page.locator('[data-act=refreshShop]').click();
    /* 14 位传奇现在都有清洗头像，不再走 4×4 图集兜底；
       断言改成「招募卡上确实有立绘」，两条路径都算通过。 */
    assert.ok(await page.locator('.recruit-card .legend-portrait img, .recruit-card .legend-portrait svg').count() > 0);
    const atlas = await page.evaluate(() => new Promise((resolve) => {
      const img = new Image(); img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null); img.src = Ashen.Art.getArt('portrait.wanderer0').src;
    }));
    assert.ok(atlas && atlas.w === atlas.h && atlas.w === 96);
    const touch = await browser.newPage({ viewport: { width: 390, height: 900 }, hasTouch: true });
    await touch.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
    await touch.locator('[data-act=titleStart]').click();
    await touch.locator('#nav [data-v=workshop]').click();
    await touch.locator('[data-act=wsPalette][data-id=runes]').tap();
    const stock = touch.locator('.ws-right [data-stash="1"]').first();
    const chosen = await stock.getAttribute('data-id');
    await stock.tap();
    await touch.locator('[data-act=wsQuickPlace]').tap();
    assert.equal(await touch.evaluate(id => Ashen.Veteran.App.ui.wsDraft.some(p => p.itemId === id), chosen), true);
    await touch.locator('[data-act=wsUndo]').tap();
    assert.equal(await touch.evaluate(id => Ashen.Veteran.App.ui.wsDraft.some(p => p.itemId === id), chosen), false);
    await touch.locator('[data-act=wsPalette][data-id=etchings]').tap();
    await touch.evaluate(() => {
      const V = Ashen.Veteran, u = V.App.state.roster.find((u) => u.id === V.App.ui.wsUnit);
      const c = V.Circuit.layout(V.App.state, u.board.placements).cells[0];
      u.scars = [{ x: c.x, y: c.y, templateId: 'ember', source: '触屏纹路', floor: 1, runId: 'touch-test' }];
      V.App.render();
    });
    const touchMark = touch.locator('.scar-cell');
    await touchMark.scrollIntoViewIfNeeded();
    const touchBox = await touchMark.boundingBox();
    await touch.touchscreen.tap(touchBox.x + touchBox.width / 2, touchBox.y + touchBox.height / 2);
    assert.match(await touch.locator('#scar-tooltip').innerText(), /被触屏纹路蚀刻/);
    await touch.close();
    // 还原同心纹跨两门蚀刻法的存档，从正常工坊入口读取左栏。
    await page.evaluate(() => {
      const V = Ashen.Veteran, st = V.State.create(42), u = st.roster[0];
      // 77 格底盘上的两套 8 格谱互不重叠，同心纹横跨它们的交界。
      for (const p of u.board.placements) st.stash.push(p.itemId);
      const item = V.State.makePart(st,{templateId:'capacitor'});
      st.itemsById[item.id] = item;
      u.board.placements = [{itemId:item.id,x:4,y:3,rotation:0,mirrorY:false}];
      u.manuscript = {...V.Data.manuscript('spark'),x:1,y:3};
      u.extraManuscripts = [{...V.Data.manuscript('rivet'),x:5,y:3}];
      const validation = V.State.validate(st);
      if (!validation.ok) throw new Error(validation.errors.join(', '));
      V.App.setState(st);
    });
    await page.reload();
    await page.locator('[data-act=titleStart]').click();
    await page.locator('#nav [data-v=workshop]').click();
    await page.locator('.ms-chip[data-id=rivet]').click();
    const lockTags = page.locator('.ws-skill .ws-effect-tags');
    assert.match(await lockTags.getByText('[普攻 ×3]', {exact: true}).getAttribute('title'), /累计普攻至少 3 次/);
    assert.match(await lockTags.getByText('伤害 75%', {exact: true}).getAttribute('title'), /自身幅值的 75%/);
    assert.match(await lockTags.getByText('护盾 12%', {exact: true}).getAttribute('title'), /自身生命上限的 12%/);
    assert.equal(await page.locator('[data-ms-cov]').innerText(), '1/8 · 13%');
    assert.equal(await page.locator('.ms-live-benefit b').innerText(), '+0%');
    assert.equal(await page.locator('[data-ms-route]').innerText(), '未贯通');
    assert.deepEqual(errors, []);
    console.log('通过：并装、切换草稿、选中轮廓、冲突回滚、主修交换、读档与单独卸下，术语、左右布局、3种宽度拖拽比例、延迟/键盘瘢痕提示、人物立绘与图集加载。');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
