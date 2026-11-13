'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes } = require('../helpers/veteran-run.cjs');

test('背包用仓库材料永久扩容，旧档、余额不足、远征中与满级均有边界', () => {
  const { A, V } = boot();
  const E = V.Expedition;
  let s = V.State.create(42);
  delete s.packLevel;
  assert.equal(E.bagCapacity(s), 24);
  assert.equal(V.Storage.decode(V.Storage.encode(s)).ok, true);
  assert.equal(E.upgradePack(s).ok, false);
  assert.equal(V.State.validate({ ...s, packLevel: -1 }).ok, false);
  for (const step of E.PACK_UPGRADES) {
    s.pantry = { ...step.needs, boneCap: 1 };
    const result = E.upgradePack(s);
    assert.ok(result.ok);
    s = result.state;
    assert.deepEqual(Object.keys(s.pantry), ['boneCap']);
    assert.equal(E.bagCapacity(s), step.capacity);
    const trip = startRun(A, s);
    assert.equal(E.upgradePack(trip).ok, false);
    assert.equal(E.packSlots(trip).length, step.capacity);
    trip.run.ingredients = { boneCap: step.capacity * E.foodPack('boneCap').limit };
    assert.equal(E.bagFree(trip), 0);
    assert.ok(V.Storage.decode(V.Storage.encode(trip)).ok);
    trip.run.ingredients.boneCap++;
    assert.equal(V.State.validate(trip).ok, false);
  }
  assert.equal(E.upgradePack(s).ok, false);
});

test('手排纹路整件移动，丢弃末堆腾出选中格；战斗中锁定整理', () => {
  const { A, V, st } = boot(42);
  const E = V.Expedition;
  let s = startRun(A, st);
  const part = addNewPart(A, s, 'elbow');
  s.run.ingredients = { boneCap: 5 };
  const token = 'part:' + part.id;
  const moved = E.movePack(s, 0, 16);
  assert.ok(moved.ok);
  assert.deepEqual(E.packSlots(moved.state).flatMap((v,i) => v === token ? [i] : []), [16,17,23]);
  assert.equal(E.movePack(s, 0, 5).ok, false, '整件不能跨右边折行');
  const second = 'food:boneCap#1';
  const index = E.packSlots(moved.state).indexOf(second);
  s = E.discardPack(moved.state, second, index).state;
  assert.equal(E.packSlots(s)[index], null);
  assert.equal(E.stackCount(s, 'food:boneCap'), 4);
  s = E.sortPack(s).state;
  assert.equal(E.packSlots(s)[0], token);
  const dropped = E.discardPack(s, token).state;
  assert.equal(dropped.itemsById[part.id], undefined);
  assert.equal(E.bagUsed(dropped), 1);
  s.run.stage = 'battle';
  assert.equal(E.sortPack(s).ok, false);
  assert.equal(E.movePack(s, 0, 1).ok, false);
  assert.equal(E.discardPack(s, token).ok, false);
});

/** 放一件本局新纹路进背包。 */
function addNewPart(A, s, templateId, seq) {
  const V = A.Veteran;
  const part = V.State.makePart(s, {
    kind: 'circuit', templateId: templateId || 'ember',
    acquiredRunId: s.run.id, acquiredSeq: seq || 1,
  });
  s.itemsById[part.id] = part;
  s.run.bag.push(part.id);
  return part;
}

function atCamp(A, s) {
  s = setNodes(A, s, ['camp']);
  const r = A.Veteran.Expedition.chooseNode(s, s.run.nodes[0].id);
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.state;
}

test('背包按占格累计，主手占 4，满包不静默吞件', () => {
  const { A, V } = boot(301);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 301);
  assert.equal(V.Expedition.bagUsed(s), 0);

  /* 填到接近上限 */
  let seq = 1;
  while (V.Expedition.bagFree(s) >= 2) {
    addNewPart(A, s, 'straight', seq++);
  }
  const used = V.Expedition.bagUsed(s);
  assert.ok(used <= V.Data.DESIGN.bagCapacity, `占用 ${used}`);

  const big = addNewPart(A, s, 'capacitor', seq);
  s.run.bag = s.run.bag.filter((id) => id !== big.id);
  s.run.pendingLoot.push(big.id);
  const r = V.Expedition.resolveLoot(s, big.id, 'take');
  assert.ok(!r.ok, '放不下时不能假装成功');
  assert.equal(r.error.code, 'bag_full');
  assert.ok(s.run.bag.includes(big.id) === false);
});

test('掉落可以替换掉背包里的一件', () => {
  const { A, V } = boot(302);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 302);
  const keep = addNewPart(A, s, 'straight', 1);
  const incoming = addNewPart(A, s, 'elbow', 2);
  s.run.pendingLoot.push(incoming.id);
  s.run.bag = s.run.bag.filter((id) => id !== incoming.id);

  const r = V.Expedition.resolveLoot(s, incoming.id, 'replace:' + keep.id);
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.ok(r.state.run.bag.includes(incoming.id));
  assert.ok(!r.state.run.bag.includes(keep.id));
  assert.equal(r.state.itemsById[keep.id], undefined, '被替换的纹路要从 registry 清掉');
});

