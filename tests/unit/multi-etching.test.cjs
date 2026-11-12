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
  assert.equal(V.Circuit.manuscriptState(st, u.id, [pose]).pct, 100);
  assert.equal(V.Circuit.preview(st, u.id, [pose]).ok, true);
  assert.equal(V.Circuit.suggestPlacement(st, u, [pose], wire, ms), null);
  assert.equal(JSON.stringify(st), original);
  assert.equal(draft.length, 0);
});

test('同板合修可独立拆装，非法落点不扣库存，读档保持位置与瘢痕', () => {
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
  const oldLoad = V.Circuit.preview(st, u.id, u.board.placements).load;
  const cells = V.State.manuscriptCells(second);
  u.scars = [{ x: cells[0][0], y: cells[0][1], templateId: 'straight', source: '顺丝纹', floor: 1, runId: 'r1' }];
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

test('新档库存可与起手法三门合修，换主修保留落点、库存和最高阶属性', () => {
  const st = V.State.create(3);
  const u = st.roster[0];
  for (const id of ['rivet', 'corridor5']) assert.equal(V.State.placeManuscript(st, u, id).ok, true);
  const positions = () => Object.fromEntries(V.State.manuscriptsOf(u).map(m => [m.id, JSON.stringify(V.State.manuscriptCells(m))]));
  const before = positions();
  const stats = V.Roster.stats(st, u);
  assert.equal(V.State.promoteManuscript(u, 'corridor5').ok, true);
  assert.equal(u.manuscript.id, 'corridor5');
  assert.deepEqual(positions(), before);
  assert.deepEqual(V.Roster.stats(st, u), stats);
  assert.equal(st.manuscriptVault.length, 0);
  const run = V.Expedition.start(st, { seed: 3 }).state;
  run.run.completedFloors = 3;
  const home = V.Expedition.extract(run, false).state;
  const returned = V.State.unitById(home, u.id);
  for (const m of V.State.manuscriptsOf(returned)) assert.equal(returned.history.msAttune[m.id].eligibleRunIds.length, 1);
  assert.equal(V.Storage.decode(V.Storage.encode(home)).ok, true);
});

test('负荷超限保留库存，旧单门存档可加装，重复装配的坏档会被拒绝', () => {
  const st = V.State.create(11, { classicPlate: true });
  const u = st.roster[0];
  V.State.equipManuscript(st, u, 'spark');
  assert.equal(Object.hasOwn(u, 'extraManuscripts'), false);
  const back = V.Storage.decode(V.Storage.encode(st));
  assert.equal(back.ok, true);
  const legacy = back.state.roster[0];
  assert.equal(V.State.placeManuscript(back.state, legacy, 'rivet').ok, true);
  const before = JSON.stringify(back.state);
  const oldCap = V.Circuit.loadCap(legacy);
  const body = V.Data.body(legacy.bodyPreset);
  body.loadCap = 1;
  try {
    const r = V.State.placeManuscript(back.state, legacy, 'corridor5');
    assert.equal(r.ok, false);
    assert.match(r.reason, /负荷/);
    assert.equal(JSON.stringify(back.state), before);
  } finally { body.loadCap = oldCap; }
  legacy.extraManuscripts.push(legacy.manuscript);
  assert.equal(V.Storage.decode(V.Storage.encode(back.state)).ok, false);
  legacy.extraManuscripts.pop();
  legacy.extraManuscripts[0].cells = [null];
  assert.equal(V.Storage.decode(V.Storage.encode(back.state)).ok, false);
});
