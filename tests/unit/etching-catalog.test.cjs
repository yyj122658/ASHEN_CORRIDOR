'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');
const { autoRouteBoard } = require('../helpers/veteran-run.cjs');

test('14 位固定来客可逐一招募，身份不重复，满员后不收费刷新', () => {
  const V = loadVeteran().Veteran;
  assert.equal(V.Data.SKINS.length, 14);
  assert.equal(new Set(V.Data.SKINS.map((s) => s.name)).size, 14);
  let st = V.State.create(42);
  st.gold = 100000;
  while (st.roster.length < 14) {
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
  assert.equal(new Set(st.roster.map((u) => u.skinId)).size, 14);
  const full = V.Roster.refreshShop(st, true);
  assert.equal(full.ok, false);
  assert.equal(full.state.gold, st.gold);
});

test('一门金属最多同时维持 4 门功法，超了拒绝并说明原因', () => {
  const V = loadVeteran().Veteran;
  const SLOTS = V.Data.DESIGN.manuscriptSlots;
  assert.equal(SLOTS, 4, '门数是 4：主修 1 + 辅修 3');
  const st = V.State.create(3);
  const u = st.roster[0];
  assert.equal(V.State.manuscriptsOf(u).length, 1, '开局自带一阶功法');

  /* 往仓库里补满可用的功法，保证失败一定来自门数而不是「没这门」 */
  for (const id of ['rivet', 'ward', 'needle', 'spark', 'flurry']) {
    st.manuscriptVault.push({ ...V.Data.manuscript(id) });
  }
  for (const id of ['rivet', 'ward', 'needle']) {
    const r = V.State.placeManuscript(st, u, id);
    assert.equal(r.ok, true, `${id} 应该装得下：${r.reason || ''}`);
  }
  assert.equal(V.State.manuscriptsOf(u).length, SLOTS);

  const back = V.State.placeManuscript(st, u, 'flurry');
  assert.equal(back.ok, false, '第五门必须被拒绝');
  assert.ok(/4 门蚀刻法/.test(back.reason), `原因要讲清门数：${back.reason}`);
  assert.equal(V.State.manuscriptsOf(u).length, SLOTS, '拒绝后不该有副作用');
  assert.ok(st.manuscriptVault.some((m) => m.id === 'flurry'), '被拒的功法要留在仓库');

  /* 换朝向 / 挪位置不算新增，不该被门数拦 */
  const first = V.State.manuscriptsOf(u)[1];
  const moved = V.State.placeManuscript(st, u, first.id);
  assert.equal(moved.ok, true, `已在板上的功法改位置不该被门数拦：${moved.reason || ''}`);
  assert.equal(V.State.manuscriptsOf(u).length, SLOTS, '挪位置不该改变门数');

  /* 卸下一门就能再装一门 */
  assert.equal(V.State.removeManuscript(st, u, 'needle').ok, true);
  const again = V.State.placeManuscript(st, u, 'flurry');
  assert.equal(again.ok, true, `腾出位置后应能装：${again.reason || ''}`);
});

test('拆卸是无损的：原件原样回库，不留瘢痕，不扣任何资源', () => {
  const V = loadVeteran().Veteran;
  const st = V.State.create(11);
  const u = st.roster[0];
  const stock = V.Data.manuscript('rivet');
  st.manuscriptVault.push({ ...stock });

  const stats = () => V.Roster.stats(st, u, []);
  const before = {
    vault: st.manuscriptVault.length,
    gold: st.gold,
    scars: (u.scars || []).length,
    power: stats().hp + stats().atk + stats().def,
  };

  assert.equal(V.State.placeManuscript(st, u, 'rivet').ok, true);
  assert.equal(st.manuscriptVault.length, before.vault - 1, '装上时从库存取走一份');
  assert.equal(V.State.removeManuscript(st, u, 'rivet').ok, true);

  const back = st.manuscriptVault.find((m) => m.id === 'rivet');
  assert.ok(back, '拆下来必须回到库存里');
  /* 姿态是装配时才算出来的东西，拆下清掉；内容一个字段都不能少 */
  Object.keys(stock).forEach((k) => {
    assert.deepEqual(back[k], stock[k], `字段 ${k} 没有原样回来`);
  });
  ['x', 'y', 'rotation', 'mirrorY'].forEach((k) => {
    assert.equal(back[k], undefined, `${k} 应随拆下一起清掉`);
  });

  assert.equal(st.manuscriptVault.length, before.vault, '库存数量回到原样');
  assert.equal(st.gold, before.gold, '拆卸不花钱');
  assert.equal((u.scars || []).length, before.scars, '拆卸不留瘢痕（瘢痕只来自营火烙印）');
  assert.equal(stats().hp + stats().atk + stats().def, before.power, '拆卸不改变面板');

  /* 反悔是双向的：拆下来还能原样装回去，门数没被占死 */
  assert.equal(V.State.placeManuscript(st, u, 'rivet').ok, true);
});

test('80 套蚀刻法有可落下的连通蚀刻法和可执行招式', () => {
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
    /* 八标：这两个敌人是「不会死的靶子」，只用来撑出足够的回合让人放招。
       难度抬上来之后它们的攻击会把 0.4 血的靶子打死在放招之前，
       于是这条用例会变成在测生存而不是测「招式放得出来」—— 关掉它们的伤害即可。 */
    st.run.battle.enemies.forEach((u) => { u.maxHp = 5000; u.hp = 1500; u.atk = 0; });
    for (let i = 0; !st.run.battle.over && i < 4201; i++) st = V.Combat.step(st).state;
    assert.ok(st.run.battle.over, spec.id);
    assert.ok(V.State.validate(st).ok, spec.id);
    if (spec.skills.length) assert.ok(st.run.battle.allies.some((u) => u.stats.skills > 0), `${spec.id} 未施展招式`);
  }
});

