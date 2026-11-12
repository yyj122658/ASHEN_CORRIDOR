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
  const MAX_FLOOR = D().DESIGN.maxFloor;

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

  /* ------------------------------ 纹路 ------------------------------ */

  /** 新建一个纹路实例（不写 registry，调用方负责注册）。 */
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

  /** 纹路占格数（主手固定 4 格；回路按模板 cells）。 */
  function partCells(item) {
    if (!item) return 0;
    if (item.kind === 'weapon') return D().DESIGN.weaponCells;
    const tpl = D().template(item.templateId);
    return tpl.cells.length;
  }

  /** 纹路负荷（主手不计负荷；回路按模板 load）。 */
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
      if (Array.isArray(run.chestChoices)) run.chestChoices.forEach((id) => push(id, 'chest'));
      if (Array.isArray(run.shop)) run.shop.filter((o) => o && !o.sold).forEach((o) => push(o.itemId, 'merchant', o.id));
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

  /** 首门沿用旧档字段，其余按装入顺序递补。 */
  function manuscriptsOf(unit) {
    return [unit?.manuscript, ...(Array.isArray(unit?.extraManuscripts) ? unit.extraManuscripts : [])].filter(Boolean);
  }

  function manuscriptCells(ms) {
    const shape = V.Manuscript.orient(V.Manuscript.normalize(ms), ms.rotation || 0, !!ms.mirrorY);
    return shape ? shape.cells.map(([x, y]) => [x + (ms.x ?? 0), y + (ms.y ?? 0)]) : [];
  }

  function freeManuscriptCells(unit, id) {
    const occupied = new Set();
    for (const ms of manuscriptsOf(unit)) {
      if (ms.id !== id) manuscriptCells(ms).forEach(cell => occupied.add(cell.join(',')));
    }
    return V.Circuit.plateOf(unit).cellsList.filter(cell => !occupied.has(cell.join(',')));
  }

  function canPlaceManuscript(unit, id, pose) {
    const spec = D().manuscript(id);
    if (!spec || !pose || !isInt(pose.x) || !isInt(pose.y)
      || ![0, 1, 2, 3].includes(pose.rotation ?? 0)) return false;
    const shape = V.Manuscript.orient(V.Manuscript.normalize(spec), pose.rotation, !!pose.mirrorY);
    return V.Manuscript.fits(shape, freeManuscriptCells(unit, id), pose.x, pose.y);
  }

  function bestManuscriptPose(st, unit, spec, cells, placements) {
    const base = V.Manuscript.normalize(spec);
    const idx = V.Manuscript.pieceIndex(V.Circuit.layout(st, placements || unit.board.placements));
    let best = null;
    let bestScore = -1;
    for (const mirrorY of [false, true]) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const oriented = V.Manuscript.orient(base, rotation, mirrorY);
        for (const [x, y] of V.Manuscript.placements(oriented, cells)) {
          const score = V.Manuscript.coverage(oriented, x, y, idx).aligned;
          if (score > bestScore) {
            best = { x, y, rotation, mirrorY };
            bestScore = score;
          }
        }
      }
    }
    return best;
  }

  /** 新角色和模拟场次直接配置起始谱，不经过玩家仓库。 */
  function equipManuscript(st, unit, msId) {
    const spec = D().manuscript(msId);
    if (!spec || !V.Manuscript) return unit;
    const pose = bestManuscriptPose(st, unit, spec, V.Circuit.plateOf(unit).cellsList);
    if (pose) {
      unit.manuscript = { ...spec, ...pose };
      delete unit.extraManuscripts;
    }
    return unit;
  }

  function setManuscripts(unit, list) {
    unit.manuscript = list[0] || null;
    unit.extraManuscripts = list.slice(1);
  }

  /** 玩家装配事务：板面与负荷全通过才提交，并且只扣新增的那一份。 */
  function placeManuscript(st, unit, id, pose, placements) {
    const spec = D().manuscript(id);
    const equipped = manuscriptsOf(unit);
    const index = equipped.findIndex(m => m.id === id);
    const stock = (st.manuscriptVault || []).findIndex(m => m.id === id);
    if (!spec || (index < 0 && stock < 0)) return { ok: false, reason: '尚未获得这门蚀刻法' };
    const target = pose || bestManuscriptPose(st, unit, spec, freeManuscriptCells(unit, id), placements);
    if (!canPlaceManuscript(unit, id, target)) return { ok: false, reason: '拓片需要一块形状相合的空地' };
    const owned = index < 0 ? st.manuscriptVault[stock] : equipped[index];
    const next = { ...spec, ...owned, x: target.x, y: target.y, rotation: target.rotation || 0, mirrorY: !!target.mirrorY };
    if (index < 0) equipped.push(next);
    else equipped[index] = next;
    const candidate = { ...unit };
    setManuscripts(candidate, equipped);
    const preview = V.Circuit.preview({ ...st, roster: [candidate] }, unit.id, placements || unit.board.placements);
    if (!preview.ok) return { ok: false, reason: preview.errors[0] };
    setManuscripts(unit, equipped);
    if (index < 0) st.manuscriptVault.splice(stock, 1);
    return { ok: true };
  }

  function removeManuscript(st, unit, id) {
    const equipped = manuscriptsOf(unit);
    const selected = equipped.find(m => m.id === id);
    if (!selected) return { ok: false, reason: '这门蚀刻法尚未装入' };
    const { x, y, rotation, mirrorY, ...stored } = selected;
    setManuscripts(unit, equipped.filter(m => m.id !== id));
    (st.manuscriptVault ||= []).push(stored);
    return { ok: true };
  }

  function promoteManuscript(unit, id) {
    const equipped = manuscriptsOf(unit);
    const index = equipped.findIndex(ms => ms.id === id);
    if (index < 0) return { ok: false, reason: '这门蚀刻法尚未装入' };
    const [primary] = equipped.splice(index, 1);
    setManuscripts(unit, [primary, ...equipped]);
    return { ok: true };
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
      scars: [],
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

  /** 给单位装配预设线路，纹路写入 registry 并挂到 board。 */
  /**
   * 装上预设线路。
   * 预设的坐标是「相对形状」，异形板面上不一定落在金属里，所以要找一个平移量
   * 让整条线都铺得下；平移量按 |dx|+|dy| 从小到大试，(0,0) 优先，老板面结果不变。
   */
  function equipPreset(st, unit, presetId) {
    const preset = D().PRESETS[presetId] || D().PRESETS.basic;
    /* 板面只认 Circuit.plateOf，别处不要重复推导 */
    const plateCells = A.Veteran.Circuit.plateOf(unit).cells;
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
      /* 蚀刻法藏品：掉到的蚀刻法先进这里，工坊里再装到具体单位身上 */
      manuscriptVault: [],
      packLevel: 0,
      pantry: {},
      packedMeals: {},
      mealStore: {},
      cookedRecipes: {},
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

    /* 同一生命基数，三门练法带来不同打法。 */
    const setup = [
      /* 顺序即身位；可在营地调整。 */
      { skinId: 'blade', bodyPreset: 'sturdy', name: '铁鸦' },
      { skinId: 'ranger', bodyPreset: 'agile', name: '灰烬' },
      { skinId: 'warden', bodyPreset: 'sturdy', name: '磐石' },
      { skinId: 'cleric', bodyPreset: 'conduit', name: '烛火' },
    ];

    setup.forEach((spec, index) => {
      const unit = makeUnit(st, spec);
      equipPreset(st, unit, 'basic');
      if (st.plateMode === 'plate') equipManuscript(st, unit, ['spark', 'needle', 'ward', 'needle'][index]);
      st.roster.push(unit);
    });

    st.team = st.roster.map((u) => u.id);

    /* 仓库：一件重炮 + 一套可换的蓄能片（capacitor + straight） */
    ['capacitor', 'straight'].forEach((tpl) => {
      const part = makePart(st, { kind: 'circuit', templateId: tpl });
      st.itemsById[part.id] = part;
      st.stash.push(part.id);
    });

    /* 短拓片适合起手合修，长拓片留给愿意调整板面的玩家。 */
    for (const id of ['corridor5', 'rivet']) {
      const starter = D().manuscript(id);
      if (starter) st.manuscriptVault.push(clone(starter));
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

    function checkCounts(counts, catalog, label, minimum = 0) {
      if (counts === undefined) return;
      if (!counts || typeof counts !== 'object' || Array.isArray(counts)
        || Object.entries(counts).some(([id, n]) => !Object.hasOwn(catalog, id) || !Number.isSafeInteger(n) || n < minimum)) {
        err(`${label}的品种或数量非法`);
      }
    }
    function checkKitchen(snapshot) {
      for (const [key,max] of [['rackLevel',3],['binLevel',1]]) {
        if (snapshot[key] !== undefined && (!isInt(snapshot[key]) || snapshot[key]<0 || snapshot[key]>max)) err('仓库改装等级非法');
      }
      if (snapshot.storePlaces !== undefined) {
        const obj = v => v && typeof v === 'object' && !Array.isArray(v);
        if (!obj(snapshot.storePlaces) || Object.entries(snapshot.storePlaces).some(([shelf,places]) =>
          !['food','meal','part','etch'].includes(shelf) || !obj(places) || Object.values(places).some(p =>
            !obj(p) || !isInt(p.at) || p.at<0 || p.at>=24+12*(snapshot.rackLevel||0) || !isInt(p.turn) || p.turn<0 || p.turn>3))) err('仓库格位非法');
      }
      if (snapshot.packLevel !== undefined && (!isInt(snapshot.packLevel) || snapshot.packLevel < 0 || snapshot.packLevel > V.Expedition.PACK_UPGRADES.length)) {
        err('背包改装等级非法');
      }
      const ingredients = V.Kitchen?.INGREDIENTS || {}, recipes = V.Kitchen?.RECIPES || {};
      const run = snapshot.run, owner = run || snapshot;
      checkCounts(snapshot.pantry, ingredients, '食材仓库');
      checkCounts(snapshot.cookedRecipes, recipes, '料理记录', 1);
      checkCounts(snapshot.mealStore, recipes, '前哨成菜仓库');
      checkCounts(snapshot.packedMeals, recipes, '出征备餐');
      checkCounts(snapshot.settlement?.ingredients, ingredients, '结算食材');
      checkCounts(snapshot.settlement?.meals, recipes, '结算成菜');
      checkCounts(run?.meals, recipes, '随身成菜');
      checkCounts(run?.ingredients, ingredients, '背包食材');
      checkCounts(run?.ingredientLoot, ingredients, '待采集食材');
      checkCounts(run?.mealLoot, recipes, '地面成菜');
      if (run && Object.values(snapshot.packedMeals || {}).some(n => n > 0)) err('出征备餐与远征行囊不能同时持有');
      if (run && run.stage !== 'loot' && [run.ingredientLoot, run.mealLoot].some(stock => Object.values(stock || {}).some(n => n > 0))) err('当前阶段不能留有地面食材或成菜');
      const stacks = owner.packStacks;
      if (stacks !== undefined && (!stacks || typeof stacks !== 'object' || Array.isArray(stacks)
        || Object.entries(stacks).some(([token, count]) => {
          const spec = V.Expedition.stackSpec(token);
          return !spec || (!run && spec.kind !== 'meal') || !Number.isInteger(count) || count < 1 || count > spec.profile.limit;
        }))) err('行囊堆号或份数非法');
      for (const turns of [owner.packTurns, owner.groundTurns]) {
        if (turns !== undefined && (!turns || typeof turns !== 'object' || Array.isArray(turns) ||
          Object.values(turns).some(turn => !Number.isInteger(turn) || turn < 0 || turn > 3))) err('物品朝向无效');
      }
      const order = owner.packOrder;
      if (order !== undefined && (!Array.isArray(order) || order.length !== V.Expedition.bagCapacity(snapshot)
        || Array.from(order).some(token => {
          if (token === null) return false;
          const spec = V.Expedition.stackSpec(token);
          return spec ? !run && spec.kind !== 'meal' : !(run && typeof token === 'string' && /^part:[A-Za-z0-9_-]{1,80}$/.test(token));
        }))) err('行囊格位数量或物品标记非法');
      if (errors.length) return;
      const cap = V.Expedition.bagCapacity(snapshot);
      const quantities = Object.entries(run?.ingredients || {});
      const meals = Object.entries((run ? run.meals : snapshot.packedMeals) || {});
      const partArea = (run?.bag || []).reduce((sum, id) => sum + partCells(snapshot.itemsById?.[id]), 0);
      const oldArea = quantities.reduce((sum, [, n]) => sum + n, partArea);
      // 旧档按每份原料一格计算，几何升级后允许保留原本超出的那几件。新收获须有实际格位。
      const reserve = run?.packReserve;
      let oldCost = 0;
      if (reserve !== undefined) {
        if (!reserve || typeof reserve !== 'object' || Array.isArray(reserve)) { err('待整理记录非法'); return; }
        for (const [token, count] of Object.entries(reserve)) {
          const spec = V.Expedition.stackSpec(token);
          const part = token.startsWith('part:') && run.bag.includes(token.slice(5)) && snapshot.itemsById?.[token.slice(5)];
          if (!Number.isSafeInteger(count) || count < 1 || !(spec?.kind === 'food' && count <= spec.profile.limit || part && count === 1)) {
            err('待整理来源或份数非法'); return;
          }
          oldCost += part ? partCells(part) : count;
        }
      }
      if (oldCost > cap || partArea > 2 * cap
        || quantities.some(([id,n]) => n > cap * (1 + V.Expedition.foodPack(id).limit))
        || meals.some(([id,n]) => n > cap * V.Expedition.mealPack(id).limit)) { err('背包超容'); return; }
      if (oldArea > cap || meals.some(([,n]) => n > 0) || reserve !== undefined) {
        const overflow = V.Expedition.packOverflow(snapshot);
        if (overflow.some(token => V.Expedition.stackCount(snapshot, token) > (reserve?.[token] || 0))) err('背包超容');
      }
    }
    checkKitchen(st);
    function checkManuscripts(u) {
      if (!u) return;
      if (u.extraManuscripts !== undefined && (!Array.isArray(u.extraManuscripts)
        || u.extraManuscripts.some(m => !m) || (u.extraManuscripts.length && !u.manuscript))) {
        err(`${u.id} 的合修记录非法`);
      }
      const ids = new Set();
      for (const m of manuscriptsOf(u)) {
        if (!Object.hasOwn(D().MANUSCRIPTS, m.id) || ids.has(m.id)
          || !Array.isArray(m.cells) || !m.cells.length || !isInt(m.x ?? 0) || !isInt(m.y ?? 0)
          || ![0, 1, 2, 3].includes(m.rotation ?? 0)) err(`${u.id} 的蚀刻法或落点非法`);
        ids.add(m.id);
      }
    }
    if (Array.isArray(st.roster)) st.roster.forEach(checkManuscripts);
    const checkpoint = st.run?.encounter?.checkpoint;
    if (checkpoint) checkKitchen(checkpoint);
    if (Array.isArray(checkpoint?.roster)) checkpoint.roster.forEach(checkManuscripts);
    if (errors.length) return { ok: false, errors };

    /** 顶层角色与回转检查点共用瘢痕校验。@param {object} u @returns {void} */
    function checkScars(u) {
      if (!u || typeof u !== 'object') { err('瘢痕所属传奇非法'); return; }
      if (u.scars !== undefined) {
        if (!Array.isArray(u.scars)) err(`${u.id} 瘢痕记录非法`);
        else {
          const metal = V.Circuit.plateOf(u).cells;
          const seenScars = new Set();
          u.scars.forEach((s) => {
            if (!s || !isInt(s.x) || !isInt(s.y) || !metal.has(s.x + ',' + s.y)
              || seenScars.has(s.x + ',' + s.y) || !Object.hasOwn(D().SCAR_EFFECTS, s.templateId)
              || typeof s.source !== 'string' || !s.source || s.source.length > 120
              || typeof s.runId !== 'string' || s.runId.length > 80 || !isInt(s.floor) || s.floor < 1 || s.floor > MAX_FLOOR) {
              err(`${u.id} 瘢痕位置或来源非法`);
            }
            if (s) seenScars.add(s.x + ',' + s.y);
          });
        }
      }
    }
    const ids = new Set();
    (st.roster || []).forEach((u) => {
      if (!u || !u.id) return err('角色缺少 id');
      if (ids.has(u.id)) err(`角色 id 重复：${u.id}`);
      ids.add(u.id);
      if (!D().BODIES[u.bodyPreset]) err(`${u.id} 的底盘未知：${u.bodyPreset}`);
      if (!isInt(u.stress) || u.stress < 0 || u.stress > 100) err(`${u.id} 压力越界`);
      checkScars(u);
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
      if (!st.itemsById[id]) err(`归属引用了不存在的纹路 ${id}`);
      if (locs[id].length > 1) {
        err(`纹路 ${id} 有 ${locs[id].length} 处归属：${locs[id].map((x) => x.where).join('/')}`);
      }
    });

    /* 主手与回路本体 */
    (st.roster || []).forEach((u) => {
      const maxCoord = (V.Circuit && typeof V.Circuit.plateOf === 'function'
        ? V.Circuit.plateOf(u).size
        : (st.plateMode === 'classic' ? D().DESIGN.gridSize : (V.PlateGen ? V.PlateGen.SIZE : D().DESIGN.gridSize))) - 1;
      (u.board && u.board.placements || []).forEach((p) => {
        const it = st.itemsById[p.itemId];
        if (!it) return err(`${u.id} 的板面引用了不存在的纹路 ${p.itemId}`);
        if (it.kind !== 'circuit') err(`${u.id} 的板面放了非回路纹路 ${p.itemId}`);
        if (!isInt(p.x) || !isInt(p.y) || p.x < 0 || p.y < 0 || p.x > maxCoord || p.y > maxCoord) {
          err(`${u.id} 的纹路 ${p.itemId} 坐标越界`);
        }
        if (![0, 1, 2, 3].includes(p.rotation)) err(`${u.id} 的纹路 ${p.itemId} 旋转值非法`);
      });
    });

    /* 蚀刻法藏品：只认已知谱目，避免坏档塞进任意对象 */
    (st.manuscriptVault || []).forEach((m) => {
      if (!m || !D().manuscript(m.id)) err(`蚀刻法藏品里有未知条目：${m && m.id}`);
    });

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
      if (r.chapterEvents != null && (!Array.isArray(r.chapterEvents) || r.chapterEvents.length > 3 ||
        r.chapterEvents.some(id => !D().EVENT_ORDER.includes(id)))) err('章节事件记录无效');
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
      if (r.encounter && r.encounter.checkpoint) {
        const cpRoster = r.encounter.checkpoint.roster;
        if (!Array.isArray(cpRoster)) err('检查点缺少传奇记录');
        else cpRoster.forEach(checkScars);
      }
      if (r.encounter && r.encounter.checkpoint && r.encounter.checkpoint.run) {
        const cpRun = r.encounter.checkpoint.run;
        if ((cpRun.fieldManuscript ?? null) !== (r.fieldManuscript ?? null)) err('遭遇检查点的战利谱不一致');
        if (cpRun.encounter && cpRun.encounter.checkpoint) err('checkpoint 出现自嵌套');
      }
      if (r.fieldManuscript != null) {
        const spec = typeof r.fieldManuscript === 'string' && D().manuscript(r.fieldManuscript);
        if (!spec?.fieldSource || spec.fieldDepth > r.floor) err('携带的战利谱来源或层数非法');
      }
      // 旧版未决宝箱需先核对原物归属，读取器随后将两件移入待拾区。
      if (r.chestChoices !== undefined) {
        const node = r.nodes?.find((n) => n.id === r.activeNodeId);
        const choices = r.chestChoices;
        if (r.stage !== 'loot' || node?.type !== 'chest' || node.consumed || !Array.isArray(r.bag) || !Array.isArray(r.pendingLoot)
          || !Array.isArray(choices) || choices.length !== 2
          || !choices.every((id) => typeof id === 'string' && st.itemsById[id]?.kind === 'circuit' && D().TEMPLATE_ORDER.includes(st.itemsById[id].templateId))
          || new Set(choices.map((id) => st.itemsById[id].templateId)).size !== 2) err('旧宝箱记录需要两件不同的待拾纹路');
      }
    }

    return { ok: errors.length === 0, errors };
  }

  V.State = {
    VERSION, RULESET, SAVE_KEY, DEFAULT_SEED, MAX_FLOOR, equipManuscript,
    manuscriptsOf, manuscriptCells, freeManuscriptCells, canPlaceManuscript, placeManuscript, removeManuscript, promoteManuscript,
    clone, ok, fail, takeId, addLog,
    create, makeUnit, makePart, equipPreset, partCells, partLoad,
    validate, itemLocations, itemLocation, ownItemIds, itemById, unitById,
    isInt,
  };
})(globalThis.Ashen ||= {});
