'use strict';
/* 平衡与稳定性冒烟：固定种子跑多场遭遇与完整远征，任何非法状态都算失败。
   这里不判断“数值好不好”，只判断“规则有没有被破坏”。 */
const test = require('node:test');
const assert = require('node:assert');
const { loadVeteran } = require('../helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const D = V.Data;

function oneFight(seed, kind, floor) {
  let st = V.State.create(seed);
  const started = V.Expedition.start(st, { seed });
  assert.ok(started.ok, JSON.stringify(started.error));
  st = started.state;
  st.run.floor = floor;
  st.run.nodes = [{ id: 'n', type: kind === 'boss' ? 'boss' : kind === 'elite' ? 'elite' : 'battle', consumed: false }];

  const opened = V.Encounter.open(st, 'n');
  assert.ok(opened.ok, JSON.stringify(opened.error));
  const att = V.Encounter.startAttempt(opened.state);
  assert.ok(att.ok, JSON.stringify(att.error));
  st = att.state;

  let ticks = 0;
  while (st.run.battle && !st.run.battle.over && ticks < 4000) {
    const r = V.Combat.step(st);
    assert.ok(r.ok, `step 失败：${JSON.stringify(r.error)}`);
    st = r.state;
    ticks += 1;
  }
  const v = V.State.validate(st);
  assert.ok(v.ok, `战斗结束后状态非法：${v.errors.slice(0, 3).join('；')}`);
  return { st, battle: st.run.battle, ticks };
}

test('固定种子下三种遭遇都能打完且状态合法（12 局）', () => {
  const kinds = [['normal', 1], ['normal', 4], ['elite', 4], ['boss', 7]];
  let total = 0;
  kinds.forEach(([kind, floor]) => {
    for (let seed = 1; seed <= 3; seed++) {
      const r = oneFight(seed * 7919, kind, floor);
      assert.ok(r.battle.over, `${kind} 应该结束`);
      assert.ok(r.ticks < 4000, `${kind} 不该超时`);
      total += 1;
    }
  });
  assert.equal(total, 12);
});

test('战斗回合数落在可玩区间（不出现一回合速通或无限拖）', () => {
  const r = oneFight(1013, 'normal', 1);
  assert.ok(r.battle.round >= 2, `normal@1 回合太少：${r.battle.round}`);
  assert.ok(r.battle.round <= 30, `normal@1 回合太多：${r.battle.round}`);
});

test('七层流程能走到结算，且完成层数与战史自洽', () => {
  let st = V.State.create(4242);
  st = V.Expedition.start(st, { seed: 4242 }).state;
  let guard = 0;

  while (st.run && guard++ < 200) {
    const r = st.run;
    const stage = r.stage;

    if (stage === 'map') {
      const left = r.nodes.filter((n) => !n.consumed);
      assert.ok(left.length > 0, '地图上应该还有可选节点');
      const pick = left.find((n) => n.type === 'boss') || left[0];
      const c = V.Expedition.chooseNode(st, pick.id);
      assert.ok(c.ok, JSON.stringify(c.error));
      st = c.state;
      continue;
    }
    if (stage === 'prebattle') {
      const a = V.Encounter.startAttempt(st);
      assert.ok(a.ok, JSON.stringify(a.error));
      st = a.state;
      continue;
    }
    if (stage === 'battle') {
      let t = 0;
      while (st.run.battle && !st.run.battle.over && t < 4000) {
        st = V.Combat.step(st).state;
        t += 1;
      }
      const prep = V.Combat.prepareResult(st);
      assert.ok(prep.ok, JSON.stringify(prep.error));
      if (prep.pendingResult.outcome === 'win') {
        const c = V.Encounter.confirm(st);
        assert.ok(c.ok, JSON.stringify(c.error));
        st = c.state;
      } else {
        const d = V.Expedition.retreat(st, 'defeat');
        assert.ok(d.ok);
        st = d.state;
        break;
      }
      continue;
    }
    if (stage === 'loot') {
      let i = 0;
      while (st.run.pendingLoot.length && i++ < 12) {
        const r2 = V.Expedition.resolveLoot(st, st.run.pendingLoot[0], 'discard');
        assert.ok(r2.ok);
        st = r2.state;
      }
      const f = V.Expedition.finishNode(st);
      assert.ok(f.ok, JSON.stringify(f.error));
      st = f.state;
      continue;
    }
    if (stage === 'camp' || stage === 'merchant') {
      const f = V.Expedition.finishNode(st);
      assert.ok(f.ok, JSON.stringify(f.error));
      st = f.state;
      continue;
    }
    if (stage === 'blessing') {
      const c = V.Expedition.chooseBlessing(st, st.run.blessingOptions[0]);
      assert.ok(c.ok);
      st = c.state;
      continue;
    }
    if (stage === 'event') {
      if (!st.run.event.resolved) {
        const ev = D.event(st.run.event.eventId);
        const c = V.Expedition.chooseEvent(st, ev.choices[ev.choices.length - 1].id);
        assert.ok(c.ok, JSON.stringify(c.error));
        st = c.state;
        continue;
      }
      if (st.run.pendingLoot.length) {
        st = V.Expedition.resolveLoot(st, st.run.pendingLoot[0], 'discard').state;
        continue;
      }
      const f = V.Expedition.finishNode(st);
      assert.ok(f.ok, JSON.stringify(f.error));
      st = f.state;
      continue;
    }
    assert.fail('未知阶段：' + stage);
  }

  assert.equal(st.run, null, '流程应当以结算收尾，而不是卡住');
  assert.ok(st.settlement, '应该有结算');
  assert.ok(st.settlement.depth >= 1, '完成层数应至少 1');
  const v = V.State.validate(st);
  assert.ok(v.ok, v.errors.slice(0, 3).join('；'));
});

test('第 7 层没打首领不能算完成', () => {
  let st = V.State.create(4242);
  st = V.Expedition.start(st, { seed: 4242 }).state;
  st.run.floor = 7;
  st.run.nodes = [
    { id: 'b1', type: 'boss', consumed: false, name: '回廊尽头', risk: 'deadly', artId: 'node.boss' },
    { id: 'c1', type: 'chest', consumed: false, name: '箱子', risk: 'low', artId: 'node.chest' },
  ];
  const c = V.Expedition.chooseNode(st, 'c1');
  assert.ok(c.ok);
  let s2 = c.state;
  let i = 0;
  while (s2.run.pendingLoot.length && i++ < 6) {
    s2 = V.Expedition.resolveLoot(s2, s2.run.pendingLoot[0], 'discard').state;
  }
  const f = V.Expedition.finishNode(s2);
  assert.ok(f.ok, JSON.stringify(f.error));
  assert.ok(f.state.run, '第 7 层的箱子不该直接结束远征');
  assert.equal(f.state.run.stage, 'map');
  assert.ok(f.state.run.nodes.some((n) => n.type === 'boss' && !n.consumed), '首领还必须留着');
});

test('战斗节点会被标记完成并记录层数', () => {
  let st = V.State.create(55);
  st = V.Expedition.start(st, { seed: 55 }).state;
  st.run.nodes = [{ id: 'nb', type: 'battle', consumed: false, name: '残响战斗', risk: 'low', artId: 'node.battle' }];
  st = V.Encounter.open(st, 'nb').state;
  st = V.Encounter.startAttempt(st).state;
  let t = 0;
  while (st.run.battle && !st.run.battle.over && t < 4000) { st = V.Combat.step(st).state; t += 1; }
  const prep = V.Combat.prepareResult(st);
  if (prep.pendingResult.outcome !== 'win') return; /* 输了这条不适用 */
  st = V.Encounter.confirm(st).state;
  let i = 0;
  while (st.run.pendingLoot.length && i++ < 8) {
    st = V.Expedition.resolveLoot(st, st.run.pendingLoot[0], 'discard').state;
  }
  const f = V.Expedition.finishNode(st);
  assert.ok(f.ok, JSON.stringify(f.error));
  assert.ok(f.state.run.completedFloors >= 1, `完成层数应 ≥1，实际 ${f.state.run.completedFloors}`);
  assert.ok(f.state.run.completedNodeIds.includes('nb'));
});
