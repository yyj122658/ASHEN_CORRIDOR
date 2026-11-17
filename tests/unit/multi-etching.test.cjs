'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');
const V = loadVeteran().Veteran;

test('试铺优先对准选中蚀刻法，保留已有纹路，草稿可撤回', () => {
  const st = V.State.create(3);
  const u = st.roster[0];
  const draft = [];
  const target = u.manuscript;
  const ms = { oriented: V.Manuscript.orient(V.Manuscript.normalize(target), target.rotation, target.mirrorY),
    ox: target.x, oy: target.y, fits: true };
  const wire = st.stash.find(id => st.itemsById[id].templateId === 'straight');
  const original = JSON.stringify(st);
  const pose = V.Circuit.suggestPlacement(st, u, draft, wire, ms);
  assert.ok(pose);
  /* 单件 straight 只盖得住它压到的那几格：骨架 6~54 格之后不可能一件满覆盖。
     要守的是「试铺确实对准了蚀刻法」——覆盖严格大于 0，且接不通（单件不是通路）。 */
  const single = V.Circuit.manuscriptState(st, u.id, [pose]);
  assert.ok(single.pct > 0, `试铺应对准蚀刻法（实际 ${single.pct}%）`);
  assert.equal(single.routed, false, '单件不该直接接通');
  assert.equal(V.Circuit.preview(st, u.id, [pose]).ok, true);
  assert.equal(V.Circuit.suggestPlacement(st, u, [pose], wire, ms), null);
  assert.equal(JSON.stringify(st), original);
  assert.equal(draft.length, 0);
});

test('同板辅修可独立拆装，非法落点不扣库存，读档保持位置与瘢痕', () => {
  const st = V.State.create(19);
  const u = st.roster[0];
  const first = JSON.stringify(u.manuscript);
  st.manuscriptVault.push(V.Data.manuscript('ward'));
  const before = JSON.stringify(st);
  assert.equal(V.State.placeManuscript(st, u, 'ward', u.manuscript).ok, false);
  assert.equal(JSON.stringify(st), before);
  assert.equal(V.State.placeManuscript(st, u, 'ward').ok, true);
  assert.equal(JSON.stringify(u.manuscript), first);
  const second = V.State.manuscriptsOf(u)[1];
  assert.equal(second.id, 'ward');
  assert.equal(st.manuscriptVault.some(m => m.id === 'ward'), false);
  assert.equal(V.Circuit.manuscriptState(st, u.id, undefined, 'ward').spec.id, 'ward');
  const cells = V.State.manuscriptCells(second);
  u.scars = [{ x: cells[0][0], y: cells[0][1], templateId: 'straight', source: '顺丝纹', floor: 1, runId: 'r1' }];
  /* 先在「已有瘢痕」的状态下取基准：瘢痕会减免纹路的维持负荷，
     前后两次测量必须带着同一份减免，差值才等于这门蚀刻法自己的负荷 */
  const oldLoad = V.Circuit.preview(st, u.id, u.board.placements).load;
  assert.equal(V.Circuit.scarState(st, u, [])[0].active, true);
  const saved = V.Storage.decode(V.Storage.encode(st));
  assert.equal(saved.ok, true, saved.errors.join(' '));
  assert.deepEqual(JSON.parse(JSON.stringify(V.State.manuscriptsOf(saved.state.roster[0]))),
    JSON.parse(JSON.stringify(V.State.manuscriptsOf(u))));
  assert.equal(V.State.removeManuscript(st, u, 'ward').ok, true);
  assert.equal(V.Circuit.scarState(st, u, [])[0].active, false);
  assert.equal(V.Circuit.preview(st, u.id, u.board.placements).load, oldLoad - second.load);
  assert.equal(st.manuscriptVault.filter(m => m.id === 'ward').length, 1);
  assert.equal(V.State.placeManuscript(st, u, 'ward').ok, true);
  assert.equal(V.State.removeManuscript(st, u, u.manuscript.id).ok, true);
  assert.equal(u.manuscript.id, 'ward');
});

test('新档库存可与起手法三门辅修，换主修保留落点、库存和最高阶属性', () => {
  const st = V.State.create(3);
  const u = st.roster[0];
  for (const id of ['rivet', 'corridor5']) assert.equal(V.State.placeManuscript(st, u, id).ok, true);
  const positions = () => Object.fromEntries(V.State.manuscriptsOf(u).map(m => [m.id, JSON.stringify(V.State.manuscriptCells(m))]));
  const before = positions();
  const stats = V.Roster.stats(st, u);
  assert.equal(V.State.promoteManuscript(u, 'corridor5').ok, true);
  assert.equal(u.manuscript.id, 'corridor5');
  assert.deepEqual(positions(), before);
  /* v4.0：阻抗取「主修覆盖率」，换主修后覆盖率会变，所以只比不随主修变的那几项。
     （完整度只看占格与闭环，幅值只看基座，节拍只看底盘。） */
  const afterPromote = V.Roster.stats(st, u);
  ['maxHp', 'atk', 'shieldCap', 'spd', 'loadCap'].forEach((k) => {
    assert.equal(afterPromote[k], stats[k], `${k} 不该因为换主修而改变`);
  });
  assert.ok(afterPromote.panel.loops === stats.panel.loops, '闭环数不该因换主修而变');
  assert.equal(st.manuscriptVault.length, 0);
  const run = V.Expedition.start(st, { seed: 3 }).state;
  run.run.completedFloors = 3;
  const home = V.Expedition.extract(run, false).state;
  const returned = V.State.unitById(home, u.id);
  for (const m of V.State.manuscriptsOf(returned)) assert.equal(returned.history.msAttune[m.id].eligibleRunIds.length, 1);
  assert.equal(V.Storage.decode(V.Storage.encode(home)).ok, true);
});

test('负荷超载不拦装配，坏档才拒绝', () => {
  /* 77 格异形板：corridor5 有 11 格骨架，14 格经典夹具上塞不下第二门 */
  const st = V.State.create(11);
  const u = st.roster[0];
  V.State.equipManuscript(st, u, 'spark');
  assert.equal(Object.hasOwn(u, 'extraManuscripts'), false);
  const back = V.Storage.decode(V.Storage.encode(st));
  assert.equal(back.ok, true);
  const legacy = back.state.roster[0];
  assert.equal(V.State.placeManuscript(back.state, legacy, 'rivet').ok, true);
  const oldCap = V.Circuit.loadCap(legacy);
  /* 负荷上限由格数 × 系数派生；这里用的是 77 格异形板，所以压的是 generatedCapPerCell */
  const perCell = V.Data.DESIGN.generatedCapPerCell;
  V.Data.DESIGN.generatedCapPerCell = 0.05;
  try {
    assert.ok(V.Circuit.loadCap(legacy) < oldCap, '压过系数后上限应更低');
    /* 超载现在允许装配，代价在战斗里结算（开局压力 + 回裕下降） */
    const r = V.State.placeManuscript(back.state, legacy, 'corridor5');
    assert.equal(r.ok, true, '超载不该再拦装配');
    const check = V.Circuit.preview(back.state, legacy.id, legacy.board.placements);
    assert.ok(check.overload > 0, '装配后应能算出超载量');
  } finally { V.Data.DESIGN.generatedCapPerCell = perCell; }
  legacy.extraManuscripts.push(legacy.manuscript);
  assert.equal(V.Storage.decode(V.Storage.encode(back.state)).ok, false);
  legacy.extraManuscripts.pop();
  legacy.extraManuscripts[0].cells = [null];
  assert.equal(V.Storage.decode(V.Storage.encode(back.state)).ok, false);
});
