'use strict';
/* 独立存档：ashen_corridor_veteran_v1。只认 ruleset='veteran'，坏档不静默抹掉。
   不改写 ashen_corridor_v1 / v2。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const ST = () => V.State;

  const KEY = ST().SAVE_KEY;
  const SCHEMA = 5;

  function encode(st, now) {
    return JSON.stringify({
      schemaVersion: SCHEMA,
      ruleset: 'veteran',
      savedAt: now || 0,
      state: st,
    });
  }

  /** 深度校验：结构、归属、几何、嵌套检查点、数值范围。 */
  function decode(raw) {
    if (typeof raw !== 'string' || !raw) {
      return { ok: false, errors: ['存档为空'], state: null };
    }
    let env;
    try {
      env = JSON.parse(raw);
    } catch (e) {
      return { ok: false, errors: ['存档不是合法 JSON'], state: null };
    }
    if (!env || typeof env !== 'object') return { ok: false, errors: ['存档结构损坏'], state: null };
    if (env.ruleset !== 'veteran') {
      return { ok: false, errors: [`ruleset 不是 veteran（${env.ruleset}），拒绝载入`], state: null };
    }
    if (![1, 2, 3, 4, SCHEMA].includes(env.schemaVersion)) {
      return { ok: false, errors: [`schemaVersion 不是 ${SCHEMA}（${env.schemaVersion}）`], state: null };
    }
    const st = env.state;
    if (!st || typeof st !== 'object') return { ok: false, errors: ['state 缺失'], state: null };
    if (st.version !== ST().VERSION) {
      return { ok: false, errors: [`state.version 不是 ${ST().VERSION}`], state: null };
    }

    try {
      const run = st.run;
      const battle = run?.battle;
      const P = V.Positions;
      if (env.schemaVersion < 4 && run) {
        const prep = run.encounter?.preparation;
        if (prep) delete prep.formation;
        for (const u of [...run.party, ...(run.encounter?.checkpoint?.run?.party || []), ...(battle?.allies || [])]) {
          if (u.cell !== undefined) {
            if (!Number.isInteger(u.cell) || u.cell < 0 || u.cell > 7) throw new Error('invalid legacy cell');
            u.deployment = { x: 118 - (u.cell % 4) * 29, y: u.cell < 4 ? 0 : -22 };
            delete u.cell;
          }
        }
        if (battle) battle.fieldY ||= P.initialField(battle, P.homeY);
      }
      if (env.schemaVersion < 5) {
        ST().migrateMetalGeometry(st);
        if (run?.encounter?.checkpoint) ST().migrateMetalGeometry(run.encounter.checkpoint);
      }
      const v = ST().validate(st);
      if (!v.ok) return { ok: false, errors: v.errors, state: null };
      if (battle) {
        if (env.schemaVersion === 1) battle.field ||= P.initialField(battle);
        const units = [...battle.allies, ...battle.enemies];
        if (!battle.field || !battle.fieldY || units.some(u => !Number.isFinite(battle.field[u.id])
          || battle.field[u.id] < 0 || battle.field[u.id] > P.ARENA.width
          || !Number.isFinite(battle.fieldY[u.id]) || battle.fieldY[u.id] < P.ARENA.minY || battle.fieldY[u.id] > P.ARENA.maxY)) {
          return { ok: false, errors: ['战场坐标损坏'], state: null };
        }
        if (battle.allies.some(u => u.deployment != null && !P.validDeployment(u.deployment))) {
          return { ok: false, errors: ['战场出战落点损坏'], state: null };
        }
      }
      V.Expedition.migrateChest(st);
    } catch {
      return { ok: false, errors: ['存档中的角色、板面或远征记录损坏'], state: null };
    }
    return { ok: true, errors: [], state: st, savedAt: env.savedAt || 0 };
  }

  function storage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) { /* file:// 下可能被禁用 */ }
    return null;
  }

  function load() {
    const ls = storage();
    if (!ls) return { ok: false, errors: ['没有可用的本地存储'], state: null };
    const raw = ls.getItem(KEY);
    if (!raw) return { ok: false, errors: ['还没有存档'], state: null, empty: true };
    const r = decode(raw);
    if (!r.ok) {
      /* 坏档保留原串，绝不自动覆盖 */
      try { ls.setItem(KEY + '_broken_' + Date.now(), raw); } catch (e) { /* 忽略容量问题 */ }
    }
    return r;
  }

  function save(st, now) {
    const ls = storage();
    const raw = encode(st, now);
    if (!ls) return { ok: false, errors: ['没有可用的本地存储'], raw };
    try {
      ls.setItem(KEY, raw);
      return { ok: true, errors: [], raw };
    } catch (e) {
      return { ok: false, errors: ['写入失败：' + (e && e.message)], raw };
    }
  }

  function exportText(st) { return encode(st, st.savedAt || 0); }

  /** 导入：先完整校验，再替换；失败保留当前状态。 */
  function importText(raw) {
    const r = decode(raw);
    if (!r.ok) return { ok: false, errors: r.errors, state: null };
    return { ok: true, errors: [], state: r.state };
  }

  function clear() {
    const ls = storage();
    if (!ls) return false;
    try { ls.removeItem(KEY); return true; } catch (e) { return false; }
  }

  V.Storage = { KEY, SCHEMA, encode, decode, load, save, exportText, importText, clear };
})(globalThis.Ashen ||= {});
