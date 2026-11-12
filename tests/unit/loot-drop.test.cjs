'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

function fixture() {
  const V = loadVeteran().Veteran, E = V.Expedition;
  const st = E.start(V.State.create(42), { seed: 42 }).state;
  st.run.stage = 'loot';
  const part = V.State.makePart(st, { kind: 'circuit', templateId: 'crook', acquiredRunId: st.run.id });
  st.itemsById[part.id] = part;
  st.run.pendingLoot = [part.id];
  st.run.ingredientLoot = { boneCap: 4 };
  return { V, E, st, token: 'part:' + part.id };
}

test('地面纹路只落在指向的完整几何空位，越界失败不吞掉奖励', () => {
  const { V, E, st, token } = fixture();
  assert.equal(typeof E.previewLootDrop, 'function');
  const before = JSON.stringify(st);
  assert.equal(E.previewLootDrop(st, token, 5).ok, false);
  assert.equal(E.takeLootAt(st, token, 5).ok, false);
  assert.equal(JSON.stringify(st), before);
  const result = E.takeLootAt(st, token, 8);
  assert.ok(result.ok);
  assert.deepEqual(Array.from(E.packSlots(result.state).flatMap((t, i) => t === token ? [i] : [])), [8,14,20,21]);
  assert.equal(result.state.run.pendingLoot.length, 0);
  assert.ok(V.Storage.decode(V.Storage.encode(result.state)).ok);
  assert.equal(E.takeLootAt(result.state, token, 1).ok, false);
});

test('食材拖入指定堆按余量补满，空格另起整堆，满堆不偷偷转移', () => {
  const { V, E, st } = fixture();
  assert.equal(typeof E.takeLootAt, 'function');
  st.run.ingredients = { boneCap: 3 };
  let result = E.takeLootAt(st, 'food:boneCap', 0);
  assert.ok(result.ok);
  assert.equal(E.stackCount(result.state, 'food:boneCap'), 4);
  assert.equal(result.state.run.ingredientLoot.boneCap, 3);
  const full = result.state;
  assert.equal(E.takeLootAt(full, 'food:boneCap', 0).ok, false);
  result = E.takeLootAt(full, 'food:boneCap', 5);
  assert.ok(result.ok);
  assert.equal(E.packSlots(result.state)[5], 'food:boneCap#1');
  assert.equal(E.stackCount(result.state, 'food:boneCap#1'), 3);
  assert.equal(E.stackCount(result.state, 'food:boneCap'), 4);
  assert.equal(result.state.run.ingredients.boneCap, 7);
  assert.ok(V.Storage.decode(V.Storage.encode(result.state)).ok);
});

test('拖入拒绝非地面物件、被占落点与非搜刮阶段', () => {
  const { E, st, token } = fixture();
  assert.equal(typeof E.takeLootAt, 'function');
  st.run.ingredients = { boneCap: 1 };
  assert.equal(E.takeLootAt(st, token, 0).ok, false);
  assert.equal(E.takeLootAt(st, 'food:mistJelly', 1).ok, false);
  assert.equal(E.takeLootAt(st, 'meal:roastCap', 1).ok, false);
  for (const to of [-1, 24, 1.5, NaN]) assert.equal(E.takeLootAt(st, token, to).ok, false);
  st.run.stage = 'camp';
  assert.equal(E.takeLootAt(st, token, 1).ok, false);
});

test('纹路放回现场保留实例，再拾回时沿用原件，离场只清地上遗留物', () => {
  const { V, E, st, token } = fixture();
  const id = token.slice(5);
  const picked = E.takeLootAt(st, token, 0).state;
  const placed = E.putOnGround(picked, token);
  assert.ok(placed.ok);
  assert.equal(placed.token, token);
  assert.equal(placed.count, 1);
  assert.equal(V.State.itemLocation(placed.state, id).where, 'pending');
  assert.deepEqual(placed.state.itemsById[id], picked.itemsById[id]);
  assert.equal(E.putOnGround(placed.state, token).state, placed.state);
  const restored = V.Storage.decode(V.Storage.encode(placed.state));
  assert.ok(restored.ok);
  const retaken = E.takeLootAt(restored.state, token, 1);
  assert.ok(retaken.ok);
  assert.equal(V.State.itemLocation(retaken.state,id).where, 'bag');
  assert.equal(E.takeLootAt(retaken.state, token, 1).ok, false);
  placed.state.run.groundPositions = { [token]: 3 };
  placed.state.run.groundKnown = { [token]: true };
  const left = E.finishNode(placed.state, true).state;
  assert.equal(left.itemsById[id], undefined);
  assert.equal(left.run.groundPositions, undefined);
  assert.equal(left.run.groundKnown, undefined);
  const retreat = E.retreat(placed.state,'emergency').state;
  assert.equal(retreat.itemsById[id], undefined);
  assert.equal(E.putOnGround(left, token).ok, false);
});

