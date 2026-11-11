'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('../helpers/load-game.cjs');

const A = loadGame();

function fakeItem(id, slot) {
  return { id, slot: slot || 'weapon', q: 1, ilvl: 3, base: '测试物品', prefix: '', stats: { atk: 5 }, locked: false, traitId: null };
}

test('create() 产生可校验状态', () => {
  const s = A.State.create();
  const v = A.State.validate(s);
  assert.deepEqual(v.errors, []);
  assert.ok(v.ok);
});

test('默认阵容可用：5 名角色、4 个上场槽位', () => {
  const s = A.State.create();
  assert.equal(s.roster.length, 5);
  assert.equal(s.team.length, 4);
  assert.ok(s.team.every((id) => id && s.roster.some((u) => u.id === id)));
});

test('初始两名剑士可用于升星与羁绊', () => {
  const s = A.State.create();
  const blades = s.roster.filter((u) => u.cls === 'blade');
  assert.equal(blades.length, 2);
  assert.equal(blades[0].star, 1);
  assert.equal(blades[1].star, 1);
});

test('拒绝重复的角色 ID', () => {
  const s = A.State.create();
  s.roster[1].id = s.roster[0].id;
  const v = A.State.validate(s);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes('角色 ID 重复')));
});

test('拒绝跨位置重复的物品归属', () => {
  const s = A.State.create();
  const it = fakeItem('it1');
  s.itemsById['it1'] = it;
  s.stash.push('it1');
  s.roster[0].equip.weapon = 'it1';
  const v = A.State.validate(s);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes('物品归属重复')));
});

test('拒绝引用不存在的装备', () => {
  const s = A.State.create();
  s.roster[0].equip.weapon = 'nope';
  const v = A.State.validate(s);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes('装备引用不存在')));
});

test('拒绝同一角色占两个槽位', () => {
  const s = A.State.create();
  s.team = [s.roster[0].id, s.roster[0].id, null, null];
  const v = A.State.validate(s);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes('占了多个槽位')));
});

test('允许稀疏队伍（空槽不前移）', () => {
  const s = A.State.create();
  s.team = [null, null, s.roster[0].id, null];
  const v = A.State.validate(s);
  assert.ok(v.ok, JSON.stringify(v.errors));
});

test('takeId 在同一 state 上连续生成不重复 ID', () => {
  const s = A.State.create();
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(A.State.takeId(s, 't'));
  assert.equal(ids.size, 50);
  assert.equal(s.nextId, 56);
});

test('clone 是深拷贝，改副本不影响原件', () => {
  const s = A.State.create();
  const c = A.State.clone(s);
  c.roster[0].star = 3;
  c.gold = 999;
  assert.equal(s.roster[0].star, 1);
  assert.equal(s.gold, 160);
});

test('物品归属查询能区分仓库/装备/背包', () => {
  const s = A.State.create();
  const a = fakeItem('a1', 'weapon');
  const b = fakeItem('b1', 'armor');
  s.itemsById['a1'] = a;
  s.itemsById['b1'] = b;
  s.stash.push('a1');
  s.roster[0].equip.armor = 'b1';
  assert.equal(A.State.itemLocation(s, 'a1'), 'stash');
  assert.equal(A.State.itemLocation(s, 'b1'), 'equip:' + s.roster[0].id + ':armor');
  assert.equal(A.State.itemLocation(s, 'zzz'), 'none');
});
