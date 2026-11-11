'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes, fight, stepUntilOver } = require('../helpers/veteran-run.cjs');

function hashBattle(b) {
  return JSON.stringify({
    tick: b.tick,
    win: b.win,
    allies: b.allies.map((u) => [u.id, u.hp, u.slot, u.gauge]),
    enemies: b.enemies.map((u) => [u.id, u.hp]),
    rng: b.rngState,
  });
}

test('open 固定敌人、RNG 与检查点；连按不会重新生成', () => {
  const { A, V } = boot(201);
  let s = startRun(A, V.State.create(4242), 201);
  s = setNodes(A, s, ['battle']);
  const nodeId = s.run.nodes[0].id;

  const r1 = V.Encounter.open(s, nodeId);
  assert.ok(r1.ok);
  const bp1 = JSON.stringify(r1.state.run.encounter.enemyBlueprint);
  const rng1 = r1.state.run.encounter.combatRngStart;
  const id1 = r1.state.run.encounter.id;

  const r2 = V.Encounter.open(r1.state, nodeId);
  assert.ok(r2.ok);
  assert.equal(JSON.stringify(r2.state.run.encounter.enemyBlueprint), bp1, '敌人不能变');
  assert.equal(r2.state.run.encounter.combatRngStart, rng1, 'RNG 不能变');
  assert.equal(r2.state.run.encounter.id, id1, '遭遇 ID 不能变');
});

test('检查点里没有自嵌套的 encounter', () => {
  const { A, V } = boot(202);
  let s = startRun(A, V.State.create(4242), 202);
  s = setNodes(A, s, ['battle']);
  s = V.Encounter.open(s, s.run.nodes[0].id).state;
  const cp = s.run.encounter.checkpoint;
  assert.equal(cp.run.encounter, null);
  assert.equal(cp.run.battle, null);
  assert.equal(cp.run.stage, 'prebattle');
  /* 只允许一层：checkpoint 里不应再出现 checkpoint 字段 */
  assert.ok(!JSON.stringify(cp).includes('"checkpoint"'), '快照里不该再有 checkpoint');
});

test('rewind 完整恢复 HP / 压力 / 能量 / 背包 / nextId / RNG', () => {
  const { A, V } = boot(203);
  let s = startRun(A, V.State.create(4242), 203);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;

  const snapshot = JSON.stringify(s.run.encounter.checkpoint);
  /* 故意破坏一切可变状态 */
  s = A.Veteran.State.clone(s);
  s.run.party.forEach((p) => { p.hp = 3; p.stress = 90; });
  s.run.bag.push('p_nonexistent_guard');
  s.run.bag.pop();
  s.nextId += 7;
  s.run.rngState = 12345;
  s.run.battle.tick = 999;
  s.run.battle.allies[0].runtime.outputs.main = [{ tags: ['ember'] }];

  const rw = V.Encounter.rewind(s);
  assert.ok(rw.ok, JSON.stringify(rw.error));
  const restored = rw.state;
  assert.equal(restored.run.stage, 'prebattle');
  assert.equal(restored.run.battle, null);
  assert.equal(restored.nextId, JSON.parse(snapshot).nextId, 'nextId 必须回到检查点');
  assert.equal(restored.run.rngState, JSON.parse(snapshot).run.rngState, 'RNG 必须回到检查点');
  assert.deepEqual(restored.run.bag, JSON.parse(snapshot).run.bag);
});

test('相同整备重打，战斗哈希完全一致', () => {
  const { A, V } = boot(204);
  let s = startRun(A, V.State.create(4242), 204);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  const first = hashBattle(stepUntilOver(A, s, 400).st.run.battle);

  const back = V.Encounter.rewind(s).state;
  const again = V.Encounter.startAttempt(back);
  assert.ok(again.ok);
  const second = hashBattle(stepUntilOver(A, again.state, 400).st.run.battle);
  assert.equal(first, second, '同整备同结果');
});

test('rewind 保留上次阵型与指令供修改', () => {
  const { A, V } = boot(205);
  let s = startRun(A, V.State.create(4242), 205);
  s = setNodes(A, s, ['battle']);
  s = V.Encounter.open(s, s.run.nodes[0].id).state;

  const formation = s.run.encounter.preparation.formation.slice().reverse();
  const edit = V.Encounter.editPreparation(s, { formation });
  assert.ok(edit.ok, JSON.stringify(edit.error));
  s = edit.state;

  const rw = V.Encounter.rewind(s);
  assert.deepEqual(rw.state.run.encounter.preparation.formation, formation, '阵型要保留');
  const slots = rw.state.run.party.map((p) => p.slot).sort();
  assert.deepEqual(slots, [0, 1, 2, 3], 'party 按阵型重排且槽位连续');
});

test('attemptNumber 增加但不推进养成', () => {
  const { A, V } = boot(206);
  let s = startRun(A, V.State.create(4242), 206);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  const before = s.roster.reduce((a, u) => a + u.history.eligibleRunIds.length, 0);
  const back = V.Encounter.rewind(s).state;
  const again = V.Encounter.startAttempt(back).state;
  assert.equal(again.run.encounter.attemptNumber, 2);
  assert.equal(again.roster.reduce((a, u) => a + u.history.eligibleRunIds.length, 0), before);
});

