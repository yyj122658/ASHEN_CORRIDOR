'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

test('21 位固定来客可逐一招募，身份不重复，满员后不收费刷新', () => {
  const V = loadVeteran().Veteran;
  assert.equal(V.Data.SKINS.length, 21);
  assert.equal(new Set(V.Data.SKINS.map((s) => s.name)).size, 21);
  let st = V.State.create(42);
  st.gold = 100000;
  while (st.roster.length < 21) {
    const refreshed = V.Roster.refreshShop(st, false);
    assert.ok(refreshed.ok);
    st = refreshed.state;
    assert.ok(st.shop.length > 0);
    assert.equal(new Set(st.shop.map((o) => o.skinId)).size, st.shop.length);
    for (const offer of st.shop) {
      const spec = V.Data.SKINS.find((s) => s.id === offer.skinId);
      assert.equal(offer.name, spec.name);
      assert.ok(!st.roster.some((u) => u.skinId === offer.skinId));
    }
    const r = V.Roster.recruit(st, st.shop[0].id);
    assert.ok(r.ok, JSON.stringify(r.error));
    st = r.state;
    assert.ok(V.State.validate(st).ok);
  }
  assert.equal(new Set(st.roster.map((u) => u.skinId)).size, 21);
  const full = V.Roster.refreshShop(st, true);
  assert.equal(full.ok, false);
  assert.equal(full.state.gold, st.gold);
});

test('80 套蚀刻法有可落下的连通拓片和可执行招式', () => {
  const V = loadVeteran().Veteran;
  const specs = Object.values(V.Data.MANUSCRIPTS);
  assert.ok(specs.length >= 80);
  assert.equal(new Set(specs.map((m) => m.name)).size, specs.length);
  const base = V.State.create(42);
  for (const spec of specs) {
    const norm = V.Manuscript.normalize(spec);
    assert.ok(norm.cells.length > 0, spec.id);
    const cells = new Set(norm.cells.map(String));
    assert.equal(cells.size, norm.cells.length, spec.id);
    const reached = new Set([String(norm.entry)]);
    for (const key of reached) {
      const [x, y] = key.split(',').map(Number);
      for (const next of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (cells.has(String(next))) reached.add(String(next));
      }
    }
    assert.equal(reached.size, cells.size, spec.id);
    assert.ok([norm.entry, ...norm.exits, ...Object.values(norm.io).map((p) => p.cell)].every((c) => cells.has(String(c))), spec.id);
    assert.ok(Object.keys(norm.veins).every((k) => cells.has(k)), spec.id);
    const fitSeed = Array.from({ length: 200 }, (_, i) => i + 1).find((plateSeed) => V.Manuscript.placements(norm, V.Circuit.plateOf({ ...base.roster[0], plateSeed }).cellsList).length);
    assert.ok(fitSeed, spec.id);
    assert.ok(spec.skills.every((sk) => sk.cost > 0 && sk.cooldown > 0), spec.id);
    assert.ok(spec.skills.every((sk) => !sk.effect.shield || sk.effect.shield <= V.Data.DESIGN.supportShieldCapPct), `${spec.id} 护盾描述超过实际可获得上限`);
    assert.ok(spec.unlockDepth >= 3 && spec.unlockDepth <= 7, spec.id);
    let st = V.State.clone(base);
    st.roster.forEach((u) => {
      u.board.placements.forEach((p) => st.stash.push(p.itemId));
      u.board.placements = [];
      u.bodyPreset = 'sturdy';
      u.plateSeed = fitSeed;
      V.State.equipPreset(st, u, 'basic');
      V.State.equipManuscript(st, u, spec.id);
      assert.equal(u.manuscript.id, spec.id);
    });
    st = V.Expedition.start(st, { seed: 42 }).state;
    const generated = V.Combat.generateEncounter(st, 'normal');
    st = V.Combat.create(generated.state, generated.enemyBlueprint, generated.combatRngStart).state;
    st.run.battle.allies.forEach((u) => {
      u.energy = u.energyMax;
      u.atkSinceSkill = 10;
      u.hp = Math.round(u.maxHp * 0.4);
      if (u.ms) u.ms.routed = true;
    });
    st.run.battle.enemies.forEach((u) => { u.maxHp = 5000; u.hp = 1500; });
    for (let i = 0; !st.run.battle.over && i < 4201; i++) st = V.Combat.step(st).state;
    assert.ok(st.run.battle.over, spec.id);
    assert.ok(V.State.validate(st).ok, spec.id);
    if (spec.skills.length) assert.ok(st.run.battle.allies.some((u) => u.stats.skills > 0), `${spec.id} 未施展招式`);
  }
});