test('整堆原料与成菜可以放回并合并，点击每次一份，拖动只拿目标能装的数量', () => {
  const { V, E, st } = fixture();
  st.run.ingredients = { boneCap: 6 };
  st.run.meals = { kelpBroth: 5 };
  st.run.mealLoot = { kelpBroth: 4 };
  const food = E.putOnGround(st, 'food:boneCap#1');
  assert.equal(food.token, 'food:boneCap');
  assert.equal(food.count, 2);
  assert.equal(food.state.run.ingredientLoot.boneCap, 6);
  assert.equal(food.state.run.ingredients.boneCap, 4);
  const meal = E.putOnGround(food.state, 'meal:kelpBroth');
  assert.equal(meal.count, 3);
  assert.equal(meal.state.run.mealLoot.kelpBroth, 7);
  assert.equal(meal.state.run.meals.kelpBroth, 2);
  const remain = 'meal:kelpBroth#1';
  const cell = E.packSlots(meal.state).indexOf(remain);
  const topping = E.takeLootAt(meal.state, 'meal:kelpBroth', cell);
  assert.equal(topping.count, 1);
  assert.equal(E.stackCount(topping.state, remain), 3);
  const single = E.takeMeal(topping.state, 'kelpBroth');
  assert.equal(single.count, 1);
  assert.equal(single.state.run.mealLoot.kelpBroth, 5);
  const landing = E.packSlots(single.state).lastIndexOf(null);
  const bulk = E.takeLootAt(single.state, 'meal:kelpBroth', landing);
  assert.equal(bulk.count, 3);
  assert.equal(bulk.state.run.mealLoot.kelpBroth, 2);
  assert.equal(bulk.state.run.meals.kelpBroth, 7);
  assert.ok(V.Storage.decode(V.Storage.encode(bulk.state)).ok);
  const leaving = E.finishNode(bulk.state, true).state;
  assert.equal(E.takeMeal(leaving, 'kelpBroth').ok, false);
  assert.deepEqual({ ...leaving.run.mealLoot }, {});
  assert.equal(E.extract(leaving).state.packedMeals.kelpBroth, 7);
  assert.equal(E.retreat(meal.state, 'emergency').state.packedMeals.kelpBroth, 1);
  assert.equal(V.State.validate({ ...leaving, run: { ...leaving.run, mealLoot:{kelpBroth:1} } }).ok, false);
});

test('旧档待整理不会封锁可用空位；未放稳的堆不能吸收新份数，取放与跨档归属唯一', () => {
  const { V, E, st } = fixture();
  const bulky = Object.keys(V.Kitchen.INGREDIENTS).filter(id => E.foodPack(id).cells.length >= 3).slice(0, 12);
  st.run.ingredients = Object.fromEntries(bulky.map(id => [id, 1]));
  for (let i = 0; i < 24; i++) {
    if ((i % 6 + Math.floor(i / 6)) % 2 === 0) continue;
    const part = V.State.makePart(st, {templateId:'rivet', acquiredRunId:st.run.id});
    st.itemsById[part.id] = part;
    st.run.bag.push(part.id);
    st.run.packOrder[i] = 'part:' + part.id;
  }
  const old = V.Storage.decode(V.Storage.encode(st)).state;
  assert.equal(E.packOverflow(old).length, 12);
  assert.equal(E.canPack(old,'food:' + bulky[0]), false);
  assert.equal(E.canPack(old, 'food:boneCap'), true);
  assert.equal(E.previewLootDrop(old, 'food:boneCap', 0).count, 4);
  const picked = E.takeLootAt(old, 'food:boneCap', 0).state;
  assert.equal(E.packSlots(picked)[0], 'food:boneCap');
  assert.equal(E.stackCount(picked,'food:boneCap'), 4);
  assert.deepEqual(Array.from(E.packOverflow(picked)), Array.from(E.packOverflow(old)));
  const restored = V.Storage.decode(V.Storage.encode(picked));
  assert.ok(restored.ok, JSON.stringify(restored.errors));
  const denied = V.State.clone(picked);
  delete denied.run.packReserve;
  assert.equal(V.State.validate(denied).ok, false);
  const placed = E.putOnGround(restored.state, 'food:' + bulky[0]);
  assert.ok(placed.ok);
  assert.equal(placed.state.run.ingredients[bulky[0]], undefined);
  assert.equal(placed.state.run.ingredientLoot[bulky[0]], 1);
  assert.equal(E.packOverflow(placed.state).length, 11);
  assert.ok(V.Storage.decode(V.Storage.encode(placed.state)).ok);
});

test('异形件旋转后按新轮廓拾取，越界拒绝且旋转四次还原', () => {
  const {V,E,st,token} = fixture();
  const shape = E.packShape(st,token);
  assert.deepEqual(E.packShape(st,token,4),shape);
  const first = E.takeLootAt(st,token,6,undefined,1);
  assert.ok(first.ok);
  const pack = first.state;
  assert.equal(E.itemTurn(pack,token),1);
  assert.equal(E.turnPack(pack,token,23,2).state,pack);
  const ground = E.putOnGround(pack,token).state;
  assert.equal(E.itemTurn(ground,token,true),1);
  const back = E.resolveLoot(ground,token.slice(5),'take').state;
  assert.equal(E.itemTurn(back,token),1);
  assert.equal(E.packSlots(back).filter(t=>t === token).length,shape.length);
  assert.ok(V.Storage.decode(V.Storage.encode(back)).ok);
});

test('同种食材的背包堆与地面堆可以各自保留方向', () => {
  const {E,st} = fixture(), token = 'food:lampKelp';
  st.run.ingredientLoot.lampKelp = 8;
  const a = E.takeLootAt(st,token,0,undefined,1);
  const b = E.takeLootAt(a.state,token,3,undefined,0);
  assert.ok(a.ok && b.ok);
  assert.equal(E.itemTurn(b.state,token),1);
  assert.equal(E.itemTurn(b.state,b.token),0);
  const down = E.putOnGround(b.state,b.token,3).state;
  assert.equal(E.itemTurn(down,token,true),3);
  assert.equal(E.itemTurn(down,token),1);
});
