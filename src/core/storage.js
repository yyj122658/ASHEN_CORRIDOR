'use strict';
/* 存档：v2 结构、v1 迁移、编解码、导入导出、坏档保护。
   纯函数部分（encode/decode/migrateV1）不接触 storage，便于测试。 */
(function (A) {
  'use strict';

  const S = () => A.State;

  const KEY_V2 = 'ashen_corridor_v2';
  const KEY_V1 = 'ashen_corridor_v1';
  const KEY_BACKUP = 'ashen_corridor_backup';

  /* ---------- 编码 ---------- */

  function encode(state) {
    const payload = {
      schemaVersion: 2,
      savedAt: Date.now ? Date.now() : 0,
      state: state,
    };
    return JSON.stringify(payload);
  }

  function decode(text) {
    const errors = [];
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return { ok: false, errors: ['存档不是合法的 JSON'] };
    }
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['存档结构不正确'] };

    const st = raw.state || raw;
    if (st.schemaVersion !== 2) {
      errors.push('schemaVersion 不是 2（实际 ' + st.schemaVersion + '）');
      return { ok: false, errors };
    }

    // 数值健壮性：拒绝 NaN / Infinity / 负数
    const numericFields = ['gold', 'shards', 'bestDepth', 'runs', 'extracts', 'wins', 'bagCap', 'nextId', 'shopRefresh'];
    for (const k of numericFields) {
      const v = st[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) errors.push(k + ' 数值非法');
    }
    if (errors.length) return { ok: false, errors };

    const v = S().validate(st);
    if (!v.ok) return { ok: false, errors: v.errors };

    return { ok: true, state: st, errors: [] };
  }

  /* ---------- v1 迁移 ---------- */

  function convertItemV1(item, usedIds, idCounter) {
    if (!item || typeof item !== 'object') return null;
    let id = typeof item.id === 'string' && item.id ? item.id : null;
    if (!id || usedIds.has(id)) {
      id = 'm' + (idCounter.n++);
    }
    usedIds.add(id);

    const slot = item.slot === 'weapon' || item.slot === 'armor' || item.slot === 'trinket' ? item.slot : 'weapon';
    const q = Number.isInteger(item.q) && item.q >= 0 && item.q <= 5 ? item.q : 1;

    return {
      id,
      slot,
      q,
      ilvl: Number.isFinite(item.ilvl) && item.ilvl > 0 ? Math.round(item.ilvl) : 1,
      base: typeof item.base === 'string' ? item.base : (A.Data.ITEM_BASE[slot][0] || '旧物'),
      prefix: typeof item.prefix === 'string' ? item.prefix : '',
      stats: (item.stats && typeof item.stats === 'object') ? item.stats : {},
      locked: !!item.locked,
      traitId: item.traitId && A.Data.TRAITS[item.traitId] ? item.traitId : null,
    };
  }

  /** v1 → v2。v1 字符串不改写，只读取。 */
  function migrateV1(raw) {
    let old;
    try {
      old = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return { ok: false, errors: ['v1 存档解析失败'] };
    }
    if (!old || typeof old !== 'object') return { ok: false, errors: ['v1 存档结构不正确'] };
    if (old.schemaVersion === 2) return { ok: false, errors: ['这已经是 v2 存档'] };

    const st = S().create();
    st.roster = [];
    st.itemsById = {};
    st.stash = [];
    st.team = [null, null, null, null];
    st.shop = [];

    const usedIds = new Set();
    const idCounter = { n: 1 };

    // 货币与战绩
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : d);
    st.gold = num(old.gold, 160);
    st.shards = num(old.shards, 0);
    st.bestDepth = Math.min(7, num(old.bestDepth, 0));
    st.runs = num(old.runs, 0);
    st.extracts = num(old.extracts, 0);
    st.wins = num(old.wins, 0);
    st.bagCap = Math.max(4, Math.min(40, num(old.bagCap, 8)));
    st.shopRefresh = num(old.shopRefresh, 0);

    // 升级：只补缺失子字段，不覆盖已有等级
    st.upgrades = { bag: 0, atk: 0, hp: 0, rec: 0 };
    if (old.upgrades && typeof old.upgrades === 'object') {
      ['bag', 'atk', 'hp', 'rec'].forEach((k) => {
        if (Number.isInteger(old.upgrades[k]) && old.upgrades[k] >= 0) st.upgrades[k] = old.upgrades[k];
      });
    }
    if (st.upgrades.bag) st.bagCap = 8 + 2 * st.upgrades.bag;

    // 角色
    const roster = Array.isArray(old.roster) ? old.roster : [];
    roster.forEach((ou) => {
      if (!ou || !A.Data.CLASSES[ou.cls]) return;
      let id = typeof ou.id === 'string' && ou.id ? ou.id : S().takeId(st, 'u');
      if (usedIds.has(id)) id = S().takeId(st, 'u');
      usedIds.add(id);

      const u = {
        id,
        cls: ou.cls,
        star: [1, 2, 3].includes(ou.star) ? ou.star : 1,
        name: typeof ou.name === 'string' ? ou.name.slice(0, 24) : ('旧识·' + A.Data.CLASSES[ou.cls].name),
        equip: { weapon: null, armor: null, trinket: null },
        stress: Math.max(0, Math.min(100, num(ou.stress, 0))),
        hp: null,
        affliction: ou.affliction && A.Data.AFFLICTIONS.some((a) => a.k === ou.affliction) ? ou.affliction : null,
        virtue: ou.virtue && A.Data.VIRTUES.some((v) => v.k === ou.virtue) ? ou.virtue : null,
        note: '',
      };

      if (ou.equip && typeof ou.equip === 'object') {
        ['weapon', 'armor', 'trinket'].forEach((slot) => {
          const raw = ou.equip[slot];
          if (!raw) return;
          const conv = convertItemV1(Object.assign({}, raw, { slot }), usedIds, idCounter);
          if (!conv) return;
          st.itemsById[conv.id] = conv;
          u.equip[slot] = conv.id;
        });
      }
      st.roster.push(u);
    });

    // 仓库
    const stash = Array.isArray(old.stash) ? old.stash : [];
    stash.forEach((it) => {
      const conv = convertItemV1(it, usedIds, idCounter);
      if (!conv) return;
      st.itemsById[conv.id] = conv;
      st.stash.push(conv.id);
    });

    // 队伍：补齐为 4 槽
    const oldTeam = Array.isArray(old.team) ? old.team : [];
    const rosterIds = new Set(st.roster.map((u) => u.id));
    const usedTeam = new Set();
    for (let i = 0; i < 4; i++) {
      const id = oldTeam[i];
      if (id && rosterIds.has(id) && !usedTeam.has(id)) {
        st.team[i] = id;
        usedTeam.add(id);
      } else {
        st.team[i] = null;
      }
    }
    // 老版本队伍可能是变长数组，把没进队的人按顺序补进空槽
    oldTeam.slice(4).forEach((id) => {
      if (!id || !rosterIds.has(id) || usedTeam.has(id)) return;
      const empty = st.team.indexOf(null);
      if (empty >= 0) { st.team[empty] = id; usedTeam.add(id); }
    });

    // 商店（招募候选，不占 roster）
    const shop = Array.isArray(old.shop) ? old.shop : [];
    shop.forEach((offer, i) => {
      const ou = offer && offer.unit ? offer.unit : null;
      if (!ou || !A.Data.CLASSES[ou.cls]) return;
      st.shop.push({
        offerId: 'v1_' + i,
        unit: {
          id: S().takeId(st, 'u'),
          cls: ou.cls,
          star: [1, 2, 3].includes(ou.star) ? ou.star : 1,
          name: typeof ou.name === 'string' ? ou.name.slice(0, 24) : ('旧识·' + A.Data.CLASSES[ou.cls].name),
          equip: { weapon: null, armor: null, trinket: null },
          stress: 0, hp: null, affliction: null, virtue: null, note: '',
        },
        sold: !!(offer && offer.sold),
      });
    });

    // 新增字段
    st.difficulty = 'normal';
    st.unlockedDifficulties = ['normal'];
    st.achievements = [];
    st.settings = { sound: true, volume: 0.35, reducedMotion: false, speed: 1 };
    st.rngState = A.Random.seedFrom('v1-migrate-' + st.roster.length + '-' + st.gold);
    st.run = null;
    st.settlement = null;
    st.logs = [{ msg: '旧存档已迁移。', kind: 'gold' }];
    st.createdAt = Date.now ? Date.now() : 0;

    const v = S().validate(st);
    if (!v.ok) return { ok: false, errors: v.errors };
    return { ok: true, state: st, errors: [] };
  }

  /* ---------- storage 操作 ---------- */

  function safeGet(storage, key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  }

  function safeSet(storage, key, value) {
    try { storage.setItem(key, value); return { ok: true }; } catch (e) {
      return { ok: false, error: '本地存储写入失败（可能是空间已满）' };
    }
  }

  function load(storage) {
    const v2 = safeGet(storage, KEY_V2);
    if (v2) {
      const dec = decode(v2);
      if (dec.ok) return { status: 'loaded', state: dec.state, errors: [] };
      // v2 坏了：不静默抹档，尝试 v1
      const v1raw = safeGet(storage, KEY_V1);
      if (v1raw) {
        const mig = migrateV1(v1raw);
        if (mig.ok) return { status: 'migrated', state: mig.state, errors: ['v2 存档损坏，已从 v1 恢复'].concat(dec.errors) };
      }
      return { status: 'corrupt', errors: dec.errors };
    }

    const v1 = safeGet(storage, KEY_V1);
    if (v1) {
      const mig = migrateV1(v1);
      if (mig.ok) return { status: 'migrated', state: mig.state, errors: [] };
      return { status: 'corrupt', errors: mig.errors };
    }

    return { status: 'new', errors: [] };
  }

  function save(storage, state) {
    const v = S().validate(state);
    if (!v.ok) return { ok: false, error: '状态校验失败：' + v.errors.slice(0, 3).join('；') };
    const text = encode(state);
    const r = safeSet(storage, KEY_V2, text);
    if (!r.ok) return r;
    return { ok: true };
  }

  function exportText(state) {
    return encode(state);
  }

  function importSave(storage, text) {
    const dec = decode(text);
    if (!dec.ok) return { ok: false, errors: dec.errors, state: null };

    // 替换前备份当前有效存档
    const current = safeGet(storage, KEY_V2);
    if (current) {
      const cur = decode(current);
      if (cur.ok) safeSet(storage, KEY_BACKUP, current);
    }

    const w = save(storage, dec.state);
    if (!w.ok) return { ok: false, errors: [w.error], state: null };
    return { ok: true, state: dec.state, errors: [] };
  }

  function clearAll(storage) {
    try {
      storage.removeItem(KEY_V2);
      storage.removeItem(KEY_V1);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '清除失败' };
    }
  }

  A.Storage = {
    KEY_V2, KEY_V1, KEY_BACKUP,
    encode, decode, migrateV1, load, save, exportText, importSave, clearAll, convertItemV1,
  };
})(globalThis.Ashen ||= {});
