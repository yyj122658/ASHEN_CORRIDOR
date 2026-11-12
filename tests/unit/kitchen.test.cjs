'use strict';
const {fullTeam} = require('../helpers/veteran-run.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

test('120种可获取食材各自都能做菜，77道不同配方可实际制作', () => {
  const V = loadVeteran().Veteran;
  const K = V.Kitchen;
  const forage = [1, 2, 3, 4, 5, 6, 7].map((floor) => K.biome(floor).forage);
  assert.deepEqual(forage, ['lampKelp', 'lampKelp', 'sulfurLeaf', 'sulfurLeaf', 'heatBulb', 'heatBulb', 'heatBulb']);
  const enemies = Object.keys(V.Data.ENEMIES);
  assert.deepEqual(Object.keys(K.ECOSYSTEM).sort(), enemies.sort());
  const obtainable = new Set([1, 3, 5].flatMap(floor => K.forageOptions(floor)).concat(enemies.flatMap(id => K.harvestOptions(id))));
  assert.equal(obtainable.size, 120);
  assert.deepEqual([...obtainable].sort(), Object.keys(K.INGREDIENTS).sort());
  const recipes = Object.values(K.RECIPES);
  assert.equal(recipes.length, 77);
  assert.equal(new Set(recipes.map(r => r.name)).size, recipes.length);
  assert.equal(new Set(recipes.map(r => r.method)).size, recipes.length);
  assert.equal(new Set(recipes.map(r => JSON.stringify(Object.entries(r.needs).sort()))).size, recipes.length);
  const st = V.State.create(43);
  V.State.unitById(st, st.team[0]).stress = 100;
  for (const id of obtainable) {
    assert.ok(recipes.some((r) => K.canCook({ ...st, pantry: { [id]: 1 } }, r.id)), id);
  }
  for (const r of recipes) {
    assert.ok(r.heal >= 0 && r.heal <= 1 && Number.isInteger(r.calm) && r.calm >= 0 && r.method);
    for (const [id, qty] of Object.entries(r.needs)) assert.ok(obtainable.has(id) && Number.isSafeInteger(qty) && qty > 0);
    const cooked = K.cook({ ...st, pantry: r.needs }, r.id);
    assert.ok(cooked.ok, r.id);
    assert.deepEqual({ ...cooked.state.pantry }, {});
    assert.equal(cooked.state.packedMeals[r.id], 1);
  }
});

test('整张配方先留精确材料，再以同类补足余量，每份原料只扣一次', () => {
  const V = loadVeteran().Veteran;
  const K = V.Kitchen;
  const dish = K.RECIPES.doubleMarrow;
  assert.equal(K.acceptsIngredient('houndMarrow', 'hipMarrow'), true);
  assert.equal(K.acceptsIngredient('glassWeed', 'ribbonWeed'), true);
  assert.equal(K.acceptsIngredient('houndMarrow', 'kelpBroth'), false);
  assert.equal(K.acceptsIngredient('toString', 'toString'), false);
  const short = { hipMarrow: 1, ridgeHazel: 1 };
  assert.equal(K.planIngredients(short, dish), null);
  const stocked = { hipMarrow: 1, shinCream: 1, spineFat: 1, cragAcorn: 1 };
  assert.deepEqual({ ...K.planIngredients(stocked, dish) }, { hipMarrow: 1, shinCream: 1, cragAcorn: 1 });
  assert.deepEqual({ ...K.planIngredients({ ...stocked, houndMarrow: 1, ridgeHazel: 1 }, dish) }, { houndMarrow: 1, hipMarrow: 1, ridgeHazel: 1 });
  assert.equal(K.planIngredients({ fogVeil: 1, dewPearl: 1 }, K.RECIPES.wraithParcel), null);
  assert.deepEqual({ ...K.planIngredients({ mistFilm: 1, rainBead: 1, lanternDew: 1 }, K.RECIPES.wraithParcel) },
    { mistFilm: 1, rainBead: 1, lanternDew: 1 });
  const st = V.State.create(42);
  V.State.unitById(st, st.team[0]).stress = 15;
  st.pantry = stocked;
  assert.deepEqual({ ...K.cook(st, dish.id).state.pantry }, { spineFat: 1 });
  assert.deepEqual(st.pantry, stocked);
});

test('营火制作不改变任何人的生命与压力，选定存活队员进食后只作用于该人', () => {
  const V = loadVeteran().Veteran;
  const st = V.Expedition.start(fullTeam(V, V.State.create(41)), { seed: 42 }).state;
  st.run.stage = 'camp';
  st.run.ingredients = { lampKelp: 2, boneCap: 1 };
  st.pantry = { lampKelp: 3 };
  const [hurt, fallen, other] = st.run.party;
  const max = V.Roster.stats(st, V.State.unitById(st, hurt.uid)).maxHp;
  Object.assign(hurt, { hp: max - 1, stress: 3 });
  Object.assign(fallen, { hp: 0, stress: 18 });
  Object.assign(other, { hp: null, stress: 18 });
  const cooked = V.Kitchen.cook(st, 'reedStew');
  assert.ok(cooked.ok);
  assert.equal(JSON.stringify(cooked.state.run.party), JSON.stringify(st.run.party));
  assert.equal(cooked.state.run.meals.reedStew, 1);
  assert.deepEqual({ ...cooked.state.run.ingredients }, { lampKelp: 1 });
  assert.deepEqual(st.run.ingredients, { lampKelp: 2, boneCap: 1 });
  assert.deepEqual(cooked.state.pantry, st.pantry);
  assert.equal(cooked.state.cookedRecipes.reedStew, 1);
  assert.equal(V.Kitchen.cook(cooked.state, 'reedStew').error.code, 'missing_ingredients');
  assert.equal(V.Kitchen.eat(cooked.state, 'reedStew', fallen.uid).state, cooked.state);
  const meal = V.Kitchen.eat(cooked.state, 'reedStew', hurt.uid);
  assert.ok(meal.ok);
  assert.equal(meal.state.run.party[0].hp, max);
  assert.equal(meal.state.run.party[0].stress, 0);
  assert.equal(V.State.unitById(meal.state, hurt.uid).stress, 0);
  assert.equal(JSON.stringify(meal.state.run.party.slice(1)), JSON.stringify(st.run.party.slice(1)));
  assert.equal(meal.state.run.meals.reedStew, undefined);
  assert.equal(V.Kitchen.eat(meal.state, 'reedStew', other.uid).ok, false);
});

test('前哨随时能备餐；目标无收益、战斗中或没有对应菜品时均不消耗', () => {
  const V = loadVeteran().Veteran, K = V.Kitchen;
  let st = V.State.create(42);
  st.pantry = { lampKelp: 2 };
  assert.equal(K.canCook(st, 'kelpBroth'), true);
  st = K.cook(st, 'kelpBroth').state;
  const uid = st.team[0], bench = st.team[1];
  st.team[1] = null;
  assert.equal(K.eat(st, 'kelpBroth', uid).error.code, 'no_effect');
  V.State.unitById(st, bench).stress = 15;
  st = K.eat(st, 'kelpBroth', bench).state;
  assert.equal(V.State.unitById(st, bench).stress, 7);
  assert.equal(V.State.unitById(st, uid).stress, 0);
  st = K.cook(st, 'kelpBroth').state;
  assert.equal(st.cookedRecipes.kelpBroth, 2);
  assert.deepEqual({ ...st.pantry }, {});
  assert.equal(K.cook(st, '__proto__').error.code, 'unknown_recipe');
  const field = V.Expedition.start(st, { seed: 2 }).state;
  field.run.ingredients = { lampKelp: 1 };
  field.run.party[0].hp = 1;
  assert.equal(K.canCook(field, 'kelpBroth'), false);
  assert.equal(K.cook(field, 'kelpBroth').error.code, 'bad_stage');
  for (const stage of ['map', 'loot', 'camp', 'merchant', 'prebattle', 'battle', 'battleReview', 'event', 'blessing']) {
    field.run.stage = stage;
    const allowed = ['map', 'loot', 'camp', 'merchant'].includes(stage);
    assert.equal(K.canEat(field, 'kelpBroth', uid), allowed);
    const result = K.eat(field, 'kelpBroth', uid);
    assert.equal(result.ok, allowed);
    if (!allowed) assert.equal(result.state, field);
  }
  assert.equal(K.eat(field, 'kelpBroth', bench).ok, false);
});

test('前哨成菜逐份入仓、装包、分堆手排、出征与回营，指定菜堆扣量', () => {
  const V = loadVeteran().Veteran, K = V.Kitchen, E = V.Expedition;
  let s = V.State.create(24);
  s.pantry = { lampKelp: 6 };
  const recipe = 'kelpBroth', base = 'meal:' + recipe, secondary = base + '#1';
  for (let i = 0; i < 6; i++) s = K.cook(s, recipe).state;
  assert.equal(E.bagUsed(s), 2);
  assert.equal(E.stackCount(s, secondary), 3);
  s = E.movePack(s, 1, 23).state;
  s = K.transferMeal(s, recipe, 'store', secondary).state;
  assert.equal(E.stackCount(s, secondary), 2);
  assert.equal(s.mealStore[recipe], 1);
  s = K.transferMeal(s, recipe, 'pack').state;
  assert.equal(E.stackCount(s, secondary), 3);
  assert.equal(s.mealStore[recipe], undefined);
  V.State.unitById(s, s.team[0]).stress = 50;
  s = K.eat(s, recipe, s.team[0], secondary).state;
  assert.equal(E.stackCount(s, secondary), 2);
  assert.equal(E.stackCount(s, base), 3);
  assert.equal(E.packSlots(s)[23], secondary);
  const wrong = K.eat(s, recipe, s.team[0], 'meal:reedStew');
  assert.equal(wrong.state, s);
  s = K.transferMeal(s, recipe, 'store', base).state;
  const stored = V.Storage.decode(V.Storage.encode(s));
  assert.ok(stored.ok);
  const trip = E.start(stored.state, { seed: 98 }).state;
  assert.equal(trip.run.meals[recipe], 4);
  assert.deepEqual({ ...trip.packedMeals }, {});
  assert.equal(trip.mealStore[recipe], 1);
  assert.equal(E.packSlots(trip)[23], secondary);
  assert.equal(K.transferMeal(trip, recipe, 'store').state, trip);
  assert.ok(V.Storage.decode(V.Storage.encode(trip)).ok);
  for (const [name, value] of [['extract',4], ['emergency',2], ['defeat',0]]) {
    const result = name === 'extract' ? E.extract(trip) : E.retreat(trip, name);
    assert.ok(result.ok);
    const back = result.state;
    assert.equal(back.packedMeals[recipe] || 0, value);
    assert.equal(back.settlement.meals[recipe] || 0, value);
    assert.equal(back.mealStore[recipe], 1);
    assert.ok(V.Storage.decode(V.Storage.encode(back)).ok);
    assert.equal(E.extract(back).ok, false);
    if (name === 'extract') assert.equal(E.packSlots(back)[23], secondary);
  }
});

test('成菜容量按真实占格：扣料后才检查空间，失败不花料、不计次数、不扣库存', () => {
  const V = loadVeteran().Veteran, K = V.Kitchen, E = V.Expedition;
  const s = V.State.create(42);
  s.packedMeals = { reedStew: 72 };
  s.mealStore = { kelpBroth: 1 };
  s.pantry = { lampKelp: 2 };
  assert.equal(E.bagFree(s), 0);
  assert.equal(K.cook(s, 'kelpBroth').error.code, 'bag_full');
  assert.equal(K.transferMeal(s, 'kelpBroth', 'pack').state, s);
  assert.equal(s.pantry.lampKelp, 2);
  assert.deepEqual({ ...s.cookedRecipes }, {});
  const trip = E.start(V.State.create(43)).state;
  trip.run.stage = 'camp';
  trip.run.meals = { reedStew: 66 };
  trip.run.ingredients = { lampKelp: 4 };
  assert.equal(E.bagFree(trip), 0);
  assert.equal(K.cook(trip, 'kelpBroth').state, trip);
  trip.run.ingredients.lampKelp = 1;
  assert.equal(E.bagFree(trip), 0);
  const cooked = K.cook(trip, 'kelpBroth');
  assert.ok(cooked.ok);
  assert.equal(cooked.state.run.meals.kelpBroth, 1);
  assert.equal(E.bagFree(cooked.state), 1);
  assert.ok(V.State.validate(cooked.state).ok);
  for (const patch of [{ packedMeals:{kelpBroth:73} }, { mealStore:{unknown:1} },
    { packedMeals:{kelpBroth:-1} }, { packStacks:{'meal:kelpBroth':4} }, { packedMeals:{kelpBroth:Number.MAX_SAFE_INTEGER} }]) {
    assert.equal(V.State.validate({ ...s, ...patch }).ok, false);
  }
  assert.equal(V.State.validate({ ...trip, packedMeals:{kelpBroth:1} }).ok, false);
  const old = V.State.create(21);
  delete old.packedMeals;
  delete old.mealStore;
  old.cookedRecipes = { reedStew: 4 };
  const restored = V.Storage.decode(V.Storage.encode(old));
  assert.ok(restored.ok);
  assert.equal(E.bagUsed(restored.state), 0);
  assert.deepEqual({ ...E.start(restored.state).state.run.meals }, {});
});
