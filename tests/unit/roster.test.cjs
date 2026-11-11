'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('../helpers/load-game.cjs');

const A = loadGame();

function seedItem(state, slot, opts) {
  const r = A.Equipment.makeItem(state, Object.assign({ ilvl: 4, bias: 2, slot }, opts || {}));
  const st = r.state;
  st.itemsById[r.item.id] = r.item;
  st.stash.push(r.item.id);
  return { state: st, item: r.item };
}

function equipFromStash(state, unitId, itemId) {
  const r = A.Equipment.equip(state, unitId, itemId);
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.state;
}

test('升星：材料身上三件装备全部退仓且保留锁定', () => {
  let s = A.State.create();
  const [target, fodder] = s.roster.filter((u) => u.cls === 'blade');

  for (const slot of ['weapon', 'armor', 'trinket']) {
    const g = seedItem(s, slot);
    s = g.state;
    s.roster.find((u) => u.id === fodder.id).equip[slot] = g.item.id;
  }
  const fodderItems = ['weapon', 'armor', 'trinket'].map((sl) => s.roster.find((u) => u.id === fodder.id).equip[sl]);
  s.itemsById[fodderItems[0]].locked = true;

  const stashBefore = s.stash.length;
  const res = A.Roster.starUp(s, target.id, fodder.id);
  assert.ok(res.ok, JSON.stringify(res.error));
  const st = res.state;

  assert.equal(st.roster.find((u) => u.id === target.id).star, 2);
  assert.ok(!st.roster.some((u) => u.id === fodder.id), '材料已移除');

  fodderItems.forEach((id) => {
    assert.equal(A.State.itemLocation(st, id), 'stash', '应回到仓库：' + id);
  });
  assert.equal(st.stash.length, stashBefore + 3);
  assert.equal(st.itemsById[fodderItems[0]].locked, true, '锁定状态必须保留');
});

test('升星：目标自己的装备不受影响', () => {
  let s = A.State.create();
  const [target, fodder] = s.roster.filter((u) => u.cls === 'blade');
  const g = seedItem(s, 'weapon');
  s = g.state;
  s.roster.find((u) => u.id === target.id).equip.weapon = g.item.id;
  const targetItem = g.item.id;

  const res = A.Roster.starUp(s, target.id, fodder.id);
  assert.ok(res.ok);
  assert.equal(res.state.roster.find((u) => u.id === target.id).equip.weapon, targetItem);
});

test('升星：同 ID / 职业不符 / 星级不符 全部失败且无副作用', () => {
  const s = A.State.create();
  const [target] = s.roster.filter((u) => u.cls === 'blade');
  const warden = s.roster.find((u) => u.cls === 'warden');

  const r1 = A.Roster.starUp(s, target.id, target.id);
  assert.ok(!r1.ok);
  assert.equal(r1.state, s);
  assert.equal(r1.state.roster.length, s.roster.length);

  const r2 = A.Roster.starUp(s, target.id, warden.id);
  assert.ok(!r2.ok);
  assert.equal(r2.error.code, 'CLS_MISMATCH');

  const s2 = A.State.clone(s);
  s2.roster.find((u) => u.id === warden.id).star = 2;
  const r3 = A.Roster.starUp(s2, warden.id, s2.roster.find((u) => u.cls === 'blade').id);
  assert.ok(!r3.ok);
});

test('遣散归还全部装备', () => {
  let s = A.State.create();
  const u = s.roster[0];
  for (const slot of ['weapon', 'armor']) {
    const g = seedItem(s, slot);
    s = g.state;
    s.roster.find((x) => x.id === u.id).equip[slot] = g.item.id;
  }
  const res = A.Roster.dismiss(s, u.id);
  assert.ok(res.ok);
  assert.ok(!res.state.roster.some((x) => x.id === u.id));
  assert.equal(res.state.stash.length, s.stash.length + 2);
});

test('稀疏队伍重排不前移，空槽保留', () => {
  let s = A.State.create();
  const a = s.roster[0].id, b = s.roster[1].id;
  s.team = [null, a, null, b];

  const r = A.Roster.move(s, a, 3);
  assert.ok(r.ok);
  assert.deepEqual(r.state.team, [null, b, null, a]);
  assert.equal(r.state.team.filter(Boolean).length, 2);
});

