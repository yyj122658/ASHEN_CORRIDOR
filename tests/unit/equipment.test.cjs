'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('../helpers/load-game.cjs');

const A = loadGame();

function withItem(state, slot, opts) {
  const r = A.Equipment.makeItem(state, Object.assign({ ilvl: 5, bias: 3, slot }, opts || {}));
  const st = r.state;
  st.itemsById[r.item.id] = r.item;
  st.stash.push(r.item.id);
  return { state: st, item: r.item };
}

test('makeItem 对相同起始状态产生完全相同结果', () => {
  const s = A.State.create();
  const a = A.Equipment.makeItem(s, { ilvl: 5, bias: 2 });
  const b = A.Equipment.makeItem(A.State.clone(s), { ilvl: 5, bias: 2 });
  assert.deepEqual(a.item, b.item);
  assert.equal(a.state.rngState, b.state.rngState);
});

test('makeItem 不把物品写进 registry（归属由调用方决定）', () => {
  const s = A.State.create();
  const r = A.Equipment.makeItem(s, { ilvl: 5, bias: 2 });
  assert.equal(r.state.itemsById[r.item.id], undefined);
  assert.ok(!r.state.stash.includes(r.item.id));
});

test('物品 id 唯一且 nextId 推进', () => {
  let s = A.State.create();
  const ids = new Set();
  const start = s.nextId;
  for (let i = 0; i < 20; i++) {
    const r = A.Equipment.makeItem(s, { ilvl: 3, bias: 1 });
    ids.add(r.item.id);
    s = r.state;
  }
  assert.equal(ids.size, 20);
  assert.equal(s.nextId, start + 20);
});

test('出售：含锁定物品时整笔拒绝，金币不变', () => {
  let s = A.State.create();
  const a = withItem(s, 'weapon'); s = a.state;
  const b = withItem(s, 'armor'); s = b.state;
  s.itemsById[b.item.id].locked = true;

  const gold = s.gold;
  const r = A.Equipment.sell(s, [a.item.id, b.item.id]);
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'LOCKED');
  assert.equal(r.state.gold, gold);
  assert.equal(r.state.stash.length, 2);
});

test('出售：不在仓库 / 不存在 的 ID 也整笔拒绝', () => {
  let s = A.State.create();
  const a = withItem(s, 'weapon'); s = a.state;
  const gold = s.gold;
  const r = A.Equipment.sell(s, [a.item.id, 'ghost']);
  assert.ok(!r.ok);
  assert.equal(r.state.gold, gold);
  assert.equal(r.state.stash.length, 1);
});

test('出售：重复 ID 只付一次钱', () => {
  let s = A.State.create();
  const a = withItem(s, 'weapon'); s = a.state;
  const expect = A.Equipment.sellValue(s.itemsById[a.item.id]);
  const gold = s.gold;
  const r = A.Equipment.sell(s, [a.item.id, a.item.id, a.item.id]);
  assert.ok(r.ok);
  assert.equal(r.state.gold, gold + expect);
});

test('出售：只卖出传入的筛选集合', () => {
  let s = A.State.create();
  const a = withItem(s, 'weapon'); s = a.state;
  const b = withItem(s, 'armor'); s = b.state;
  const r = A.Equipment.sell(s, [a.item.id]);
  assert.ok(r.ok);
  assert.equal(r.state.stash.length, 1);
  assert.equal(r.state.stash[0], b.item.id);
  assert.ok(!r.state.itemsById[a.item.id]);
});

test('筛选：按槽位 / 最低品质 / 锁定', () => {
  let s = A.State.create();
  const a = withItem(s, 'weapon', { bias: 0 }); s = a.state;
  const b = withItem(s, 'armor', { bias: 3 }); s = b.state;
  s.itemsById[b.item.id].locked = true;

  const weapons = A.Equipment.filter(s, { slot: 'weapon' });
  assert.equal(weapons.length, 1);
  assert.equal(weapons[0].slot, 'weapon');

  const locked = A.Equipment.filter(s, { locked: 'locked' });
  assert.equal(locked.length, 1);
  assert.equal(locked[0].id, b.item.id);

  const highQ = A.Equipment.filter(s, { minQuality: 2 });
  assert.ok(highQ.every((i) => i.q >= 2));
});

test('换装对比给出完整属性差，而不只是战力', () => {
  let s = A.State.create();
  const unit = s.roster.find((u) => u.cls === 'blade');
  const weak = withItem(s, 'weapon', { ilvl: 1, bias: 0 }); s = weak.state;
  s = A.Equipment.equip(s, unit.id, weak.item.id).state;

  const strong = withItem(s, 'weapon', { ilvl: 9, bias: 3 }); s = strong.state;

  const cmp = A.Equipment.compare(s, unit.id, strong.item.id);
  assert.ok(cmp);
  assert.ok(cmp.delta.atk > 0, '攻击应提升，实际 ' + JSON.stringify(cmp.delta));
  assert.equal(cmp.replacedId, weak.item.id);
  assert.ok(cmp.after.maxHp >= cmp.before.maxHp);
});

test('装备时旧装备回仓库', () => {
  let s = A.State.create();
  const unit = s.roster[0];
  const a = withItem(s, 'weapon'); s = a.state;
  const b = withItem(s, 'weapon'); s = b.state;
  s = A.Equipment.equip(s, unit.id, a.item.id).state;
  const res = A.Equipment.equip(s, unit.id, b.item.id);
  assert.ok(res.ok);
  assert.equal(res.state.roster.find((u) => u.id === unit.id).equip.weapon, b.item.id);
  assert.ok(res.state.stash.includes(a.item.id));
});

test('卸下装备回到仓库，空槽再卸失败', () => {
  let s = A.State.create();
  const unit = s.roster[0];
  const a = withItem(s, 'weapon'); s = a.state;
  s = A.Equipment.equip(s, unit.id, a.item.id).state;
  const r = A.Equipment.unequip(s, unit.id, 'weapon');
  assert.ok(r.ok);
  assert.ok(r.state.stash.includes(a.item.id));
  const r2 = A.Equipment.unequip(r.state, unit.id, 'weapon');
  assert.ok(!r2.ok);
});

test('锁定只影响出售，不影响装备', () => {
  let s = A.State.create();
  const a = withItem(s, 'weapon'); s = a.state;
  s.itemsById[a.item.id].locked = true;
  const r = A.Equipment.equip(s, s.roster[0].id, a.item.id);
  assert.ok(r.ok);
});

test('每件装备至多一个特色词条', () => {
  let s = A.State.create();
  for (let i = 0; i < 60; i++) {
    const r = A.Equipment.makeItem(s, { ilvl: 6, bias: 4 });
    s = r.state;
    const tid = r.item.traitId;
    assert.ok(tid === null || A.Data.TRAITS[tid], 'traitId 必须是 null 或合法 ID');
  }
});
