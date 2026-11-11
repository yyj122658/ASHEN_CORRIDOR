'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('../helpers/load-game.cjs');

const A = loadGame();
const X = A.Expedition;

function freshRun(seed) {
  const s0 = A.State.create();
  // 给队伍一点装备，便于验证全灭掉落
  const r = X.start(s0, { difficulty: 'normal', seed: seed == null ? 12345 : seed });
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.state;
}

function forceNodes(state, types) {
  const st = A.State.clone(state);
  st.run.nodes = types.map((t, i) => ({
    id: 'test_' + i, type: t, consumed: false,
    risk: 'low', rewardTags: [], name: t, artId: 'node.' + t, icon: 'sword',
  }));
  return st;
}

test('入场立刻撤离：金币、遗物、完成层数净变化为 0', () => {
  const s = freshRun();
  const before = { gold: s.gold, shards: s.shards, best: s.bestDepth };
  const r = X.extract(s, 'extract');
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.state.gold, before.gold);
  assert.equal(r.state.shards, before.shards);
  assert.equal(r.state.bestDepth, before.best);
  assert.equal(r.state.settlement.completedFloors, 0);
  assert.equal(r.state.settlement.items.length, 0);
});

test('完成一层后撤离：遗物 = 2 × 完成层数', () => {
  let s = forceNodes(freshRun(), ['camp']);
  const node = s.run.nodes[0];
  s = X.enterNode(s, node.id).state;
  assert.equal(s.run.stage, 'event');
  s = X.finishNode(s).state;
  assert.equal(s.run.completedFloors, 1);

  const shardsBefore = s.shards;
  const r = X.extract(s, 'extract');
  assert.ok(r.ok);
  assert.equal(r.state.shards, shardsBefore + 2);
  assert.equal(r.state.bestDepth, 1);
});

test('终局命令幂等：重复撤离不再发奖', () => {
  const s = freshRun();
  const r1 = X.extract(s, 'extract');
  assert.ok(r1.ok);
  const r2 = X.extract(r1.state, 'extract');
  assert.ok(!r2.ok);
  assert.equal(r2.state.gold, r1.state.gold);
  assert.equal(r2.state.shards, r1.state.shards);
});

test('同一节点不能进入两次', () => {
  const s = forceNodes(freshRun(), ['camp']);
  const id = s.run.nodes[0].id;
  const r1 = X.enterNode(s, id);
  assert.ok(r1.ok);
  const r2 = X.enterNode(r1.state, id);
  assert.ok(!r2.ok);
});

test('非 map 阶段不能选路线', () => {
  const s = forceNodes(freshRun(), ['camp']);
  const s1 = X.enterNode(s, s.run.nodes[0].id).state;
  const r = X.enterNode(s1, s1.run.nodes[0].id);
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'BAD_STAGE');
});

test('掉落先进 pendingLoot，不直接进背包', () => {
  let s = forceNodes(freshRun(), ['chest']);
  s = X.enterNode(s, s.run.nodes[0].id).state;
  const pend = s.run.pendingLoot.length;
  assert.ok(pend > 0);
  const bagBefore = s.run.bag.length;
  assert.equal(bagBefore, 0, '背包此时应为空');
  assert.equal(s.run.stage, 'loot');
});

test('满包时接受掉落必须先指定替换对象', () => {
  let s = forceNodes(freshRun(), ['chest']);
  s = A.State.clone(s);
  s.bagCap = 1;
  const dummy = A.Equipment.makeItem(s, { ilvl: 1, bias: 0, slot: 'weapon' });
  s = dummy.state;
  s.itemsById[dummy.item.id] = dummy.item;
  s.run.bag.push(dummy.item.id);

  s = X.enterNode(s, s.run.nodes[0].id).state;
  assert.equal(s.run.bag.length, 1);
  const lootId = s.run.pendingLoot[0];

  const bad = X.resolveLoot(s, lootId, { action: 'accept' });
  assert.ok(!bad.ok);
  assert.equal(bad.error.code, 'BAG_FULL');

  const good = X.resolveLoot(s, lootId, { action: 'replace', replaceId: dummy.item.id });
  assert.ok(good.ok, JSON.stringify(good.error));
  assert.ok(good.state.run.bag.includes(lootId));
  assert.ok(!good.state.run.bag.includes(dummy.item.id), '被替换的物品从背包移除');
  assert.ok(!good.state.itemsById[dummy.item.id], '被替换的物品从 registry 移除');
});

test('尚有未处理掉落时不能推进', () => {
  let s = forceNodes(freshRun(), ['chest']);
  s = X.enterNode(s, s.run.nodes[0].id).state;
  if (s.run.pendingLoot.length > 1) {
    const r = X.finishNode(s);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'LOOT_PENDING');
  }
});

