'use strict';
/* 七层远征：节点生成、营火现场烙印、背包按格数、临时/永久归属、
   撤离与撤退的幂等结算事务。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;
  const ST = () => V.State;

  function rngInt(st, min, max) {
    const r = A.Random.int(st.rngState >>> 0, min, max);
    st.rngState = r.state >>> 0;
    return r.value;
  }
  function rngShuffle(st, arr) {
    const r = A.Random.shuffle(st.rngState >>> 0, arr);
    st.rngState = r.state >>> 0;
    return r.value;
  }
  function rngChance(st, p) {
    const r = A.Random.chance(st.rngState >>> 0, p);
    st.rngState = r.state >>> 0;
    return r.value;
  }

  function bagUsed(st) {
    if (!st.run) return 0;
    return st.run.bag.reduce((a, id) => a + ST().partCells(st.itemsById[id]), 0);
  }
  function bagFree(st) { return D().DESIGN.bagCapacity - bagUsed(st); }

  /* ------------------------------ 节点生成 ------------------------------ */

  function genNodes(st) {
    const floor = st.run.floor;
    let types;

    if (floor >= D().DESIGN.maxFloor) {
      types = ['boss'].concat(rngShuffle(st, ['camp', 'chest', 'battle']).slice(0, 2));
    } else {
      const pool = ['battle', 'battle', 'chest', 'event'];
      if (floor >= 2) pool.push('camp', 'event');
      if (floor >= 3) pool.push('elite', 'merchant', 'elite');
      const picked = [];
      const bag = rngShuffle(st, pool);
      bag.forEach((t) => { if (picked.length < 3 && !picked.includes(t)) picked.push(t); });
      while (picked.length < 3) picked.push('battle');
      types = rngShuffle(st, picked);
    }

    st.run.nodes = types.map((t, i) => ({
      id: 'n' + floor + '_' + i,
      type: t,
      consumed: false,
      name: D().nodeType(t).name,
      desc: D().nodeType(t).desc,
      risk: D().nodeType(t).risk,
      artId: D().nodeType(t).artId,
      icon: D().nodeType(t).icon,
    }));
  }

  /* ------------------------------ 开局 ------------------------------ */

  function start(st, opts) {
    const o = opts || {};
    if (st.run) return ST().fail(st, 'run_exists', '已经有一次远征在进行');
    const formation = (st.team || []).filter(Boolean);
    if (!formation.length) return ST().fail(st, 'empty_team', '没有编队');

    const next = ST().clone(st);
    if (o.seed != null) next.rngState = (o.seed >>> 0);

    const run = {
      id: 'r' + next.nextId,
      difficulty: o.difficulty || next.difficulty || 'normal',
      floor: 1,
      completedFloors: 0,
      completedNodeIds: [],
      stage: 'map',
      rngState: next.rngState >>> 0,
      party: formation.map((uid, slot) => ({ uid, slot, hp: null, stress: 0 })),
      nodes: [],
      lockedNodeId: null,
      startLoadouts: {},
      bag: [],
      pendingLoot: [],
      provisionalBindings: [],
      fieldLayouts: {},
      goldFound: 0,
      shards: 0,
      blessings: [],
      blessingFloorsTaken: [],
      fieldInscribedUnitIds: [],
      maxHpModifiers: {},
      event: null,
      shop: null,
      encounter: null,
      battle: null,
      finishedFloors: [],
      pendingAdvance: null,
    };
    next.nextId += 1;

    /* 入场快照：主手、板面、指令 */
    run.party.forEach((p) => {
      const u = next.roster.find((x) => x.id === p.uid);
      if (!u) return;
      p.stress = u.stress || 0;
      run.startLoadouts[u.id] = {
        weaponId: u.weaponId,
        board: ST().clone(u.board),
        gambits: ST().clone(u.gambits),
        hp: p.hp,
        stress: p.stress,
      };
    });

    next.run = run;
    next.stats.runs = (next.stats.runs || 0) + 1;
    genNodes(next);
    ST().addLog(next, { kind: 'sys', text: `第 1 层。${next.run.nodes.map((n) => n.name).join('、')}。` });

    return ST().ok(next, [{ type: 'runStart', meta: { runId: run.id } }]);
  }

  /* ------------------------------ 选择节点 ------------------------------ */

  function chooseNode(st, nodeId) {
    const run = st.run;
    if (!run) return ST().fail(st, 'no_run', '没有远征');
    if (run.stage !== 'map') return ST().fail(st, 'bad_stage', '现在不能选节点');
    const node = (run.nodes || []).find((n) => n.id === nodeId);
    if (!node) return ST().fail(st, 'no_node', '找不到节点');
    if (node.consumed) return ST().fail(st, 'consumed', '这个节点已经走过了');

    /* 战斗节点也要记 activeNodeId：finishNode 靠它把节点标成已完成并记层数。
       之前这里直接 return，导致战斗节点永远不会被标记完成、完成层数恒为 0。 */
    const staged = ST().clone(st);
    staged.run.activeNodeId = nodeId;

    if (node.type === 'battle' || node.type === 'elite' || node.type === 'boss') {
      return V.Encounter.open(staged, nodeId);
    }

    const next = staged;

    if (node.type === 'chest') {
      const rr = rngInt(next, 1, 2);
      const got = [];
      for (let i = 0; i < rr; i++) {
        const tpl = rngShuffle(next, D().TEMPLATE_ORDER)[0];
        const part = ST().makePart(next, { kind: 'circuit', templateId: tpl, acquiredRunId: next.run.id, acquiredSeq: next.run.bag.length + next.run.pendingLoot.length + i + 1 });
        next.itemsById[part.id] = part;
        if (bagUsed(next) + ST().partCells(part) <= D().DESIGN.bagCapacity) {
          next.run.bag.push(part.id);
          got.push(part.id);
        } else {
          next.run.pendingLoot.push(part.id);
        }
      }
      next.run.stage = 'loot';
      ST().addLog(next, { kind: 'loot', text: `箱子里有 ${got.length} 件构件。` });
      return ST().ok(next, [{ type: 'chest', meta: { itemIds: got } }]);
    }

    if (node.type === 'event') {
      const evId = rngShuffle(next, D().EVENT_ORDER)[0];
      const ev = D().event(evId);
      next.run.event = { eventId: evId, resolved: false, resultText: '', pendingCombat: null };
      next.run.stage = 'event';
      return ST().ok(next, [{ type: 'eventOpen', meta: { eventId: evId } }]);
    }

    if (node.type === 'camp') {
      next.run.stage = 'camp';
      return ST().ok(next, [{ type: 'campOpen' }]);
    }

    if (node.type === 'merchant') {
      const offers = [];
      for (let i = 0; i < 3; i++) {
        const isWeapon = rngChance(next, 0.3);
        const tpl = isWeapon
          ? rngShuffle(next, D().WEAPON_ORDER)[0]
          : rngShuffle(next, D().TEMPLATE_ORDER)[0];
        const part = ST().makePart(next, {
          kind: isWeapon ? 'weapon' : 'circuit',
          weaponId: isWeapon ? tpl : undefined,
          templateId: isWeapon ? undefined : tpl,
        });
        next.itemsById[part.id] = part;
        const base = isWeapon ? 90 : 55;
        offers.push({
          id: 'o' + i + '_' + part.id,
          itemId: part.id,
          price: base + rngInt(next, 0, 25),
          sold: false,
        });
      }
      next.run.shop = offers;
      next.run.stage = 'merchant';
      return ST().ok(next, [{ type: 'merchantOpen' }]);
    }

    return ST().fail(st, 'bad_node', '未知节点类型');
  }

  /* ------------------------------ 事件 ------------------------------ */

  function chooseEvent(st, choiceId) {
    const run = st.run;
    if (!run || run.stage !== 'event' || !run.event) return ST().fail(st, 'bad_stage', '现在不在事件中');
    if (run.event.resolved) return ST().fail(st, 'resolved', '事件已经处理过');
    const ev = D().event(run.event.eventId);
    const choice = (ev.choices || []).find((c) => c.id === choiceId);
    if (!choice) return ST().fail(st, 'no_choice', '没有这个选项');

    let next = ST().clone(st);
    const r = next.run;
    r.event.resolved = true;
    r.event.resultText = choice.text || '';
    const results = [];

    if (choice.combat) {
      r.event.pendingCombat = choice.combat.kind || 'normal';
      /* 事件战斗也走检查点：先锁节点再生成 */
      const nodeId = r.activeNodeId;
      const open = V.Encounter.openForEvent(next, nodeId, choice.combat.kind || 'normal');
      if (!open.ok) return open;
      next = open.state;
      next.run.event = r.event;
      next.run.stage = 'battle';
      const cr = V.Combat.create(next, next.run.encounter.enemyBlueprint, next.run.encounter.combatRngStart);
      if (!cr.ok) return cr;
      const b = cr.state.run.battle;
      if (choice.text) {
        b.logSeq += 1;
        b.logs.push({ seq: b.logSeq, type: 'note', text: choice.text });
      }
      return ST().ok(cr.state, [{ type: 'eventCombat', meta: { kind: choice.combat.kind } }]);
    }

    if (choice.loot) {
      for (let i = 0; i < choice.loot; i++) {
        const tpl = rngShuffle(next, D().TEMPLATE_ORDER)[0];
        const part = ST().makePart(next, { kind: 'circuit', templateId: tpl, acquiredRunId: r.id, acquiredSeq: r.bag.length + r.pendingLoot.length + i + 1 });
        next.itemsById[part.id] = part;
        if (bagUsed(next) + ST().partCells(part) <= D().DESIGN.bagCapacity) {
          r.bag.push(part.id);
          results.push({ kind: 'loot', itemId: part.id });
        } else {
          r.pendingLoot.push(part.id);
          results.push({ kind: 'loot', itemId: part.id, overflow: true });
        }
      }
    }

    if (choice.damagePct) {
      const target = r.party[Math.floor(r.party.length * 0.5)] || r.party[0];
      if (target) {
        const u = next.roster.find((x) => x.id === target.uid);
        const st2 = V.Roster.stats(next, u);
        const dmg = Math.round(st2.maxHp * choice.damagePct);
        target.hp = Math.max(1, (target.hp == null ? st2.maxHp : target.hp) - dmg);
        results.push({ kind: 'damage', uid: target.uid, amount: dmg });
      }
    }

    if (choice.stress) {
      r.party.forEach((p) => {
        p.stress = Math.max(0, Math.min(100, (p.stress || 0) + choice.stress));
        const u = next.roster.find((x) => x.id === p.uid);
        if (u) u.stress = p.stress;
      });
      results.push({ kind: 'stress', amount: choice.stress });
    }

    r.stage = r.pendingLoot.length ? 'loot' : 'event';
    return ST().ok(next, [{ type: 'eventResolve', meta: { choiceId, results } }]);
  }

  /* ------------------------------ 祝福 ------------------------------ */

  function chooseBlessing(st, blessingId) {
    const run = st.run;
    if (!run || run.stage !== 'blessing') return ST().fail(st, 'bad_stage', '现在不能选祝福');
    if (!D().BLESSINGS[blessingId]) return ST().fail(st, 'no_blessing', '没有这个祝福');
    const next = ST().clone(st);
    next.run.blessings.push(blessingId);
    next.run.pendingAdvance = null;
    advance(next);
    return ST().ok(next, [{ type: 'blessing', meta: { blessingId } }]);
  }

  /* ------------------------------ 商人 ------------------------------ */

  function buy(st, offerId) {
    const run = st.run;
    if (!run || run.stage !== 'merchant' || !run.shop) return ST().fail(st, 'bad_stage', '现在不在商人处');
    const offer = run.shop.find((o) => o.id === offerId);
    if (!offer) return ST().fail(st, 'no_offer', '没有这个商品');
    if (offer.sold) return ST().fail(st, 'sold', '已经卖掉了');
    if (st.gold < offer.price) return ST().fail(st, 'no_gold', '金币不够');

    const next = ST().clone(st);
    const o = next.run.shop.find((x) => x.id === offerId);
    const part = next.itemsById[o.itemId];
    if (bagUsed(next) + ST().partCells(part) > D().DESIGN.bagCapacity) {
      return ST().fail(st, 'bag_full', '背包放不下，先处理待取舍的构件');
    }
    next.gold -= o.price;
    o.sold = true;
    part.acquiredRunId = next.run.id;
    part.acquiredSeq = next.run.bag.length + 1;
    next.run.bag.push(part.id);
    /* 所有权从 merchant 转到 bag */
    return ST().ok(next, [{ type: 'buy', meta: { offerId, price: o.price, itemId: part.id } }]);
  }

  /* ------------------------------ 掉落取舍 ------------------------------ */

  function resolveLoot(st, itemId, decision) {
    const run = st.run;
    if (!run || !run.pendingLoot.includes(itemId)) return ST().fail(st, 'no_pending', '没有这件待处理构件');
    const next = ST().clone(st);
    const r = next.run;
    const part = next.itemsById[itemId];

    if (decision === 'discard') {
      r.pendingLoot = r.pendingLoot.filter((id) => id !== itemId);
      delete next.itemsById[itemId];
      return ST().ok(next, [{ type: 'lootDiscard', meta: { itemId } }]);
    }

    if (decision === 'take') {
      if (bagUsed(next) + ST().partCells(part) > D().DESIGN.bagCapacity) {
        return ST().fail(st, 'bag_full', '背包放不下，先选一件替换或丢弃');
      }
      r.pendingLoot = r.pendingLoot.filter((id) => id !== itemId);
      r.bag.push(itemId);
      return ST().ok(next, [{ type: 'lootTake', meta: { itemId } }]);
    }

    if (typeof decision === 'string' && decision.startsWith('replace:')) {
      const dropId = decision.slice('replace:'.length);
      if (!r.bag.includes(dropId)) return ST().fail(st, 'no_bag_item', '背包里没有这件构件');
      const dropPart = next.itemsById[dropId];
      if (bagUsed(next) - ST().partCells(dropPart) + ST().partCells(part) > D().DESIGN.bagCapacity) {
        return ST().fail(st, 'bag_full', '换掉这件也放不下');
      }
      r.bag = r.bag.filter((id) => id !== dropId);
      delete next.itemsById[dropId];
      r.pendingLoot = r.pendingLoot.filter((id) => id !== itemId);
      r.bag.push(itemId);
      return ST().ok(next, [{ type: 'lootReplace', meta: { itemId, droppedId: dropId } }]);
    }

    return ST().fail(st, 'bad_decision', '未知取舍方式');
  }

  /* ------------------------------ 营火烙印 ------------------------------ */

  function inscribable(st, unitId) {
    const run = st.run;
    if (!run) return { ok: false, reason: '没有远征' };
    if (run.fieldInscribedUnitIds.includes(unitId)) return { ok: false, reason: '这名角色本局已经烙印过' };
    const hasNew = run.bag.some((id) => {
      const p = st.itemsById[id];
      return p && p.kind === 'circuit' && p.acquiredRunId === run.id;
    });
    if (!hasNew) return { ok: false, reason: '背包里没有本局获得的构件' };
    return { ok: true };
  }

  /**
   * inscribe(st, unitId, itemId, proposedPlacements)
   * 原子提交：几何/负荷/输出全部合法 + 原件集合不减 + 新件确为本局所得。
   */
  function inscribe(st, unitId, itemId, proposedPlacements) {
    const run = st.run;
    if (!run) return ST().fail(st, 'no_run', '没有远征');
    if (run.stage !== 'camp') return ST().fail(st, 'bad_stage', '只有在营火才能现场烙印');
    const unit = st.roster.find((u) => u.id === unitId);
    if (!unit) return ST().fail(st, 'no_unit', '找不到角色');

    const gate = inscribable(st, unitId);
    if (!gate.ok) return ST().fail(st, 'cannot_inscribe', gate.reason);

    const newPart = st.itemsById[itemId];
    if (!newPart) return ST().fail(st, 'no_item', '找不到构件');
    if (newPart.kind !== 'circuit') return ST().fail(st, 'bad_item', '只能烙印回路构件');
    if (newPart.acquiredRunId !== run.id || !run.bag.includes(itemId)) {
      return ST().fail(st, 'not_this_run', '只能使用本局获得、且还在背包里的构件');
    }

    const base = (run.fieldLayouts[unitId]) ? run.fieldLayouts[unitId] : unit.board.placements;
    const baseItemIds = base.map((p) => p.itemId);
    const proposedIds = (proposedPlacements || []).map((p) => p.itemId);

    /* 原件集合不能减少，新件恰好一次 */
    for (const id of baseItemIds) {
      if (!proposedIds.includes(id)) return ST().fail(st, 'missing_original', '原构件不能在烙印中丢掉');
    }
    const newCount = proposedIds.filter((id) => id === itemId).length;
    if (newCount !== 1) return ST().fail(st, 'new_item_count', '新构件必须恰好放置一次');
    const extra = proposedIds.filter((id) => id !== itemId && !baseItemIds.includes(id));
    if (extra.length) return ST().fail(st, 'extra_items', '只能添加一件本局新构件');

    const pv = V.Circuit.preview(st, unitId, proposedPlacements);
    if (!pv.ok) return ST().fail(st, 'bad_geometry', pv.errors.join('；'), { details: pv.errors });
    if (!pv.reachableOutputs.length) {
      return ST().fail(st, 'no_output', '烙印后没有任何输出连通');
    }

    const next = ST().clone(st);
    const r = next.run;
    const u2 = next.roster.find((x) => x.id === unitId);

    /* 代价：本局最大生命 ×0.8，当前 HP 等比，压力 +40。
       先取“烙印前”的数值，否则会把自己算进去再乘一次。 */
    const mult = D().DESIGN.fieldInscribe.maxHpMult;
    const p = r.party.find((x) => x.uid === unitId);
    const maxHpBefore = V.Roster.stats(next, u2).maxHp;
    r.maxHpModifiers[unitId] = (r.maxHpModifiers[unitId] || 1) * mult;
    if (p) {
      const cur = p.hp == null ? maxHpBefore : p.hp;
      p.hp = Math.max(1, Math.round(cur * mult));
      p.stress = Math.min(100, (p.stress || 0) + D().DESIGN.fieldInscribe.stress);
      u2.stress = p.stress;
    }

    /* 归属：新件从 bag 移出，变成 provisional；临时板面只在本局有效 */
    r.bag = r.bag.filter((id) => id !== itemId);
    r.provisionalBindings.push({ unitId, itemId, placement: null });
    r.fieldLayouts[unitId] = (proposedPlacements || []).map((x) => ({
      itemId: x.itemId, x: x.x, y: x.y, rotation: x.rotation || 0, mirrorY: !!x.mirrorY,
    }));
    const binding = r.provisionalBindings.find((b) => b.itemId === itemId);
    if (binding) {
      const pl = r.fieldLayouts[unitId].find((x) => x.itemId === itemId);
      binding.placement = pl ? { ...pl } : null;
    }
    if (!r.fieldInscribedUnitIds.includes(unitId)) r.fieldInscribedUnitIds.push(unitId);

    ST().addLog(next, { kind: 'sys', text: `${u2.name} 在营火旁完成现场烙印：生命上限下降，但回路更强。` });
    return ST().ok(next, [{ type: 'fieldInscribe', meta: { unitId, itemId } }]);
  }

  /** 营火休息：恢复生命，压力下降。 */
  function campRest(st) {
    const run = st.run;
    if (!run || run.stage !== 'camp') return ST().fail(st, 'bad_stage', '现在不在营火');
    const next = ST().clone(st);
    next.run.party.forEach((p) => {
      const u = next.roster.find((x) => x.id === p.uid);
      const s = V.Roster.stats(next, u);
      const cur = p.hp == null ? s.maxHp : p.hp;
      p.hp = Math.min(s.maxHp, cur + Math.round(s.maxHp * 0.45));
      p.stress = Math.max(0, (p.stress || 0) - 30);
      u.stress = p.stress;
    });
    next.run.stage = 'camp';
    return ST().ok(next, [{ type: 'campRest' }]);
  }

  /* ------------------------------ 完成节点 ------------------------------ */

  function finishNode(st) {
    const run = st.run;
    if (!run) return ST().fail(st, 'no_run', '没有远征');
    if (['battle', 'battleReview', 'blessing'].includes(run.stage)) {
      return ST().fail(st, 'bad_stage', '这个阶段还没处理完');
    }
    if (run.stage === 'event' && run.event && !run.event.resolved) {
      return ST().fail(st, 'bad_stage', '事件还没选');
    }
    if (run.pendingLoot.length) return ST().fail(st, 'pending_loot', '还有待取舍的构件没处理');

    const next = ST().clone(st);
    const r = next.run;

    let finishedType = null;
    const activeId = r.activeNodeId || r.lockedNodeId;
    if (activeId) {
      const node = r.nodes.find((n) => n.id === activeId);
      if (node && !node.consumed) {
        node.consumed = true;
        finishedType = node.type;
        r.completedNodeIds.push(node.id);
        /* 第 7 层只有打倒首领才算完成这一层 */
        if (r.floor < D().DESIGN.maxFloor || finishedType === 'boss') {
          r.completedFloors = Math.max(r.completedFloors, r.floor);
          if (!r.finishedFloors.includes(r.floor)) r.finishedFloors.push(r.floor);
        }
      }
    }
    r.activeNodeId = null;
    r.event = null;
    r.shop = null;
    r.encounter = null;
    r.lockedNodeId = null;

    /* 第 7 层：没打首领就还留在这一层 */
    if (r.floor >= D().DESIGN.maxFloor) {
      if (finishedType !== 'boss') {
        r.stage = 'map';
        const left = r.nodes.filter((n) => !n.consumed);
        if (left.length && left.some((n) => n.type === 'boss')) {
          return ST().ok(next, [{ type: 'nodeFinished', meta: { floor: r.floor, needBoss: true } }]);
        }
      }
      const ex = extract(next, true);
      return ex.ok ? ex : ex;
    }

    r.pendingAdvance = { from: r.floor };

    /* 每层祝福：2/4/6 层，每层一次 */
    if (D().DESIGN.blessingFloors.includes(r.floor) && !r.blessingFloorsTaken.includes(r.floor)) {
      r.blessingFloorsTaken.push(r.floor);
      r.stage = 'blessing';
      r.blessingOptions = rngShuffle(next, D().BLESSING_ORDER).slice(0, 3);
      return ST().ok(next, [{ type: 'blessingOffer', meta: { options: r.blessingOptions } }]);
    }

    advance(next);
    return ST().ok(next, [{ type: 'nodeFinished', meta: { floor: r.floor } }]);
  }

  /** 推进到下一层：层间喘息、重置阶段、生成新节点。 */
  function advance(st) {
    const r = st.run;
    if (!r) return st;
    const finished = r.floor;
    if (finished >= D().DESIGN.maxFloor) return st;

    r.party.forEach((p) => {
      const u = st.roster.find((x) => x.id === p.uid);
      if (!u) return;
      const s2 = V.Roster.stats(st, u);
      const cur = p.hp == null ? s2.maxHp : p.hp;
      p.hp = Math.min(s2.maxHp, cur + Math.round(s2.maxHp * D().DESIGN.floorRecovery));
    });

    r.floor = finished + 1;
    r.stage = 'map';
    r.pendingAdvance = null;
    r.blessingOptions = null;
    genNodes(st);
    ST().addLog(st, { kind: 'sys', text: `第 ${r.floor} 层。${r.nodes.map((n) => n.name).join('、')}。` });
    return st;
  }

  /* ------------------------------ 结算事务 ------------------------------ */

  /** 固化临时板面与新件归属，写战史，清 run。 */
  function commitSettlement(st, kind, extra) {
    const next = ST().clone(st);
    const r = next.run;
    const gained = { items: [], gold: r.goldFound, shards: r.shards };

    /* ① 临时板面固化 + provisional 转永久 */
    Object.keys(r.fieldLayouts || {}).forEach((unitId) => {
      const u = next.roster.find((x) => x.id === unitId);
      if (!u) return;
      u.board.placements = r.fieldLayouts[unitId].map((x) => ({
        itemId: x.itemId, x: x.x, y: x.y, rotation: x.rotation || 0, mirrorY: !!x.mirrorY,
      }));
    });

    /* ② bag 入仓 */
    r.bag.forEach((id) => {
      const p = next.itemsById[id];
      if (!p) return;
      if (!next.stash.includes(id)) next.stash.push(id);
      gained.items.push(id);
    });

    /* ③ 货币 */
    next.gold += Math.round(r.goldFound);
    next.shards += r.shards;

    /* ④ 清本局 maxHp 修正、回营满血；保留已确认压力 */
    next.roster.forEach((u) => {
      if (r.maxHpModifiers && r.maxHpModifiers[u.id]) {
        /* 修正只在本局有效，回营后移除 */
        delete r.maxHpModifiers[u.id];
      }
      u.hp = null;
    });

    /* ⑤ 战史 / 合格撤离 / 调谐 */
    const record = V.Roster.recordExtraction(next, {
      runId: r.id,
      kind,
      depth: r.completedFloors,
      floors: r.finishedFloors.slice(),
      party: r.party.map((p) => p.uid),
      usedWeapons: r.party.map((p) => {
        const load = (r.startLoadouts || {})[p.uid];
        const partId = load ? load.weaponId : null;
        const part = partId ? next.itemsById[partId] : null;
        return {
          uid: p.uid,
          partId,
          weaponId: part ? part.templateId : null,
        };
      }),
    });

    next.bestDepth = Math.max(next.bestDepth, r.completedFloors);
    if (record.eligible) next.stats.extracts = (next.stats.extracts || 0) + 1;
    if (kind === 'clear') next.stats.wins = (next.stats.wins || 0) + 1;

    next.settlement = {
      mode: kind,
      title: kind === 'clear' ? '回廊尽头' : '成功撤离',
      depth: r.completedFloors,
      gold: gained.gold,
      shards: gained.shards,
      items: gained.items,
      eligible: record.eligible,
      reason: record.reason,
      records: record.records || [],
    };

    next.run = null;
    return next;
  }

  /** 正常撤离（第 7 层通关也走这里，同一条幂等事务）。 */
  function extract(st, clear) {
    const r = st.run;
    if (!r) return ST().fail(st, 'no_run', '没有远征');
    if (!clear && r.stage !== 'map') return ST().fail(st, 'bad_stage', '只能在选择节点时撤离');
    if (!clear && r.pendingLoot.length) return ST().fail(st, 'pending_loot', '还有待取舍的构件');
    const next = commitSettlement(st, clear ? 'clear' : 'extract');
    return ST().ok(next, [{ type: 'settlement', meta: next.settlement }]);
  }

  /** 撤退代价预览（不写 state）。 */
  function previewRetreat(st, mode) {
    const r = st.run;
    if (!r) return { ok: false, reason: '没有远征' };
    const keepRatio = mode === 'emergency' ? D().DESIGN.emergency.keepRatio : 0;
    const newParts = collectNewParts(st).sort((a, b) => a.seq - b.seq);
    const keepCount = Math.ceil(newParts.length * keepRatio);
    const kept = newParts.slice(0, keepCount);
    const lost = newParts.slice(keepCount);

    const cp = r.encounter && r.encounter.checkpoint;
    const entranceStress = {};
    if (cp && cp.run) cp.run.party.forEach((p) => { entranceStress[p.uid] = p.stress || 0; });

    return {
      ok: true,
      mode,
      keepParts: kept.map((x) => x.id),
      lostParts: lost.map((x) => x.id),
      gold: Math.floor(r.goldFound * (mode === 'emergency' ? 0.5 : 0)),
      shards: mode === 'emergency' ? Math.floor(r.shards * 0.5) + r.completedFloors : 0,
      stress: mode === 'emergency' ? D().DESIGN.emergency.stress : D().DESIGN.defeat.stress,
      entranceStress,
      completedFloors: r.completedFloors,
    };
  }

  function collectNewParts(st) {
    const r = st.run;
    const out = [];
    const push = (id) => {
      const p = st.itemsById[id];
      if (p && p.acquiredRunId === r.id) out.push({ id, seq: p.acquiredSeq || 0 });
    };
    r.bag.forEach(push);
    r.provisionalBindings.forEach((b) => push(b.itemId));
    return out;
  }

  /**
   * 撤退：紧急保留一半新件，确认败退全失；两者都恢复入场装配、回营满血。
   */
  function retreat(st, mode) {
    const r = st.run;
    if (!r) return ST().fail(st, 'no_run', '没有远征');
    const preview = previewRetreat(st, mode);
    const next = ST().clone(st);
    const run = next.run;

    /* ① 恢复入场装配：永久板面、主手、指令 */
    Object.entries(run.startLoadouts || {}).forEach(([uid, load]) => {
      const u = next.roster.find((x) => x.id === uid);
      if (!u) return;
      u.weaponId = load.weaponId;
      u.board = ST().clone(load.board);
      u.gambits = ST().clone(load.gambits);
    });
    /* 临时板面与绑定全部丢弃 */
    run.fieldLayouts = {};
    run.provisionalBindings = [];

    /* ② 丢弃未保留的新件（含临时绑定与背包） */
    const keepSet = new Set(preview.keepParts);
    collectNewParts(next).forEach((x) => {
      if (!keepSet.has(x.id)) {
        delete next.itemsById[x.id];
      }
    });
    /* 保留的新件进仓库 */
    preview.keepParts.forEach((id) => {
      if (!next.itemsById[id]) return;
      if (!next.stash.includes(id)) next.stash.push(id);
    });
    run.bag = [];

    /* ③ 货币 */
    next.gold += preview.gold;
    next.shards += preview.shards;

    /* ④ 压力与生命 */
    const cp = run.encounter && run.encounter.checkpoint;
    const entrance = {};
    if (cp && cp.run) cp.run.party.forEach((p) => { entrance[p.uid] = p.stress || 0; });
    run.party.forEach((p) => {
      const u = next.roster.find((x) => x.id === p.uid);
      const base = entrance[p.uid] != null ? entrance[p.uid] : (p.stress || 0);
      const stress = Math.min(100, base + preview.stress);
      if (u) {
        u.stress = stress;
        u.hp = null;
      }
    });
    next.roster.forEach((u) => { u.hp = null; });

    /* ⑤ 不记合格撤离 */
    V.Roster.recordExtraction(next, {
      runId: run.id,
      kind: mode === 'emergency' ? 'emergency' : 'defeat',
      depth: run.completedFloors,
      floors: [],
      party: run.party.map((p) => p.uid),
      usedWeapons: [],
      ineligible: true,
    });

    next.bestDepth = Math.max(next.bestDepth, run.completedFloors);
    next.settlement = {
      mode,
      title: mode === 'emergency' ? '紧急撤退' : '确认败退',
      depth: run.completedFloors,
      gold: preview.gold,
      shards: preview.shards,
      items: preview.keepParts,
      lostItems: preview.lostParts,
      eligible: false,
      reason: mode === 'emergency' ? '紧急撤退不算合格撤离' : '败退不算合格撤离',
      stress: preview.stress,
    };

    next.run = null;
    return ST().ok(next, [{ type: 'retreat', meta: next.settlement }]);
  }

  /* 事件触发的战斗：也必须有检查点（用同一套 open 逻辑，但节点类型由事件决定） */
  function openForEvent(st, nodeId, kind) {
    const next = ST().clone(st);
    const node = (next.run.nodes || []).find((n) => n.id === nodeId) || {
      id: nodeId, type: 'event',
    };
    const savedType = node.type;
    node.type = kind === 'boss' ? 'boss' : kind === 'elite' ? 'elite' : 'battle';
    const r = V.Encounter.open(next, nodeId);
    node.type = savedType;
    return r;
  }

  V.Expedition = {
    start, chooseNode, chooseEvent, chooseBlessing, buy, resolveLoot,
    inscribe, inscribable, campRest, finishNode, extract, retreat, previewRetreat,
    openForEvent, advance, commitSettlement, collectNewParts,
    bagUsed, bagFree, genNodes, rngInt, rngShuffle, rngChance,
  };
})(globalThis.Ashen ||= {});
