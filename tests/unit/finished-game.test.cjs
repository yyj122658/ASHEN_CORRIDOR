'use strict';
/* 完整构筑必须能在真实异形板上成立，并兑现战斗文本。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVeteran } = require('../helpers/load-veteran.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('蚀刻法与纹路分层：单件压不满骨架，起手通路才接通', () => {
  /* 六标之后骨架有 6~54 格，「一件 straight 压满 → 100% 贯通」这件事不再成立，
     而它本来想守的语义是**分层**：纹路是填充物，不是一件就点亮的开关。
     现在守两半：单件压不满（pct < 100、接不通），起手通路能接通。 */
  const V = loadVeteran().Veteran;
  const st = V.State.create(42);
  const u = st.roster[0];
  const part = st.itemsById[u.board.placements[0].itemId];
  part.templateId = 'straight';
  const single = [{ itemId: part.id, x: u.manuscript.x, y: u.manuscript.y, rotation: 0, mirrorY: false }];
  assert.equal(V.Circuit.preview(st, u.id, single).ok, true);
  assert.ok(V.Circuit.manuscriptState(st, u.id, single).pct < 100, '单件不该压满整块骨架');

  const loadout = V.Circuit.autoLoadout(st, u);
  assert.ok(loadout && loadout.length >= 2, '起手通路应铺得出来');
  const ms = V.Circuit.manuscriptState(st, u.id, loadout);
  assert.equal(ms.routed, true, '起手通路应接通');
  assert.ok(ms.pulse.path.length >= 2);
});

test('新队伍有铁鸦与灰烬两人，开局已形成共鸣', () => {
  const V = loadVeteran().Veteran;
  for (const seed of [1, 42, 20261112]) {
    const st = V.State.create(seed);
    assert.deepEqual(Array.from(st.roster,u=>u.skinId),['blade','ranger']);
    assert.deepEqual(Array.from(st.team),[...st.roster.map(u=>u.id),null,null]);
    assert.equal(new Set(st.roster.map(u=>u.manuscript.id)).size,2);
    for (const u of st.roster) {
      /* 开局要「已经形成共鸣」：通路接通、面板有占格。
         不再要求 100% 覆盖 —— 骨架扩到 6~54 格之后，开局铺不满是设计而不是缺陷。 */
      const ms = V.Circuit.manuscriptState(st, u.id);
      assert.equal(ms.routed, true, `${u.name} 开局应已接通`);
      assert.ok(ms.pct > 0, `${u.name} 开局应有覆盖`);
      assert.equal(V.Circuit.preview(st, u.id, u.board.placements).ok, true);
    }
  }
});

/** 使用真实战斗步骤，仅隔离其他单位的行动。@returns {object} */
function battleFixture() {
  const V = loadVeteran().Veteran;
  let st = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
  const generated = V.Combat.generateEncounter(st, 'normal');
  st = V.Combat.create(generated.state, generated.enemyBlueprint, generated.combatRngStart).state;
  const b = st.run.battle;
  [...b.allies, ...b.enemies].forEach((u) => { u.atkTimer = -100; u.dodge = 0; u.hits = 1; u.crit = 0; });
  const actor = b.allies[0];
  return { V, st, b, actor };
}

test('贯穿招式真实命中前两位，未命中的后位不受伤', () => {
  const { V, st, b, actor } = battleFixture();
  actor.casting = 'pierce'; actor.castTimer = 0;
  actor.pendingSkill = V.Data.MANUSCRIPTS.corridor5.skills[0];
  const before = b.enemies.map((u) => u.hp);
  const after = V.Combat.step(st).state.run.battle.enemies;
  assert.ok(after[0].hp < before[0]);
  assert.ok(after[1].hp < before[1]);
  assert.equal(after[2].hp, before[2]);
});

test('护持条件未满足时不会消耗共振余裕', () => {
  const { V, st, actor } = battleFixture();
  actor.skillList = [{ id: 'care', cost: 1, cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 1 } }];
  actor.energy = 10; actor.atkTimer = 100;
  const after = V.Combat.step(st).state.run.battle.allies[0];
  assert.equal(after.casting, null);
  assert.ok(after.energy >= 10);
});

test('确认战利品保留实际模板，不把所有掉落变成顺丝纹', () => {
  const V = loadVeteran().Veteran;
  let st = V.Expedition.start(V.State.create(42), { seed: 42 }).state;
  const node = st.run.nodes.find((n) => n.risk !== 'none');
  st = V.Encounter.open(st, node.id).state;
  st = V.Encounter.startAttempt(st).state;
  st.run.battle.over = true; st.run.battle.win = true; st.run.battle.outcome = 'win';
  V.Combat.prepareResult(st);
  st.run.encounter.pendingResult.rewardSpec.drops = [{ kind: 'circuit', templateId: 'capacitor' }];
  const r = V.Encounter.confirm(st);
  assert.equal(r.ok, true);
  const [id] = r.state.run.pendingLoot;
  assert.equal(r.state.itemsById[id].templateId, 'capacitor');
  assert.equal(r.state.run.bag.includes(id), false);
  const taken = V.Expedition.resolveLoot(r.state, id, 'take').state;
  assert.ok(taken.run.bag.includes(id));
  assert.equal(taken.run.pendingLoot.includes(id), false);
});

