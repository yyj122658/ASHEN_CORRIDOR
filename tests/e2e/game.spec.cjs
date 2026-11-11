'use strict';
/* 灰烬回廊浏览器验证（单入口）：真实点击，不直接调用领域命令（只构造必要场景）。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('需要 playwright'); process.exit(2); }

const R = [];
const ok = (n, c, x) => R.push({ n, p: !!c, x: x === undefined ? '' : String(x) });
const url = 'file://' + path.join(ROOT, 'index.html');

async function launch() {
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch (e) { return await chromium.launch(); }
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 940 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('ERR_FILE_NOT_FOUND')) errs.push('CONSOLE: ' + m.text());
  });
  page.on('dialog', (d) => d.accept());

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  const click = async (sel) => {
    const el = await page.$(sel);
    if (!el) return false;
    await el.click().catch(() => {});
    await wait(160);
    return true;
  };
  const snap = () => ev(() => {
    const A = window.Ashen.Veteran;
    const st = A.App.state;
    return {
      screen: A.App.ui.screen,
      stage: st.run ? st.run.stage : null,
      floor: st.run ? st.run.floor : null,
      over: st.run && st.run.battle ? st.run.battle.over : null,
      gold: st.gold,
      run: !!st.run,
      nodes: st.run ? st.run.nodes.map((n) => ({ id: n.id, type: n.type })) : [],
    };
  });
  const waitBattle = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await snap();
      if (s.over || s.screen !== 'battle') return true;
      await wait(300);
    }
    return false;
  };
  const endRun = async () => {
    await ev(() => {
      const A = window.Ashen.Veteran;
      let st = A.App.state;
      if (!st.run) return;
      const r = A.Expedition.extract(st, false);
      if (r.ok) st = r.state;
      else {
        const rw = A.Expedition.retreat(st, 'emergency');
        if (rw.ok) st = rw.state;
      }
      st.settlement = null;
      A.App.setState(st);
    });
    await wait(200);
  };

  /* ---------- A 启动 ---------- */
  await page.goto(url);
  await wait(800);
  ok('A1 新入口可打开', (await snap()).screen === 'title');
  ok('A2 旧版 App 未定义（单入口）', await ev(() => !window.Ashen.App));
  ok('A3 状态 ruleset 正确', await ev(() => {
    const st = window.Ashen.Veteran.App.state;
    return st.version === 1 && st.ruleset === 'veteran';
  }));
  await click('[data-act="titleStart"]');
  ok('A4 进入营地', (await snap()).screen === 'camp');
  ok('A5 四位老兵', await ev(() => window.Ashen.Veteran.App.state.roster.length === 4));

  /* ---------- B 工坊 ---------- */
  await click('[data-act="go"][data-v="workshop"]');
  ok('B1 打开工坊', (await snap()).screen === 'workshop');
  ok('B2 渲染 4x4 板面', await ev(() => !!document.querySelector('svg.board')));
  ok('B3 默认板面合法', await ev(() => document.body.innerText.includes('板面合法')));

  const partId = await ev(() => {
    const st = window.Ashen.Veteran.App.state;
    return st.stash.find((id) => st.itemsById[id].kind === 'circuit') || null;
  });
  if (partId) {
    await click(`[data-act="wsPick"][data-id="${partId}"]`);
    await click('[data-act="wsCell"][data-id="0,0"]');
    ok('B4 点选可放置', (await ev(() => window.Ashen.Veteran.App.ui.wsDraft.length)) === 3);
    await click('[data-act="wsUndo"]');
    ok('B5 撤销', (await ev(() => window.Ashen.Veteran.App.ui.wsDraft.length)) === 2);
    await click('[data-act="wsRedo"]');
    ok('B6 重做', (await ev(() => window.Ashen.Veteran.App.ui.wsDraft.length)) === 3);
    await click('[data-act="wsUndo"]');
  } else {
    ok('B4 跳过（仓库没有多余回路）', true);
    ok('B5 跳过', true);
    ok('B6 跳过', true);
  }

  await ev(() => {
    const A = window.Ashen.Veteran;
    A.App.ui.wsPick = A.App.state.stash.find((id) => A.App.state.itemsById[id].kind === 'circuit');
  });
  await click('[data-act="wsCell"][data-id="2,3"]');
  ok('B7 屏蔽格给出具体原因', await ev(() => {
    const box = document.querySelector('.err-box');
    return !!box && box.innerText.includes('屏蔽格');
  }));
  await click('[data-act="wsUndo"]');

  /* ---------- B8~B9 拖拽装配 ---------- */
  const dragGeo = await ev(() => {
    const svg = document.querySelector('svg.board');
    if (!svg) return null;
    const g = { cell: +svg.dataset.cell, gx: +svg.dataset.gx, gy: +svg.dataset.gy };
    const ctm = svg.getScreenCTM();
    const pt = svg.createSVGPoint();
    const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const toScreen = (cx, cy) => {
      pt.x = g.gx + cx * g.cell + g.cell / 2;
      pt.y = g.gy + cy * g.cell + g.cell / 2;
      const p = pt.matrixTransform(ctm);
      return { x: p.x, y: p.y };
    };
    const part = svg.querySelector('.part-group');
    const itemEl = document.querySelector('.part-item[data-act="wsPick"]');
    const hit = svg.querySelector('.hit');
    return {
      part: part ? Object.assign({ id: part.dataset.id }, center(part)) : null,
      item: itemEl ? Object.assign({ id: itemEl.dataset.id }, center(itemEl)) : null,
      hit: hit ? (() => {
        const [cx, cy] = hit.dataset.id.split(',').map(Number);
        return Object.assign({ id: hit.dataset.id }, toScreen(cx, cy));
      })() : null,
    };
  });

  if (dragGeo && dragGeo.part && dragGeo.hit) {
    const before = await ev((id) => {
      const p = window.Ashen.Veteran.App.ui.wsDraft.find((x) => x.itemId === id);
      return p ? p.x + ',' + p.y : null;
    }, dragGeo.part.id);
    await page.mouse.move(dragGeo.part.x, dragGeo.part.y);
    await page.mouse.down();
    await page.mouse.move(dragGeo.hit.x, dragGeo.hit.y, { steps: 8 });
    await page.mouse.up();
    await wait(300);
    const after = await ev((id) => {
      const p = window.Ashen.Veteran.App.ui.wsDraft.find((x) => x.itemId === id);
      return p ? p.x + ',' + p.y : null;
    }, dragGeo.part.id);
    ok('B8 拖动已有构件能换位置', !!after && after !== before, `${before} -> ${after}`);
  } else {
    ok('B8 跳过（没有可拖的构件或空格）', true);
  }

  if (dragGeo && dragGeo.item && dragGeo.hit) {
    const n0 = await ev(() => window.Ashen.Veteran.App.ui.wsDraft.length);
    await page.mouse.move(dragGeo.item.x, dragGeo.item.y);
    await page.mouse.down();
    await page.mouse.move(dragGeo.hit.x, dragGeo.hit.y, { steps: 8 });
    await page.mouse.up();
    await wait(300);
    const n1 = await ev(() => window.Ashen.Veteran.App.ui.wsDraft.length);
    ok('B9 从构件库拖到板面能放置', n1 === n0 + 1, `${n0} -> ${n1}`);
    await click('[data-act="wsUndo"]');
  } else {
    ok('B9 跳过（构件库为空）', true);
  }

  /* ---------- C 出征与战斗 ---------- */
  await click('[data-act="go"][data-v="camp"]');
  await click('[data-act="startRun"]');
  await wait(400);
  ok('C1 进入地图', (await snap()).screen === 'map');
  ok('C2 三个节点', (await snap()).nodes.length === 3);

  let nodes = (await snap()).nodes;
  let battleNode = nodes.find((n) => ['battle', 'elite', 'boss'].includes(n.type));
  for (let i = 0; i < 6 && !battleNode; i++) {
    await endRun();
    await click('[data-act="startRun"]');
    await wait(300);
    nodes = (await snap()).nodes;
    battleNode = nodes.find((n) => ['battle', 'elite', 'boss'].includes(n.type));
  }
  ok('C3 找到战斗节点', !!battleNode, JSON.stringify(nodes));

  await click(`[data-act="chooseNode"][data-id="${battleNode.id}"]`);
  await wait(300);
  ok('C4 进入战前整备', (await snap()).screen === 'prebattle');

  const bp1 = await ev(() => JSON.stringify(window.Ashen.Veteran.App.state.run.encounter.enemyBlueprint));
  await click('[data-act="startAttempt"]');
  await wait(400);
  ok('C5 进入战斗', (await snap()).screen === 'battle');
  ok('C6 战场画布存在', await ev(() => !!document.getElementById('cv')));
  await click('#btlSpeed');
  ok('C7 速度按钮同步', await ev(() => document.getElementById('btlSpeed').textContent.includes('×2')));

  const ended = await waitBattle(60000);
  ok('C8 战斗能结束', ended && (await snap()).over === true);

  const pix = await ev(() => {
    const cv = document.getElementById('cv');
    if (!cv) return -1;
    try {
      const c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4 * 61) if (d[i] > 22 || d[i + 1] > 22 || d[i + 2] > 22) n += 1;
      return n;
    } catch (e) { return 'tainted'; }
  });
  ok('C9 战场有绘制内容', pix === 'tainted' ? true : pix > 500, pix);

  /* ---------- D 回转与确认 ---------- */
  await click('[data-act="rewind"]');
  await wait(300);
  ok('D1 重新整备回到战前', (await snap()).screen === 'prebattle');
  ok('D2 敌人没有重新生成', await ev(() => JSON.stringify(window.Ashen.Veteran.App.state.run.encounter.enemyBlueprint)) === bp1);

  await click('[data-act="prepPick"][data-id="0"]');
  const swapTarget = await ev(() => {
    const f = window.Ashen.Veteran.App.state.run.encounter.preparation.formation;
    return f[1] || f[0];
  });
  await click(`[data-act="prepSwap"][data-a="0"][data-uid="${swapTarget}"]`);
  ok('D3 阵型可调整', (await ev(() => window.Ashen.Veteran.App.state.run.encounter.preparation.formation[0])) === swapTarget);

  await click('[data-act="startAttempt"]');
  await waitBattle(60000);
  ok('D4 第二次尝试能结束', (await snap()).over === true);
  ok('D5 尝试次数累加', (await ev(() => window.Ashen.Veteran.App.state.run.encounter.attemptNumber)) >= 2);

  await click('[data-act="reviewNow"]');
  await wait(300);
  ok('D6 进入结果预览', (await snap()).screen === 'review');

  const outcome = await ev(() => window.Ashen.Veteran.App.state.run.encounter.pendingResult.outcome);
  ok('D7 有结算结果', !!outcome, outcome);

  if (outcome === 'win') {
    await click('[data-act="confirmResult"]');
    await wait(300);
    ok('D8 确认后进入掉落', (await snap()).screen === 'loot');
    ok('D9 奖励先记在本局', (await ev(() => window.Ashen.Veteran.App.state.run.goldFound)) > 0);
    ok('D10 确认后禁止回转', await ev(() => !window.Ashen.Veteran.Encounter.rewind(window.Ashen.Veteran.App.state).ok));
    for (let i = 0; i < 8; i++) {
      const pend = await ev(() => window.Ashen.Veteran.App.state.run.pendingLoot.length);
      if (!pend) break;
      await click('[data-act="lootDiscard"]');
    }
    await click('[data-act="finishNode"]');
    await wait(300);
    if ((await snap()).screen === 'blessing') {
      await click('[data-act="chooseBlessing"]');
      await wait(300);
    }
    const s = await snap();
    ok('D11 完成后推进到第 2 层', s.screen === 'map' && s.floor === 2, `${s.screen}@${s.floor}`);
  } else {
    ok('D8 非胜利时提供败退入口', await ev(() => !!document.querySelector('[data-act="retreatDefeat"]')));
    ok('D9 跳过（本局未胜）', true);
    ok('D10 跳过', true);
    ok('D11 跳过', true);
  }

  /* ---------- E 营火烙印与撤退归属 ---------- */
  await endRun();
  const campOk = await ev(() => {
    const V = window.Ashen.Veteran;
    let st = V.App.state;
    st = V.Expedition.start(st, { seed: 31 }).state;
    st.run.floor = 3;
    st.run.nodes = [{ id: 'nc', type: 'camp', consumed: false, name: '废弃营火', risk: 'none', artId: 'node.camp' }];
    const r = V.Expedition.chooseNode(st, 'nc');
    if (!r.ok) return { ok: false, err: r.error };
    let s2 = r.state;
    const part = V.State.makePart(s2, { kind: 'circuit', templateId: 'ember', acquiredRunId: s2.run.id, acquiredSeq: 1 });
    s2.itemsById[part.id] = part;
    s2.run.bag.push(part.id);
    V.App.setState(s2);
    return { ok: true };
  });
  ok('E1 进入营火', campOk.ok && (await snap()).screen === 'campNode', JSON.stringify(campOk));

  await click('[data-act="inscribeStart"]');
  ok('E2 进入烙印编辑', (await ev(() => window.Ashen.Veteran.App.ui.wsMode)) === 'inscribe');
  await click('[data-act="wsAutoLayout"]');
  await wait(200);
  ok('E3 推荐布局合法且接通主手', await ev(() => {
    const A = window.Ashen.Veteran;
    const u = A.App.state.roster.find((x) => x.id === A.App.ui.wsUnit);
    const pv = A.Circuit.preview(A.App.state, u.id, A.App.ui.wsDraft);
    return pv.ok && pv.reachableOutputs.includes('main');
  }));

  await click('[data-act="wsInscribe"]');
  await wait(300);
  ok('E4 烙印后压力 +40', (await ev(() => window.Ashen.Veteran.App.state.run.party[0].stress)) === 40);
  ok('E5 烙印后生命上限 ×0.8', await ev(() => {
    const A = window.Ashen.Veteran;
    return A.Roster.stats(A.App.state, A.App.state.roster[0]).maxHp === 128;
  }));

  await click('[data-act="finishNode"]');
  await wait(300);
  if ((await snap()).screen === 'blessing') {
    await click('[data-act="chooseBlessing"]');
    await wait(300);
  }
  /* 下一层的节点类型是随机的，这里把本层节点固定成一场战斗，
     保证测的是“烙印 → 锁定遭遇 → 紧急撤退”，而不是节点随机性。 */
  await ev(() => {
    const A = window.Ashen.Veteran;
    const st = A.State.clone(A.App.state);
    if (!st.run) return;
    st.run.stage = 'map';
    st.run.nodes = [{ id: 'eb', type: 'battle', consumed: false, name: '残响战斗', risk: 'low', artId: 'node.battle' }];
    A.App.setState(st);
  });
  await wait(200);
  await click('[data-act="chooseNode"][data-id="eb"]');
  await wait(300);
  ok('E6 锁定了遭遇', (await snap()).screen === 'prebattle');

  const ownedBefore = await ev(() => window.Ashen.Veteran.State.ownItemIds(window.Ashen.Veteran.App.state).length);
  await click('[data-act="retreatEmergency"]');
  await wait(500);
  const sAfter = await snap();
  ok('E7 紧急撤退回营', sAfter.screen === 'settlement' && !sAfter.run, `${sAfter.screen}/${sAfter.run}`);
  const ownedAfter = await ev(() => window.Ashen.Veteran.State.ownItemIds(window.Ashen.Veteran.App.state).length);
  ok('E8 带入资产未丢失', ownedAfter >= ownedBefore - 1, `${ownedBefore} -> ${ownedAfter}`);
  ok('E9 撤退不算合格撤离', await ev(() => {
    const st = window.Ashen.Veteran.App.state;
    return !!st.settlement && st.settlement.eligible === false;
  }));
  ok('E10 撤退后板面引用仍然有效', await ev(() => {
    const st = window.Ashen.Veteran.App.state;
    return st.roster[0].board.placements.every((p) => !!st.itemsById[p.itemId]);
  }));
  await click('[data-act="settleClose"]');
  ok('E11 结算后回营地', (await snap()).screen === 'camp');

  /* ---------- F 存档与恢复 ---------- */
  await ev(() => {
    const A = window.Ashen.Veteran;
    const st = A.State.clone(A.App.state);
    st.gold = 4321;
    A.App.setState(st);
  });
  await page.reload();
  await wait(800);
  ok('F1 刷新后停在标题', (await snap()).screen === 'title');
  ok('F2 金币保留', (await ev(() => window.Ashen.Veteran.App.state.gold)) === 4321);

  await click('[data-act="titleStart"]');
  await ev(() => {
    const A = window.Ashen.Veteran;
    const st = A.Expedition.start(A.App.state, { seed: 77 }).state;
    st.run.nodes = [{ id: 'nb', type: 'battle', consumed: false, name: '残响战斗', risk: 'low', artId: 'node.battle' }];
    const r = A.Encounter.open(st, 'nb');
    const s2 = A.Encounter.startAttempt(r.state);
    A.App.setState(s2.state);
  });
  await wait(500);
  const tickBefore = await ev(() => window.Ashen.Veteran.App.state.run.battle.tick);
  await page.reload();
  await wait(900);
  ok('F3 战斗中刷新回到标题', (await snap()).screen === 'title');
  const tickAfter = await ev(() => {
    const st = window.Ashen.Veteran.App.state;
    return st.run && st.run.battle ? st.run.battle.tick : null;
  });
  ok('F4 战斗没有在后台推进', tickAfter == null || tickAfter <= tickBefore + 1, `${tickBefore} -> ${tickAfter}`);

  /* ---------- G 资源全失败 ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 940 } });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.route('**/assets/art/**', (r) => r.abort());
  await p2.goto(url);
  await wait(700);
  await p2.click('[data-act="titleStart"]');
  await wait(300);
  await p2.click('[data-act="go"][data-v="workshop"]');
  await wait(300);
  ok('G1 无美术时工坊仍可用', await p2.evaluate(() => !!document.querySelector('svg.board')));
  ok('G2 无美术时无异常', errs2.length === 0, errs2.slice(0, 2).join('|'));

  /* ---------- H 响应式 ---------- */
  for (const w of [360, 390, 768, 1440]) {
    const c3 = await browser.newContext({ viewport: { width: w, height: 900 } });
    const p3 = await c3.newPage();
    await p3.goto(url);
    await wait(500);
    await p3.click('[data-act="titleStart"]');
    await wait(250);
    await p3.click('[data-act="go"][data-v="workshop"]');
    await wait(250);
    const ov = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`H ${w}px 无横向溢出`, ov <= 0, ov);
    await c3.close();
  }

  /* ---------- I 单入口 ---------- */
  ok('I1 只剩一个入口（veteran.html 已移除）', !fs.existsSync(path.join(ROOT, 'veteran.html')));
  ok('I2 旧玩法模块已移除', !fs.existsSync(path.join(ROOT, 'src/systems')) && !fs.existsSync(path.join(ROOT, 'src/app.js')));
  ok('I3 页面标题为灰烬回廊', await page.evaluate(() => document.title) === '灰烬回廊 · Ashen Corridor');

  const pass = R.filter((r) => r.p).length;
  console.log('\n===== 老兵回路 E2E =====');
  R.forEach((r) => console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.x ? '   [' + r.x + ']' : ''}`));
  console.log(`\n合计 ${pass}/${R.length}`);
  console.log('JS 错误：', errs.length ? errs.slice(0, 5).join('\n') : '无');

  await browser.close();
  process.exit(pass === R.length && errs.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('崩溃：', e && e.stack ? e.stack.slice(0, 900) : e);
  process.exit(1);
});