test('营火烙印未提交时不扣生命与压力', () => {
  const { A, V } = boot(303);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 303);
  const before = s.run.party.map((p) => p.hp);
  s = atCamp(A, s);
  assert.equal(s.run.stage, 'camp');
  assert.deepEqual(s.run.party.map((p) => p.hp), before);
  assert.equal(s.run.maxHpModifiers[Object.keys(s.run.maxHpModifiers)[0]], undefined);
});

test('营火烙印：生命 ×0.8、当前 HP 等比、压力 +40，每角色每局一次', () => {
  const { A, V } = boot(304);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 304);
  s = atCamp(A, s);
  const unit = s.roster[0];
  const maxBefore = V.Roster.stats(s, unit).maxHp;
  s.run.party[0].hp = maxBefore;
  const newPart = addNewPart(A, s, 'ember', 1);

  const placements = unit.board.placements.map((p) => ({ ...p, y: p.y }));
  /* 把 (0,1) 的 straight 换成 ember，并把原 straight 停到空地 */
  const straight = placements.find((p) => p.x === 0 && p.y === 1);
  const park = V.Data.STRAIGHT_PARK[unit.bodyPreset];
  const proposed = placements.map((p) => (p.itemId === straight.itemId
    ? { ...p, x: park.x, y: park.y }
    : p)).concat([{ itemId: newPart.id, x: 0, y: 1, rotation: 0, mirrorY: false }]);

  const r = V.Expedition.inscribe(s, unit.id, newPart.id, proposed);
  assert.ok(r.ok, JSON.stringify(r.error));
  s = r.state;

  const maxAfter = V.Roster.stats(s, s.roster[0]).maxHp;
  assert.equal(maxAfter, Math.round(maxBefore * 0.8), '生命上限 ×0.8');
  assert.equal(s.run.party[0].stress, 40);
  assert.ok(s.run.fieldInscribedUnitIds.includes(unit.id));
  assert.ok(!s.run.bag.includes(newPart.id), '新件从背包转成临时绑定');
  assert.ok(s.roster[0].board.placements.length === 2, '永久板面不变');
  assert.equal(s.roster[0].scars.length, 1, '确认营火烙印才留下一个底层瘢痕');
  assert.equal(s.roster[0].scars[0].source, '余烬纹');
  const scarRecord = JSON.stringify(s.roster[0].scars);
  const retreat = V.Expedition.retreat(s, 'emergency');
  assert.ok(retreat.ok);
  assert.equal(JSON.stringify(retreat.state.roster[0].scars), scarRecord, '撤退不能洗去已确认瘢痕');

  /* 第二次必须拒绝 */
  const second = addNewPart(A, s, 'ember', 2);
  const r2 = V.Expedition.inscribe(s, unit.id, second.id, proposed.concat([
    { itemId: second.id, x: 1, y: 0, rotation: 0, mirrorY: false },
  ]));
  assert.ok(!r2.ok);
  assert.equal(r2.error.code, 'cannot_inscribe');
});

test('已有瘢痕不叠加时，烙印重排也按新生命上限同步当前生命', () => {
  const { A, V } = boot(304);
  let s = atCamp(A, startRun(A, V.State.create(4242, { classicPlate: true }), 304));
  const u = s.roster[0];
  u.scars = [[0, 1, 'ember'], [1, 1, 'ember'], [2, 1, 'capacitor']].map(([x, y, templateId]) => ({
    x, y, templateId, source: V.Data.template(templateId).name, floor: 1, runId: 'prior',
  }));
  s.run.party[0].hp = V.Roster.stats(s, u).maxHp;
  const part = addNewPart(A, s, 'ember', 1);
  const proposed = u.board.placements.map((p) => ({ ...p, x: 0, y: p.x === 0 ? 0 : 2 }))
    .concat([{ itemId: part.id, x: 0, y: 1, rotation: 0, mirrorY: false }]);
  const r = V.Expedition.inscribe(s, u.id, part.id, proposed);
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.state.roster[0].scars.length, 3);
  assert.equal(r.state.run.party[0].hp, V.Roster.stats(r.state, r.state.roster[0]).maxHp);
});

test('烙印不能丢掉原纹路，也不能塞两件新件', () => {
  const { A, V } = boot(305);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 305);
  s = atCamp(A, s);
  const unit = s.roster[0];
  const p1 = addNewPart(A, s, 'straight', 1);
  const p2 = addNewPart(A, s, 'elbow', 2);

  const onlyNew = [{ itemId: p1.id, x: 0, y: 1, rotation: 0, mirrorY: false }];
  const r1 = V.Expedition.inscribe(s, unit.id, p1.id, onlyNew);
  assert.ok(!r1.ok);
  assert.equal(r1.error.code, 'missing_original');

  const bothNew = unit.board.placements.map((p) => ({ ...p })).concat([
    { itemId: p1.id, x: 0, y: 0, rotation: 0, mirrorY: false },
    { itemId: p2.id, x: 2, y: 0, rotation: 0, mirrorY: false },
  ]);
  const r2 = V.Expedition.inscribe(s, unit.id, p1.id, bothNew);
  assert.ok(!r2.ok);
});

