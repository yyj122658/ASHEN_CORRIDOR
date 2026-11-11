'use strict';
/* 招募、主手换装、战史与一阶调谐。所有成长只提供决策能力，不追加星级/羁绊/永久倍率。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;
  const ST = () => V.State;

  /** 有效属性：底盘 + 本局 maxHp 修正（远征中才有）。 */
  function stats(st, unit) {
    if (!unit) return { maxHp: 1, atk: 0, def: 0, spd: 1 };
    const body = D().body(unit.bodyPreset);
    const mod = (st.run && st.run.maxHpModifiers && st.run.maxHpModifiers[unit.id]) || 1;
    return {
      maxHp: Math.round(body.hp * mod),
      atk: body.atk,
      def: body.def,
      spd: body.spd,
      loadCap: body.loadCap,
      blocked: body.blocked,
      mod,
    };
  }

  /** 当前主手实例。 */
  function weaponOf(st, unit) {
    /* 武器系统已移除，保留空实现避免调用方崩 */
    return null;
  }

  /** 该角色在当前主手上已解锁的调谐特性（按人+件记录，换人不清零）。 */
  function traitOf(st, unit) {
    const w = weaponOf(st, unit);
    if (!w || !w.attunements) return null;
    const att = w.attunements[unit.id];
    return att && att.traitId ? att.traitId : null;
  }

  /* ------------------------------ 招募 ------------------------------ */

  function refreshShop(st, pay) {
    const next = ST().clone(st);
    const cost = 12;
    if (pay && next.gold < cost) return ST().fail(st, 'no_gold', `刷新需要 ${cost} 金币`);
    if (pay) next.gold -= cost;

    const offers = [];
    for (let i = 0; i < 3; i++) {
      const bodyIds = Object.keys(D().BODIES);
      const bi = A.Random.int(next.rngState, 0, bodyIds.length - 1);
      next.rngState = bi.state;
      const si = A.Random.int(next.rngState, 0, D().SKINS.length - 1);
      next.rngState = si.state;
      const wi = A.Random.int(next.rngState, 0, D().WEAPON_ORDER.length - 1);
      next.rngState = wi.state;
      const ni = A.Random.int(next.rngState, 0, D().NAMES.length - 1);
      next.rngState = ni.state;
      const pi = A.Random.int(next.rngState, D().DESIGN.recruitCost.min, D().DESIGN.recruitCost.max);
      next.rngState = pi.state;

      const skin = D().SKINS[si.value];
      offers.push({
        id: 'rc' + next.nextId + '_' + i,
        bodyPreset: bodyIds[bi.value],
        skinId: skin.id,
        name: D().NAMES[ni.value],
        weaponId: D().WEAPON_ORDER[wi.value],
        price: pi.value,
      });
    }
    next.shop = offers;
    return ST().ok(next, [{ type: 'shopRefresh', meta: { offers } }]);
  }

  function recruit(st, offerId) {
    const offer = (st.shop || []).find((o) => o.id === offerId);
    if (!offer) return ST().fail(st, 'no_offer', '没有这个招募位');
    if (offer.sold) return ST().fail(st, 'sold', '已经招募过了');
    if (st.gold < offer.price) return ST().fail(st, 'no_gold', '金币不够');
    if (st.roster.length >= 8) return ST().fail(st, 'roster_full', '营地已经满了');

    const next = ST().clone(st);
    next.gold -= offer.price;
    const o = next.shop.find((x) => x.id === offerId);
    o.sold = true;

    const unit = ST().makeUnit(next, {
      name: offer.name, skinId: offer.skinId, bodyPreset: offer.bodyPreset,
    });
    const weapon = ST().makePart(next, { kind: 'weapon', weaponId: offer.weaponId });
    next.itemsById[weapon.id] = weapon;
    unit.weaponId = weapon.id;
    /* 招募的人也不带功法：功法靠掉落与祭坛 */
    ST().equipPreset(next, unit, 'basic');
    next.roster.push(unit);

    /* 有空位就自动上场 */
    const empty = next.team.indexOf(null);
    if (empty >= 0) next.team[empty] = unit.id;

    ST().addLog(next, { kind: 'sys', text: `${unit.name} 加入了营地。` });
    return ST().ok(next, [{ type: 'recruit', meta: { unitId: unit.id, price: offer.price } }]);
  }

  /* ------------------------------ 换装与指令 ------------------------------ */

  function equipWeapon(st, unitId, itemId) {
    const unit = st.roster.find((u) => u.id === unitId);
    if (!unit) return ST().fail(st, 'no_unit', '找不到角色');
    const part = st.itemsById[itemId];
    if (!part || part.kind !== 'weapon') return ST().fail(st, 'bad_item', '不是主手');
    if (st.run) return ST().fail(st, 'in_run', '远征中不能换主手');

    const holder = st.roster.find((x) => x.weaponId === itemId);
    const inStash = st.stash.includes(itemId);
    if (!inStash && !holder) {
      return ST().fail(st, 'not_owned', '这件主手不在仓库里，也没有人拿着');
    }

    const next = ST().clone(st);
    const u = next.roster.find((x) => x.id === unitId);
    const old = u.weaponId;

    if (holder && holder.id !== unitId) {
      /* 直接转移：原持有者换回当前角色的旧主手，避免有人空手 */
      const prev = next.roster.find((x) => x.id === holder.id);
      prev.weaponId = old || null;
    } else if (old && !next.stash.includes(old)) {
      next.stash.push(old);
    }
    if (inStash) next.stash = next.stash.filter((id) => id !== itemId);
    u.weaponId = itemId;

    /* 主手换掉后，如果新主手没有可用板面就补一套基础线路（不产生不可用板） */
    return ST().ok(next, [{ type: 'equipWeapon', meta: { unitId, from: old, to: itemId } }]);
  }

  function setGambits(st, unitId, rules) {
    const unit = st.roster.find((u) => u.id === unitId);
    if (!unit) return ST().fail(st, 'no_unit', '找不到角色');
    const v = V.Tactics.validate(rules, unit.logicSlots);
    if (!v.ok) return ST().fail(st, 'bad_gambits', v.errors.join('；'), { details: v.errors });
    const next = ST().clone(st);
    const u = next.roster.find((x) => x.id === unitId);
    u.gambits = ST().clone(rules);
    return ST().ok(next, [{ type: 'gambits', meta: { unitId } }]);
  }

  function setTeamSlot(st, slot, unitId) {
    if (slot < 0 || slot > 3) return ST().fail(st, 'bad_slot', '槽位只能是 1-4');
    if (unitId && !st.roster.some((u) => u.id === unitId)) return ST().fail(st, 'no_unit', '找不到角色');
    const next = ST().clone(st);
    if (unitId) {
      const prev = next.team.indexOf(unitId);
      if (prev >= 0) next.team[prev] = null;
    }
    next.team[slot] = unitId || null;
    return ST().ok(next, [{ type: 'team', meta: { slot, unitId } }]);
  }

  /**
   * saveBoard：保存工坊板面，并同步归属（仓库 → 板面 / 板面 → 仓库）。
   * 本局背包里的构件不能在这里直接装上，只能走营火烙印。
   */
  function saveBoard(st, unitId, placements) {
    const unit = st.roster.find((u) => u.id === unitId);
    if (!unit) return ST().fail(st, 'no_unit', '找不到角色');
    if (st.run) return ST().fail(st, 'in_run', '远征中不能在工坊改板面，只能用营火烙印');

    const listed = (placements || []).map((p) => p.itemId);
    const unknown = listed.find((id) => !st.itemsById[id]);
    if (unknown) return ST().fail(st, 'no_item', `构件不存在：${unknown}`);

    const res = V.Circuit.saveLoadout(st, unitId, placements);
    if (!res.ok) return ST().fail(st, 'bad_board', res.errors.join('；'), { details: res.errors });

    const next = res.state;
    const placed = new Set(listed);
    const before = new Set(unit.board.placements.map((p) => p.itemId));

    placed.forEach((id) => {
      if (before.has(id)) return;
      /* 从仓库拿来用 */
      next.stash = next.stash.filter((x) => x !== id);
    });
    before.forEach((id) => {
      if (placed.has(id)) return;
      if (!next.stash.includes(id)) next.stash.push(id);
    });

    return ST().ok(next, [{ type: 'boardSaved', meta: { unitId, load: res.load } }]);
  }

  /* ------------------------------ 战史与调谐 ------------------------------ */

  const MIN_DEPTH = 3;

  /**
   * recordExtraction(st, settlement) -> {eligible, reason, records}
   * 合格撤离：普通撤离或通关，且本次完成至少 3 层；同一 runId 只计一次。
   */
  function recordExtraction(st, rec) {
    const kind = rec.kind;
    const depth = rec.depth || 0;
    const eligible = !rec.ineligible
      && (kind === 'extract' || kind === 'clear')
      && depth >= MIN_DEPTH;

    const reason = eligible
      ? `完成 ${depth} 层，计一次合格撤离`
      : rec.ineligible
        ? `${kind === 'emergency' ? '紧急撤退' : '败退'}不算合格撤离`
        : depth < MIN_DEPTH
          ? `只完成 ${depth} 层，至少 ${MIN_DEPTH} 层才算合格`
          : '本次不计入战史';

    const records = [];
    (rec.party || []).forEach((uid) => {
      const unit = st.roster.find((u) => u.id === uid);
      if (!unit) return;

      unit.history = unit.history || { eligibleRunIds: [], records: [] };
      const already = unit.history.eligibleRunIds.includes(rec.runId);
      if (eligible && !already) unit.history.eligibleRunIds.push(rec.runId);

      unit.history.records.push({
        runId: rec.runId,
        kind,
        depth,
        floors: (rec.floors || []).slice(),
        eligible,
        reason,
      });
      if (unit.history.records.length > 40) unit.history.records.shift();

      /* 两次合格撤离解锁第三条规则槽 */
      if (eligible && unit.history.eligibleRunIds.length >= D().DESIGN.logicUnlockExtracts) {
        unit.logicSlots = D().DESIGN.logicSlotsMax;
      }

      /* 一阶调谐：同一角色带同一主手 3 次合格撤离 */
      const used = (rec.usedWeapons || []).find((w) => w.uid === uid);
      if (eligible && used && used.partId) {
        const part = st.itemsById[used.partId];
        if (part && part.kind === 'weapon') {
        }
      }

      if (eligible) records.push({ unitId: uid, type: 'eligible', runId: rec.runId, depth });
    });

    return { eligible, reason, records };
  }

  function history(st, unitId) {
    const u = st.roster.find((x) => x.id === unitId);
    if (!u) return null;
    /* 武器已移除：调谐改为按「当前功法的合格撤离次数」统计，不做永久强化 */
    const ms = u.manuscript || null;
    const att = ms ? (u.history.msAttune || {})[ms.id] : null;
    return {
      unitId,
      name: u.name,
      stress: u.stress,
      logicSlots: u.logicSlots,
      eligibleRuns: u.history.eligibleRunIds.length,
      nextSlotIn: Math.max(0, D().DESIGN.logicUnlockExtracts - u.history.eligibleRunIds.length),
      attunement: {
        manuscriptId: ms ? ms.id : null,
        manuscriptName: ms ? ms.name : null,
        runs: att ? (att.eligibleRunIds || []).length : 0,
        need: D().DESIGN.attuneRuns,
        traitId: null,
        traitName: null,
        traitDesc: null,
      },
      records: u.history.records.slice(-8).reverse(),
    };
  }

  /** 安抚：花金币降压力。 */
  function comfort(st, unitId) {
    const u = st.roster.find((x) => x.id === unitId);
    if (!u) return ST().fail(st, 'no_unit', '找不到角色');
    const cost = 30;
    if (st.gold < cost) return ST().fail(st, 'no_gold', `安抚需要 ${cost} 金币`);
    const next = ST().clone(st);
    next.gold -= cost;
    const u2 = next.roster.find((x) => x.id === unitId);
    u2.stress = 0;
    u2.affliction = null;
    if (next.run) {
      const p = next.run.party.find((x) => x.uid === unitId);
      if (p) p.stress = 0;
    }
    return ST().ok(next, [{ type: 'comfort', meta: { unitId } }]);
  }

  V.Roster = {
    stats, weaponOf, traitOf, refreshShop, recruit, equipWeapon, setGambits, setTeamSlot,
    recordExtraction, history, comfort, saveBoard, MIN_DEPTH,
  };
})(globalThis.Ashen ||= {});
