'use strict';
/* 逐帧动画接入的浏览器验证：真实战斗、暂停、倍率、刷新恢复、资源降级。 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('需要 playwright'); process.exit(2); }

const R = [];
const ok = (n, c, x) => R.push({ n, p: !!c, x: x === undefined ? '' : String(x) });

async function launch() {
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch (e) { return await chromium.launch(); }
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FILE_NOT_FOUND')) errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());

  const url = 'file://' + path.join(ROOT, 'index.html');
  await page.goto(url);
  await page.waitForTimeout(800);
  await page.click('[data-act="titleStart"]');
  await page.waitForTimeout(300);

  // 准备一场含剑士与骸骨兵的战斗
  const setup = await page.evaluate(async () => {
    const A = window.Ashen;
    const load = await A.SpriteAnim.preload(['blade', 'bone']);
    const st = A.Expedition.start(A.App.state, { seed: 4242 });
    A.App.state = st.state;
    A.App.state.run.floor = 2;
    const cr = A.Combat.create(A.App.state, 'normal');
    A.App.state = cr.state;
    const bt = A.App.state.run.battle;
    bt.enemies[0].enemyType = 'bone';
    bt.enemies[0].name = '骸骨兵';
    A.App.ui.screen = 'battle';
    A.App.ui.lastScreen = null;
    A.App.render();
    return { load, ready: A.SpriteAnim.isReady() };
  });
  ok('动画图集加载 8/8', setup.load.loaded === 8 && setup.load.failed === 0, JSON.stringify(setup.load));
  ok('动画模块就绪', setup.ready === true);

  // 启动战斗循环
  await page.evaluate(() => Ashen.App.dispatch({ type: 'setTactic' }));
  await page.waitForTimeout(2200);

  const running = await page.evaluate(() => {
    const A = window.Ashen;
    const bt = A.App.state.run.battle;
    const blade = bt.allies.find((u) => u.cls === 'blade');
    const bone = bt.enemies.find((u) => u.enemyType === 'bone');
    return {
      bladeSupported: A.SpriteAnim.supports(blade),
      boneSupported: A.SpriteAnim.supports(bone),
      bladeState: A.SpriteAnim.stateOf(blade.id),
      boneState: A.SpriteAnim.stateOf(bone.id),
      // 多个剑士必须各自独立
      bladeStates: bt.allies.filter((u) => u.cls === 'blade').map((u) => A.SpriteAnim.stateOf(u.id)),
    };
  });
  ok('剑士走动画', running.bladeSupported === true);
  ok('骸骨兵走动画', running.boneSupported === true);
  ok('每名剑士有独立动画状态', running.bladeStates.length === 2 && running.bladeStates.every((s) => s && typeof s.frame === 'number'));

  // 暂停冻结
  await page.evaluate(() => { Ashen.App.ui.paused = true; });
  const f1 = await page.evaluate(() => {
    const A = window.Ashen; const b = A.App.state.run.battle.allies.find((u) => u.cls === 'blade');
    return A.SpriteAnim.stateOf(b.id).frame;
  });
  await page.waitForTimeout(700);
  const f2 = await page.evaluate(() => {
    const A = window.Ashen; const b = A.App.state.run.battle.allies.find((u) => u.cls === 'blade');
    return A.SpriteAnim.stateOf(b.id).frame;
  });
  ok('暂停时动画冻结', f1 === f2, `${f1} -> ${f2}`);
  await page.evaluate(() => { Ashen.App.ui.paused = false; Ashen.App.dispatch({ type: 'togglePause' }); });
  await page.waitForTimeout(200);

  // 刷新恢复：不重放历史事件
  const beforeReload = await page.evaluate(() => {
    const A = window.Ashen;
    const bt = A.App.state.run.battle;
    return {
      seq: bt.logSeq,
      states: [...bt.allies, ...bt.enemies].map((u) => A.SpriteAnim.stateOf(u.id)).filter(Boolean).length,
      bladeAnim: A.SpriteAnim.stateOf(bt.allies.find((u) => u.cls === 'blade').id).anim,
    };
  });
  await page.reload();
  await page.waitForTimeout(900);
  await page.click('[data-act="titleStart"]');
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(async () => {
    const A = window.Ashen;
    await A.SpriteAnim.preload(['blade', 'bone']);
    const bt = A.App.state.run && A.App.state.run.battle;
    if (!bt) return { noBattle: true };
    if (A.App.ui.screen !== 'battle') { A.App.ui.screen = 'battle'; A.App.ui.lastScreen = null; A.App.render(); }
    const blade = bt.allies.find((u) => u.cls === 'blade');
    return {
      seq: bt.logSeq,
      bladeAnim: A.SpriteAnim.stateOf(blade.id).anim,
    };
  });
  ok('刷新后战斗仍在', !afterReload.noBattle);
  if (!afterReload.noBattle) {
    ok('恢复后不重放攻击动画', afterReload.bladeAnim === 'idle' || afterReload.bladeAnim === undefined, afterReload.bladeAnim);
  } else {
    ok('恢复后不重放攻击动画', true, 'skipped');
  }

  // 资源失败降级：拦截战斗图集，应回落到程序绘制且不报错
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  const err2 = [];
  p2.on('pageerror', (e) => err2.push(e.message));
  await p2.route('**/assets/art/battle-v1/**', (route) => route.abort());
  await p2.goto(url);
  await p2.waitForTimeout(800);
  await p2.click('[data-act="titleStart"]');
  await p2.waitForTimeout(300);
  const fallback = await p2.evaluate(async () => {
    const A = window.Ashen;
    await A.SpriteAnim.preload(['blade', 'bone']);
    const st = A.Expedition.start(A.App.state, { seed: 4242 });
    A.App.state = st.state;
    const cr = A.Combat.create(A.App.state, 'normal');
    A.App.state = cr.state;
    A.App.ui.screen = 'battle';
    A.App.ui.lastScreen = null;
    A.App.render();
    const blade = A.App.state.run.battle.allies.find((u) => u.cls === 'blade');
    return { ready: A.SpriteAnim.isReady(), supported: A.SpriteAnim.supports(blade), canvas: !!document.getElementById('cv') };
  });
  ok('图集全失败时不支持动画', fallback.supported === false, JSON.stringify(fallback));
  ok('降级仍能渲染战场', fallback.canvas === true);
  ok('降级无未捕获异常', err2.length === 0, err2.slice(0, 2).join('|'));

  const pass = R.filter((r) => r.p).length;
  console.log('\n===== 动画 E2E =====');
  R.forEach((r) => console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.x ? '   [' + r.x + ']' : ''}`));
  console.log(`\n合计 ${pass}/${R.length}`);
  console.log('JS 错误：', errs.length ? errs.slice(0, 3).join('\n') : '无');
  await browser.close();
  process.exit(pass === R.length && errs.length === 0 ? 0 : 1);
})().catch((e) => { console.error('崩溃：', e.message); process.exit(1); });