test('ember 默认替换线在三个底盘上都放得下', () => {
  const { A, V } = boot(306);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 306);
  s = atCamp(A, s);
  ['sturdy', 'agile', 'conduit'].forEach((body) => {
    const unit = s.roster.find((u) => u.bodyPreset === body) || s.roster[1];
    const part = addNewPart(A, s, 'ember', 1);
    const park = V.Data.STRAIGHT_PARK[body] || V.Data.STRAIGHT_PARK.sturdy;
    const placements = unit.board.placements.map((p) => (
      p.x === 0 && p.y === 1 ? { ...p, x: park.x, y: park.y } : { ...p }
    ));
    const proposed = placements.concat([{ itemId: part.id, x: 0, y: 1, rotation: 0, mirrorY: false }]);
    const pv = V.Circuit.preview(s, unit.id, proposed);
    assert.ok(pv.ok, `${body}: ${JSON.stringify(pv.errors)}`);
    /* 接线模型已删除：装配只要求几何放得下、负荷不超 */
    assert.equal(pv.overload, 0, `${body} 不该超载`);
  });
});

test('紧急撤退保留一半新件、全部带入件，压力入场 +10', () => {
  const { A, V } = boot(307);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 307);
  const broughtIds = V.State.ownItemIds(s).slice();
  [1, 2, 3, 4].forEach((i) => addNewPart(A, s, 'straight', i));
  s.run.goldFound = 100;
  s.run.shards = 10;
  s.run.completedFloors = 3;
  s.run.party.forEach((p) => { p.stress = 20; });

  const preview = V.Expedition.previewRetreat(s, 'emergency');
  assert.equal(preview.keepParts.length, 2, '4 件新件保留 2 件');
  assert.equal(preview.gold, 50);
  assert.equal(preview.shards, 5 + 3);

  const r = V.Expedition.retreat(s, 'emergency');
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.state.run, null, '回营');
  broughtIds.forEach((id) => assert.ok(r.state.itemsById[id], `带入件 ${id} 必须保留`));
  assert.equal(r.state.gold, s.gold + 50);
  const stress = r.state.roster.map((u) => u.stress);
  assert.ok(stress.every((v) => v === 30), `压力应为入场 20 + 10，实际 ${stress}`);
});

test('确认败退：新收获全失、带入资产保留、压力 +20', () => {
  const { A, V } = boot(308);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 308);
  const broughtIds = V.State.ownItemIds(s).slice();
  const newParts = [1, 2, 3].map((i) => addNewPart(A, s, 'straight', i));
  s.run.goldFound = 90;
  s.run.party.forEach((p) => { p.stress = 10; });

  const r = V.Expedition.retreat(s, 'defeat');
  assert.ok(r.ok);
  assert.equal(r.state.gold, s.gold, '不退金币');
  newParts.forEach((p) => assert.equal(r.state.itemsById[p.id], undefined, '新件应被清掉'));
  broughtIds.forEach((id) => assert.ok(r.state.itemsById[id], '带入件必须保留'));
  assert.ok(r.state.roster.every((u) => u.stress === 30));
});

test('烙印不能把本局新件洗成安全资产：撤退后板面回到入场状态', () => {
  const { A, V } = boot(309);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 309);
  s = atCamp(A, s);
  const unit = s.roster[0];
  const original = JSON.stringify(unit.board.placements);
  const newPart = addNewPart(A, s, 'ember', 1);
  const park = V.Data.STRAIGHT_PARK[unit.bodyPreset];
  const placements = unit.board.placements.map((p) => (
    p.x === 0 && p.y === 1 ? { ...p, x: park.x, y: park.y } : { ...p }
  ));
  const r = V.Expedition.inscribe(s, unit.id, newPart.id, placements.concat([
    { itemId: newPart.id, x: 0, y: 1, rotation: 0, mirrorY: false },
  ]));
  assert.ok(r.ok, JSON.stringify(r.error));
  s = r.state;

  const back = V.Expedition.retreat(s, 'emergency');
  assert.ok(back.ok);
  const u = back.state.roster.find((x) => x.id === unit.id);
  assert.equal(JSON.stringify(u.board.placements), original, '永久板面必须回到入场状态');
  assert.equal(back.state.run, null);
  /* 保留的新件在仓库里，不直接插回板上 */
  const kept = back.state.stash.filter((id) => id === newPart.id);
  const keptOnBoard = u.board.placements.some((p) => p.itemId === newPart.id);
  assert.ok(kept.length + (keptOnBoard ? 1 : 0) <= 1, '新件不能既在仓库又在板上');
});