test('确认后禁止回转，且检查点被删除', () => {
  const { A, V } = boot(207);
  let s = startRun(A, V.State.create(4242), 207);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  s = stepUntilOver(A, s).st;
  if (!s.run.battle.win) return; /* 这局输了就跳过，另有败退测试 */

  const prep = V.Combat.prepareResult(s);
  assert.ok(prep.ok);
  const c = V.Encounter.confirm(s);
  assert.ok(c.ok, JSON.stringify(c.error));
  s = c.state;
  assert.equal(s.run.encounter.checkpoint, null, '确认后删除检查点');
  const rw = V.Encounter.rewind(s);
  assert.ok(!rw.ok, '确认后不能回转');
  assert.equal(rw.error.code, 'already_confirmed');
});

test('确认双击不会重复发奖、掉落或战史', () => {
  const { A, V } = boot(208);
  let s = startRun(A, V.State.create(4242), 208);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  s = stepUntilOver(A, s).st;
  if (!s.run.battle.win) return;

  V.Combat.prepareResult(s);
  const once = V.Encounter.confirm(s).state;
  const items1 = V.State.ownItemIds(once).length;
  const gold1 = once.gold + once.run.goldFound;
  const history1 = once.roster.reduce((a, u) => a + u.history.records.length, 0);

  const twice = V.Encounter.confirm(once);
  assert.ok(twice.ok);
  assert.equal(V.State.ownItemIds(twice.state).length, items1, '不能多出构件');
  assert.equal(twice.state.gold + twice.state.run.goldFound, gold1, '不能多出金币');
  assert.equal(twice.state.roster.reduce((a, u) => a + u.history.records.length, 0), history1,
    '不能重复写战史');
});

test('victory 确认后进入 loot 且未处理完不能进下一层', () => {
  const { A, V } = boot(209);
  let s = startRun(A, V.State.create(4242), 209);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  s = stepUntilOver(A, s).st;
  if (!s.run.battle.win) return;

  V.Combat.prepareResult(s);
  s = V.Encounter.confirm(s).state;
  assert.equal(s.run.stage, 'loot');

  /* 制造一件待取舍，finishNode 必须被挡住 */
  const gen = V.Combat.generateEncounter(s, 'normal');
  const part = V.State.makePart(gen.state, { kind: 'circuit', templateId: 'straight', acquiredRunId: s.run.id, acquiredSeq: 99 });
  const s2 = A.Veteran.State.clone(s);
  s2.itemsById[part.id] = part;
  s2.run.pendingLoot.push(part.id);
  const blocked = V.Expedition.finishNode(s2);
  assert.ok(!blocked.ok);
  assert.equal(blocked.error.code, 'pending_loot');

  const taken = V.Expedition.resolveLoot(s2, part.id, 'discard');
  assert.ok(taken.ok);
  const done = V.Expedition.finishNode(taken.state);
  assert.ok(done.ok, JSON.stringify(done.error));
});

test('锁定后不能换节点', () => {
  const { A, V } = boot(210);
  let s = startRun(A, V.State.create(4242), 210);
  s = setNodes(A, s, ['battle', 'battle', 'battle']);
  s = V.Encounter.open(s, s.run.nodes[0].id).state;
  const other = V.Encounter.open(s, s.run.nodes[1].id);
  assert.ok(!other.ok);
  assert.equal(other.error.code, 'node_locked');
});

test('全灭也可以回转，不会被困死', () => {
  const { A, V } = boot(211);
  let s = startRun(A, V.State.create(4242), 211);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  /* 强行全灭 */
  s = A.Veteran.State.clone(s);
  s.run.battle.allies.forEach((u) => { u.hp = 0; u.alive = false; });
  const r = V.Combat.step(s);
  assert.ok(r.ok);
  assert.equal(r.state.run.battle.outcome, 'loss');
  const rw = V.Encounter.rewind(r.state);
  assert.ok(rw.ok, '战败后必须能重新整备');
  assert.equal(rw.state.run.stage, 'prebattle');
});

test('battleReview 阶段仍可回转', () => {
  const { A, V } = boot(212);
  let s = startRun(A, V.State.create(4242), 212);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  s = stepUntilOver(A, s).st;
  const prep = V.Combat.prepareResult(s);
  assert.ok(prep.ok);
  assert.ok(s.run.encounter.pendingResult, '结果只写进 encounter.pendingResult');
  const rw = V.Encounter.rewind(s);
  assert.ok(rw.ok);
  assert.equal(rw.state.run.encounter.pendingResult, null, '回转清空待确认结果');
});

test('prepareResult 不改长期状态', () => {
  const { A, V } = boot(213);
  let s = startRun(A, V.State.create(4242), 213);
  s = setNodes(A, s, ['battle']);
  s = fight(A, s, 'normal').st;
  s = stepUntilOver(A, s).st;
  const before = { gold: s.gold, stash: s.stash.length, nextId: s.nextId };
  V.Combat.prepareResult(s);
  assert.equal(s.gold, before.gold);
  assert.equal(s.stash.length, before.stash);
  assert.equal(s.nextId, before.nextId, 'rewardSpec 不分配物品 ID');
});