test('旧档重复角色保留资产，仍可收齐21种身份', () => {
  const V = loadVeteran().Veteran;
  let st = V.State.create(42);
  const duplicate = V.State.makeUnit(st, { name: '旧档铁鸦', skinId: 'blade', bodyPreset: 'sturdy' });
  V.State.equipPreset(st, duplicate, 'basic');
  st.roster.push(duplicate);
  st.gold = 100000;
  while (new Set(st.roster.map((u) => u.skinId)).size < 21) {
    const refreshed = V.Roster.refreshShop(st, false);
    assert.ok(refreshed.ok);
    const recruited = V.Roster.recruit(refreshed.state, refreshed.state.shop[0].id);
    assert.ok(recruited.ok);
    st = recruited.state;
  }
  assert.equal(st.roster.length, 22);
  assert.ok(st.roster.some((u) => u.id === duplicate.id));
  assert.ok(V.State.validate(st).ok);
});

test('九种新增拼接轮廓用两件真实纹路可以满覆盖并贯通', () => {
  const V = loadVeteran().Veteran;
  const st = V.State.create(46);
  const layouts = [
    ['chalkLine', 'straight', 'straight', 0, 0],
    ['oarlock', 'elbow', 'straight', 0, 1],
    ['pikeHead', 'straight', 'elbow', 0, 0],
    ['millStone', 'elbow', 'elbow', 0, 1],
    ['capstan', 'capacitor', 'straight', 0, 0],
    ['sump', 'straight', 'capacitor', 0, 0],
    ['copperWick', 'splitter', 'straight', 0, 0],
    ['soundingLine', 'splitter', 'straight', 0, 2],
    ['lodestone', 'elbow', 'splitter', 0, 0],
  ];
  for (const [id, first, second, y1, y2] of layouts) {
    const placements = [[first, 0, y1], [second, 2, y2]].map(([templateId, x, y]) => {
      const p = V.State.makePart(st, { templateId });
      st.itemsById[p.id] = p;
      return { itemId: p.id, x, y };
    });
    const pieces = V.Manuscript.pieceIndex(V.Circuit.layout(st, placements));
    const spec = V.Manuscript.normalize(V.Data.manuscript(id));
    assert.equal(V.Manuscript.coverage(spec, 0, 0, pieces).pct, 100, id);
    assert.ok(V.Manuscript.route(spec, 0, 0, pieces).ok, id);
    const incomplete = V.Manuscript.pieceIndex(V.Circuit.layout(st, placements.slice(0, 1)));
    assert.equal(V.Manuscript.route(spec, 0, 0, incomplete).ok, false, id);
  }
});

test('撤离谱墨斗与宝箱谱针眼能正常并装，轮流积攒和施展各自招式', () => {
  const V = loadVeteran().Veteran;
  let st = V.State.create(42);
  const unit = st.roster[0];
  V.State.removeManuscript(st, unit, unit.manuscript.id);
  for (const id of ['chalkLine', 'awlPoint']) {
    st.manuscriptVault.push(V.State.clone(V.Data.manuscript(id)));
    const r = V.State.placeManuscript(st, unit, id);
    assert.ok(r.ok, r.reason);
  }
  st = V.Storage.decode(V.Storage.encode(st)).state;
  st = V.Expedition.start(st, { seed: 42 }).state;
  const gen = V.Combat.generateEncounter(st, 'normal');
  st = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
  const b = st.run.battle;
  const actor = b.allies[0];
  actor.hits = 1;
  actor.energy = actor.energyMax;
  for (const enemy of b.enemies) { enemy.dodge = 0; enemy.hp = enemy.maxHp = 5000; }
  for (const u of [...b.allies.slice(1), ...b.enemies]) u.atkTimer = -1000;
  for (let i = 0; i < 90; i++) st = V.Combat.step(st).state;
  const hits = st.run.battle.logs.filter(e => e.actorId === actor.id && ['hit', 'crit'].includes(e.type));
  for (const name of ['弹线', '穿眼']) assert.ok(hits.some(e => e.text.includes(name)), name);
  assert.equal(new Set(hits.filter(e => e.text.includes('弹线')).map(e => e.targetId)).size, 2);
});