test('正常撤离是幂等事务：板面固化、背包入仓、清修正、战史只计一次', () => {
  const { A, V } = boot(310);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 310);
  s = atCamp(A, s);
  const unit = s.roster[0];
  const newPart = addNewPart(A, s, 'ember', 1);
  const park = V.Data.STRAIGHT_PARK[unit.bodyPreset];
  const placements = unit.board.placements.map((p) => (
    p.x === 0 && p.y === 1 ? { ...p, x: park.x, y: park.y } : { ...p }
  ));
  s = V.Expedition.inscribe(s, unit.id, newPart.id, placements.concat([
    { itemId: newPart.id, x: 0, y: 1, rotation: 0, mirrorY: false },
  ])).state;

  /* 营火处理完要离开节点才能到 map */
  const left = V.Expedition.finishNode(s);
  assert.ok(left.ok, JSON.stringify(left.error));
  s = left.state;
  assert.equal(s.run.stage, 'map');

  s.run.completedFloors = 4;
  const bagIds = s.run.bag.slice();
  s.run.goldFound = 60;
  s.run.shards = 4;

  const extractOk = V.Expedition.extract(s);
  assert.ok(extractOk.ok, JSON.stringify(extractOk.error));
  const out = extractOk.state;

  assert.equal(out.run, null);
  assert.equal(out.gold, s.gold + 60);
  bagIds.forEach((id) => assert.ok(out.stash.includes(id), '背包应入仓'));
  /* 烙印的新件在确认时固化到板面，归属从 provisional 变成 board（不进仓库） */
  assert.ok(out.roster[0].board.placements.some((p) => p.itemId === newPart.id),
    '烙印的新件要固化到板面');
  assert.ok(!out.stash.includes(newPart.id), '固化后不该同时出现在仓库');
  assert.equal(V.Roster.stats(out, out.roster[0]).mod, 1, 'maxHp 修正必须清除');
  const records = out.roster.reduce((a, u) => a + u.history.records.length, 0);
  assert.equal(records, s.run.party.length, '每个参战角色一条战史');

  /* 幂等：重复调用不能再来一次 */
  const again = V.Expedition.extract(out);
  assert.ok(!again.ok);
  assert.equal(again.error.code, 'no_run');
});

test('0 完成层正常撤离没有收益也不算合格', () => {
  const { A, V } = boot(311);
  let s = startRun(A, V.State.create(4242, { classicPlate: true }), 311);
  const goldBefore = s.gold;
  const r = V.Expedition.extract(s);
  assert.ok(r.ok);
  assert.equal(r.state.gold, goldBefore);
  assert.equal(r.state.settlement.eligible, false);
  assert.ok(r.state.settlement.reason.includes('0 层'));
});

test('事件里的战斗分支能正常开战（openForEvent 走本模块，不绕 V.Encounter）', () => {
  const { A, V, st: base } = boot(7311);
  let st = startRun(A, base);
  st = setNodes(A, st, ['event']);
  const r = V.Expedition.chooseNode(st, st.run.nodes[0].id);
  assert.ok(r.ok, JSON.stringify(r.error));
  st = r.state;
  /* 强制用带战斗的那条事件：雾中的岔路 / 走血路 */
  st.run.event.eventId = 'fogFork';
  st.run.event.resolved = false;

  const c = V.Expedition.chooseEvent(st, 'blood');
  assert.ok(c.ok, JSON.stringify(c.error && c.error.message));
  assert.equal(c.state.run.stage, 'battle', '应该直接进入战斗');
  assert.ok(c.state.run.battle, '要生成战场');
  assert.ok(c.state.run.encounter && c.state.run.encounter.enemyBlueprint, '要有敌人蓝图（说明检查点建好了）');

  /* 打完一场，状态仍然合法 */
  let s = c.state;
  for (let i = 0; i < 2000 && !s.run.battle.over; i++) {
    const step = V.Combat.step(s);
    assert.ok(step.ok, JSON.stringify(step.error));
    s = step.state;
  }
  assert.ok(s.run.battle.over, '战斗应能结束');
  assert.ok(V.State.validate(s).ok, JSON.stringify(V.State.validate(s).errors));
});

test('固定种子的每层路线都有战斗与补给，阶段解锁和首领保留', () => {
  const { A, V, st } = boot(420);
  const seen = new Set();
  for (let seed = 0; seed < 48; seed++) {
    const s = startRun(A, st, seed);
    const resumed = V.Storage.decode(V.Storage.encode(s)).state;
    for (let floor = 1; floor <= 49; floor++) {
      for (const runState of [s, resumed]) {
        runState.run.floor = floor;
        V.Expedition.genNodes(runState);
      }
      const types = s.run.nodes.map((n) => n.type);
      types.forEach((t) => seen.add(t));
      assert.deepEqual(s.run.nodes, resumed.run.nodes);
      if (floor % 7 === 0) {
        assert.deepEqual(Array.from(types), ['boss']);
        continue;
      }
      assert.equal(new Set(types).size, 3);
      assert.ok(types.some((t) => ['battle', 'elite', 'boss'].includes(t)));
      assert.ok(types.some((t) => ['camp', 'chest', 'merchant'].includes(t)));
      assert.equal(types.includes('boss'), floor === 7);
      if (floor === 1) assert.ok(!types.includes('camp'));
      if (floor < 3) assert.ok(!types.includes('elite') && !types.includes('merchant'));
    }
  }
  assert.equal(seen.size, 7);
});