test('起手余裕、共享冷却和临时强化兑现实际效果', () => {
  const { V, st, b, actor } = battleFixture();
  assert.ok(actor.energy > 0, '共鸣起手余裕不能被重复字段清零');
  actor.skillList = V.Data.MANUSCRIPTS.twinflow.skills;
  actor.energy = 20; actor.atkTimer = 100;
  const after = V.Combat.step(st).state.run.battle.allies[0];
  assert.ok(after.cds.flowA > 0 && after.cds.flowB > 0, '两招共享冷却');
  actor.casting = 'flurry'; actor.castTimer = 0;
  actor.pendingSkill = V.Data.MANUSCRIPTS.flurry.skills[0];
  const boosted = V.Combat.step(st).state;
  assert.ok(boosted.run.battle.allies[0].buffs.some((x) => x.k === 'atkUp'));
  /* 强化按「次」结算：不挂秒表，只有打完次数才消失 */
  const hits = boosted.run.battle.allies[0].buffs.find((x) => x.k === 'atkUp').hits;
  assert.equal(typeof hits, 'number', '强化要记剩余次数，而不是秒数');
  let next = boosted;
  for (let i = 0; i < 60; i++) {
    next = V.Combat.step(next).state;
    const buff = next.run.battle.allies[0].buffs.find((x) => x.k === 'atkUp');
    if (!buff) break;
    assert.ok(buff.hits > 0, '剩余次数必须是正数');
  }
  assert.equal(next.run.battle.allies[0].buffs.some((x) => x.k === 'atkUp'), false, '打完次数后强化消失');

  /* 反面：次数给足时，时间过去也不会被清掉（不再有秒表） */
  const plenty = V.State.clone(boosted);
  plenty.run.battle.allies[0].buffs = [{ k: 'atkUp', v: 0.5, hits: 99 }];
  let slow = plenty;
  for (let i = 0; i < 40; i++) slow = V.Combat.step(slow).state;
  assert.ok(slow.run.battle.allies[0].buffs.some((x) => x.k === 'atkUp'), '按次数结算，不该被时间清掉');
});

test('治疗贡献属于施法者，战场1号位确实最靠近敌人', () => {
  const { V, st, b, actor } = battleFixture();
  actor.casting = 'care'; actor.castTimer = 0;
  actor.pendingSkill = { id: 'care', target: 'ally', effect: { heal: 1 } };
  /* v4.0 的完整度只有 25~120：按比例掉血，别直接打成负数（死了就没人可治） */
  b.allies[1].hp = Math.max(1, b.allies[1].hp - Math.round(b.allies[1].maxHp * 0.5));
  const after = V.Combat.step(st).state.run.battle;
  assert.ok(after.allies[0].stats.healing > 0);
  assert.equal(after.allies[1].stats.healing, 0);
  const A = loadVeteran();
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/veteran/view.js'), 'utf8'), { Ashen: A });
  assert.ok(A.Veteran.View.targetX({ side: 'ally', slot: 0 }) > A.Veteran.View.targetX({ side: 'ally', slot: 3 }));
});

test('旧档携带双流旧招式顺序，仍使用当前规则择机护持', () => {
  const V = loadVeteran().Veteran;
  /* 77 格异形板 + 真实装配：双流是 44 格的骨卷，14 格经典夹具塞不下 */
  let st = V.State.create(42);
  const ms = V.Data.MANUSCRIPTS.twinflow;
  V.State.equipManuscript(st, st.roster[0], 'twinflow');
  V.Circuit.autoLoadout(st, st.roster[0]);
  st.roster[0].manuscript = {
    ...st.roster[0].manuscript,
    skills: [ms.skills.find((s) => s.id === 'flowA'), { ...ms.skills.find((s) => s.id === 'flowB'), cond: { energyAbove: 14 } }],
  };
  const decoded = V.Storage.decode(V.Storage.encode(st));
  assert.equal(decoded.ok, true);
  st = V.Expedition.start(decoded.state, { seed: 42 }).state;
  const generated = V.Combat.generateEncounter(st, 'normal');
  st = V.Combat.create(generated.state, generated.enemyBlueprint, generated.combatRngStart).state;
  const b = st.run.battle;
  [...b.allies, ...b.enemies].forEach((u) => { u.atkTimer = -100; });
  b.allies[0].atkTimer = 100; b.allies[0].energy = 20;
  /* 双流的右流要「有人受伤」（<60%）才排到前面 */
  b.allies[1].hp = Math.max(1, Math.round(b.allies[1].maxHp * 0.4));
  assert.equal(V.Combat.step(st).state.run.battle.allies[0].casting, 'flowB');
});
