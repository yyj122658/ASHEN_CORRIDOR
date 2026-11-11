'use strict';
/* 默认状态、ID 生成、深拷贝与一致性校验。
   逻辑层不依赖 DOM / localStorage / 时钟。 */
(function (A) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const MAX_FLOOR = 7;
  const DEFAULT_SEED = 0x2F6E2B1;

  function clone(value) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(value));
  }

  /** 在 state 副本上推进 nextId，返回新 ID。只能在已克隆的 state 上调用。 */
  function takeId(state, prefix) {
    const n = state.nextId;
    state.nextId = n + 1;
    return (prefix || 'x') + n;
  }

  function createUnit(state, cls, star, name) {
    const id = takeId(state, 'u');
    return {
      id, cls, star: star || 1,
      name: name || (A.Data.GIVEN_NAMES[0] + '·' + A.Data.CLASSES[cls].name),
      equip: { weapon: null, armor: null, trinket: null },
      stress: 0,
      hp: null,
      affliction: null,
      virtue: null,
      note: '',
    };
  }

  function create() {
    const state = {
      schemaVersion: SCHEMA_VERSION,
      gold: 160,
      shards: 0,
      bestDepth: 0,
      runs: 0,
      extracts: 0,
      wins: 0,
      bagCap: 8,
      nextId: 1,
      shopRefresh: 0,
      roster: [],
      itemsById: {},
      stash: [],
      team: [null, null, null, null],
      shop: [],
      upgrades: { bag: 0, atk: 0, hp: 0, rec: 0 },
      difficulty: 'normal',
      unlockedDifficulties: ['normal'],
      achievements: [],
      settings: { sound: true, volume: 0.35, reducedMotion: false, speed: 1 },
      rngState: DEFAULT_SEED,
      run: null,
      settlement: null,
      logs: [],
      createdAt: 0,
      savedAt: 0,
    };

    // 固定初始阵容：两名剑士用于展示羁绊与升星
    const a = createUnit(state, 'blade', 1, '铁鸦·剑士');
    const b = createUnit(state, 'blade', 1, '灰烬·剑士');
    const c = createUnit(state, 'warden', 1, '寒霜·盾卫');
    const d = createUnit(state, 'cleric', 1, '晨星·牧师');
    const e = createUnit(state, 'ranger', 1, '暗刃·游侠');
    state.roster.push(a, b, c, d, e);
    state.team = [a.id, b.id, c.id, d.id];

    return state;
  }

  function addLog(state, msg, kind) {
    state.logs.unshift({ msg: String(msg), kind: kind || '' });
    if (state.logs.length > 30) state.logs.length = 30;
  }

  function unitById(state, id) {
    return state.roster.find((u) => u.id === id) || null;
  }

  function itemById(state, id) {
    return state.itemsById[id] || null;
  }

  /** 物品当前归属：'stash' | 'equip:<unitId>:<slot>' | 'bag' | 'pending' | 'shop' | 'none' */
  function itemLocation(state, itemId) {
    if (state.stash.includes(itemId)) return 'stash';
    for (const u of state.roster) {
      for (const slot of ['weapon', 'armor', 'trinket']) {
        if (u.equip && u.equip[slot] === itemId) return 'equip:' + u.id + ':' + slot;
      }
    }
    if (state.run) {
      if (state.run.bag.includes(itemId)) return 'bag';
      if (state.run.pendingLoot.includes(itemId)) return 'pending';
      const ev = state.run.event;
      if (ev && ev.goods) {
        const g = ev.goods.find((x) => x.itemId === itemId);
        if (g && !g.sold) return 'shop';
      }
    }
    return 'none';
  }

  function ownItemIds(state) {
    const ids = new Set();
    state.stash.forEach((id) => ids.add(id));
    state.roster.forEach((u) => {
      if (!u.equip) return;
      ['weapon', 'armor', 'trinket'].forEach((s) => {
        if (u.equip[s]) ids.add(u.equip[s]);
      });
    });
    if (state.run) {
      state.run.bag.forEach((id) => ids.add(id));
      state.run.pendingLoot.forEach((id) => ids.add(id));
      const ev = state.run.event;
      if (ev && ev.goods) ev.goods.forEach((g) => { if (!g.sold) ids.add(g.itemId); });
    }
    return ids;
  }

  function isNonNegInt(v) {
    return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
  }

  function validate(state) {
    const errors = [];

    if (!state || typeof state !== 'object') return { ok: false, errors: ['state 不是对象'] };
    if (state.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion 必须为 ' + SCHEMA_VERSION);

    ['gold', 'shards', 'bestDepth', 'runs', 'extracts', 'wins', 'bagCap', 'nextId', 'shopRefresh'].forEach((k) => {
      if (!isNonNegInt(state[k])) errors.push(k + ' 必须是非负整数');
    });
    if (isNonNegInt(state.bagCap) && (state.bagCap < 4 || state.bagCap > 40)) errors.push('bagCap 超出范围');

    if (!Array.isArray(state.roster)) errors.push('roster 必须是数组');
    if (!Array.isArray(state.stash)) errors.push('stash 必须是数组');
    if (!Array.isArray(state.team) || state.team.length !== 4) errors.push('team 必须是长度 4 的数组');
    if (!state.itemsById || typeof state.itemsById !== 'object') errors.push('itemsById 必须是对象');

    // 角色 ID 唯一
    const unitIds = new Set();
    (state.roster || []).forEach((u) => {
      if (!u || typeof u.id !== 'string') { errors.push('角色缺少 id'); return; }
      if (unitIds.has(u.id)) errors.push('角色 ID 重复：' + u.id);
      unitIds.add(u.id);
      if (!A.Data.CLASSES[u.cls]) errors.push('未知职业：' + u.cls);
      if (![1, 2, 3].includes(u.star)) errors.push('星级非法：' + u.id);
      if (!u.equip) errors.push('角色缺少装备槽：' + u.id);
      ['weapon', 'armor', 'trinket'].forEach((s) => {
        const ref = u.equip && u.equip[s];
        if (ref && !state.itemsById[ref]) errors.push('装备引用不存在：' + ref);
        if (ref && state.itemsById[ref] && state.itemsById[ref].slot !== s) errors.push('装备槽位不符：' + ref);
      });
    });

    // 物品 ID 唯一 + 归属唯一
    const itemIds = Object.keys(state.itemsById || {});
    const seen = new Set();
    itemIds.forEach((id) => {
      if (seen.has(id)) errors.push('物品 ID 重复：' + id);
      seen.add(id);
      const it = state.itemsById[id];
      if (!it || it.id !== id) errors.push('物品 id 字段不符：' + id);
      if (it && !A.Data.SLOT_NAME[it.slot]) errors.push('物品槽位非法：' + id);
      if (it && it.q != null && (it.q < 0 || it.q > 5)) errors.push('物品品质越界：' + id);
    });

    const locCount = {};
    const bump = (id) => { if (!id) return; locCount[id] = (locCount[id] || 0) + 1; };
    (state.stash || []).forEach(bump);
    (state.roster || []).forEach((u) => {
      if (!u.equip) return;
      ['weapon', 'armor', 'trinket'].forEach((s) => bump(u.equip[s]));
    });
    if (state.run) {
      (state.run.bag || []).forEach(bump);
      (state.run.pendingLoot || []).forEach(bump);
      const ev = state.run.event;
      if (ev && ev.goods) ev.goods.forEach((g) => { if (!g.sold) bump(g.itemId); });
    }
    Object.keys(locCount).forEach((id) => {
      if (locCount[id] > 1) errors.push('物品归属重复：' + id + ' ×' + locCount[id]);
      if (!state.itemsById[id]) errors.push('引用了不存在的物品：' + id);
    });

    // 队伍
    if (Array.isArray(state.team)) {
      const inTeam = new Set();
      state.team.forEach((id) => {
        if (id == null) return;
        if (!unitIds.has(id)) errors.push('队伍引用了不存在的角色：' + id);
        if (inTeam.has(id)) errors.push('同一角色占了多个槽位：' + id);
        inTeam.add(id);
      });
    }

    // 远征
    if (state.run) {
      const run = state.run;
      if (!run.party || !Array.isArray(run.party)) errors.push('run.party 必须是数组');
      else {
        run.party.forEach((p) => {
          if (!unitIds.has(p.uid)) errors.push('远征队伍引用了不存在的角色：' + p.uid);
        });
        if (run.party.length > 4) errors.push('远征队伍超过 4 人');
      }
      if (!Array.isArray(run.bag)) errors.push('run.bag 必须是数组');
      if (!Array.isArray(run.pendingLoot)) errors.push('run.pendingLoot 必须是数组');
      if (run.bag && run.bag.length > state.bagCap) errors.push('背包超出容量');
      if (run.floor != null && (run.floor < 1 || run.floor > MAX_FLOOR)) errors.push('楼层越界：' + run.floor);
      if (run.blessings) {
        run.blessings.forEach((b) => { if (!A.Data.BLESSINGS[b]) errors.push('未知祝福：' + b); });
      }
    }

    if (state.difficulty && !A.Data.DIFFICULTIES[state.difficulty]) errors.push('未知难度：' + state.difficulty);
    (state.unlockedDifficulties || []).forEach((d) => {
      if (!A.Data.DIFFICULTIES[d]) errors.push('未知解锁难度：' + d);
    });

    return { ok: errors.length === 0, errors };
  }

  A.State = {
    SCHEMA_VERSION, MAX_FLOOR, DEFAULT_SEED,
    clone, create, takeId, addLog, validate,
    unitById, itemById, itemLocation, ownItemIds,
    ok, fail,
  };

  /** 成功：返回新状态与事件。 */
  function ok(state, events, extra) {
    return Object.assign({ ok: true, state, events: events || [] }, extra || {});
  }

  /** 失败：返回原状态与空事件，绝不产生副作用。 */
  function fail(state, code, message) {
    return { ok: false, state, events: [], error: { code, message } };
  }
})(globalThis.Ashen ||= {});
