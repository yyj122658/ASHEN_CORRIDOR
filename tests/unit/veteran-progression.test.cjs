'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun } = require('../helpers/veteran-run.cjs');

/** 直接按给定完成层数走一次撤离事务，用于验证成长规则。 */
function extractAt(A, st, depth, opts) {
  const V = A.Veteran;
  let s = A.Veteran.State.clone(st);
  if (opts && opts.team) s.team = opts.team.slice();
  const started = V.Expedition.start(s, { seed: (opts && opts.seed) || 4242 });
  if (!started.ok) throw new Error(JSON.stringify(started.error));
  s = started.state;
  s.run.completedFloors = depth;
  s.run.finishedFloors = Array.from({ length: depth }, (_, i) => i + 1);
  const r = V.Expedition.extract(s);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.state;
}

test('只完成 2 层不算合格撤离', () => {
  const { A, V } = boot(401);
  const st = extractAt(A, V.State.create(4242, { classicPlate: true }), 2);
  assert.equal(st.settlement.eligible, false);
  assert.ok(st.settlement.reason.includes('至少 3 层'));
  assert.ok(st.roster.every((u) => u.history.eligibleRunIds.length === 0));
});

test('三次 3 层撤离后仍只有 2 个逻辑槽，两次后解锁第 3 槽', () => {
  const { A, V } = boot(402);
  let st = V.State.create(4242, { classicPlate: true });
  assert.equal(st.roster[0].logicSlots, 2);
  st = extractAt(A, st, 3);
  assert.equal(st.roster[0].logicSlots, 2, '一次还不够');
  st = extractAt(A, st, 3);
  assert.equal(st.roster[0].logicSlots, 3, '两次合格解锁第三槽');
});

test('同一 runId 不会重复计数', () => {
  const { A, V } = boot(403);
  let st = V.State.create(4242, { classicPlate: true });
  st = extractAt(A, st, 3);
  const unit = st.roster[0];
  const before = unit.history.eligibleRunIds.length;
  /* 手动重放同一 runId */
  const r = V.Roster.recordExtraction(st, {
    runId: unit.history.eligibleRunIds[0],
    kind: 'extract', depth: 3, floors: [1, 2, 3],
    party: [unit.id], usedWeapons: [],
  });
  assert.equal(r.eligible, true);
  assert.equal(unit.history.eligibleRunIds.length, before, '同 runId 不该再记一次');
});

test('紧急撤退与败退都不算合格撤离', () => {
  const { A, V } = boot(404);
  ['emergency', 'defeat'].forEach((mode) => {
    let st = startRun(A, v0(), 404);
    st.run.completedFloors = 5;
    const r = V.Expedition.retreat(st, mode);
    assert.ok(r.ok);
    assert.equal(r.state.settlement.eligible, false);
    assert.ok(r.state.roster.every((u) => u.history.eligibleRunIds.length === 0));
    assert.ok(r.state.settlement.reason.includes('不算合格撤离'));
  });
});

test('战史视图能解释为什么没拿到合格撤离', () => {
  const { A, V } = boot(407);
  let st = extractAt(A, V.State.create(4242, { classicPlate: true }), 2);
  const h = V.Roster.history(st, st.roster[0].id);
  assert.equal(h.eligibleRuns, 0);
  assert.equal(h.nextSlotIn, 2);
  assert.equal(h.records.length, 1);
  assert.ok(h.records[0].reason.includes('2 层'), h.records[0].reason);
  assert.equal(h.attunement.need, 3);
});

test('招募产出可用角色：主手 + 基础线路 + 合法状态', () => {
  const { A, V } = boot(408);
  let st = V.State.create(4242, { classicPlate: true });
  st.gold = 999;
  st = V.Roster.refreshShop(st, false).state;
  assert.equal(st.shop.length, 3);
  const offer = st.shop[0];
  const r = V.Roster.recruit(st, offer.id);
  assert.ok(r.ok, JSON.stringify(r.error));
  st = r.state;
  const unit = st.roster[st.roster.length - 1];
  assert.ok(unit.weaponId, '必须有主手');
  const pv = V.Circuit.preview(st, unit.id, unit.board.placements);
  assert.ok(pv.ok, JSON.stringify(pv.errors));
  assert.ok(pv.reachableOutputs.length > 0, '招募出来的板面必须能通电');
  const v = V.State.validate(st);
  assert.ok(v.ok, v.errors.slice(0, 3).join('；'));
});

test('指令超过槽位被拒绝', () => {
  const { A, V } = boot(409);
  let st = V.State.create(4242, { classicPlate: true });
  const unit = st.roster[0];
  const tooMany = [
    { id: '1', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action: 'main' },
    { id: '2', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action: 'guard' },
    { id: '3', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe', action: 'guard' },
  ];
  const r = V.Roster.setGambits(st, unit.id, tooMany);
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'bad_gambits');
});

function v0() { return boot(4242).V.State.create(4242, { classicPlate: true }); }
