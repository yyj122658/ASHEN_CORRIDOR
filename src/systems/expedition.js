'use strict';
/* 远征状态机：节点、事件、商人、祝福、统一掉落、结算。
   所有终局命令幂等，结算只产生一次。 */
(function (A) {
  'use strict';

  const S = () => A.State;
  const D = () => A.Data;
  const E = () => A.Equipment;

  const MAX_FLOOR = 7;
  const BLESSING_FLOORS = [2, 4, 6];

  /* ---------- 小工具 ---------- */

  function partyUnits(st) {
    if (!st.run) return [];
    return st.run.party.map((p) => st.roster.find((u) => u.id === p.uid)).filter(Boolean);
  }

  function partyIds(st) {
    return st.run ? st.run.party.map((p) => p.uid) : [];
  }

  function syncPartyToRoster(st) {
    if (!st.run) return;
    st.run.party.forEach((p) => {
      const u = st.roster.find((x) => x.id === p.uid);
      if (u) u.stress = p.stress;
    });
  }

  function stressMult(st) {
    return st.run && st.run.blessings.includes('pact') ? 1.25 : 1;
  }

  function addStress(st, amount) {
    if (!st.run) return;
    const mult = stressMult(st);
    st.run.party.forEach((p) => {
      const delta = Math.round(amount * mult);
      p.stress = Math.max(0, Math.min(100, p.stress + delta));
    });
    syncPartyToRoster(st);
  }

  function addGold(st, amount) {
    if (!st.run) return 0;
    const mult = st.run.blessings.includes('scavenger') ? 1.2 : 1;
    const gained = Math.round(amount * mult);
    st.run.goldFound += gained;
    return gained;
  }

  function addShards(st, amount) {
    if (!st.run) return;
    st.run.shards += Math.max(0, Math.round(amount));
  }

  function maxHpOf(st, uid) {
    return A.Roster.calcStats(st, uid, partyIds(st)).maxHp;
  }

  /** 生成掉落 → 全部进入 pendingLoot，绝不直接进背包或仓库。 */
  function pushLoot(st, count, ilvl, bias) {
    const got = [];
    for (let i = 0; i < count; i++) {
      const r = E().makeItem(st, { ilvl, bias });
      st = r.state;
      st.itemsById[r.item.id] = r.item;
      st.run.pendingLoot.push(r.item.id);
      got.push(r.item.id);
    }
    return { state: st, ids: got };
  }

  /* ---------- 节点生成 ---------- */

  function newNode(st, type, idx) {
    const id = 'n' + st.run.floor + '_' + idx + '_' + S().takeId(st, '');
    const meta = D().NODE_TYPES[type];
    const risk = type === 'elite' || type === 'boss' ? 'high'
      : type === 'chest' || type === 'event' ? 'medium' : 'low';
    const rewardTags = type === 'battle' ? ['loot', 'gold']
      : type === 'elite' ? ['loot', 'gold', 'shard']
      : type === 'chest' ? ['loot', 'gold']
      : type === 'camp' ? ['heal', 'stress']
      : type === 'merchant' ? ['trade']
      : type === 'boss' ? ['loot', 'gold', 'shard', 'clear']
      : ['event'];
    return {
      id, type, consumed: false, risk, rewardTags,
      name: meta.name, artId: meta.artId, icon: meta.icon,
    };
  }

  function genNodes(st) {
    const f = st.run.floor;
    if (f >= MAX_FLOOR) {
      st.run.nodes = [newNode(st, 'boss', 0)];
      return;
    }
    const pool = [];
    pool.push('battle', 'battle', 'chest', 'event');
    if (f >= 2) pool.push('camp', 'event');
    if (f >= 3) pool.push('elite', 'merchant');
    if (f >= 4) pool.push('elite');

    const sh = A.Random.shuffle(st.run.rngState, pool);
    st.run.rngState = sh.state;
    const types = sh.value.slice(0, 3);
    st.run.nodes = types.map((t, i) => newNode(st, t, i));
  }

  /* ---------- 开始远征 ---------- */

  function start(state, opts) {
    opts = opts || {};
    if (state.run) return S().fail(state, 'RUN_ACTIVE', '已经有一次远征在进行中');

    const difficulty = opts.difficulty || state.difficulty || 'normal';
    if (!D().DIFFICULTIES[difficulty]) return S().fail(state, 'BAD_DIFFICULTY', '未知难度');
    if (!(state.unlockedDifficulties || []).includes(difficulty)) {
      return S().fail(state, 'LOCKED_DIFFICULTY', '该难度尚未解锁');
    }

    const party = [];
    state.team.forEach((uid, slot) => {
      if (!uid) return;
      const u = state.roster.find((x) => x.id === uid);
      if (!u) return;
      party.push({ uid, slot, hp: 0, stress: u.stress || 0 });
    });
    if (!party.length) return S().fail(state, 'NO_PARTY', '队伍是空的');

    const st = S().clone(state);
    const seed = (opts.seed != null ? opts.seed : A.Random.seedFrom('run' + st.runs + '_' + st.nextId)) >>> 0;

    st.runs += 1;
    st.run = {
      id: S().takeId(st, 'r'),
      seed,
      rngState: seed,
      difficulty,
      stage: 'map',
      floor: 1,
      maxFloor: MAX_FLOOR,
      completedFloors: 0,
      completedNodeIds: [],
      activeNodeId: null,
      nodes: [],
      party,
      bag: [],
      pendingLoot: [],
      goldFound: 0,
      shards: 0,
      kills: 0,
      blessings: [],
      blessingOffers: [],
      event: null,
      battle: null,
      settled: false,
    };

    // 满血出发
    st.run.party.forEach((p) => { p.hp = maxHpOf(st, p.uid); });

    genNodes(st);
    S().addLog(st, D().VEIL_TEXT.start, 'gold');
    return S().ok(st, [{ type: 'runStart', meta: { seed, difficulty } }]);
  }

  /* ---------- 进入节点 ---------- */

  function enterNode(state, nodeId) {
    let st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    if (st.run.stage !== 'map') return S().fail(state, 'BAD_STAGE', '当前不能选择路线');
    if (st.run.settled) return S().fail(state, 'SETTLED', '本次远征已结算');

    const node = st.run.nodes.find((n) => n.id === nodeId);
    if (!node) return S().fail(state, 'NO_NODE', '找不到该路线');
    if (node.consumed) return S().fail(state, 'CONSUMED', '这条路线已经走过');

    st.run.activeNodeId = node.id;

    switch (node.type) {
      case 'battle':
      case 'elite':
      case 'boss':
        st.run.stage = 'battle';
        return S().ok(st, [{ type: 'nodeEnter', meta: { nodeId: node.id, kind: node.type } }]);

      case 'chest': {
        node.consumed = true;
        const f = st.run.floor;
        const gr = A.Random.range(st.run.rngState, 0, 10);
        st.run.rngState = gr.state;
        const gold = 10 + f * 6 + Math.floor(gr.value);
        addGold(st, gold);
        const pl = pushLoot(st, 1 + (f >= 3 ? 1 : 0), f, 1 + f * 0.3);
        st = pl.state;
        // 22% 陷阱
        const trap = A.Random.chance(st.run.rngState, 0.22);
        st.run.rngState = trap.state;
        let trapText = '';
        if (trap.value) {
          const victim = st.run.party[0];
          const dmg = Math.round(12 + f * 4);
          victim.hp = Math.max(1, victim.hp - dmg);
          addStress(st, 8);
          trapText = '箱盖掀开的瞬间，缝里伸出一只手。有人流了血。';
        }
        st.run.event = {
          eventId: 'chest', choiceIds: ['continue'], resolved: true,
          resultText: (trapText ? trapText + '<br>' : '') + '你拿走了 ' + gold + ' 金币，还有几件东西。',
          kind: 'chest',
        };
        st.run.stage = st.run.pendingLoot.length ? 'loot' : 'event';
        return S().ok(st, [{ type: 'chest', amount: gold, meta: { trapped: trap.value } }]);
      }

      case 'camp': {
        node.consumed = true;
        st.run.party.forEach((p) => {
          const max = maxHpOf(st, p.uid);
          p.hp = Math.min(max, p.hp + Math.round(max * 0.45));
          p.stress = Math.max(0, p.stress - 30);
        });
        syncPartyToRoster(st);
        st.run.event = {
          eventId: 'camp-rest', choiceIds: ['continue'], resolved: true, kind: 'camp',
          resultText: '火苗很小，但够暖。全队恢复 45% 生命，压力 -30。',
        };
        st.run.stage = 'event';
        return S().ok(st, [{ type: 'camp' }]);
      }

      case 'event': {
        const ids = Object.keys(D().EVENTS);
        const pick = A.Random.pick(st.run.rngState, ids);
        st.run.rngState = pick.state;
        const ev = D().EVENTS[pick.value];
        st.run.event = {
          eventId: ev.id,
          choiceIds: ev.choices.map((c) => c.id),
          resolved: false,
          resultText: '',
          kind: 'event',
        };
        st.run.stage = 'event';
        return S().ok(st, [{ type: 'nodeEnter', meta: { nodeId: node.id, kind: 'event' } }]);
      }

      case 'merchant': {
        const f = st.run.floor;
        const goods = [];
        for (let i = 0; i < 3; i++) {
          const r = E().makeItem(st, { ilvl: f + 1, bias: 1.6 + f * 0.3 });
          st = r.state;
          st.itemsById[r.item.id] = r.item;
          goods.push({ itemId: r.item.id, price: Math.round(E().sellValue(r.item) * 2.6 + 20), sold: false });
        }
        st.run.event = {
          eventId: 'merchant', choiceIds: ['leave'], resolved: false, kind: 'merchant',
          resultText: '', goods, bought: [], healPrice: Math.round(18 + f * 5),
        };
        st.run.stage = 'event';
        return S().ok(st, [{ type: 'nodeEnter', meta: { nodeId: node.id, kind: 'merchant' } }]);
      }

      default:
        return S().fail(state, 'BAD_NODE', '未知节点类型');
    }
  }

  /* ---------- 事件 ---------- */

  function applyEffects(st, effects, results) {
    (effects || []).forEach((ef) => {
      if (ef.t === 'gold') {
        const gr = A.Random.range(st.run.rngState, ef.min, ef.max);
        st.run.rngState = gr.state;
        const v = Math.round(gr.value);
        addGold(st, v);
        results.push({ kind: 'gold', amount: v });
      } else if (ef.t === 'stress') {
        addStress(st, ef.amount);
        results.push({ kind: 'stress', amount: ef.amount });
      } else if (ef.t === 'loot') {
        const ilvl = st.run.floor + (ef.ilvlBonus || 0);
        const pl = pushLoot(st, ef.count || 1, ilvl, ef.bias || 1);
        st = pl.state;
        results.push({ kind: 'loot', itemIds: pl.ids });
      } else if (ef.t === 'combat') {
        // 事件里插一场战斗：等选择结算完再切到 battle 阶段
        if (st.run.event) st.run.event.pendingCombat = ef.kind || 'normal';
      } else if (ef.t === 'damagePct') {
        const pool = st.run.party.filter((p) => p.hp > 0);
        if (pool.length) {
          const target = A.Random.pick(st.run.rngState, pool);
          st.run.rngState = target.state;
          target.value.hp = Math.max(1, target.value.hp - Math.round(maxHpOf(st, target.value.uid) * ef.pct));
          results.push({ kind: 'damage', uid: target.value.uid });
        }
      }
    });
    return st;
  }

  function chooseEvent(state, choiceId) {
    let st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    const ev = st.run.event;
    if (!ev) return S().fail(state, 'NO_EVENT', '当前没有事件');
    if (ev.resolved) return S().fail(state, 'RESOLVED', '这个事件已经处理过了');

    const def = D().EVENTS[ev.eventId];
    if (!def) return S().fail(state, 'NO_DEF', '事件定义缺失');
    const choice = def.choices.find((c) => c.id === choiceId);
    if (!choice) return S().fail(state, 'NO_CHOICE', '找不到该选项');

    const totalWeight = choice.outcomes.reduce((a, o) => a + o.weight, 0);
    let roll = A.Random.range(st.run.rngState, 0, totalWeight);
    st.run.rngState = roll.state;
    let acc = roll.value;
    let outcome = choice.outcomes[choice.outcomes.length - 1];
    for (const o of choice.outcomes) {
      acc -= o.weight;
      if (acc <= 0) { outcome = o; break; }
    }

    const results = [];
    st = applyEffects(st, outcome.effects, results);

    // 文本插值
    let text = outcome.text;
    const lootIds = results.filter((r) => r.kind === 'loot').flatMap((r) => r.itemIds);
    const goldRes = results.find((r) => r.kind === 'gold');
    text = text.replace('{loot}', lootIds.length
      ? lootIds.map((id) => E().itemDisplayName(st.itemsById[id])).join('、')
      : '几件旧东西');
    text = text.replace('{gold}', goldRes ? String(goldRes.amount) : '0');

    ev.resolved = true;
    ev.resultText = text;
    ev.kind = 'event';
    ev.choiceIds = [];

    if (ev.pendingCombat) {
      st.run.stage = 'battle';
      return S().ok(st, [{ type: 'eventCombat', meta: { kind: ev.pendingCombat, text } }]);
    }

    st.run.stage = st.run.pendingLoot.length ? 'loot' : 'event';
    return S().ok(st, [{ type: 'eventResolve', meta: { eventId: ev.eventId, choiceId } }]);
  }

  /* ---------- 掉落取舍 ---------- */

  function resolveLoot(state, itemId, opts) {
    opts = opts || {};
    const st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    if (st.run.stage !== 'loot') return S().fail(state, 'BAD_STAGE', '当前不能处理掉落');

    const idx = st.run.pendingLoot.indexOf(itemId);
    if (idx < 0) return S().fail(state, 'NO_LOOT', '这件东西不在待处理列表');
    const it = st.itemsById[itemId];
    if (!it) return S().fail(state, 'NO_ITEM', '物品不存在');

    const action = opts.action || 'accept';

    if (action === 'discard') {
      st.run.pendingLoot.splice(idx, 1);
      delete st.itemsById[itemId];
    } else if (action === 'accept' || action === 'replace') {
      const full = st.run.bag.length >= st.bagCap;
      let replaceId = opts.replaceId || null;

      if (full && !replaceId) return S().fail(state, 'BAG_FULL', '背包已满，需要先选一件替换');

      if (replaceId) {
        const ri = st.run.bag.indexOf(replaceId);
        if (ri < 0) return S().fail(state, 'NO_REPLACE', '要替换的物品不在背包');
        st.run.bag.splice(ri, 1);
        delete st.itemsById[replaceId];
      }

      st.run.pendingLoot.splice(idx, 1);
      st.run.bag.push(itemId);
    } else {
      return S().fail(state, 'BAD_ACTION', '未知操作');
    }

    // 全部处理完 → 完成节点
    if (st.run.pendingLoot.length === 0) {
      const fin = finishNodeInternal(st);
      return S().ok(fin.state, [{ type: 'lootResolved', meta: { itemId, action } }].concat(fin.events || []));
    }

    return S().ok(st, [{ type: 'lootResolved', meta: { itemId, action } }]);
  }

  /* ---------- 商人 ---------- */

  function buy(state, itemId, opts) {
    opts = opts || {};
    const st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    const ev = st.run.event;
    if (!ev || ev.kind !== 'merchant') return S().fail(state, 'NO_MERCHANT', '当前不在商队');

    const good = ev.goods.find((g) => g.itemId === itemId);
    if (!good) return S().fail(state, 'NO_GOODS', '找不到该商品');
    if (good.sold) return S().fail(state, 'SOLD', '已经卖掉了');
    if (st.gold < good.price) return S().fail(state, 'NO_GOLD', '金币不足');

    const full = st.run.bag.length >= st.bagCap;
    const replaceId = opts.replaceId || null;
    if (full && !replaceId) return S().fail(state, 'BAG_FULL', '背包已满，需要先选一件替换');

    // 事务：所有检查通过后才扣款
    if (replaceId) {
      const ri = st.run.bag.indexOf(replaceId);
      if (ri < 0) return S().fail(state, 'NO_REPLACE', '要替换的物品不在背包');
      st.run.bag.splice(ri, 1);
      delete st.itemsById[replaceId];
    }

    st.gold -= good.price;
    good.sold = true;
    st.run.bag.push(itemId);
    ev.bought.push(itemId);

    return S().ok(st, [{ type: 'buy', amount: good.price, meta: { itemId } }]);
  }

  function merchantHeal(state) {
    const st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    const ev = st.run.event;
    if (!ev || ev.kind !== 'merchant') return S().fail(state, 'NO_MERCHANT', '当前不在商队');
    if (st.gold < ev.healPrice) return S().fail(state, 'NO_GOLD', '金币不足');

    st.gold -= ev.healPrice;
    st.run.party.forEach((p) => { p.hp = maxHpOf(st, p.uid); });
    return S().ok(st, [{ type: 'merchantHeal', amount: ev.healPrice }]);
  }

  /* ---------- 祝福 ---------- */

  function rollBlessingOffers(st) {
    const owned = new Set(st.run.blessings);
    const pool = D().BLESSING_IDS.filter((b) => !owned.has(b));
    const sh = A.Random.shuffle(st.run.rngState, pool);
    st.run.rngState = sh.state;
    return sh.value.slice(0, 3);
  }

  function chooseBlessing(state, blessingId) {
    const st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    if (st.run.stage !== 'blessing') return S().fail(state, 'BAD_STAGE', '当前不能选择祝福');
    const offs = st.run.blessingOffers || [];
    if (!offs.includes(blessingId)) return S().fail(state, 'NO_OFFER', '该祝福不在候选中');
    if (!D().BLESSINGS[blessingId]) return S().fail(state, 'NO_BLESSING', '未知祝福');

    st.run.blessings.push(blessingId);
    // 磐石：获得时按生命比例同步
    if (blessingId === 'stone') {
      st.run.party.forEach((p) => {
        const newMax = maxHpOf(st, p.uid);
        p.hp = Math.min(newMax, p.hp + Math.round(p.hp * 0.15));
      });
    }
    st.run.blessingOffers = [];

    // 推进到下一层
    return advanceFloor(st, [{ type: 'blessing', meta: { blessingId } }]);
  }

  /* ---------- 节点完成与推进 ---------- */

  function finishNodeInternal(st) {
    if (!st.run) return { state: st, events: [] };
    const nodeId = st.run.activeNodeId;
    const events = [];

    if (nodeId && !st.run.completedNodeIds.includes(nodeId)) {
      st.run.completedNodeIds.push(nodeId);
    }
    st.run.activeNodeId = null;
    st.run.event = null;
    st.run.stage = 'map';

    // 完成一层
    if (st.run.floor > st.run.completedFloors) {
      st.run.completedFloors = st.run.floor;
      if (st.run.completedFloors > st.bestDepth) st.bestDepth = st.run.completedFloors;
    }

    // 第 7 层完成 → 自动撤离（必须在记录完成层之后）
    if (st.run.completedFloors >= MAX_FLOOR) {
      return extractInternal(st, 'clear', events);
    }

    // 2/4/6 层 → 祝福
    if (BLESSING_FLOORS.includes(st.run.floor)) {
      st.run.stage = 'blessing';
      st.run.blessingOffers = rollBlessingOffers(st);
      events.push({ type: 'blessingOffer', meta: { offers: st.run.blessingOffers } });
      return { state: st, events };
    }

    return advanceFloorInternal(st, events);
  }

  function advanceFloorInternal(st, events) {
    st.run.floor += 1;
    st.run.nodes = [];
    st.run.event = null;
    st.run.activeNodeId = null;
    if (st.run.floor > MAX_FLOOR) return extractInternal(st, 'clear', events);
    genNodes(st);
    st.run.stage = 'map';
    return { state: st, events };
  }

  function advanceFloor(st, events) {
    const r = advanceFloorInternal(st, events || []);
    return S().ok(r.state, r.events);
  }

  /** 玩家点击"继续"（战斗结算后 / 事件结果后）。 */
  function finishNode(state) {
    const st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    if (st.run.stage === 'loot') return S().fail(state, 'LOOT_PENDING', '还有战利品没处理');
    if (st.run.stage === 'battle') return S().fail(state, 'IN_BATTLE', '战斗尚未结束');
    const r = finishNodeInternal(st);
    return S().ok(r.state, r.events);
  }

  /* ---------- 结算 ---------- */

  function settlementPreview(state, mode, stOverride) {
    const st = stOverride || state;
    if (!st.run) return null;
    const run = st.run;
    const cleared = mode === 'clear';
    const fleeing = mode === 'flee';

    const completed = run.completedFloors;
    const battleShards = run.shards;
    const gold = fleeing ? Math.floor(run.goldFound / 2) : run.goldFound;
    const items = fleeing ? run.bag.slice(0, Math.ceil(run.bag.length / 2)) : run.bag.slice();
    const lostItems = fleeing ? run.bag.slice(Math.ceil(run.bag.length / 2)) : [];

    let shards;
    if (fleeing) shards = Math.floor(battleShards / 2) + completed;
    else shards = battleShards + 2 * completed + (cleared ? 7 : 0);

    return {
      type: mode,
      completedFloors: completed,
      gold,
      shards: Math.max(0, shards),
      items,
      lostItems,
      itemCount: items.length,
      lostCount: lostItems.length,
    };
  }

  function previewSettlement(state, mode) {
    return settlementPreview(state, mode);
  }

  function extractInternal(st, mode, events) {
    if (!st.run) return { state: st, events: events || [] };
    if (st.run.settled) return { state: st, events: events || [] };

    const prev = settlementPreview(st, mode, st);
    const run = st.run;
    const cleared = mode === 'clear';

    // 物品入仓
    prev.items.forEach((id) => {
      if (st.itemsById[id]) st.stash.push(id);
    });
    prev.lostItems.forEach((id) => { delete st.itemsById[id]; });

    st.gold += prev.gold;
    st.shards += prev.shards;

    if (mode === 'extract' || mode === 'clear') st.extracts += 1;

    // 回营地休养
    run.party.forEach((p) => {
      const u = st.roster.find((x) => x.id === p.uid);
      if (u) { u.hp = null; u.stress = p.stress; }
    });

    if (cleared) {
      if (!st.achievements.includes('firstClear')) st.achievements.push('firstClear');
      unlockNextDifficulty(st, run.difficulty);
      st.wins += 1;
    }
    if (!st.achievements.includes('firstExtract') && (mode === 'extract' || mode === 'clear')) {
      st.achievements.push('firstExtract');
    }

    st.settlement = {
      id: S().takeId(st, 's'),
      runId: run.id,
      type: mode,
      gold: prev.gold,
      shards: prev.shards,
      items: prev.items,
      lostItems: prev.lostItems.map((id) => {
        const it = st.itemsById[id];
        return it ? { name: E().itemDisplayName(it), q: it.q } : { name: '未知物品', q: 0 };
      }),
      completedFloors: prev.completedFloors,
      difficulty: run.difficulty,
      stats: run.battle && run.battle.stats ? run.battle.stats : null,
    };

    run.settled = true;
    st.run = null;

    if (prev.completedFloors === 0 && prev.items.length === 0 && prev.gold === 0 && prev.shards === 0) {
      S().addLog(st, D().VEIL_TEXT.emptyExtract, '');
    }

    events = (events || []).concat([{ type: 'settle', meta: { settlementId: st.settlement.id, mode } }]);
    return { state: st, events };
  }

  function extract(state, mode) {
    const st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    if (st.run.settled) return S().fail(state, 'SETTLED', '本次远征已经结算过');
    if (mode === 'clear' && st.run.completedFloors < MAX_FLOOR) {
      return S().fail(state, 'NOT_CLEARED', '还没打到回廊尽头');
    }
    const r = extractInternal(st, mode || 'extract');
    return S().ok(r.state, r.events);
  }

  function unlockNextDifficulty(st, difficulty) {
    const order = ['normal', 'deep', 'nightmare'];
    const idx = order.indexOf(difficulty);
    const next = order[idx + 1];
    if (next && !st.unlockedDifficulties.includes(next)) {
      st.unlockedDifficulties.push(next);
    }
  }

  /* ---------- 全灭 ---------- */

  function wipe(state) {
    const st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    if (st.run.settled) return S().fail(state, 'SETTLED', '本次远征已经结算过');

    const run = st.run;
    const lostItems = run.bag.slice();
    const lostGear = [];

    run.party.forEach((p) => {
      const u = st.roster.find((x) => x.id === p.uid);
      if (!u) return;
      const slots = ['weapon', 'armor', 'trinket'].filter((s) => u.equip[s]);
      if (slots.length) {
        const pick = A.Random.pick(st.rngState, slots);
        st.rngState = pick.state;
        const itemId = u.equip[pick.value];
        const it = st.itemsById[itemId];
        lostGear.push(it ? { name: E().itemDisplayName(it), q: it.q } : { name: '未知装备', q: 0 });
        u.equip[pick.value] = null;
        delete st.itemsById[itemId];
      }
      u.hp = null;
      u.stress = Math.min(100, (p.stress || 0) + 25);
      if (u.stress >= 100) {
        const aff = A.Random.pick(st.rngState, D().AFFLICTIONS);
        st.rngState = aff.state;
        u.affliction = aff.value.k;
        u.virtue = null;
        u.stress = 60;
      }
    });

    lostItems.forEach((id) => { delete st.itemsById[id]; });

    st.settlement = {
      id: S().takeId(st, 's'),
      runId: run.id,
      type: 'wipe',
      gold: 0,
      shards: 0,
      items: [],
      lostItems: lostItems.map((id) => {
        const it = st.itemsById[id];
        return it ? { name: E().itemDisplayName(it), q: it.q } : { name: '战利品', q: 1 };
      }),
      lostGear,
      completedFloors: run.completedFloors,
      difficulty: run.difficulty,
      stats: run.battle && run.battle.stats ? run.battle.stats : null,
    };

    run.settled = true;
    st.run = null;
    S().addLog(st, D().VEIL_TEXT.wipe, 'bad');
    return S().ok(st, [{ type: 'wipe', meta: { settlementId: st.settlement.id } }]);
  }

  /* ---------- 供 UI 查询 ---------- */

  function currentNode(state) {
    if (!state.run || !state.run.activeNodeId) return null;
    return state.run.nodes.find((n) => n.id === state.run.activeNodeId) || null;
  }

  function canEnter(state, nodeId) {
    if (!state.run || state.run.stage !== 'map') return false;
    const n = state.run.nodes.find((x) => x.id === nodeId);
    return !!n && !n.consumed;
  }

  A.Expedition = {
    MAX_FLOOR, BLESSING_FLOORS,
    start, enterNode, chooseEvent, resolveLoot, buy, merchantHeal,
    chooseBlessing, finishNode, extract, wipe,
    previewSettlement, settlementPreview,
    currentNode, canEnter, partyIds, partyUnits, maxHpOf,
    addStress, addGold, addShards, pushLoot,
    _internal: { genNodes, finishNodeInternal, extractInternal, rollBlessingOffers },
  };
})(globalThis.Ashen ||= {});
