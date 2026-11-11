'use strict';
/* 队伍、属性计算、羁绊、升星、遣散、招募、安抚与祭坛升级。 */
(function (A) {
  'use strict';

  const S = () => A.State;
  const D = () => A.Data;

  const STAR_MULT = [0, 1, 1.55, 2.30];

  /* ---------- 属性 ---------- */

  function emptyStats() {
    return {
      maxHp: 0, atk: 0, def: 0, spd: 0,
      crit: 0, acc: 0, eva: 0,
      critDmg: 0,
      atkMult: 0, spdMult: 0, magicMult: 0, physMult: 0,
      healMult: 0, healingReceivedMult: 1,
      dmgReduce: 0, postHeal: 0,
      burn: 0, slow: 0, slowPow: 0.30, killBonus: 0,
      regen: 0, regenEvery: 3,
    };
  }

  function applyItemStats(s, it) {
    if (!it) return;
    for (const k in it.stats) {
      const v = it.stats[k];
      if (k === 'hp') s.maxHp += v;
      else if (k === 'spd') s.spd += v;
      else if (k === 'atkPct') s.atkMult += v;
      else s[k] = (s[k] || 0) + v;
    }
  }

  function partyJobCounts(state, partyIds) {
    const jobCount = {}, elemCount = {};
    (partyIds || []).forEach((id) => {
      const u = state.roster.find((x) => x.id === id);
      if (!u) return;
      jobCount[u.cls] = (jobCount[u.cls] || 0) + 1;
      const el = D().CLASSES[u.cls].element;
      elemCount[el] = (elemCount[el] || 0) + 1;
    });
    return { jobCount, elemCount };
  }

  function calcStats(state, unitId, partyIds) {
    const u = state.roster.find((x) => x.id === unitId);
    if (!u) return emptyStats();
    const c = D().CLASSES[u.cls];
    const mult = STAR_MULT[u.star] || 1;

    const s = emptyStats();
    s.maxHp = Math.round(c.hp * mult);
    s.atk = Math.round(c.atk * mult);
    s.def = Math.round(c.def * mult);
    s.spd = c.spd;
    s.crit = c.crit;
    s.acc = c.acc;
    s.eva = c.eva;

    // 装备
    ['weapon', 'armor', 'trinket'].forEach((slot) => {
      const id = u.equip[slot];
      if (id) applyItemStats(s, state.itemsById[id]);
    });

    // 永久升级
    s.maxHp = Math.round(s.maxHp * (1 + 0.05 * (state.upgrades.hp || 0)));
    s.atk = Math.round(s.atk * (1 + 0.05 * (state.upgrades.atk || 0)));

    // 羁绊（同职业先算，元素后算，累计生效）
    const { jobCount, elemCount } = partyJobCounts(state, partyIds);
    for (const job in jobCount) {
      const def = D().JOB_SYNERGY[job];
      if (!def) continue;
      def.tiers.forEach((t) => { if (jobCount[job] >= t.n) t.f(s); });
    }
    for (const el in elemCount) {
      const def = D().ELEM_SYNERGY[el];
      if (!def) continue;
      def.tiers.forEach((t) => { if (elemCount[el] >= t.n) t.f(s); });
    }

    // 本局祝福
    if (state.run && state.run.blessings) {
      state.run.blessings.forEach((b) => {
        if (b === 'ember') s.atkMult += 0.10;
        else if (b === 'stone') s.maxHp = Math.round(s.maxHp * 1.15);
        else if (b === 'spring') s.healMult += 0.20;
        else if (b === 'feather') s.spdMult += 0.10;
        else if (b === 'pact') s.atkMult += 0.20;
      });
    }

    // 精神状态：负值改为乘算的 healingReceivedMult，绝不出现“治疗变多”
    if (u.affliction) {
      if (u.affliction === 'paranoid') s.acc -= 0.12;
      else if (u.affliction === 'fear') s.spdMult -= 0.20;
      else if (u.affliction === 'despair') s.healingReceivedMult *= 0.70;
      else if (u.affliction === 'selfish') s.atkMult -= 0.15;
    }
    if (u.virtue) {
      if (u.virtue === 'stalwart') { s.atkMult += 0.20; s.dmgReduce += 0.10; }
      else if (u.virtue === 'focused') { s.acc += 0.15; s.crit += 0.10; }
    }

    s.atk = Math.round(s.atk * (1 + s.atkMult));
    s.spd = Math.max(3, Math.round(s.spd * (1 + s.spdMult)));
    s.crit = Math.min(0.85, Math.max(0, s.crit));
    s.acc = Math.min(1.0, Math.max(0.30, s.acc));
    s.eva = Math.min(0.55, Math.max(0, s.eva));
    s.dmgReduce = Math.min(0.75, Math.max(0, s.dmgReduce));
    s.maxHp = Math.max(1, Math.round(s.maxHp));
    return s;
  }

  function maxHpOf(state, unitId) {
    return calcStats(state, unitId, state.team.filter(Boolean)).maxHp;
  }

  /* ---------- 羁绊摘要 ---------- */

  function synergies(state, partyIds) {
    const { jobCount, elemCount } = partyJobCounts(state, partyIds);
    const out = [];

    for (const job in jobCount) {
      const def = D().JOB_SYNERGY[job];
      if (!def) continue;
      const n = jobCount[job];
      const activeTiers = def.tiers.filter((t) => n >= t.n);
      const next = def.tiers.find((t) => n < t.n);
      out.push({
        kind: 'job', id: job, name: def.name, count: n,
        activeTier: activeTiers.length,
        nextNeed: next ? next.n : null,
        desc: activeTiers.length ? activeTiers[activeTiers.length - 1].desc : (next ? next.desc : ''),
        active: activeTiers.length > 0,
      });
    }
    for (const el in elemCount) {
      const def = D().ELEM_SYNERGY[el];
      if (!def) continue;
      const n = elemCount[el];
      const activeTiers = def.tiers.filter((t) => n >= t.n);
      const next = def.tiers.find((t) => n < t.n);
      out.push({
        kind: 'elem', id: el, name: def.name, count: n,
        activeTier: activeTiers.length,
        nextNeed: next ? next.n : null,
        desc: activeTiers.length ? activeTiers[activeTiers.length - 1].desc : (next ? next.desc : ''),
        active: activeTiers.length > 0,
      });
    }
    return out;
  }

  /** 假设改动队伍后的羁绊变化（用于换人预览）。 */
  function previewTeamChange(state, unitId, action) {
    const before = state.team.slice();
    const after = state.team.slice();
    if (action === 'add') {
      const idx = after.findIndex((x) => x == null);
      if (idx >= 0) after[idx] = unitId;
    } else {
      const idx = after.indexOf(unitId);
      if (idx >= 0) after[idx] = null;
    }
    const b = synergies(state, before.filter(Boolean));
    const a = synergies(state, after.filter(Boolean));
    const map = new Map(b.map((x) => [x.kind + ':' + x.id, x]));
    return a.map((x) => {
      const old = map.get(x.kind + ':' + x.id);
      return { ...x, delta: x.count - (old ? old.count : 0), gained: !old || x.activeTier > old.activeTier, lost: !!old && x.activeTier < old.activeTier };
    });
  }

  /* ---------- 队伍 ---------- */

  function move(state, unitId, toSlot) {
    if (!Number.isInteger(toSlot) || toSlot < 0 || toSlot > 3) return S().fail(state, 'BAD_SLOT', '槽位必须是 0-3');
    const st = S().clone(state);
    const from = st.team.indexOf(unitId);
    if (from < 0) return S().fail(state, 'NOT_IN_TEAM', '该角色不在队伍中');
    if (from === toSlot) return S().fail(state, 'SAME_SLOT', '已经在目标槽位');

    const occupant = st.team[toSlot];
    st.team[toSlot] = unitId;
    st.team[from] = occupant || null; // 交换；空槽就留空，绝不压缩

    return S().ok(st, [{ type: 'move', actorId: unitId, meta: { from, to: toSlot, swappedWith: occupant || null } }]);
  }

  function setTeamSlot(state, unitId, slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return S().fail(state, 'BAD_SLOT', '槽位必须是 0-3');
    const st = S().clone(state);
    if (!st.roster.some((u) => u.id === unitId)) return S().fail(state, 'NO_UNIT', '找不到该角色');
    const exist = st.team.indexOf(unitId);
    if (exist >= 0) st.team[exist] = null;
    const occupant = st.team[slot];
    st.team[slot] = unitId;
    if (occupant && occupant !== unitId) {
      // 被顶下来的人回到空位，没有空位就下场
      const empty = st.team.indexOf(null);
      if (empty >= 0) st.team[empty] = occupant;
    }
    return S().ok(st, [{ type: 'assign', actorId: unitId, meta: { slot, displaced: occupant || null } }]);
  }

  function removeFromTeam(state, unitId) {
    const st = S().clone(state);
    const idx = st.team.indexOf(unitId);
    if (idx < 0) return S().fail(state, 'NOT_IN_TEAM', '该角色不在队伍中');
    st.team[idx] = null;
    return S().ok(st, [{ type: 'remove', actorId: unitId, meta: { slot: idx } }]);
  }

  /* ---------- 升星 / 遣散 ---------- */

  /** 把角色的三件装备退回仓库，保留锁定状态。 */
  function returnEquipment(st, unit) {
    const moved = [];
    ['weapon', 'armor', 'trinket'].forEach((slot) => {
      const id = unit.equip[slot];
      if (!id) return;
      unit.equip[slot] = null;
      st.stash.push(id);
      moved.push(id);
    });
    return moved;
  }

  function starUp(state, targetId, fodderId) {
    const st = S().clone(state);
    const target = st.roster.find((u) => u.id === targetId);
    const fodder = st.roster.find((u) => u.id === fodderId);

    if (!target) return S().fail(state, 'NO_UNIT', '找不到目标角色');
    if (!fodder) return S().fail(state, 'NO_FODDER', '找不到升星材料');
    if (target.id === fodder.id) return S().fail(state, 'SAME_UNIT', '不能消耗自己');
    if (target.star >= 3) return S().fail(state, 'MAX_STAR', '已经是 3 星');
    if (fodder.cls !== target.cls) return S().fail(state, 'CLS_MISMATCH', '需要同职业材料');
    if (fodder.star !== target.star) return S().fail(state, 'STAR_MISMATCH', '需要同星级材料');

    // 材料身上的装备先完整退仓（含锁定状态），再删角色
    const returned = returnEquipment(st, fodder);
    st.roster = st.roster.filter((u) => u.id !== fodder.id);
    const slot = st.team.indexOf(fodder.id);
    if (slot >= 0) st.team[slot] = null; // 空槽保留，不压缩

    target.star += 1;

    return S().ok(st, [{
      type: 'starUp', actorId: targetId,
      meta: { fodderId, newStar: target.star, returnedItems: returned },
    }]);
  }

  function dismiss(state, unitId) {
    const st = S().clone(state);
    const u = st.roster.find((x) => x.id === unitId);
    if (!u) return S().fail(state, 'NO_UNIT', '找不到该角色');
    const returned = returnEquipment(st, u);
    st.roster = st.roster.filter((x) => x.id !== unitId);
    const slot = st.team.indexOf(unitId);
    if (slot >= 0) st.team[slot] = null;
    return S().ok(st, [{ type: 'dismiss', actorId: unitId, meta: { returnedItems: returned } }]);
  }

  /* ---------- 招募 ---------- */

  const RECRUIT_BASE = { blade: 60, warden: 65, ranger: 70, warlock: 75, cleric: 55, rogue: 80 };

  function recruitCost(unit) {
    const base = RECRUIT_BASE[unit.cls] || 60;
    return Math.round(base * (unit.star === 2 ? 2.4 : 1));
  }

  function makeUnit(st, cls, star) {
    const id = S().takeId(st, 'u');
    const name = A.Data.GIVEN_NAMES[Math.floor(A.Random.next(st.rngState).value * A.Data.GIVEN_NAMES.length)] + '·' + A.Data.CLASSES[cls].name;
    st.rngState = A.Random.next(st.rngState).state;
    return {
      id, cls, star: star || 1, name,
      equip: { weapon: null, armor: null, trinket: null },
      stress: 0, hp: null, affliction: null, virtue: null, note: '',
    };
  }

  function refreshShop(state, force) {
    const st = S().clone(state);
    if (!force && st.shop.length) return S().fail(state, 'NO_NEED', '商店还没空');
    if (force) {
      if (st.gold < 12) return S().fail(state, 'NO_GOLD', '金币不足');
      st.gold -= 12;
      st.shopRefresh += 1;
    }
    const classes = Object.keys(A.Data.CLASSES);
    st.shop = [];
    for (let i = 0; i < 3; i++) {
      let rng = st.rngState;
      const cp = A.Random.pick(rng, classes); rng = cp.state;
      const twoStarChance = 0.12 + 0.05 * (st.upgrades.rec || 0);
      const starRoll = A.Random.chance(rng, twoStarChance); rng = starRoll.state;
      st.rngState = rng;
      const unit = makeUnit(st, cp.value, starRoll.value ? 2 : 1);
      st.shop.push({ offerId: 'o' + i + '_' + A.State.takeId(st, ''), unit, sold: false });
    }
    return S().ok(st, [{ type: 'shopRefresh', meta: { paid: force ? 12 : 0 } }]);
  }

  function recruit(state, offerId) {
    const st = S().clone(state);
    const offer = st.shop.find((o) => o.offerId === offerId);
    if (!offer) return S().fail(state, 'NO_OFFER', '找不到该招募项');
    if (offer.sold) return S().fail(state, 'SOLD', '已经招募过了');
    const cost = recruitCost(offer.unit);
    if (st.gold < cost) return S().fail(state, 'NO_GOLD', '金币不足');
    st.gold -= cost;
    offer.sold = true;
    st.roster.push(offer.unit);
    return S().ok(st, [{ type: 'recruit', actorId: offer.unit.id, amount: cost }]);
  }

  function comfort(state, unitId) {
    const st = S().clone(state);
    const u = st.roster.find((x) => x.id === unitId);
    if (!u) return S().fail(state, 'NO_UNIT', '找不到该角色');
    if (u.stress <= 0) return S().fail(state, 'NO_STRESS', '没有压力需要安抚');
    const cost = Math.ceil(u.stress * 0.8);
    if (st.gold < cost) return S().fail(state, 'NO_GOLD', '金币不足');
    st.gold -= cost;
    u.stress = 0;
    u.affliction = null;
    u.virtue = null;
    return S().ok(st, [{ type: 'comfort', actorId: unitId, amount: cost }]);
  }

  function upgradeCost(state, up) {
    const lv = state.upgrades[up.k] || 0;
    return up.base + up.inc * lv;
  }

  function upgrade(state, key) {
    const st = S().clone(state);
    const up = A.Data.ALTAR_UPGRADES.find((x) => x.k === key);
    if (!up) return S().fail(state, 'NO_UPGRADE', '未知升级项');
    const lv = st.upgrades[key] || 0;
    if (lv >= up.max) return S().fail(state, 'MAXED', '已经升满');
    const cost = up.base + up.inc * lv;
    if (st.shards < cost) return S().fail(state, 'NO_SHARDS', '遗物不足');
    st.shards -= cost;
    st.upgrades[key] = lv + 1;
    if (key === 'bag') st.bagCap = 8 + 2 * st.upgrades.bag;
    return S().ok(st, [{ type: 'upgrade', amount: cost, meta: { key, level: lv + 1 } }]);
  }

  A.Roster = {
    STAR_MULT, calcStats, maxHpOf, synergies, previewTeamChange,
    move, setTeamSlot, removeFromTeam,
    starUp, dismiss, returnEquipment,
    recruitCost, refreshShop, recruit, comfort, upgrade, upgradeCost, makeUnit,
  };
})(globalThis.Ashen ||= {});