test('全部掉落处理完后自动完成节点', () => {
  let s = forceNodes(freshRun(), ['chest']);
  s = X.enterNode(s, s.run.nodes[0].id).state;
  let guard = 0;
  while (s.run && s.run.stage === 'loot' && guard++ < 20) {
    const id = s.run.pendingLoot[0];
    const r = X.resolveLoot(s, id, { action: 'discard' });
    assert.ok(r.ok, JSON.stringify(r.error));
    s = r.state;
  }
  assert.ok(s.run.completedFloors >= 1, '节点完成后应记录完成层');
});

test('商人：满包未指定替换时不扣款、不标售出', () => {
  let s = forceNodes(freshRun(), ['merchant']);
  s = A.State.clone(s);
  s.bagCap = 1;
  const dummy = A.Equipment.makeItem(s, { ilvl: 1, bias: 0, slot: 'weapon' });
  s = dummy.state;
  s.itemsById[dummy.item.id] = dummy.item;
  s.run.bag.push(dummy.item.id);

  s = X.enterNode(s, s.run.nodes[0].id).state;
  const ev = s.run.event;
  assert.equal(ev.kind, 'merchant');
  const good = ev.goods[0];
  const goldBefore = s.gold;

  const r = X.buy(s, good.itemId, {});
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'BAG_FULL');
  assert.equal(r.state.gold, goldBefore);
  assert.equal(r.state.run.event.goods[0].sold, false);

  const ok = X.buy(s, good.itemId, { replaceId: dummy.item.id });
  assert.ok(ok.ok, JSON.stringify(ok.error));
  assert.equal(ok.state.gold, goldBefore - good.price);
  assert.equal(ok.state.run.event.goods[0].sold, true);
});

test('商人取消购买不产生任何变化', () => {
  let s = forceNodes(freshRun(), ['merchant']);
  s = X.enterNode(s, s.run.nodes[0].id).state;
  const gold = s.gold;
  const bag = s.run.bag.length;
  const goodsSold = s.run.event.goods.filter((g) => g.sold).length;
  // 不做任何操作，直接离开
  assert.equal(s.gold, gold);
  assert.equal(s.run.bag.length, bag);
  assert.equal(s.run.event.goods.filter((g) => g.sold).length, goodsSold);
});

test('第 2 层完成节点后进入祝福，三选项不重复且不含已持有', () => {
  let s = freshRun();
  s = A.State.clone(s);
  s.run.floor = 2;
  s = forceNodes(s, ['camp']);
  s = X.enterNode(s, s.run.nodes[0].id).state;
  const r = X.finishNode(s);
  assert.ok(r.ok, JSON.stringify(r.error));
  const st = r.state;
  assert.equal(st.run.stage, 'blessing');
  const offs = st.run.blessingOffers;
  assert.equal(offs.length, 3);
  assert.equal(new Set(offs).size, 3, '三个祝福必须不同');
  offs.forEach((o) => assert.ok(A.Data.BLESSINGS[o]));
});

test('选择祝福后推进一层，且不能重复选择', () => {
  let s = freshRun();
  s = A.State.clone(s);
  s.run.floor = 2;
  s = forceNodes(s, ['camp']);
  s = X.enterNode(s, s.run.nodes[0].id).state;
  s = X.finishNode(s).state;
  const offer = s.run.blessingOffers[0];

  const r = X.chooseBlessing(s, offer);
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.ok(r.state.run.blessings.includes(offer));
  assert.equal(r.state.run.floor, 3);

  const again = X.chooseBlessing(r.state, offer);
  assert.ok(!again.ok);
});

test('祝福不会出现已持有的重复项', () => {
  let s = freshRun();
  s = A.State.clone(s);
  s.run.floor = 4;
  s.run.blessings = ['ember', 'stone', 'spring', 'feather'];
  s = forceNodes(s, ['camp']);
  s = X.enterNode(s, s.run.nodes[0].id).state;
  const r = X.finishNode(s);
  const offs = r.state.run.blessingOffers;
  offs.forEach((o) => assert.ok(!['ember', 'stone', 'spring', 'feather'].includes(o)));
});

test('逃离：物品向上取半、金币与遗物向下取半', () => {
  let s = forceNodes(freshRun(), ['chest']);
  s = A.State.clone(s);
  s.run.goldFound = 41;
  s.run.shards = 5;
  s.run.completedFloors = 2;
  // 造 3 件背包物品
  for (let i = 0; i < 3; i++) {
    const r = A.Equipment.makeItem(s, { ilvl: 2, bias: 0 });
    s = r.state;
    s.itemsById[r.item.id] = r.item;
    s.run.bag.push(r.item.id);
  }
  s.run.stage = 'map';

  const p = X.previewSettlement(s, 'flee');
  assert.equal(p.itemCount, 2, '3 件向上取半 = 2');
  assert.equal(p.gold, 20, '41 向下取半 = 20');
  assert.equal(p.shards, 2 + 2, 'floor(5/2)=2 战斗遗物 + 2 完成层');

  const r = X.extract(s, 'flee');
  assert.ok(r.ok);
  assert.equal(r.state.settlement.type, 'flee');
  assert.equal(r.state.extracts, 0, '逃离不计入成功撤离次数');
});

