'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun } = require('../helpers/veteran-run.cjs');

function part(V, st, templateId, owner = 'bag') {
  const item = V.State.makePart(st, { templateId, acquiredRunId: st.run.id, acquiredSeq: st.run.bag.length + 1 });
  st.itemsById[item.id] = item;
  st.run[owner].push(item.id);
  return item.id;
}

test('每种纹路保留实际轮廓；120种食材有明确形状、分堆上限与同族规格', () => {
  const { A, V, st } = boot();
  const E = V.Expedition;
  const s = startRun(A, st);
  const food = Object.values(V.Kitchen.INGREDIENTS);
  const types = new Set();
  for (const item of food) {
    const spec = E.foodPack(item.id);
    assert.ok(Number.isInteger(spec.limit) && spec.limit > 1);
    assert.deepEqual(E.packShape(s, 'food:' + item.id + '#1'), spec.cells);
    if (item.family) assert.deepEqual(E.foodPack(item.family), spec);
    types.add(JSON.stringify(spec.cells));
  }
  assert.ok(types.size >= 5);
  assert.equal(E.foodPack('toString'), null);
  for (const tpl of Object.values(V.Data.TEMPLATES)) {
    const id = part(V, s, tpl.id);
    const x = Math.min(...tpl.cells.map(p => p[0]));
    const y = Math.min(...tpl.cells.map(p => p[1]));
    assert.deepEqual(E.packShape(s, 'part:' + id), tpl.cells.map(p => [p[0] - x, p[1] - y]));
  }
});

test('碎空位不够放整件，替换会检查落点和真实归属，拒绝时价款与物品不变', () => {
  const { A, V, st } = boot();
  const E = V.Expedition;
  const s = startRun(A, st);
  for (let i = 0; i < 24; i++) {
    if ((i % 6 + Math.floor(i / 6)) % 2) s.run.packOrder[i] = 'part:' + part(V, s, 'rivet');
  }
  const id = part(V, s, 'straight', 'pendingLoot');
  const token = 'part:' + id;
  assert.equal(E.bagFree(s), 12);
  assert.equal(E.canPack(s, token), false);
  assert.equal(E.resolveLoot(s, id, 'take').state, s);
  const merchant = V.State.clone(s);
  merchant.run.pendingLoot = [];
  merchant.run.stage = 'merchant';
  merchant.run.shop = [{ id: 'offer', itemId: id, price: 5, sold: false }];
  merchant.gold = 100;
  assert.equal(E.buy(merchant, 'offer').state, merchant);
  assert.equal(merchant.gold, 100);
  const replaced = E.resolveLoot(s, id, 'replace:' + s.run.bag[0]);
  assert.ok(replaced.ok);
  assert.equal(replaced.state.itemsById[s.run.bag[0]], undefined);
  assert.equal(V.State.itemLocation(replaced.state, id).where, 'bag');
  assert.deepEqual(E.packSlots(replaced.state).slice(0, 2), [token, token]);
});

test('全形随拖动交换，不能越行或挤占第三件；补拾和读档沿用原位置', () => {
  const { A, V, st } = boot();
  const E = V.Expedition;
  let s = startRun(A, st);
  const token = 'part:' + part(V, s, 'elbow');
  s.run.ingredients = { boneCap: 2 };
  s.run.packOrder[15] = 'food:boneCap';
  s.run.stage = 'merchant';
  const moved = E.movePack(s, 0, 15);
  assert.ok(moved.ok);
  s = moved.state;
  assert.deepEqual(E.packSlots(s).flatMap((v, i) => v === token ? [i] : []), [15,16,22]);
  assert.equal(E.packSlots(s)[0], 'food:boneCap');
  assert.equal(E.movePack(s, 15, 5).state, s);
  const third = part(V, s, 'rivet');
  s.run.packOrder[10] = 'part:' + third;
  assert.equal(E.movePack(s, 15, 9).state, s);
  const saved = V.Storage.decode(V.Storage.encode(s));
  assert.ok(saved.ok, JSON.stringify(saved.errors));
  assert.deepEqual(E.packSlots(saved.state), E.packSlots(s));
  s.run.stage = 'loot';
  s.run.ingredientLoot = { boneCap: 1 };
  const picked = E.takeIngredient(s, 'boneCap').state;
  assert.equal(E.stackCount(picked, 'food:boneCap'), 3);
  assert.deepEqual(E.packSlots(picked), E.packSlots(s));
});

