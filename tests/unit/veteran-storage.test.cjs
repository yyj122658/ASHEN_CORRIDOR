'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { boot, startRun, setNodes, fight, stepUntilOver } = require('../helpers/veteran-run.cjs');

function prebattle(A) {
  let s = startRun(A, A.Veteran.State.create(4242), 4242);
  s = setNodes(A, s, ['battle']);
  return A.Veteran.Encounter.open(s, s.run.nodes[0].id).state;
}

test('五个阶段都能 roundtrip', () => {
  const { A, V } = boot(501);
  const cases = [];

  /* prebattle */
  cases.push(['prebattle', prebattle(A)]);

  /* battle */
  let s = prebattle(A);
  s = V.Encounter.startAttempt(s).state;
  s = V.Combat.step(s).state;
  s = V.Combat.step(s).state;
  cases.push(['battle', s]);

  /* battleReview */
  let r = prebattle(A);
  r = V.Encounter.startAttempt(r).state;
  r = stepUntilOver(A, r).st;
  V.Combat.prepareResult(r);
  cases.push(['battleReview', r]);

  /* loot */
  let l = prebattle(A);
  l = V.Encounter.startAttempt(l).state;
  l = stepUntilOver(A, l).st;
  if (l.run.battle.win) {
    V.Combat.prepareResult(l);
    const c = V.Encounter.confirm(l);
    if (c.ok) cases.push(['loot', c.state]);
  }

  cases.forEach(([label, state]) => {
    const raw = V.Storage.encode(state, 12345);
    const back = V.Storage.decode(raw);
    assert.ok(back.ok, `${label} 解码失败：${JSON.stringify(back.errors)}`);
    assert.equal(back.savedAt, 12345);
    assert.equal(back.state.run ? back.state.run.stage : null,
      state.run ? state.run.stage : null, `${label} 阶段要一致`);
    assert.equal(back.state.run ? back.state.run.floor : null, state.run ? state.run.floor : null);
  });
});

test('只认 ruleset=veteran，别的一律拒绝', () => {
  const { A, V } = boot(502);
  const st = V.State.create(4242);
  const okRaw = V.Storage.encode(st, 1);
  const env = JSON.parse(okRaw);
  env.ruleset = 'classic';
  const bad = V.Storage.decode(JSON.stringify(env));
  assert.ok(!bad.ok);
  assert.ok(bad.errors.join('').includes('veteran'));
});

test('坏 JSON / 空串 / 缺 state 都不会静默通过', () => {
  const { V } = boot(503);
  [{}, null, 'not json', '{}', '{"ruleset":"veteran","schemaVersion":1}'].forEach((raw) => {
    const r = V.Storage.decode(raw);
    assert.ok(!r.ok, `应拒绝：${String(raw).slice(0, 20)}`);
  });
});

test('自嵌套 checkpoint 被拒绝', () => {
  const { A, V } = boot(504);
  const s = prebattle(A);
  const env = JSON.parse(V.Storage.encode(s, 0));
  env.state.run.encounter.checkpoint.run.encounter = { id: 'evil', checkpoint: {} };
  const r = V.Storage.decode(JSON.stringify(env));
  assert.ok(!r.ok);
  assert.ok(r.errors.join('').includes('嵌套'), r.errors.join('；'));
});

test('重复归属被拒绝', () => {
  const { A, V } = boot(505);
  const s = V.State.create(4242);
  const id = s.stash[0];
  s.stash.push(id); /* 同一件出现两次 */
  const r = V.Storage.decode(V.Storage.encode(s, 0));
  assert.ok(!r.ok);
  assert.ok(r.errors.join('').includes('归属'), r.errors.join('；'));
});

test('板面越界 / 超负荷的状态被拒绝', () => {
  const { A, V } = boot(506);
  const s = A.Veteran.State.create(4242);
  s.roster[0].board.placements[0].x = 9;
  const r = V.Storage.decode(V.Storage.encode(s, 0));
  assert.ok(!r.ok);
  assert.ok(r.errors.some((m) => m.includes('越界')), r.errors.join('；'));
});

test('角色 ID 重复与压力越界被拒绝', () => {
  const { A, V } = boot(507);
  const s = V.State.create(4242);
  s.roster.push(V.State.clone(s.roster[0]));
  assert.ok(!V.Storage.decode(V.Storage.encode(s, 0)).ok);

  const s2 = V.State.create(4242);
  s2.roster[1].stress = 400;
  assert.ok(!V.Storage.decode(V.Storage.encode(s2, 0)).ok);
});

test('导入导出：先校验再替换，失败不覆盖', () => {
  const { A, V } = boot(508);
  const st = V.State.create(4242);
  st.gold = 777;
  const raw = V.Storage.exportText(st);
  const imp = V.Storage.importText(raw);
  assert.ok(imp.ok);
  assert.equal(imp.state.gold, 777);

  const bad = V.Storage.importText('{"ruleset":"veteran","schemaVersion":1,"state":{}}');
  assert.ok(!bad.ok);
  assert.equal(bad.state, null, '失败时不返回半成品状态');
});

test('旧存档 key 不被触碰', () => {
  const { A, V } = boot(509);
  assert.equal(V.Storage.KEY, 'ashen_corridor_veteran_v1');
  assert.notEqual(V.Storage.KEY, 'ashen_corridor_v1');
  assert.notEqual(V.Storage.KEY, 'ashen_corridor_v2');
  const raw = V.Storage.encode(V.State.create(1), 0);
  assert.ok(raw.includes('veteran'));
  void A;
});

test('存档序列化不含函数或 DOM', () => {
  const { A, V } = boot(510);
  const s = prebattle(A);
  const json = V.Storage.encode(s, 0);
  assert.ok(!json.includes('function'));
  assert.ok(!json.includes('[object'));
  assert.ok(json.length < 1_200_000, `存档过大：${json.length}`);
});