test('普通宝箱可拾全部、任选或直接离开，余物与重复领取均有明确归属', () => {
  const { A, V, st } = boot(421);
  const E = V.Expedition;
  const start = setNodes(A, startRun(A, st, 421), ['chest']);
  const opened = E.chooseNode(start, start.run.nodes[0].id).state;
  const s = V.Storage.decode(V.Storage.encode(opened)).state;
  const [first, second] = s.run.pendingLoot;
  assert.equal(s.run.pendingLoot.length, 2);
  assert.notEqual(s.itemsById[first].templateId, s.itemsById[second].templateId);
  assert.equal(V.State.itemLocation(s, first).where, 'pending');
  assert.equal(E.chooseNode(s, s.run.activeNodeId).ok, false);
  assert.equal(E.extract(s).ok, false);
  for (const ids of [[], [first], [second], [second, first]]) {
    let taken = s;
    for (const id of ids) {
      const result = E.resolveLoot(taken, id, 'take');
      assert.ok(result.ok);
      taken = result.state;
      assert.equal(E.resolveLoot(taken, id, 'take').ok, false);
      assert.deepEqual(taken.run.ingredientLoot, s.run.ingredientLoot);
      assert.equal(taken.rngState, s.rngState);
    }
    const left = E.finishNode(taken, true);
    assert.ok(left.ok);
    assert.deepEqual(left.state.run.bag, ids);
    assert.deepEqual(left.state.run.ingredientLoot, {});
    for (const id of [first, second]) assert.equal(!!left.state.itemsById[id], ids.includes(id));
    const back = E.extract(left.state).state;
    for (const id of ids) assert.equal(back.stash.filter(x => x === id).length, 1);
    assert.ok(V.State.validate(back).ok);
  }
  const retreat = E.retreat(s, 'emergency').state;
  assert.equal(retreat.itemsById[first], undefined);
  assert.equal(retreat.itemsById[second], undefined);
});

test('旧档未决宝箱恢复两件原物，食材与拓本按原随机进度只生成一次', () => {
  const { A, V, st } = boot(428);
  for (let seed = 1; seed <= 12; seed++) {
    const start = setNodes(A, startRun(A, st, seed), ['chest']);
    const opened = V.Expedition.chooseNode(start, start.run.nodes[0].id).state;
    const old = V.State.clone(opened);
    old.run.chestChoices = old.run.pendingLoot;
    old.run.pendingLoot = [];
    for (const id of old.run.chestChoices) Object.assign(old.itemsById[id], { acquiredRunId: null, acquiredSeq: 0 });
    old.run.ingredientLoot = {};
    delete old.run.fieldManuscript;
    old.rngState = A.Random.shuffle(start.rngState, V.Data.TEMPLATE_ORDER).state;
    const decoded = V.Storage.decode(V.Storage.encode(old));
    assert.ok(decoded.ok, JSON.stringify(decoded.errors));
    const restored = decoded.state;
    assert.equal(restored.run.chestChoices, undefined);
    assert.deepEqual(restored.run.pendingLoot, opened.run.pendingLoot);
    assert.deepEqual(restored.itemsById, opened.itemsById);
    assert.deepEqual(restored.run.ingredientLoot, opened.run.ingredientLoot);
    assert.equal(restored.run.fieldManuscript, opened.run.fieldManuscript);
    assert.equal(restored.rngState, opened.rngState);
    assert.deepEqual(V.Storage.decode(V.Storage.encode(restored)).state, restored);
    const one = V.Expedition.resolveLoot(restored, restored.run.pendingLoot[0], 'take').state;
    assert.deepEqual(V.Storage.decode(V.Storage.encode(one)).state, one);
    const invalid = V.State.clone(old);
    invalid.run.chestChoices[1] = invalid.run.chestChoices[0];
    assert.equal(V.Storage.decode(V.Storage.encode(invalid)).ok, false);
  }
});

test('满包宝箱仍保留两件，替换只消耗指定一件，放弃或离开清理余物', () => {
  const { A, V, st } = boot(422);
  const E = V.Expedition;
  const s = setNodes(A, startRun(A, st, 422), ['chest']);
  const pending = E.chooseNode(s, s.run.nodes[0].id).state;
  const [id, other] = pending.run.pendingLoot;
  addNewPart(A, pending, pending.itemsById[id].templateId);
  while (E.bagFree(pending)) addNewPart(A, pending, 'rivet', pending.run.bag.length + 1);
  assert.equal(E.resolveLoot(pending, id, 'take').state, pending);
  const replaced = E.resolveLoot(pending, id, 'replace:' + pending.run.bag[0]).state;
  assert.equal(V.State.itemLocation(replaced, id).where, 'bag');
  assert.deepEqual(replaced.run.pendingLoot, [other]);
  const left = E.finishNode(replaced, true).state;
  assert.equal(left.itemsById[other], undefined);
  const discard = E.resolveLoot(pending, id, 'discard').state;
  assert.equal(discard.itemsById[id], undefined);
  assert.deepEqual(discard.run.pendingLoot, [other]);
  assert.equal(E.retreat(pending, 'emergency').state.itemsById[id], undefined);
});

