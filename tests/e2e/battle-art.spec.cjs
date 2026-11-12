'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 880 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const act = id => page.locator('[data-act="' + id + '"]').first();
    await page.addInitScript(() => {
      window.battleFrames = {};
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
        if (this.canvas.id === 'cv' && image.src && image.src.includes('/battle-v')) {
          const source = image.src.split('/art/')[1];
          (window.battleFrames[source] ||= {})[args[0] + ',' + args[1]] = true;
        }
        return draw.call(this, image, ...args);
      };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname,'../../index.html')).href);
    await act('titleStart').click();
    await act('startRun').click();
    const node = await page.evaluate(() => Ashen.Veteran.App.state.run.nodes.find(n => n.type === 'battle').id);
    await page.locator('[data-act="chooseNode"][data-id="' + node + '"]').click();
    await act('startAttempt').click();
    async function checkRoster() {
      await page.waitForFunction(() => {
        const b = Ashen.Veteran.App.state.run?.battle;
        return b && [...b.allies,...b.enemies].every(Ashen.SpriteAnim.supports) && Ashen.Art.isReady('scene.corridor');
      });
      await page.waitForFunction(() => Object.keys(window.battleFrames).some(path => path.includes('ranger.webp')));
      const ids = await page.evaluate(() => {
        const b = Ashen.Veteran.App.state.run.battle;
        return b.allies.map(u => [u.skinId,Ashen.SpriteAnim.charIdFor(u)]);
      });
      assert.ok(ids.every(([skin, char]) => skin === char));
      assert.equal(new Set(ids.map(pair => pair[0])).size,4);
    }
    await checkRoster();
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
      src.endsWith('.webp') && Object.hasOwn(rects,'576,0')));
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
      for (let i = 0; i < 28; i += 4) {
        let st = V.State.create(42);
        st.roster.forEach((u,j) => { u.skinId = skins[(i+j) % skins.length].id; });
        st = V.Expedition.start(st,{seed:42}).state;
        const [floor, kind, previousRuns] = [
          [1,'battle',0], [15,'battle',0], [29,'battle',0], [36,'elite',0], [14,'boss',0], [49,'boss',1], [21,'boss',0],
        ][i/4];
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
      if (result.loaded !== (skins.length+Object.keys(V.Data.ENEMIES).length)*4) throw new Error('图集不全');
      return {heroes:ids.size,enemies:enemies.size};
    });
    assert.equal(checked.heroes,21);
    assert.ok(checked.enemies >= 7);
    assert.deepEqual(errors,[]);
    console.log('开新局、战斗存档刷新、实时出手、21 位传奇的战斗实体与 28 套实际图集通过。');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
