'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const url = pathToFileURL(path.resolve(__dirname,'../../index.html')).href;
const actor = (page, i) => page.locator('[data-prep-unit]').nth(i);

async function openPreparation(page) {
  await page.goto(url);
  await page.locator('[data-act="titleStart"]').click();
  await page.locator('[data-act="startRun"]').first().click();
  const node = await page.evaluate(() => Ashen.Veteran.App.state.run.nodes.find(n => n.type === 'battle').id);
  await page.locator('[data-act="chooseNode"][data-id="' + node + '"]').click();
  await page.evaluate(() => Ashen.Art.preloadArt(['scene.battle.angled', 'scene.corridor']));
}

async function dragPoints(page, unit, destination) {
  const field = page.locator('[data-prep-field]');
  await unit.scrollIntoViewIfNeeded();
  const body = await unit.boundingBox(), scene = await field.boundingBox();
  const x = Number(await unit.getAttribute('data-field-x'));
  const y = Number(await unit.getAttribute('data-field-y'));
  const arena = await page.evaluate(() => Ashen.Veteran.Positions.ARENA);
  const from = {x: Math.round(body.x + body.width / 2), y: Math.round(body.y + body.height / 2)};
  const to = {x: Math.round(from.x + (destination.x - x) * scene.width / arena.width),
    y: Math.round(from.y + (destination.y - y) * arena.depthScale * scene.height / arena.height)};
  return [from, to];
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 880 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const act = id => page.locator('[data-act="' + id + '"]').first();
    await page.addInitScript(() => {
      window.battleFrames = {};
      window.weaponCues = {};
      window.arenaDrawn = false;
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
        if (this.canvas.id === 'cv' && image.src?.endsWith('/angled_sanctum.png')) window.arenaDrawn = true;
        if (this.canvas.id === 'cv' && image.src && image.src.includes('/topology-v4/actors/')) {
          const source = image.src.split('/art/')[1];
          (window.battleFrames[source] ||= {})[args[0] + ',' + args[1]] = true;
        }
        if (this.canvas.id === 'cv' && image.src?.endsWith('/effects.png')) {
          const row = args[1] / 48;
          const skin = row >= 11 && row <= 13 ? 'ranger' : row >= 14 && row <= 16 ? 'blade' : null;
          if (skin && !(skin in window.weaponCues)) {
            const unit = Ashen.Veteran.App.state.run.battle.allies.find(u => u.skinId === skin);
            if (unit && Ashen.SpriteAnim.isImpactFrame(unit)) window.weaponCues[skin] = true;
          }
        }
        return draw.call(this, image, ...args);
      };
    });
    await openPreparation(page);
    const rangerId = await actor(page, 1).getAttribute('data-prep-unit');
    const ranger = page.locator(`[data-prep-unit="${rangerId}"]`);
    const [from, to] = await dragPoints(page, ranger, {x: 66, y: -37});
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 8});
    assert.equal(await ranger.evaluate(el => el.classList.contains('prep-dragging')), true);
    await page.mouse.up();
    const placedX = Number(await ranger.getAttribute('data-field-x'));
    const placedY = Number(await ranger.getAttribute('data-field-y'));
    assert.ok(Math.abs(placedX - 66) <= 1 && Math.abs(placedY + 37) <= 1);
    await ranger.press('Enter');
    assert.equal(await ranger.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.prep-reach').isVisible(), true);
    assert.match(await page.locator('#prep-help').textContent(), /射程 150/);
    await ranger.press('Escape');
    assert.equal(await ranger.getAttribute('aria-pressed'), 'false');
    await ranger.press('ArrowDown');
    const finalY = Number(await ranger.getAttribute('data-field-y'));
    assert.equal(finalY, placedY + 8);
    const [invalidStart, invalidEnd] = await dragPoints(page, ranger, {x: 210, y: 0});
    await page.mouse.move(invalidStart.x, invalidStart.y);
    await page.mouse.down();
    await page.mouse.move(invalidEnd.x, invalidEnd.y, {steps: 8});
    assert.equal(await ranger.evaluate(el => el.classList.contains('prep-invalid')), true);
    await page.mouse.up();
    assert.equal(Number(await ranger.getAttribute('data-field-x')), placedX);
    await ranger.press('Escape');
    if (process.env.ASHEN_FORMATION_CAPTURE) {
      await ranger.blur();
      await page.locator('[data-prep-field]').screenshot({path: path.join(process.env.ASHEN_FORMATION_CAPTURE, 'oblique-deployment.png')});
    }

    await act('startAttempt').click();
    assert.deepEqual(await page.evaluate(() => {
      const b = Ashen.Veteran.App.state.run.battle;
      const unit = b.allies.find(u => u.skinId === 'ranger');
      return [b.field[unit.id], b.fieldY[unit.id]];
    }), [placedX, finalY]);
    async function checkRoster() {
      await page.waitForFunction(() => {
        const b = Ashen.Veteran.App.state.run?.battle;
        return b && window.arenaDrawn && [...b.allies,...b.enemies].every(Ashen.SpriteAnim.supports) && Ashen.Art.isReady('scene.corridor');
      });
      await page.waitForFunction(() => Object.keys(window.battleFrames).some(path => path.includes('ranger.png')));
      const ids = await page.evaluate(() => {
        const b = Ashen.Veteran.App.state.run.battle;
        return b.allies.map(u => [u.skinId,Ashen.SpriteAnim.charIdFor(u)]);
      });
      assert.ok(ids.every(([skin, char]) => skin === char));
      /* 3.0 起新游戏只由两位传奇（铁鸦、灰烬）出发，不再从四人队开始 */
      assert.equal(new Set(ids.map(pair => pair[0])).size,2);
    }
    await checkRoster();
    if (process.env.ASHEN_FORMATION_CAPTURE) {
      await page.locator('#cv').screenshot({path: path.join(process.env.ASHEN_FORMATION_CAPTURE, 'oblique-combat.png')});
    }
    await page.waitForFunction(() => {
      const V = Ashen.Veteran;
      const battle = V.App.state.run.battle;
      const blade = battle.allies.find(u => u.skinId === 'blade');
      const ranger = battle.allies.find(u => u.skinId === 'ranger');
      const poses = window.battleFrames['topology-v4/actors/blade.png'] || {};
      return battle.field[blade.id] > V.Positions.homeX(blade)
        && battle.field[ranger.id] === V.Positions.homeX(ranger)
        && battle.fieldY[ranger.id] === V.Positions.homeY(ranger)
        && Object.keys(poses).some(rect => parseInt(rect, 10) >= 704);
    });
    await page.waitForFunction(() => 'ranger' in window.weaponCues && 'blade' in window.weaponCues);
    assert.deepEqual(await page.evaluate(() => window.weaponCues), { ranger: true, blade: true });
    for (const skin of ['ranger', 'blade']) {
      const poses = await page.evaluate(id => Object.keys(window.battleFrames['topology-v4/actors/' + id + '.png']), skin);
      assert.ok(poses.includes('464,0') && poses.includes('544,0'), skin + ' 应绘制准备与出手帧');
    }
    await page.reload();
    await act('titleStart').click();
    await checkRoster();
    const framesDir = process.env.ASHEN_CAPTURE_FRAMES;
    if (framesDir) {
      fs.mkdirSync(framesDir,{recursive:true});
      const field = page.locator('#cv');
      for (let i = 0; i < 42; i++) {
        await field.screenshot({path:path.join(framesDir,'f' + String(i).padStart(3,'0') + '.png')});
        await page.waitForTimeout(65);
      }
    }
    await page.waitForFunction(() => Object.entries(window.battleFrames).some(([src, rects]) =>
      src.endsWith('.png') && Object.hasOwn(rects,'544,0')));
    const tick = await page.evaluate(() => Ashen.Veteran.App.state.run.battle.tick);
    assert.ok(tick > 0);
    await page.reload();
    await act('titleStart').click();
    await checkRoster();
    assert.ok(await page.evaluate(() => Ashen.Veteran.App.state.run.battle.tick) >= tick);
    const checked = await page.evaluate(async () => {
      const V = Ashen.Veteran, sa = Ashen.SpriteAnim;
      V.App.ui.paused = true;
      const result = await sa.preload();
      if (result.failed) throw new Error('有角色图集加载失败');
      const skins = V.Data.SKINS;
      const ids = new Set();
      const c = document.createElement('canvas').getContext('2d');
      let painted;
      const draw = c.drawImage.bind(c);
      c.drawImage = (img,...args) => { painted = [img.src,args[0],args[1]]; draw(img,...args); };
      const enemies = new Set();
      function checkActor(u) {
        sa.syncFromBattle({allies:[u]});
        if (!sa.draw(c,u,50,50,40)) throw new Error(sa.charIdFor(u));
        const idle = painted.join(',');
        sa.play(u,'attack'); sa.update([u],290);
        sa.draw(c,u,50,50,40);
        if (idle === painted.join(',')) throw new Error(sa.charIdFor(u) + ' 出手仍绘制待机帧');
        if (u.side === 'ally') {
          for (const action of ['move','cast','guard','dodge']) {
            if (!sa.play(u,action,{force:true})) throw new Error(u.skinId + ' 缺少 ' + action);
            sa.update([u],110);
            if (!sa.draw(c,u,50,50,40) || sa.stateOf(u.id).anim !== action) throw new Error(action);
            sa.update([u],600);
            if (sa.stateOf(u.id).anim !== 'idle') throw new Error(action + ' 没有收势');
          }
        }
      }
      /* 3.0 起开局只有两位传奇，一次装不满 21 张皮肤：
         按「场景 × 批次」轮着分配，批次够多才能把所有皮肤都过一遍。 */
      const scenarios = [
        [1, 'battle', 0], [15, 'battle', 0], [29, 'battle', 0], [36, 'elite', 0],
        [14, 'boss', 0], [49, 'boss', 1], [21, 'boss', 0],
      ];
      let skinCursor = 0;
      for (const [floor, kind, previousRuns] of scenarios) {
        for (let batch = 0; batch < 4; batch += 1) {
          let st = V.State.create(42);
          st.roster.forEach((u) => { u.skinId = skins[skinCursor++ % skins.length].id; });
          st = V.Expedition.start(st,{seed:42}).state;
          st.run.floor = floor;
          st.stats.runs = previousRuns;
          st.run.nodes[0].type = kind;
          st = V.Encounter.open(st,st.run.nodes[0].id).state;
          st = V.Encounter.startAttempt(st).state;
          for (const u of st.run.battle.allies) {
            checkActor(u);
            ids.add(sa.charIdFor(u));
          }
          for (const u of st.run.battle.enemies) {
            checkActor(u);
            enemies.add(sa.charIdFor(u));
          }
        }
      }
      if (result.loaded !== (skins.length+Object.keys(V.Data.ENEMIES).length)*4) throw new Error('图集不全');
      /* skins.length 直接带出来：这条断言的意思是「十四种皮肤全过一遍」，
         写死 21 是十四人之前的口径，数据缩到 14 之后它永远不可能成立 */
      return {heroes:ids.size,enemies:enemies.size,skins:skins.length};
    });
    assert.equal(checked.heroes, checked.skins, `应覆盖全部 ${checked.skins} 位传奇，实际 ${checked.heroes}`);
    assert.ok(checked.enemies >= 7);

    const facing = await page.evaluate(() => {
      const V = Ashen.Veteran, sa = Ashen.SpriteAnim;
      const state = structuredClone(V.App.state);
      const b = state.run.battle;
      const [blade, ranger] = b.allies;
      const [rear, near, ...others] = b.enemies;
      b.tactic = 'focus';
      b.logs = [];
      b.logSeq = 0;
      for (const u of [blade, ranger, rear, near]) u.alive = true;
      rear.hp = 1;
      near.hp = near.maxHp;
      for (const u of others) u.alive = false;
      for (const u of [blade, ranger]) {
        u.skillList = [];
        u.pendingSkill = null;
        u.casting = null;
        b.field[u.id] = 151;
        b.fieldY[u.id] = 0;
      }
      b.field[rear.id] = 105;
      b.fieldY[rear.id] = 14;
      b.field[near.id] = 166;
      b.fieldY[near.id] = 0;
      V.App.ui.paused = true;
      V.App.setState(state);
      V.View.reset();
      V.View.mount(state);
      const directions = {};
      const draw = sa.draw;
      sa.draw = function(ctx, u, x, y, size, reduced, right) {
        directions[u.id] = right;
        return draw(ctx, u, x, y, size, reduced, right);
      };
      try {
        V.View.renderFrame(state, performance.now());
        const focus = [directions[blade.id], directions[ranger.id]];
        b.logs = [{seq: 1, type: 'hit', actorId: blade.id, targetId: near.id, strike: true, amount: 1}];
        b.logSeq = 1;
        V.View.renderFrame(state, performance.now());
        const strike = directions[blade.id];
        sa.update([blade], 650);
        V.View.renderFrame(state, performance.now());
        return { focus, strike, reacquire: directions[blade.id], nearest: V.Positions.nearestFoe(b, blade).id === near.id };
      } finally { sa.draw = draw; }
    });
    assert.deepEqual(facing, {focus: [false, false], strike: true, reacquire: false, nearest: true});

    const mobile = await browser.newPage({ viewport: {width: 360, height: 820}, isMobile: true, hasTouch: true });
    mobile.on('pageerror', error => errors.push(error.message));
    await openPreparation(mobile);
    const mobileId = await actor(mobile, 1).getAttribute('data-prep-unit');
    const mobileRanger = mobile.locator(`[data-prep-unit="${mobileId}"]`);
    const [a, b] = await dragPoints(mobile, mobileRanger, {x: 56, y: -42});
    const touch = await mobile.context().newCDPSession(mobile);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [b] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const mobileX = Number(await mobileRanger.getAttribute('data-field-x'));
    const mobileY = Number(await mobileRanger.getAttribute('data-field-y'));
    assert.ok(Math.abs(mobileX - 56) <= 2 && Math.abs(mobileY + 42) <= 2);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 360);
    await mobile.reload();
    await mobile.locator('[data-act="titleStart"]').click();
    assert.equal(Number(await mobileRanger.getAttribute('data-field-x')), mobileX);
    assert.equal(Number(await mobileRanger.getAttribute('data-field-y')), mobileY);
    if (process.env.ASHEN_FORMATION_CAPTURE) {
      await mobile.screenshot({path: path.join(process.env.ASHEN_FORMATION_CAPTURE, 'oblique-mobile.png'), fullPage: true});
    }
    assert.deepEqual(errors,[]);
    console.log(`斜俯视布阵、入场坐标、背后目标转身与重新索敌、${checked.skins} 位传奇的动作图集通过。`);
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
