'use strict';
/* 独立存档：ashen_corridor_veteran_v1。只认 ruleset='veteran'，坏档不静默抹掉。
   不改写 ashen_corridor_v1 / v2。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const ST = () => V.State;

  const KEY = ST().SAVE_KEY;
  const SCHEMA = 1;

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
    if (env.schemaVersion !== SCHEMA) {
      return { ok: false, errors: [`schemaVersion 不是 ${SCHEMA}（${env.schemaVersion}）`], state: null };
    }
    const st = env.state;
    if (!st || typeof st !== 'object') return { ok: false, errors: ['state 缺失'], state: null };
    if (st.version !== ST().VERSION) {
      return { ok: false, errors: [`state.version 不是 ${ST().VERSION}`], state: null };
    }

    const v = ST().validate(st);
    if (!v.ok) return { ok: false, errors: v.errors, state: null };
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