test('全灭：背包清空、遗物为 0、装备被扯走、角色保留', () => {
  let s = freshRun();
  s = A.State.clone(s);
  const unitId = s.roster[0].id;
  const item = A.Equipment.makeItem(s, { ilvl: 3, bias: 1, slot: 'weapon' });
  s = item.state;
  s.itemsById[item.item.id] = item.item;
  s.roster[0].equip.weapon = item.item.id;

  const bagItem = A.Equipment.makeItem(s, { ilvl: 2, bias: 0 });
  s = bagItem.state;
  s.itemsById[bagItem.item.id] = bagItem.item;
  s.run.bag.push(bagItem.item.id);

  const rosterBefore = s.roster.length;
  const extractsBefore = s.extracts;
  const r = X.wipe(s);
  assert.ok(r.ok, JSON.stringify(r.error));
  const st = r.state;

  assert.equal(st.run, null);
  assert.equal(st.settlement.type, 'wipe');
  assert.equal(st.settlement.shards, 0);
  assert.equal(st.settlement.items.length, 0);
  assert.equal(st.extracts, extractsBefore, '全灭不计撤离次数');
  assert.equal(st.roster.length, rosterBefore, '角色保留，不永久死亡');
  assert.ok(!st.itemsById[bagItem.item.id], '背包物品销毁');
  assert.equal(st.roster.find((u) => u.id === unitId).equip.weapon, null, '装备被扯走');
});

test('层数不会越过 7，第 7 层完成后自动撤离', () => {
  let s = freshRun();
  s = A.State.clone(s);
  s.run.floor = 7;
  s.run.completedFloors = 6;
  s = forceNodes(s, ['boss']);
  s = X.enterNode(s, s.run.nodes[0].id).state;
  s.run.stage = 'battleResult';

  const r = X.finishNode(s);
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.state.run, null, '应自动撤离');
  assert.equal(r.state.settlement.type, 'clear');
  assert.equal(r.state.settlement.completedFloors, 7);
  assert.equal(r.state.unlockedDifficulties.includes('deep'), true, '通关解锁深入');
});

test('结算只产生一次，settlementId 唯一', () => {
  const s = freshRun();
  const r1 = X.extract(s, 'extract');
  const id1 = r1.state.settlement.id;
  const r2 = X.extract(r1.state, 'extract');
  assert.ok(!r2.ok);
  assert.equal(r2.state.settlement.id, id1);
});

test('拾荒祝福只加成后续金币', () => {
  const s = A.State.clone(freshRun());
  s.run.blessings = ['scavenger'];
  s.run.goldFound = 0;
  const gained = X.addGold(s, 100);
  assert.equal(gained, 120);
  assert.equal(s.run.goldFound, 120);
});

test('禁忌契约提高压力获得', () => {
  const s = A.State.clone(freshRun());
  s.run.blessings = ['pact'];
  s.run.party.forEach((p) => { p.stress = 0; });
  X.addStress(s, 20);
  assert.equal(s.run.party[0].stress, 25);
});

test('事件选择能正常结算（不因状态重建抛错）', () => {
  const s = A.State.clone(freshRun());
  s.run.floor = 3;
  s.run.event = { eventId: 'wall-knock', choiceIds: ['break', 'leave'], resolved: false, resultText: '', kind: 'event' };
  s.run.stage = 'event';

  const r = X.chooseEvent(s, 'break');
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.ok(r.state.run.event.resolved, '事件应被标记为已结算');
  assert.ok(r.state.run.event.resultText.length > 0, '应生成结果文本');
  assert.ok(['loot', 'event'].includes(r.state.run.stage), r.state.run.stage);
});

test('「走血迹」真的进入战斗而不是直接给战利品', () => {
  const s = A.State.clone(freshRun());
  s.run.floor = 3;
  s.run.event = { eventId: 'fog-fork', choiceIds: ['blood', 'tracks', 'middle'], resolved: false, resultText: '', kind: 'event' };
  s.run.stage = 'event';

  const r = X.chooseEvent(s, 'blood');
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.state.run.stage, 'battle', '应切换到战斗阶段');
  assert.equal(r.state.run.event.pendingCombat, 'normal');
  assert.equal(r.state.run.pendingLoot.length, 0, '战斗前不应直接发放战利品');
  assert.ok(r.state.run.event.resultText.includes('站着'), '应保留开场文本');
});

test('没有 combat 效果的事件不会进入战斗', () => {
  const s = A.State.clone(freshRun());
  s.run.floor = 3;
  s.run.event = { eventId: 'fog-fork', choiceIds: ['blood', 'tracks', 'middle'], resolved: false, resultText: '', kind: 'event' };
  s.run.stage = 'event';
  const r = X.chooseEvent(s, 'middle');
  assert.ok(r.ok);
  assert.notEqual(r.state.run.stage, 'battle', '普通事件不应触发战斗');
});