test('商人陈列三种模板，未售物离店清理，已购物正常记账', () => {
  const { A, V, st } = boot(423);
  const s = setNodes(A, startRun(A, st, 423), ['merchant']);
  s.gold = 150;
  const shop = V.Expedition.chooseNode(s, s.run.nodes[0].id).state;
  const offers = shop.run.shop;
  assert.equal(new Set(offers.map((o) => shop.itemsById[o.itemId].templateId)).size, 3);
  assert.equal(V.State.itemLocation(shop, offers[0].itemId).where, 'merchant');
  assert.deepEqual(V.Storage.decode(V.Storage.encode(shop)).state.run.shop, offers);
  const bought = V.Expedition.buy(shop, offers[0].id).state;
  assert.equal(bought.gold, s.gold - offers[0].price);
  assert.deepEqual(bought.run.bag, [offers[0].itemId]);
  for (const end of [V.Expedition.finishNode(bought), V.Expedition.retreat(bought, 'emergency')]) {
    assert.ok(end.ok);
    assert.ok(V.State.validate(end.state).ok);
    assert.ok(end.state.itemsById[offers[0].itemId]);
    assert.equal(end.state.itemsById[offers[1].itemId], undefined);
    assert.equal(end.state.itemsById[offers[2].itemId], undefined);
  }
});

test('宝箱开盖时按种子抽取三分之一携谱机会，读档与拾取顺序不能重抽', () => {
  const { A, V, st } = boot(440);
  const outcomes = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const s = setNodes(A, startRun(A, st, seed), ['chest']);
    const drawn = A.Random.shuffle(s.rngState, V.Data.TEMPLATE_ORDER);
    const expected = A.Random.chance(drawn.state, 1 / 3).value;
    const opened = V.Expedition.chooseNode(s, s.run.nodes[0].id).state;
    assert.equal(!!opened.run.fieldManuscript, expected);
    outcomes.add(expected);
    const restored = V.Storage.decode(V.Storage.encode(opened)).state;
    const [first, second] = restored.run.pendingLoot;
    for (const itemId of [first, second]) {
      const taken = V.Expedition.resolveLoot(restored, itemId, 'take').state;
      assert.equal(taken.run.fieldManuscript, opened.run.fieldManuscript);
      assert.equal(taken.rngState, opened.rngState);
    }
    if (!expected) continue;
    const id = restored.run.fieldManuscript;
    assert.equal(V.Data.manuscript(id).fieldSource, 'chest');
    assert.equal(V.Data.manuscript(id).fieldDepth, 1);
    assert.equal(V.Expedition.bagUsed(restored), 0);
    const leaving = V.Expedition.finishNode(restored, true).state;
    const extracted = V.Expedition.extract(leaving).state;
    assert.equal(extracted.settlement.fieldManuscript, id);
    assert.equal(extracted.manuscriptVault.filter((m) => m.id === id).length, 1);
    assert.equal(V.Expedition.extract(extracted).ok, false);
    for (const mode of ['emergency', 'defeat']) {
      const lost = V.Expedition.retreat(restored, mode).state;
      assert.equal(lost.settlement.fieldManuscript, undefined);
      assert.deepEqual(lost.manuscriptVault, st.manuscriptVault);
    }
  }
  assert.equal(outcomes.size, 2);
});

