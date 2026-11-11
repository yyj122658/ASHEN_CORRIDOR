'use strict';
/* 装备生成、装备/卸下、锁定、筛选、出售与换装对比。
   物品以 ID 存放在 itemsById registry，任何时刻只有唯一归属。 */
(function (A) {
  'use strict';

  const S = () => A.State;

  function rollQuality(state, bias) {
    const w = [34, 30, 18 + bias * 3, 10 + bias * 4, 5 + bias * 3, 1 + bias * 1.6];
    const idx = [0, 1, 2, 3, 4, 5];
    const r = A.Random.weighted(state.rngState, idx, w);
    return { q: r.value, state: r.state };
  }

  function trinketVal(k, qm, ilvl) {
    switch (k) {
      case 'spd': return Math.max(1, Math.round((1 + ilvl * 0.18) * qm));
      case 'crit': return +(0.025 * qm).toFixed(3);
      case 'eva': return +(0.022 * qm).toFixed(3);
      case 'acc': return +(0.02 * qm).toFixed(3);
      case 'atkPct': return +(0.05 * qm).toFixed(3);
      case 'hp': return Math.round(ilvl * 5 * qm) + 8;
      case 'def': return Math.round(ilvl * 0.9 * qm) + 1;
      case 'atk': return Math.round(ilvl * 1.4 * qm) + 1;
      default: return 0;
    }
  }

  function pickRng(rngState, arr) {
    const r = A.Random.pick(rngState, arr);
    return { value: r.value, state: r.state };
  }

  /**
   * 生成一件候选物品。不写入 itemsById —— 必须由调用方在事务中决定归属。
   * 远征中消费 run.rngState，营地消费 state.rngState，保证两者互不干扰。
   */
  function makeItem(state, opts) {
    opts = opts || {};
    const st = S().clone(state);
    const inRun = !!(st.run && opts.inRun !== false);
    let rng = inRun ? st.run.rngState : st.rngState;

    const ilvl = Math.max(1, Math.round(opts.ilvl || 1));
    const bias = opts.bias || 0;

    let slot = opts.slot;
    if (!slot) { const r = pickRng(rng, ['weapon', 'armor', 'trinket']); slot = r.value; rng = r.state; }

    const qr = rollQuality({ rngState: rng }, bias);
    rng = qr.state;
    const q = qr.q;
    const qm = A.Data.QUALITY[q].mult;

    const it = {
      id: S().takeId(st, 'i'),
      slot, q, ilvl,
      base: '',
      prefix: '',
      stats: {},
      locked: false,
      traitId: null,
    };

    const rand = () => { const r = A.Random.range(rng, 0.9, 1.15); rng = r.state; return r.value; };

    if (slot === 'weapon') {
      it.stats.atk = Math.round(ilvl * 1.75 * qm * rand()) + 2;
    } else if (slot === 'armor') {
      it.stats.hp = Math.round(ilvl * 8 * qm * rand()) + 10;
      it.stats.def = Math.round(ilvl * 0.8 * qm) + 1;
    } else {
      const pool = ['spd', 'crit', 'eva', 'acc', 'atkPct'];
      const a = pickRng(rng, pool); rng = a.state;
      const b = pickRng(rng, pool.filter((x) => x !== a.value)); rng = b.state;
      it.stats[a.value] = trinketVal(a.value, qm, ilvl);
      if (q >= 2) it.stats[b.value] = trinketVal(b.value, qm, ilvl);
    }

    // 词缀
    const affixCount = q >= 4 ? 2 : q >= 2 ? 1 : 0;
    const used = Object.keys(it.stats);
    for (let i = 0; i < affixCount; i++) {
      const cand = ['hp', 'def', 'crit', 'eva', 'spd', 'atkPct', 'acc'].filter((k) => !used.includes(k));
      if (!cand.length) break;
      const kp = pickRng(rng, cand); rng = kp.state;
      const k = kp.value;
      used.push(k);
      it.stats[k] = (it.stats[k] || 0) + trinketVal(k, qm, ilvl);
      const pf = pickRng(rng, A.Data.PREFIX[k] || A.Data.PREFIX.atk); rng = pf.state;
      it.prefix = pf.value;
    }

    // 特色词条：精良及以上 25%
    if (q >= 2) {
      const ch = A.Random.chance(rng, 0.25);
      rng = ch.state;
      if (ch.value) {
        const tp = pickRng(rng, A.Data.TRAIT_IDS); rng = tp.state;
        it.traitId = tp.value;
      }
    }

    const basePick = A.Random.pick(rng, A.Data.ITEM_BASE[slot]);
    rng = basePick.state;
    it.base = basePick.value;

    if (inRun) st.run.rngState = rng >>> 0;
    else st.rngState = rng >>> 0;

    return { state: st, item: it };
  }

  /** 把候选物品注册进 registry 并放到背包或仓库。 */
  function register(state, item, where) {
    const st = S().clone(state);
    st.itemsById[item.id] = item;
    if (where === 'stash') st.stash.push(item.id);
    else if (where === 'bag') {
      if (!st.run) return { ok: false, state, error: { code: 'NO_RUN', message: '不在远征中' } };
      st.run.bag.push(item.id);
    }
    return { ok: true, state: st, item };
  }

  function itemDisplayName(it) {
    if (!it) return '';
    return (it.prefix ? it.prefix + '·' : '') + it.base;
  }

  function statLabel(k) {
    return {
      hp: '生命', def: '防御', atk: '攻击', spd: '速度',
      crit: '暴击', eva: '闪避', acc: '命中', atkPct: '攻击%',
    }[k] || k;
  }

  function statText(k, v) {
    if (k === 'crit' || k === 'eva' || k === 'acc' || k === 'atkPct') {
      return '+' + (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
    }
    return '+' + v;
  }

  function itemPower(it) {
    let p = 0;
    for (const k in it.stats) {
      const v = it.stats[k];
      p += (k === 'hp' ? v / 6 : k === 'def' ? v * 1.5 : k === 'atk' ? v * 3 : k === 'spd' ? v * 4 : v * 120);
    }
    return Math.round(p);
  }

  function sellValue(it) {
    return Math.round((it.ilvl * 4 + 8) * (it.q + 1) * 0.7);
  }

  /* ---------- 操作 ---------- */

  function equip(state, unitId, itemId) {
    const st = S().clone(state);
    const u = st.roster.find((x) => x.id === unitId);
    if (!u) return S().fail(state, 'NO_UNIT', '找不到该角色');
    const it = st.itemsById[itemId];
    if (!it) return S().fail(state, 'NO_ITEM', '找不到该装备');
    const idx = st.stash.indexOf(itemId);
    if (idx < 0) return S().fail(state, 'NOT_IN_STASH', '该装备不在仓库');
    if (u.equip[it.slot] === itemId) return S().fail(state, 'ALREADY', '已经装备了这件物品');

    st.stash.splice(idx, 1);
    const old = u.equip[it.slot];
    u.equip[it.slot] = itemId;
    if (old) st.stash.push(old);

    return S().ok(st, [{ type: 'equip', actorId: unitId, meta: { itemId, replaced: old || null } }]);
  }

  function unequip(state, unitId, slot) {
    const st = S().clone(state);
    const u = st.roster.find((x) => x.id === unitId);
    if (!u) return S().fail(state, 'NO_UNIT', '找不到该角色');
    const id = u.equip[slot];
    if (!id) return S().fail(state, 'EMPTY', '该槽位是空的');
    u.equip[slot] = null;
    st.stash.push(id);
    return S().ok(st, [{ type: 'unequip', actorId: unitId, meta: { itemId: id, slot } }]);
  }

  function toggleLock(state, itemId) {
    const st = S().clone(state);
    const it = st.itemsById[itemId];
    if (!it) return S().fail(state, 'NO_ITEM', '找不到该装备');
    it.locked = !it.locked;
    return S().ok(st, [{ type: 'lock', meta: { itemId, locked: it.locked } }]);
  }

  /** 整笔事务：只要有一件不存在/不在仓库/已锁定，就全部拒绝。 */
  function sell(state, itemIds) {
    if (!Array.isArray(itemIds) || !itemIds.length) return S().fail(state, 'EMPTY', '没有选择任何装备');
    const st = S().clone(state);
    const uniq = [...new Set(itemIds)];

    let total = 0;
    for (const id of uniq) {
      const it = st.itemsById[id];
      if (!it) return S().fail(state, 'NO_ITEM', '找不到装备：' + id);
      if (!st.stash.includes(id)) return S().fail(state, 'NOT_IN_STASH', '装备不在仓库：' + id);
      if (it.locked) return S().fail(state, 'LOCKED', itemDisplayName(it) + ' 已锁定，无法出售');
      total += sellValue(it);
    }

    uniq.forEach((id) => {
      st.stash = st.stash.filter((x) => x !== id);
      delete st.itemsById[id];
    });
    st.gold += total;

    return S().ok(st, [{ type: 'sell', amount: total, meta: { itemIds: uniq } }]);
  }

  function filter(state, opts) {
    opts = opts || {};
    let ids = state.stash.slice();
    let items = ids.map((id) => state.itemsById[id]).filter(Boolean);

    if (opts.slot && opts.slot !== 'all') items = items.filter((i) => i.slot === opts.slot);
    if (typeof opts.minQuality === 'number' && opts.minQuality > 0) items = items.filter((i) => i.q >= opts.minQuality);
    if (opts.locked === 'locked') items = items.filter((i) => i.locked);
    else if (opts.locked === 'unlocked') items = items.filter((i) => !i.locked);

    const sort = opts.sort || 'quality';
    if (sort === 'quality') items.sort((a, b) => b.q - a.q || itemPower(b) - itemPower(a));
    else if (sort === 'power') items.sort((a, b) => itemPower(b) - itemPower(a));
    else if (sort === 'newest') items.sort((a, b) => Number(String(b.id).replace(/\D/g, '')) - Number(String(a.id).replace(/\D/g, '')));

    return items;
  }

  /** 换装后的完整属性对比（不是只比 itemPower）。 */
  function compare(state, unitId, itemId) {
    const u = state.roster.find((x) => x.id === unitId);
    const it = state.itemsById[itemId];
    if (!u || !it) return null;

    const partyIds = state.team.filter(Boolean);
    const before = A.Roster.calcStats(state, unitId, partyIds);

    const trial = S().clone(state);
    const tu = trial.roster.find((x) => x.id === unitId);
    const old = tu.equip[it.slot];
    tu.equip[it.slot] = itemId;
    const after = A.Roster.calcStats(trial, unitId, partyIds);

    const keys = ['maxHp', 'atk', 'def', 'spd', 'crit', 'eva', 'acc', 'dmgReduce', 'healMult'];
    const delta = {};
    keys.forEach((k) => { delta[k] = +(after[k] - before[k]).toFixed(4); });

    const beforeTraits = traitIdsOfUnit(state, unitId);
    const afterTraits = beforeTraits.filter((t) => t !== (old ? state.itemsById[old] && state.itemsById[old].traitId : null));
    if (it.traitId) afterTraits.push(it.traitId);

    return { before, after, delta, replacedId: old || null, traitChanges: { before: beforeTraits, after: [...new Set(afterTraits.filter(Boolean))] } };
  }

  function traitIdsOfUnit(state, unitId) {
    const u = state.roster.find((x) => x.id === unitId);
    if (!u) return [];
    const out = [];
    ['weapon', 'armor', 'trinket'].forEach((s) => {
      const it = u.equip[s] ? state.itemsById[u.equip[s]] : null;
      if (it && it.traitId) out.push(it.traitId);
    });
    return [...new Set(out)];
  }

  A.Equipment = {
    makeItem, register, equip, unequip, toggleLock, sell, filter, compare,
    itemDisplayName, statLabel, statText, itemPower, sellValue, traitIdsOfUnit, trinketVal,
  };
})(globalThis.Ashen ||= {});