test('同一角色不能占两个槽位', () => {
  const s = A.State.create();
  const id = s.roster[0].id;
  s.team = [id, null, null, null];
  const r = A.Roster.setTeamSlot(s, id, 2);
  assert.ok(r.ok);
  assert.equal(r.state.team.filter((x) => x === id).length, 1);
  assert.equal(r.state.team[0], null);
});

test('绝望：healingReceivedMult 为 0.70 而不是放大治疗', () => {
  const s = A.State.create();
  const id = s.roster[0].id;
  s.roster[0].affliction = 'despair';
  const st = A.Roster.calcStats(s, id, s.team.filter(Boolean));
  assert.equal(st.healingReceivedMult, 0.70);
  const healed = Math.round(100 * st.healingReceivedMult);
  assert.equal(healed, 70);
});

test('calcStats 不修改原始数据表与装备', () => {
  const s = A.State.create();
  const before = JSON.stringify(A.Data.CLASSES.blade);
  const id = s.roster[0].id;
  A.Roster.calcStats(s, id, s.team.filter(Boolean));
  assert.equal(JSON.stringify(A.Data.CLASSES.blade), before);
  assert.equal(s.roster[0].star, 1);
});

test('两人同职业触发 2 档羁绊，数值与展示一致', () => {
  const s = A.State.create();
  const blades = s.roster.filter((u) => u.cls === 'blade').map((u) => u.id);
  s.team = [blades[0], blades[1], null, null];

  const syn = A.Roster.synergies(s, s.team.filter(Boolean));
  const blade = syn.find((x) => x.id === 'blade');
  assert.equal(blade.count, 2);
  assert.equal(blade.activeTier, 1);
  assert.equal(blade.active, true);

  const st = A.Roster.calcStats(s, blades[0], s.team.filter(Boolean));
  const base = A.Data.CLASSES.blade.atk;
  // 剑势 2 档：攻击 +12%
  assert.equal(st.atk, Math.round(base * 1.12));
});

test('招募价格、刷新与金币扣除', () => {
  let s = A.State.create();
  const r0 = A.Roster.refreshShop(s, false);
  assert.ok(r0.ok);
  s = r0.state;
  assert.equal(s.shop.length, 3);
  assert.equal(s.gold, 160, '首次生成不扣钱');

  const g = s.gold;
  const r1 = A.Roster.refreshShop(s, true);
  assert.ok(r1.ok);
  assert.equal(r1.state.gold, g - 12);

  const offer = r1.state.shop.find((o) => !o.sold);
  const cost = A.Roster.recruitCost(offer.unit);
  const r2 = A.Roster.recruit(r1.state, offer.offerId);
  assert.ok(r2.ok);
  assert.equal(r2.state.gold, r1.state.gold - cost);
  assert.equal(r2.state.roster.length, r1.state.roster.length + 1);

  const r3 = A.Roster.recruit(r2.state, offer.offerId);
  assert.ok(!r3.ok, '同一 offer 不能招募两次');
});

test('安抚清空压力与负面状态并扣钱', () => {
  let s = A.State.create();
  s.roster[0].stress = 80;
  s.roster[0].affliction = 'fear';
  const r = A.Roster.comfort(s, s.roster[0].id);
  assert.ok(r.ok);
  assert.equal(r.state.roster[0].stress, 0);
  assert.equal(r.state.roster[0].affliction, null);
  assert.ok(r.state.gold < s.gold);
});

test('祭坛升级提升背包容量且不能超上限', () => {
  let s = A.State.create();
  s.shards = 100;
  const r = A.Roster.upgrade(s, 'bag');
  assert.ok(r.ok);
  assert.equal(r.state.upgrades.bag, 1);
  assert.equal(r.state.bagCap, 10);
  assert.ok(r.state.shards < 100);

  let cur = r.state;
  for (let i = 0; i < 10; i++) {
    const rr = A.Roster.upgrade(cur, 'bag');
    if (rr.ok) cur = rr.state;
  }
  assert.equal(cur.upgrades.bag, 5);
  assert.equal(cur.bagCap, 18);
});
