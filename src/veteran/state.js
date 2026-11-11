'use strict';
/* 老兵回路版状态：纯数据、事务结果、归属与一致性校验。
   不读 DOM / 时钟 / Math.random；所有命令都在克隆上操作并返回新状态。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;

  const VERSION = 1;
  const RULESET = 'veteran';
  const SAVE_KEY = 'ashen_corridor_veteran_v1';
  const DEFAULT_SEED = 20261111;
  const MAX_FLOOR = 7;

  /** 有些地方只需要一个无关紧要的种子；避免碰 Math.random。 */
  function clone(value) { return A.State.clone(value); }

  function ok(state, events, extra) {
    return Object.assign({ ok: true, state, events: events || [] }, extra || {});
  }

  function fail(state, code, message, extra) {
    return Object.assign({
      ok: false,
      state,
      events: [],
      error: { code, message },
    }, extra || {});
  }

  function takeId(st, prefix) {
    const n = st.nextId;
    st.nextId = n + 1;
    return (prefix || 'x') + n;
  }

  function addLog(st, entry) {
    st.logs.push(Object.assign({ at: st.logs.length }, entry));
    if (st.logs.length > 120) st.logs.shift();
  }

  /* ------------------------------ 构件 ------------------------------ */

  /** 新建一个构件实例（不写 registry，调用方负责注册）。 */
  function makePart(st, spec) {
    const kind = spec.kind || 'circuit';
    const item = {
      id: takeId(st, kind === 'weapon' ? 'w' : 'p'),
      kind,
      templateId: kind === 'weapon' ? (spec.weaponId || 'shortBlade') : (spec.templateId || 'straight'),
      modId: spec.modId || null,
      acquiredRunId: spec.acquiredRunId || null,
      acquiredSeq: spec.acquiredSeq || 0,
      attunements: {},
    };
    return item;
  }

  /** 构件占格数（主手固定 4 格；回路按模板 cells）。 */
  function partCells(item) {
    if (!item) return 0;
    if (item.kind === 'weapon') return D().DESIGN.weaponCells;
    const tpl = D().template(item.templateId);
    return tpl.cells.length;
  }

  /** 构件负荷（主手不计负荷；回路按模板 load）。 */
  function partLoad(item) {
    if (!item) return 0;
    if (item.kind === 'weapon') return 0;
    return D().template(item.templateId).load;
  }

  function itemById(st, id) { return st.itemsById[id] || null; }
  function unitById(st, id) { return st.roster.find((u) => u.id === id) || null; }

  /* ------------------------------ 归属 ------------------------------ */

  /**
   * 每个真实物品恰好一处所有权：stash / weapon / board / bag / pending / merchant / provisional。
   * snapshot、startLoadouts、fieldLayouts、历史引用不算第二份。
   */
  function itemLocations(st) {
    const map = {}; // itemId -> [{where, detail}]
    const push = (id, where, detail) => {
      if (!id) return;
      (map[id] ||= []).push({ where, detail: detail || null });
    };

    st.stash.forEach((id) => push(id, 'stash'));
    st.roster.forEach((u) => {
      /* 武器槽已移除 */
      (u.board && u.board.placements || []).forEach((p) => push(p.itemId, 'board', u.id));
    });
    (st.shop || []).forEach((o) => push(o.itemId, 'merchant', o.id));

    const run = st.run;
    if (run) {
      (run.bag || []).forEach((id) => push(id, 'bag'));
      (run.pendingLoot || []).forEach((id) => push(id, 'pending'));
      (run.provisionalBindings || []).forEach((b) => push(b.itemId, 'provisional', b.unitId));
    }
    return map;
  }

  function itemLocation(st, id) {
    const all = itemLocations(st)[id];
    return all && all.length ? all[0] : null;
  }

  function ownItemIds(st) { return Object.keys(itemLocations(st)); }

  /* ------------------------------ 默认档 ------------------------------ */

  /**
   * 装上一套功法：放在板面上第一个能容纳它的位置。
   * 功法是占格的「管道」，摆不下就先空着（玩家自己找位置）。
   */
  function equipManuscript(st, unit, msId) {
    const spec = D().manuscript(msId);
    if (!spec || !A.Veteran.Manuscript) return unit;
    const base = A.Veteran.Manuscript.normalize(spec);
    if (!base) return unit;
    const plate = A.Veteran.Circuit.plateOf(unit);
    /* 已放构件占住的格不能让出来给功法 */
    const occupied = new Set();
    (unit.board.placements || []).forEach((pl) => {
      const item = st.itemsById[pl.itemId];
      if (!item) return;
      const tpl = D().template(item.templateId);
      const tf = A.Veteran.Circuit.transformTemplate(tpl, pl.rotation || 0, !!pl.mirrorY);
      tf.cells.forEach((c) => occupied.add((c.x + pl.x) + ',' + (c.y + pl.y)));
    });
    for (let r = 0; r < 4; r++) {
      const oriented = A.Veteran.Manuscript.orient(base, r, false);
      const spots = A.Veteran.Manuscript.placements(oriented, plate.cellsList)
        .filter(([ox, oy]) => oriented.cells.every((c) => !occupied.has((c[0] + ox) + ',' + (c[1] + oy))));
      if (spots.length) {
        unit.manuscript = Object.assign({}, spec, {
          x: spots[0][0], y: spots[0][1], rotation: r, mirrorY: false,
        });
        return unit;
      }
    }
    return unit;
  }

  /** FNV-1a：把字符串稳定映射成 uint32，用来派生板面 seed。 */
  function hashSeed(text) {
    let h = 0x811C9DC5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function classicPlateOf(body) {
    const blocked = new Set((body.blocked || []).map((b) => b[0] + ',' + b[1]));
    const cells = [];
    for (let y = 0; y < D().DESIGN.gridSize; y++) {
      for (let x = 0; x < D().DESIGN.gridSize; x++) {
        if (!blocked.has(x + ',' + y)) cells.push([x, y]);
      }
    }
    return { cells, terminals: D().TERMINALS };
  }

  function makeUnit(st, spec) {
    const body = D().body(spec.bodyPreset);
    const unitId = takeId(st, 'u');
    const unit = {
      id: unitId,
      name: spec.name,
      skinId: spec.skinId,
      bodyPreset: body.id,
      /* 板面 seed 由 id 稳定派生，不消耗玩法随机序列：
         否则改一次板面规则就会打乱整局的随机，存档也对不上 */
      plateSeed: spec.plateSeed != null ? (spec.plateSeed >>> 0) : hashSeed('plate:' + unitId),
      stress: 0,
      affliction: null,
      board: { placements: [] },
      manuscript: null,
      gambits: D().defaultGambits(),
      logicSlots: D().DESIGN.logicSlots,
      history: { eligibleRunIds: [], records: [] },
    };
    /* 经典板面必须早于 equipPreset 生效，否则预设会按随机板面平移 */
    if (st.plateMode === 'classic') unit.plateOverride = classicPlateOf(body);
    return unit;
  }

  /** 给单位装配预设线路，构件写入 registry 并挂到 board。 */
  /**
   * 装上预设线路。
   * 预设的坐标是「相对形状」，异形板面上不一定落在金属里，所以要找一个平移量
   * 让整条线都铺得下；平移量按 |dx|+|dy| 从小到大试，(0,0) 优先，老板面结果不变。
   */
  function equipPreset(st, unit, presetId) {
    const preset = D().PRESETS[presetId] || D().PRESETS.basic;
    /* 板面只认 Circuit.plateOf，别处不要重复推导 */
    const plateCells = A.Veteran.Circuit.plateOf(unit).cells;
    /* 功法先铺好，构件给它让位 */
    if (unit.manuscript && A.Veteran.Manuscript) {
      const or = A.Veteran.Manuscript.orient(
        A.Veteran.Manuscript.normalize(unit.manuscript),
        unit.manuscript.rotation || 0, !!unit.manuscript.mirrorY,
      );
      const ox = unit.manuscript.x || 0;
      const oy = unit.manuscript.y || 0;
      or.cells.forEach((c) => plateCells.delete((c[0] + ox) + ',' + (c[1] + oy)));
    }

    const fits = (dx, dy) => preset.layout.every((slot) => {
      const tpl = D().template(slot.templateId);
      const tf = A.Veteran.Circuit.transformTemplate(tpl, slot.rotation || 0, !!slot.mirrorY);
      return tf.cells.every((c) => plateCells.has((c.x + slot.x + dx) + ',' + (c.y + slot.y + dy)));
    });

    let off = null;
    const span = 8;
    for (let d = 0; d <= span && !off; d++) {
      for (let dy = -d; dy <= d && !off; dy++) {
        for (let dx = -d; dx <= d && !off; dx++) {
          if (Math.abs(dx) + Math.abs(dy) !== d) continue;
          if (fits(dx, dy)) off = [dx, dy];
        }
      }
    }
    if (!off) return unit; /* 板面太窄，先给空板面，玩家在工坊里自己铺 */

    preset.layout.forEach((slot) => {
      const part = makePart(st, { kind: 'circuit', templateId: slot.templateId });
      st.itemsById[part.id] = part;
      unit.board.placements.push({
        itemId: part.id, x: slot.x + off[0], y: slot.y + off[1],
        rotation: slot.rotation || 0, mirrorY: !!slot.mirrorY,
      });
    });
    return unit;
  }

  function create(seed, opts) {
    const st = {
      version: VERSION,
      ruleset: RULESET,
      nextId: 1,
      rngState: (seed === undefined || seed === null) ? DEFAULT_SEED : (seed >>> 0),
      /* classic = 固定 4x4（老存档与单测）；plate = 按 seed 生成的异形金属 */
      plateMode: (opts && opts.classicPlate) ? 'classic' : 'plate',
      gold: 180,
      shards: 0,
      bestDepth: 0,
      roster: [],
      /* 功法藏品：掉到的功法先进这里，工坊里再装到具体单位身上 */
      manuscriptVault: [],
      team: [null, null, null, null],
      itemsById: {},
      stash: [],
      shop: [],
      settings: { sound: true, speed: 1, reducedMotion: false },
      difficulty: 'normal',
      unlockedDifficulties: ['normal'],
      logs: [],
      settlement: null,
      stats: { runs: 0, extracts: 0, wins: 0, retries: 0 },
      run: null,
      savedAt: 0,
    };

    /* 四位老兵：短刃 / 塔盾 / 长矛 / 仪式杖 */
    const setup = [
      /* 顺序即初始站位：短刃必须 1 号位，长矛 2 号位可贯穿，塔盾与杖在后 */
      { skinId: 'blade', bodyPreset: 'sturdy', name: '铁鸦' },
      { skinId: 'ranger', bodyPreset: 'agile', name: '灰烬' },
      { skinId: 'warden', bodyPreset: 'sturdy', name: '磐石' },
      { skinId: 'cleric', bodyPreset: 'conduit', name: '烛火' },
    ];

    setup.forEach((spec) => {
      const unit = makeUnit(st, spec);
      /* 开局就带一门微功法（经典模式除外，老存档沿用旧负荷） */
      if (st.plateMode === 'plate') equipManuscript(st, unit, 'spark');
      /* 开局不装功法：功法是副本掉落物，第一层必掉（见 expedition 掉落表）。
         没有功法的单位只能基础攻击，这是「还没入门」的状态。 */
      equipPreset(st, unit, 'basic');
      st.roster.push(unit);
    });

    st.team = st.roster.map((u) => u.id);

    /* 仓库：一件重炮 + 一套可换的蓄能片（capacitor + straight） */
    ['capacitor', 'straight'].forEach((tpl) => {
      const part = makePart(st, { kind: 'circuit', templateId: tpl });
      st.itemsById[part.id] = part;
      st.stash.push(part.id);
    });

    /* 开局身上没有功法，但仓库给一套入门的：玩家在工坊里自己装。
       后续更稀有的功法走副本掉落与祭坛兑换。 */
    if (st.manuscriptVault.length === 0) {
      const starter = D().manuscript('corridor5');
      if (starter) st.manuscriptVault.push(JSON.parse(JSON.stringify(starter)));
    }

    addLog(st, { kind: 'sys', text: '灰烬前哨。四位老兵在等下一次下潜。' });

    return st;
  }

  /* ------------------------------ 校验 ------------------------------ */

  function isInt(v) { return typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v; }

  /**
   * 返回 {ok, errors}。errors 是具体位置的中文原因，供 UI 直接显示。
   * 几何深校验委托 V.Circuit（加载顺序允许时）；缺失时退化为结构校验。
   */
  function validate(st) {
    const errors = [];
    const err = (m) => errors.push(m);

    if (!st || typeof st !== 'object') return { ok: false, errors: ['状态不是对象'] };
    if (st.version !== VERSION) err(`version 必须是 ${VERSION}`);
    if (st.ruleset !== RULESET) err('ruleset 必须是 veteran');
    if (!isInt(st.nextId) || st.nextId < 1) err('nextId 必须是正整数');
    ['gold', 'shards', 'bestDepth'].forEach((k) => {
      if (!isInt(st[k]) || st[k] < 0) err(`${k} 必须是非负整数`);
    });
    if (!Array.isArray(st.roster) || st.roster.length === 0) err('roster 不能为空');
    if (!Array.isArray(st.team) || st.team.length !== 4) err('team 必须是 4 个槽位');

    const ids = new Set();
    (st.roster || []).forEach((u) => {
      if (!u || !u.id) return err('角色缺少 id');
      if (ids.has(u.id)) err(`角色 id 重复：${u.id}`);
      ids.add(u.id);
      if (!D().BODIES[u.bodyPreset]) err(`${u.id} 的底盘未知：${u.bodyPreset}`);
      if (!isInt(u.stress) || u.stress < 0 || u.stress > 100) err(`${u.id} 压力越界`);
      if (!u.board || !Array.isArray(u.board.placements)) err(`${u.id} 缺少 board.placements`);
      if (!Array.isArray(u.gambits)) err(`${u.id} 缺少 gambits`);
      else if (u.gambits.length > (u.logicSlots || D().DESIGN.logicSlots)) {
        err(`${u.id} 的规则数超过槽位上限`);
      }
      if (![2, 3].includes(u.logicSlots)) err(`${u.id} 的逻辑槽必须是 2 或 3`);
      if (!u.history || !Array.isArray(u.history.eligibleRunIds)) err(`${u.id} 缺少战史`);
    });

    const teamSeen = new Set();
    (st.team || []).forEach((id, i) => {
      if (id == null) return;
      if (!ids.has(id)) err(`team[${i}] 指向不存在的角色 ${id}`);
      if (teamSeen.has(id)) err(`team 中角色重复：${id}`);
      teamSeen.add(id);
    });

    if (!st.itemsById || typeof st.itemsById !== 'object') err('itemsById 缺失');

    /* 归属唯一 */
    const locs = itemLocations(st);
    Object.keys(locs).forEach((id) => {
      if (!st.itemsById[id]) err(`归属引用了不存在的构件 ${id}`);
      if (locs[id].length > 1) {
        err(`构件 ${id} 有 ${locs[id].length} 处归属：${locs[id].map((x) => x.where).join('/')}`);
      }
    });

    /* 主手与回路本体 */
    (st.roster || []).forEach((u) => {
      const maxCoord = (V.Circuit && typeof V.Circuit.plateOf === 'function'
        ? V.Circuit.plateOf(u).size
        : (st.plateMode === 'classic' ? D().DESIGN.gridSize : (V.PlateGen ? V.PlateGen.SIZE : D().DESIGN.gridSize))) - 1;
      (u.board && u.board.placements || []).forEach((p) => {
        const it = st.itemsById[p.itemId];
        if (!it) return err(`${u.id} 的板面引用了不存在的构件 ${p.itemId}`);
        if (it.kind !== 'circuit') err(`${u.id} 的板面放了非回路构件 ${p.itemId}`);
        if (!isInt(p.x) || !isInt(p.y) || p.x < 0 || p.y < 0 || p.x > maxCoord || p.y > maxCoord) {
          err(`${u.id} 的构件 ${p.itemId} 坐标越界`);
        }
        if (![0, 1, 2, 3].includes(p.rotation)) err(`${u.id} 的构件 ${p.itemId} 旋转值非法`);
      });
    });

    /* 功法藏品：只认已知谱目，避免坏档塞进任意对象 */
    (st.manuscriptVault || []).forEach((m) => {
      if (!m || !D().MANUSCRIPTS[m.id]) err(`功法藏品里有未知条目：${m && m.id}`);
    });

    /* 功法：必须整块落在板面上（占格由 preview 统一查） */
    if (V.Manuscript && V.Circuit && typeof V.Circuit.plateOf === 'function') {
      (st.roster || []).forEach((u) => {
        if (!u.manuscript) return;
        const plate = V.Circuit.plateOf(u);
        const or = V.Manuscript.orient(
          V.Manuscript.normalize(u.manuscript),
          u.manuscript.rotation || 0, !!u.manuscript.mirrorY,
        );
        if (!V.Manuscript.fits(or, plate.cellsList, u.manuscript.x || 0, u.manuscript.y || 0)) {
          err(`${u.name || u.id} 的功法没有完整落在板面上`);
        }
      });
    }

    /* 几何与负荷：委托回路编译器（含屏蔽格、重叠、越界、超负荷、闭环） */
    if (V.Circuit && typeof V.Circuit.preview === 'function') {
      (st.roster || []).forEach((u) => {
        const r = V.Circuit.preview(st, u.id, u.board.placements || []);
        if (!r.ok) (r.errors || []).forEach((m) => err(`${u.name || u.id} 板面：${m}`));
      });
    }

    /* 运行中的远征 */
    if (st.run) {
      const r = st.run;
      if (typeof r.id !== 'string' || !r.id) err('run.id 缺失');
      if (!isInt(r.floor) || r.floor < 1 || r.floor > MAX_FLOOR) err('run.floor 越界');
      if (!Array.isArray(r.party) || r.party.length > 4) err('run.party 结构错误');
      (r.party || []).forEach((p, i) => {
        if (!ids.has(p.uid)) err(`party[${i}] 指向不存在的角色 ${p.uid}`);
        if (!isInt(p.slot) || p.slot < 0 || p.slot > 3) err(`party[${i}] slot 越界`);
      });
      if (r.party) {
        const slots = new Set(r.party.map((p) => p.slot));
        if (slots.size !== r.party.length) err('party 中 slot 重复');
        if (new Set(r.party.map((p) => p.uid)).size !== r.party.length) err('party 中 uid 重复');
      }
      /* 必须覆盖远征全部阶段，否则在这些节点存档会被自己判成坏档 */
      const stages = ['map', 'prebattle', 'battle', 'battleReview', 'loot',
        'event', 'camp', 'merchant', 'blessing'];
      if (!stages.includes(r.stage)) err(`run.stage 非法：${r.stage}`);
      if (r.encounter && r.encounter.checkpoint && r.encounter.checkpoint.run) {
        const cpRun = r.encounter.checkpoint.run;
        if (cpRun.encounter && cpRun.encounter.checkpoint) err('checkpoint 出现自嵌套');
      }
      if (r.bag) {
        const used = r.bag.reduce((a, id) => a + partCells(st.itemsById[id]), 0);
        if (used > D().DESIGN.bagCapacity) err(`背包超容：${used} > ${D().DESIGN.bagCapacity}`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  V.State = {
    VERSION, RULESET, SAVE_KEY, DEFAULT_SEED, MAX_FLOOR, equipManuscript,
    clone, ok, fail, takeId, addLog,
    create, makeUnit, makePart, equipPreset, partCells, partLoad,
    validate, itemLocations, itemLocation, ownItemIds, itemById, unitById,
    isInt,
  };
})(globalThis.Ashen ||= {});
