'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');
const { autoRouteBoard } = require('../helpers/veteran-run.cjs');

test('越界蓝图按整门拒绝，库存、原装配和自动布线资源保持原状', () => {
  const A = loadVeteran();
  const V = A.Veteran;
  const state = V.State.create(42, {classicPlate:true});
  const unit = state.roster[0];
  const spec = V.Data.manuscript('inverse');
  state.manuscriptVault.push(V.State.clone(spec));
  const before = JSON.stringify(state);
  const outcome = V.State.placeManuscript(state, unit, spec.id);
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /轮廓不兼容/);
  V.State.equipManuscript(state, unit, spec.id);
  assert.equal(JSON.stringify(state), before);
  assert.equal(autoRouteBoard(A, state, unit, {msId:spec.id}).ok, false);
  assert.equal(JSON.stringify(state), before);
});

test('迁移旧档时保留裁剪谱和越界纹路的所有权', () => {
  const V = loadVeteran().Veteran;
  const state = V.State.create(42);
  const unit = state.roster[0];
  const big = V.Data.manuscript('inverse');
  unit.manuscript = { ...big, cells: [[0,0]], clipped:true, x:11, y:11 };
  const placed = unit.board.placements[0];
  assert.ok(placed);
  placed.x = 11;
  placed.y = 11;
  const save = JSON.parse(V.Storage.encode(state));
  save.schemaVersion = 4;
  const loaded = V.Storage.decode(JSON.stringify(save));
  assert.ok(loaded.ok, loaded.errors.join('，'));
  const recovered = loaded.state;
  const equipped = V.State.manuscriptsOf(recovered.roster[0]);
  const moved = [...equipped, ...recovered.manuscriptVault].find(ms => ms.id === big.id);
  assert.deepEqual(moved.cells, big.cells);
  assert.equal(moved.clipped, undefined);
  assert.equal(V.State.itemLocations(recovered)[placed.itemId].length, 1);
});