test('精英战胜确认才给谱，重复确认及回转不能刷；优先缺本且每趟限一份', () => {
  const { A, V, st } = boot(441);
  const s = startRun(A, st, 441);
  s.run.floor = 49;
  setNodes(A, s, ['elite', 'boss']);
  const pool = Object.values(V.Data.MANUSCRIPTS).filter((m) => m.fieldSource === 'elite');
  assert.equal(pool.length, 17);
  for (const m of pool.slice(1)) s.manuscriptVault.push(V.State.clone(m));
  const expected = pool[0].id;
  const opened = V.Expedition.chooseNode(s, s.run.nodes[0].id).state;
  function win(start) {
    const battle = V.Encounter.startAttempt(start).state;
    battle.run.battle.over = true;
    battle.run.battle.outcome = 'win';
    assert.ok(V.Combat.prepareResult(battle).ok);
    return battle;
  }
  const review = win(opened);
  assert.equal(review.run.fieldManuscript, undefined);
  const retried = win(V.Encounter.rewind(review).state);
  const won = V.Encounter.confirm(review).state;
  assert.equal(won.run.fieldManuscript, expected);
  assert.equal(V.Encounter.confirm(retried).state.run.fieldManuscript, expected);
  assert.equal(V.Encounter.confirm(won).state.rngState, won.rngState);
  assert.equal(V.Encounter.rewind(won).ok, false);
  assert.deepEqual(won.manuscriptVault, s.manuscriptVault);
  const finalMap = V.Expedition.finishNode(won, true).state;
  const boss = V.Expedition.chooseNode(finalMap, finalMap.run.nodes.find((n) => n.type === 'boss').id).state;
  const cleared = V.Encounter.confirm(win(boss)).state;
  const settled = V.Expedition.finishNode(cleared, true).state;
  assert.equal(settled.settlement.fieldManuscript, expected);
  assert.notEqual(settled.settlement.manuscript.id, expected);
  assert.equal(settled.manuscriptVault.length, s.manuscriptVault.length + 2);
  const carried = Object.values(V.Data.MANUSCRIPTS).find((m) => m.fieldSource === 'chest').id;
  s.run.fieldManuscript = carried;
  const both = V.Expedition.chooseNode(s, s.run.nodes[0].id).state;
  assert.equal(V.Encounter.confirm(win(both)).state.run.fieldManuscript, carried);
  assert.equal(V.Encounter.rewind(win(both)).state.run.fieldManuscript, carried);
  both.run.encounter.checkpoint.run.fieldManuscript = expected;
  assert.equal(V.Storage.decode(V.Storage.encode(both)).ok, false);
  s.run.fieldManuscript = 'spark';
  assert.equal(V.Storage.decode(V.Storage.encode(s)).ok, false);
});

test('满盘食材可合并未满的一堆；腾出轮廓后取纹路，未采集随离场清理', () => {
  const { A, V, st } = boot(450);
  const E = V.Expedition;
  const s = setNodes(A, startRun(A, st, 450), ['chest']);
  const id = V.Kitchen.biome(1).forage;
  const profile = E.foodPack(id);
  const cap = E.bagCapacity(s);
  s.run.ingredients = { [id]: cap / profile.cells.length * profile.limit };
  const opened = E.chooseNode(s, s.run.nodes[0].id).state;
  const part = opened.run.pendingLoot[0];
  const loot = opened;
  assert.equal(loot.run.pendingLoot.length, 2);
  assert.equal(loot.run.ingredientLoot[id], 1);
  assert.equal(Object.keys(loot.run.ingredientLoot).length, 2);
  assert.equal(E.takeIngredient(loot, id).state, loot);
  const free = E.dropIngredient(loot, id).state;
  assert.equal(E.bagFree(free), 0);
  assert.ok(E.canPack(free, 'food:' + id));
  const gathered = E.takeIngredient(free, id).state;
  assert.equal(E.takeIngredient(gathered, id).ok, false);
  assert.equal(E.bagUsed(gathered), cap);
  assert.deepEqual(V.Storage.decode(V.Storage.encode(gathered)).state.run.ingredients, s.run.ingredients);
  let room = loot;
  while (!E.canPack(room, 'part:' + part)) {
    const drop = E.dropIngredient(room, id);
    assert.ok(drop.ok);
    room = drop.state;
  }
  const taken = E.resolveLoot(room, part, 'take');
  assert.ok(taken.ok);
  assert.ok(taken.state.run.bag.includes(part));
  const left = E.finishNode(taken.state, true).state;
  assert.deepEqual(left.run.ingredientLoot, {});
  assert.equal(E.takeIngredient(left, id).ok, false);
  assert.ok(E.dropIngredient(left, id).ok);
  const camp = atCamp(A, left);
  assert.ok(E.dropIngredient(camp, id).ok);
  assert.equal(E.takeIngredient(camp, id).ok, false);
});

test('真实敌群每只产一份基础和一份副产食材，回转及重复确认不会多产', () => {
  const { A, V, st } = boot(451);
  const s = setNodes(A, startRun(A, st, 451), ['battle']);
  const id = V.Kitchen.biome(1).forage;
  const profile = V.Expedition.foodPack(id);
  s.run.ingredients = { [id]: V.Expedition.bagCapacity(s) / profile.cells.length * profile.limit };
  const opened = V.Expedition.chooseNode(s, s.run.nodes[0].id).state;
  const expected = {};
  for (const enemy of opened.run.encounter.enemyBlueprint.units) {
    const ingredient = V.Kitchen.ECOSYSTEM[enemy.enemyType].ingredient;
    expected[ingredient] = (expected[ingredient] || 0) + 1;
  }
  assert.equal(V.Expedition.dropIngredient(opened, id).ok, false);
  const battle = V.Encounter.startAttempt(opened).state;
  battle.run.battle.over = true;
  battle.run.battle.outcome = 'win';
  V.Combat.prepareResult(battle);
  assert.deepEqual(V.Encounter.rewind(battle).state.run.ingredientLoot, {});
  const won = V.Encounter.confirm(battle).state;
  for (const [id, amount] of Object.entries(expected)) assert.equal(won.run.ingredientLoot[id], amount);
  assert.equal(Object.values(won.run.ingredientLoot).reduce((a, b) => a + b, 0), opened.run.encounter.enemyBlueprint.units.length * 2);
  assert.deepEqual(won.run.bag, []);
  assert.ok(won.run.pendingLoot.length > 0, '背包全是食材时，确认战利纹路进待处理区');
  const restored = V.Storage.decode(V.Storage.encode(won)).state;
  assert.deepEqual(V.Encounter.confirm(restored).state.run.ingredientLoot, won.run.ingredientLoot);
});