test('同种食材分堆独立扣除和补量，空堆重新获得时占用第一个可放位置', () => {
  const { A, V, st } = boot();
  const E = V.Expedition;
  let s = startRun(A, st);
  s.run.stage = 'loot';
  s.run.ingredients = { boneCap: 5 };
  s.run.ingredientLoot = { boneCap: 2 };
  const base = 'food:boneCap', extra = base + '#1';
  s = E.movePack(s, 1, 20).state;
  s = E.discardPack(s, base, 0).state;
  assert.equal(E.stackCount(s, base), 3);
  assert.equal(E.stackCount(s, extra), 1);
  s = E.discardPack(s, extra, 20).state;
  assert.equal(E.packSlots(s)[20], null);
  s = E.takeIngredient(s, 'boneCap').state;
  s = E.takeIngredient(s, 'boneCap').state;
  assert.equal(E.stackCount(s, base), 4);
  assert.equal(E.stackCount(s, extra), 1);
  assert.equal(E.packSlots(s)[1], extra);
  assert.equal(E.packSlots(s)[20], null);
});

test('旧档几何超限完整保管，可丢弃、撤离和撤退；新档拒绝坏堆号与巨量食材', () => {
  const { A, V, st } = boot();
  const E = V.Expedition;
  const s = startRun(A, st);
  delete s.run.packOrder;
  const foods = Object.keys(V.Kitchen.INGREDIENTS).filter(id => E.foodPack(id).cells.length >= 3).slice(0, 12);
  s.run.ingredients = Object.fromEntries(foods.map(id => [id, 1]));
  const asset = part(V, s, 'elbow');
  const saved = V.Storage.decode(V.Storage.encode(s));
  assert.ok(saved.ok, JSON.stringify(saved.errors));
  const overflow = E.packOverflow(saved.state);
  assert.ok(overflow.length);
  assert.equal(new Set([...E.packSlots(saved.state).filter(Boolean), ...overflow]).size, foods.length + 1);
  assert.equal(E.canPack(saved.state, 'food:boneCap'), E.packSlots(saved.state).includes(null));
  const removed = E.discardPack(saved.state, overflow[0]);
  assert.ok(removed.ok);
  assert.equal(E.stackCount(removed.state, overflow[0]), 0);
  assert.ok(V.Storage.decode(V.Storage.encode(removed.state)).ok);
  const extracted = E.extract(saved.state).state;
  assert.deepEqual(extracted.settlement.ingredients, s.run.ingredients);
  assert.equal(extracted.stash.filter(id => id === asset).length, 1);
  assert.equal(E.extract(extracted).ok, false);
  const retreat = E.retreat(saved.state, 'emergency').state;
  assert.equal(Object.values(retreat.settlement.ingredients).reduce((n,v) => n+v, 0), Math.ceil(foods.length / 2));
  assert.deepEqual(E.retreat(saved.state, 'defeat').state.settlement.ingredients, {});
  for (const patch of [
    { ingredients: { boneCap: Number.MAX_SAFE_INTEGER } },
    { packStacks: { 'food:boneCap#0': 1 } }, { packStacks: { 'food:boneCap': 100 } },
    { packOrder: Array(24).fill('food:boneCap#-1') }, { packOrder: Array(23).fill(null) },
  ]) assert.equal(V.State.validate({ ...s, run: { ...s.run, ...patch } }).ok, false);
});

test('仓库改装、旧库存待上架与非法移动保持物资数量', () => {
  const {V,st} = boot(), E = V.Expedition;
  st.pantry = {lampKelp:120,houndShank:2,shellLichen:3,mistJelly:2};
  const stored = E.storeLayout(st,'food');
  assert.equal(stored.slots.length,24);
  assert.ok(stored.overflow.length);
  assert.equal([...stored.entries].reduce((n,[key,item])=>n+(key.startsWith('food:lampKelp')?item.count:0),0),120);
  const token = stored.slots.find(key=>key?.startsWith('food:lampKelp'));
  assert.equal(E.arrangeStore(st,'food',token,23).ok,false);
  const rack = E.upgradePack(st,'rack');
  assert.ok(rack.ok);
  assert.equal(E.storeLayout(rack.state,'food').slots.length,36);
  assert.equal(rack.state.pantry.lampKelp,117);
  const bins = E.upgradePack(rack.state,'bins');
  assert.ok(bins.ok);
  assert.equal(E.storeLayout(bins.state,'food').entries.get('food:lampKelp').count,6);
  assert.equal(E.upgradePack(bins.state,'bins').ok,false);
  const parsed = V.Storage.decode(V.Storage.encode(bins.state));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.state.pantry,bins.state.pantry);
});
