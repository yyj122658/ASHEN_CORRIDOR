'use strict';
/* 生命金属身份：真实几何决定装配，底盘不再暗藏战斗属性。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

test('异形金属共用战斗基数，蚀刻法相同就不因底盘获得隐藏属性', () => {
  const V = loadVeteran().Veteran;
  const st = V.State.create(42);
  const stats = Object.keys(V.Data.BODIES).map((bodyPreset) => V.Roster.stats(st, { ...st.roster[0], bodyPreset }));
  for (const s of stats) {
    assert.equal(s.maxHp, 140);
    assert.equal(s.atk, 28);
    assert.equal(s.def, 12);
    assert.equal(s.spd, 10);
  }
});

test('负荷统一取当前板面配置，经典板保留原值', () => {
  const V = loadVeteran().Veteran;
  const st = V.State.create(42);
  for (const u of st.roster) {
    const expected = V.Data.body(u.bodyPreset).plate.loadCap;
    assert.equal(V.Circuit.loadCap(u), expected);
    assert.equal(V.Roster.stats(st, u).loadCap, expected);
  }
  const old = V.State.create(42, { classicPlate: true });
  for (const u of old.roster) {
    assert.equal(V.Circuit.loadCap(u), V.Data.body(u.bodyPreset).loadCap);
    assert.equal(V.Roster.stats(old, u).maxHp, V.Data.body(u.bodyPreset).hp);
  }
});

test('招募前固定板形，招入后保持一致且不制造退役武器', () => {
  const V = loadVeteran().Veteran;
  let st = V.Roster.refreshShop(V.State.create(42), false).state;
  st.gold = 1000;
  const offer = st.shop[0];
  assert.ok(Number.isInteger(offer.plateSeed));
  const before = JSON.stringify(V.Circuit.plateOf(offer).cellsList);
  const weapons = Object.values(st.itemsById).filter((item) => item.kind === 'weapon').length;
  const r = V.Roster.recruit(st, offer.id);
  assert.equal(r.ok, true);
  const unit = r.state.roster.at(-1);
  assert.equal(JSON.stringify(V.Circuit.plateOf(unit).cellsList), before);
  assert.equal(Object.values(r.state.itemsById).filter((item) => item.kind === 'weapon').length, weapons);
  assert.equal(V.State.validate(r.state).ok, true);
});