test('宝箱与精英各有十七门专属谱，并能在对应节点出现的层数搜获', () => {
  const V = loadVeteran().Veteran;
  const field = Object.values(V.Data.MANUSCRIPTS).filter((m) => m.fieldSource);
  const skillIds = field.map((m) => m.skills[0].id);
  assert.equal(field.length, 34);
  assert.equal(new Set(skillIds).size, field.length);
  for (const [source, first, last] of [['chest', 1, 7], ['elite', 3, 6]]) {
    const levels = field.filter((m) => m.fieldSource === source).map((m) => m.fieldDepth);
    assert.equal(levels.length, 17);
    assert.equal(Math.min(...levels), first);
    assert.ok(levels.every((n) => Number.isInteger(n) && n <= last));
    assert.ok(Math.max(...levels) >= 6);
    const collected = new Set();
    const campaign = V.State.create(42);
    for (let seed = 1; seed <= 500 && collected.size < levels.length; seed++) {
      const trip = V.Expedition.start(campaign, { seed }).state;
      trip.run.floor = last;
      V.Expedition.findFieldManuscript(trip, source);
      const id = trip.run.fieldManuscript;
      if (!id) continue;
      assert.equal(V.Data.manuscript(id).fieldSource, source);
      assert.ok(!collected.has(id), id);
      collected.add(id);
      campaign.manuscriptVault.push(V.State.clone(V.Data.manuscript(id)));
    }
    assert.equal(collected.size, levels.length, source);
  }
  const st = V.State.create(42);
  for (const [id, templateId] of [['silverTap', 'elbow'], ['coreDrill', 'capacitor']]) {
    const spec = V.Data.manuscript(id);
    const part = V.State.makePart(st, { templateId });
    st.itemsById[part.id] = part;
    const layout = V.Circuit.layout(st, [{ itemId: part.id, x: 0, y: 0 }]);
    assert.ok(V.Manuscript.route(V.Manuscript.normalize(spec), 0, 0, V.Manuscript.pieceIndex(layout)).ok, spec.name);
  }
});

test('多次撤离可补齐46门蚀刻法，现场专属谱不占结算名额', () => {
  const V = loadVeteran().Veteran;
  let st = V.State.create(42);
  const unit = st.roster.find((u) => u.manuscript.id === 'spark');
  const placement = V.State.placeManuscript(st, unit, 'rivet');
  assert.ok(placement.ok, placement.reason);
  assert.equal(unit.extraManuscripts[0].id, 'rivet');
  const seen = new Set([...st.roster.flatMap(V.State.manuscriptsOf), ...st.manuscriptVault].map((m) => m.id));
  const catalogSize = Object.values(V.Data.MANUSCRIPTS).filter((m) => !m.fieldSource).length;
  assert.equal(catalogSize, 46);
  for (let i = 0; i < catalogSize; i++) {
    st = V.Expedition.start(st, { seed: 42 + i }).state;
    st.run.floor = 44;
    st.run.completedFloors = 43;
    st.run.finishedFloors = Array.from({length:43},(_,i)=>i+1);
    const r = V.Expedition.extract(st);
    assert.ok(r.ok);
    st = r.state;
    assert.ok(!V.Data.manuscript(st.settlement.manuscript.id).fieldSource);
    if (seen.size < catalogSize) assert.ok(!seen.has(st.settlement.manuscript.id), st.settlement.manuscript.id);
    seen.add(st.settlement.manuscript.id);
  }
  assert.equal(seen.size, catalogSize);
  const firstCopy = V.Data.manuscriptReward(st, 7);
  st.manuscriptVault.push(firstCopy);
  assert.notEqual(V.Data.manuscriptReward(st, 7).id, firstCopy.id, '收齐后优先给其他角色补稀缺副本');
});