test('实际开箱、确认战利并拾取可随种子收齐120种食材', () => {
  const { A, V, st } = boot(453);
  const gathered = new Set();
  for (let seed = 1; seed <= 256 && gathered.size < 120; seed++) {
    for (const [floor, type] of [[1, 'chest'], [15, 'chest'], [29, 'chest'], [1, 'battle'], [15, 'battle'], [29, 'battle'], [29, 'elite'], [7, 'boss'], [14, 'boss'], [28, 'boss']]) {
      const s = startRun(A, st, seed);
      s.run.floor = floor;
      s.stats.runs = seed;
      setNodes(A, s, [type]);
      const opened = V.Expedition.chooseNode(s, s.run.nodes[0].id).state;
      let loot;
      if (type === 'chest') {
        loot = opened;
      } else {
        const battle = V.Encounter.startAttempt(opened).state;
        battle.run.battle.over = true;
        battle.run.battle.outcome = 'win';
        V.Combat.prepareResult(battle);
        loot = V.Encounter.confirm(battle).state;
      }
      for (const id of Object.keys(loot.run.ingredientLoot)) {
        const taken = V.Expedition.takeIngredient(loot, id);
        assert.ok(taken.ok, id);
        loot = taken.state;
        gathered.add(id);
      }
    }
  }
  assert.deepEqual([...gathered].sort(), Object.keys(V.Kitchen.INGREDIENTS).sort());
});

test('食材正常撤离全入仓、紧急按总量保留一半、败退清空；旧档及计数校验', () => {
  const { A, V, st } = boot(452);
  const s = startRun(A, st, 452);
  const [first, second] = Object.keys(V.Kitchen.INGREDIENTS).sort();
  s.pantry = { [first]: 5 };
  s.run.ingredients = { [second]: 4, [first]: 1 };
  const total = V.Expedition.extract(s).state;
  assert.deepEqual(total.settlement.ingredients, { [first]: 1, [second]: 4 });
  assert.deepEqual(total.pantry, { [first]: 6, [second]: 4 });
  const emergency = V.Expedition.retreat(s, 'emergency').state;
  assert.deepEqual(emergency.settlement.ingredients, { [first]: 1, [second]: 2 });
  assert.deepEqual(emergency.pantry, { [first]: 6, [second]: 2 });
  const loss = V.Expedition.retreat(s, 'defeat').state;
  assert.deepEqual(loss.settlement.ingredients, {});
  assert.deepEqual(loss.pantry, s.pantry);
  assert.ok(V.Storage.decode(V.Storage.encode(emergency)).ok);
  const legacy = V.State.clone(s);
  delete legacy.pantry; delete legacy.cookedRecipes;
  delete legacy.run.ingredients; delete legacy.run.ingredientLoot;
  assert.ok(V.Storage.decode(V.Storage.encode(legacy)).ok);
  for (const bad of [
    { ...s, pantry: { bogus: 2 } },
    { ...s, cookedRecipes: { [Object.keys(V.Kitchen.RECIPES)[0]]: 0 } },
    { ...s, run: { ...s.run, ingredients: { [first]: -1 } } },
    { ...s, run: { ...s.run, ingredients: { [first]: 25 } } },
    { ...s, run: { ...s.run, ingredientLoot: { [first]: 1 } } },
  ]) assert.equal(V.Storage.decode(V.Storage.encode(bad)).ok, false);
});

test('每处营火只免费休息一次，读档保留次数，下一处重新开放', () => {
  const { A, V, st } = boot(453);
  let s = atCamp(A, startRun(A, st, 453));
  const p = s.run.party[0];
  p.hp = 1;
  p.stress = 80;
  const maxHp = V.Roster.stats(s, V.State.unitById(s, p.uid)).maxHp;
  const rested = V.Expedition.campRest(s);
  assert.ok(rested.ok);
  assert.equal(rested.state.run.party[0].hp, 1 + Math.round(maxHp * 0.45));
  assert.equal(rested.state.run.party[0].stress, 50);
  s = V.Storage.decode(V.Storage.encode(rested.state)).state;
  const again = V.Expedition.campRest(s);
  assert.equal(again.error.code, 'already_rested');
  assert.equal(again.state, s);
  const second = atCamp(A, V.Expedition.finishNode(s).state);
  assert.equal(second.run.campRested, false);
  assert.ok(V.Expedition.campRest(second).ok);
});