test('旧档重复角色保留资产，仍可收齐14种身份', () => {
  const V = loadVeteran().Veteran;
  let st = V.State.create(42);
  const duplicate = V.State.makeUnit(st, { name: '旧档铁鸦', skinId: 'blade', bodyPreset: 'sturdy' });
  V.State.equipPreset(st, duplicate, 'basic');
  st.roster.push(duplicate);
  st.gold = 100000;
  while (new Set(st.roster.map((u) => u.skinId)).size < 14) {
    const refreshed = V.Roster.refreshShop(st, false);
    assert.ok(refreshed.ok);
    const recruited = V.Roster.recruit(refreshed.state, refreshed.state.shop[0].id);
    assert.ok(recruited.ok);
    st = recruited.state;
  }
  assert.equal(st.roster.length, 15);
  assert.ok(st.roster.some((u) => u.id === duplicate.id));
  assert.ok(V.State.validate(st).ok);
});

test('九种拼接轮廓在真实板面上都能接通，抽掉起点就断', () => {
  /* 六标之前这条靠「两件纹路手写摆法」，骨架扩到 6~54 格之后那张表必然失真。
     现在守的是同一件事的现代版本：这些轮廓**能被接通**，而且**通路不是白给的** ——
     拿走起点那件，route 立刻断。 */
  const A = loadVeteran();
  const V = A.Veteran;
  const ids = ['chalkLine', 'oarlock', 'pikeHead', 'millStone', 'capstan',
    'sump', 'copperWick', 'soundingLine', 'lodestone'];
  ids.forEach((id) => {
    const st = V.State.create(46);
    const u = V.State.makeUnit(st, { skinId: 'blade', bodyPreset: 'sturdy', name: '试' });
    u.manuscript = null;
    delete u.extraManuscripts;
    st.roster.push(u);
    st.team[0] = u.id;
    V.State.equipManuscript(st, u, id);
    const r = autoRouteBoard(A, st, u, { style: 'elbow' });
    assert.ok(r.ok, `${id} 应能接通：${r.reason || ''}`);

    const ms = V.State.manuscriptsOf(u)[0];
    const or = V.Manuscript.orient(V.Manuscript.normalize(ms), ms.rotation || 0, !!ms.mirrorY);
    const trimmed = u.board.placements.slice(1);
    const idx = V.Manuscript.pieceIndex(V.Circuit.layout(st, trimmed));
    assert.equal(V.Manuscript.route(or, ms.x || 0, ms.y || 0, idx).ok, false,
      `${id} 抽掉通路起点后不该还通`);
  });
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
  /* 现场谱同样要能被接通（单件纹路压满整卷这件事，在 6~54 格的骨架里已经不成立了） */
  for (const id of ['silverTap', 'coreDrill']) {
    const st = V.State.create(42);
    const u = V.State.makeUnit(st, { skinId: 'blade', bodyPreset: 'sturdy', name: '试' });
    u.manuscript = null;
    delete u.extraManuscripts;
    st.roster.push(u);
    st.team[0] = u.id;
    V.State.equipManuscript(st, u, id);
    const r = autoRouteBoard(loadVeteran(), st, u, { style: 'elbow' });
    assert.ok(r.ok, `${V.Data.manuscript(id).name} 应能接通：${r.reason || ''}`);
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
