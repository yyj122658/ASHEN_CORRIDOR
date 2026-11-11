'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes } = require('../helpers/veteran-run.cjs');

/** 放一件本局新构件进背包。 */
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
  let s = startRun(A, V.State.create(4242), 301);
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
  let s = startRun(A, V.State.create(4242), 302);
  const keep = addNewPart(A, s, 'straight', 1);
  const incoming = addNewPart(A, s, 'elbow', 2);
  s.run.pendingLoot.push(incoming.id);
  s.run.bag = s.run.bag.filter((id) => id !== incoming.id);

  const r = V.Expedition.resolveLoot(s, incoming.id, 'replace:' + keep.id);
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.ok(r.state.run.bag.includes(incoming.id));
  assert.ok(!r.state.run.bag.includes(keep.id));
  assert.equal(r.state.itemsById[keep.id], undefined, '被替换的构件要从 registry 清掉');
});

test('营火烙印未提交时不扣生命与压力', () => {
  const { A, V } = boot(303);
  let s = startRun(A, V.State.create(4242), 303);
  const before = s.run.party.map((p) => p.hp);
  s = atCamp(A, s);
  assert.equal(s.run.stage, 'camp');
  assert.deepEqual(s.run.party.map((p) => p.hp), before);
  assert.equal(s.run.maxHpModifiers[Object.keys(s.run.maxHpModifiers)[0]], undefined);
});

test('营火烙印：生命 ×0.8、当前 HP 等比、压力 +40，每角色每局一次', () => {
  const { A, V } = boot(304);
  let s = startRun(A, V.State.create(4242), 304);
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

  /* 第二次必须拒绝 */
  const second = addNewPart(A, s, 'ember', 2);
  const r2 = V.Expedition.inscribe(s, unit.id, second.id, proposed.concat([
    { itemId: second.id, x: 1, y: 0, rotation: 0, mirrorY: false },
  ]));
  assert.ok(!r2.ok);
  assert.equal(r2.error.code, 'cannot_inscribe');
});

test('烙印不能丢掉原构件，也不能塞两件新件', () => {
  const { A, V } = boot(305);
  let s = startRun(A, V.State.create(4242), 305);
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

test('ember 默认替换线在三个底盘上都能接通主手', () => {
  const { A, V } = boot(306);
  let s = startRun(A, V.State.create(4242), 306);
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
    assert.ok(pv.reachableOutputs.includes('main'), `${body} 应接通主手`);
  });
});

test('紧急撤退保留一半新件、全部带入件，压力入场 +10', () => {
  const { A, V } = boot(307);
  let s = startRun(A, V.State.create(4242), 307);
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
  let s = startRun(A, V.State.create(4242), 308);
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
  let s = startRun(A, V.State.create(4242), 309);
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
  let s = startRun(A, V.State.create(4242), 310);
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
  assert.equal(records, 4, '每个参战角色一条战史');

  /* 幂等：重复调用不能再来一次 */
  const again = V.Expedition.extract(out);
  assert.ok(!again.ok);
  assert.equal(again.error.code, 'no_run');
});

test('0 完成层正常撤离没有收益也不算合格', () => {
  const { A, V } = boot(311);
  let s = startRun(A, V.State.create(4242), 311);
  const goldBefore = s.gold;
  const r = V.Expedition.extract(s);
  assert.ok(r.ok);
  assert.equal(r.state.gold, goldBefore);
  assert.equal(r.state.settlement.eligible, false);
  assert.ok(r.state.settlement.reason.includes('0 层'));
});
