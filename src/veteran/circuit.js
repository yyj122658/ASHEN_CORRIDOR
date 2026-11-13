'use strict';
/* 生命金属回路：4x4 几何、90 度旋转 / 上下翻转、有向端口图编译、能量路由。
   全部纯函数；不读 RNG、DOM、时钟。结果可 JSON 序列化。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;

  const DIRS = {
    N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0],
  };
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const ROT_CW = { N: 'E', E: 'S', S: 'W', W: 'N' };

  function opposite(d) { return OPPOSITE[d]; }
  function rotateDir(d) { return ROT_CW[d]; }
  function flipNS(d) { return d === 'N' ? 'S' : d === 'S' ? 'N' : d; }

  /* ------------------------------ 变换 ------------------------------ */

  function normalize(cells, ports) {
    if (!cells.length) return;
    const minX = Math.min(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    if (!minX && !minY) return;
    cells.forEach((c) => { c.x -= minX; c.y -= minY; });
    ports.forEach((p) => { p.cell[0] -= minX; p.cell[1] -= minY; });
  }

  /**
   * 模板变换：先 mirrorY（包围盒内 y→h-1-y、N/S 互换），再顺时针旋转 rotation 次。
   * mirror 可为布尔或次数；返回新的 cells / ports / links（不修改入参）。
   */
  function transformTemplate(tpl, rotation, mirrorY) {
    const cells = tpl.cells.map(([x, y]) => ({ x, y }));
    const ports = tpl.ports.map((p) => ({ id: p.id, cell: p.cell.slice(), dir: p.dir, role: p.role }));
    normalize(cells, ports);

    const mirrorTimes = mirrorY === true ? 1 : mirrorY === false || mirrorY == null ? 0 : (Number(mirrorY) | 0);
    for (let i = 0; i < mirrorTimes; i++) {
      const maxY = Math.max(...cells.map((c) => c.y));
      cells.forEach((c) => { c.y = maxY - c.y; });
      ports.forEach((p) => { p.cell[1] = maxY - p.cell[1]; p.dir = flipNS(p.dir); });
      normalize(cells, ports);
    }

    const rot = (((rotation | 0) % 4) + 4) % 4;
    for (let i = 0; i < rot; i++) {
      const h = Math.max(...cells.map((c) => c.y)) + 1;
      cells.forEach((c) => { const nx = h - 1 - c.y; const ny = c.x; c.x = nx; c.y = ny; });
      ports.forEach((p) => {
        const nx = h - 1 - p.cell[1]; const ny = p.cell[0];
        p.cell[0] = nx; p.cell[1] = ny; p.dir = rotateDir(p.dir);
      });
      normalize(cells, ports);
    }

    return { cells, ports, links: tpl.links.map((l) => l.slice()) };
  }

  /* ------------------------------ 几何校验 ------------------------------ */

  function blockedSet(body) {
    const set = new Set();
    (body.blocked || []).forEach(([x, y]) => set.add(x + ',' + y));
    return set;
  }

  /**
   * 一个单位实际能放纹路的板面：{cells:Set<'x,y'>, size, generated}
   * - 底盘带 plate 配置 → 用 PlateGen 按 seed 生成异形板面；
   * - 否则退回旧的 4x4 网格（老存档 / 测试用）。
   * 板面只管「哪一格能放」。接线模型（输入极 / 输出极 / 脉冲）已删除，这里不再派生端子。
   * 这是唯一决定「哪一格能放」的地方，别处不要再写死 4。
   */
  function plateOf(unit) {
    const body = D().body(unit && unit.bodyPreset);
    /* 显式覆写优先：测试与老存档用固定几何 */
    if (unit && unit.plateOverride && Array.isArray(unit.plateOverride.cells)) {
      const cells = new Set(unit.plateOverride.cells.map((c) => c[0] + ',' + c[1]));
      return {
        cells,
        cellsList: unit.plateOverride.cells,
        size: D().DESIGN.gridSize,
        generated: false,
      };
    }
    const conf = body && body.plate;
    if (conf && V.PlateGen) {
      const gen = V.PlateGen.generate({
        seed: unit.plateSeed == null ? 1 : unit.plateSeed,
        archetype: conf.archetype,
        target: conf.target,
      });
      return {
        cells: new Set(gen.cells.map((c) => c[0] + ',' + c[1])),
        cellsList: gen.cells,
        size: V.PlateGen.SIZE,
        generated: true,
        manuscript: !!unit.manuscript,
      };
    }
    const size = D().DESIGN.gridSize;
    const blocked = blockedSet(body || {});
    const cells = new Set();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!blocked.has(x + ',' + y)) cells.add(x + ',' + y);
      }
    }
    return {
      cells, cellsList: [...cells].map((k) => k.split(',').map(Number)),
      size, generated: false,
    };
  }

  /**
   * preview(st, unitId, placements) -> {ok, errors, occupied, load, overload, cap}
   * 同一函数供 UI 预览与真实保存使用；非法时 state 不变（本函数不写 state）。
   */
  /** 装配上限统一取板面配置，经典板保留原值。@param {object} unit @returns {number} */
  function loadCap(unit) {
    const plate = plateOf(unit);
    const body = D().body(unit.bodyPreset);
    return plate.generated ? body.plate.loadCap : body.loadCap;
  }

  /** 瘢痕不随拆装消失，只由真实占格决定激活。@param {object} st @param {object} unit @param {object[]} [placements] @returns {object[]} */
  function scarState(st, unit, placements) {
    if (!unit.scars || !unit.scars.length) return [];
    const draft = placements || (st.run && st.run.fieldLayouts && st.run.fieldLayouts[unit.id]) || unit.board.placements;
    const occupied = new Set(layout(st, draft).cells.map((c) => c.x + ',' + c.y));
    V.State.manuscriptsOf(unit).forEach(ms => {
      V.State.manuscriptCells(ms).forEach(cell => occupied.add(cell.join(',')));
    });
    return unit.scars.map((s) => {
      const tpl = D().TEMPLATES[s.templateId];
      const source = tpl && s.source === tpl.legacyName ? tpl.name : s.source;
      return { ...s, source, active: occupied.has(s.x + ',' + s.y), effect: D().SCAR_EFFECTS[s.templateId] || {} };
    });
  }

  function preview(st, unitId, placements) {
    const errors = [];
    const unit = st.roster.find((u) => u.id === unitId);
    if (!unit) return { ok: false, errors: ['找不到角色'], occupied: [], load: 0, overload: 0, cap: 0 };
    const body = D().body(unit.bodyPreset);
    const plate = plateOf(unit);

    /* 蚀刻法是拓片：必须落在金属上，纹路可在同格填入纹路。 */
    const etchings = V.State.manuscriptsOf(unit);
    const stencilCells = new Set();
    for (const ms of etchings) {
      const cells = V.State.manuscriptCells(ms).map(cell => cell.join(','));
      if (!cells.length || cells.some(cell => !plate.cells.has(cell))) errors.push(`蚀刻法「${ms.name}」没有完整落在板面上`);
      if (cells.some(cell => stencilCells.has(cell))) errors.push(`蚀刻法「${ms.name}」与另一张拓片重叠`);
      cells.forEach(cell => stencilCells.add(cell));
    }

    const list = placements || [];
    const seenItems = new Set();
    const occupied = [];
    const cellOwner = new Map(); // 'x,y' -> itemId
    const built = [];
    let load = 0;
    let bagError = null;

    list.forEach((p) => {
      const item = st.itemsById[p.itemId];
      if (!item) { errors.push(`纹路不存在：${p.itemId}`); return; }
      if (item.kind !== 'circuit') { errors.push(`不是回路纹路：${p.itemId}`); return; }
      if (seenItems.has(p.itemId)) { errors.push(`同一纹路被放置两次：${p.itemId}`); return; }
      seenItems.add(p.itemId);

      const tpl = D().template(item.templateId);
      const tf = transformTemplate(tpl, p.rotation || 0, !!p.mirrorY);
      load += tpl.load;

      const cells = tf.cells.map((c) => ({ x: c.x + p.x, y: c.y + p.y }));
      const ports = tf.ports.map((pt) => ({
        id: pt.id, role: pt.role, dir: pt.dir,
        cell: [pt.cell[0] + p.x, pt.cell[1] + p.y],
      }));

      cells.forEach((c) => {
        const key = c.x + ',' + c.y;
        if (!plate.generated && (c.x < 0 || c.y < 0 || c.x >= plate.size || c.y >= plate.size)) {
          errors.push(`${tpl.name}（${item.id}）的格 (${c.x},${c.y}) 越界`);
          return;
        }
        if (!plate.cells.has(key)) {
          /* 旧网格报「屏蔽格」，异形板面报「不在板面上」，措辞按来源区分 */
          errors.push(plate.generated
            ? `${tpl.name}（${item.id}）的格 (${c.x},${c.y}) 不在板面上`
            : `${tpl.name}（${item.id}）的格 (${c.x},${c.y}) 是屏蔽格`);
          return;
        }
        if (cellOwner.has(key)) {
          const other = cellOwner.get(key);
          if (other !== item.id) errors.push(`纹路 ${other} 与 ${item.id} 在 (${c.x},${c.y}) 重叠`);
        } else {
          cellOwner.set(key, item.id);
        }
        occupied.push([c.x, c.y]);
      });

      /* 回路片必须在仓库或板面里，不能是随身背包里的东西（背包只在本局可用） */
      built.push({ itemId: item.id, templateId: item.templateId, tpl, x: p.x, y: p.y, rotation: p.rotation || 0, mirrorY: !!p.mirrorY, cells, ports });
    });

    /* 蚀刻法也吃负荷：多修一套就少放纹路，这是唯一的平衡阀 */
    for (const ms of etchings) load += Number(ms.load) || 0;
    /* 异形板面格数多，负荷上限单独给；经典模式沿用老值 */
    const cap = loadCap(unit);
    /* 超载不再阻止装配：超出部分转成开局压力与回裕惩罚，玩家自己决定值不值 */
    const overload = Math.max(0, load - cap);

    if (errors.length) {
      return { ok: false, errors, occupied, load, overload, cap };
    }

    return { ok: true, errors: [], occupied, load, overload, cap, bagError };
  }

  /**
   * layout(st, placements)：容错版布局，供 UI 画格子/端口/纹路间的相邻连线。
   * 不做合法性判断（非法摆放也照画），权威校验仍走 preview。
   */
  function layout(st, placements) {
    const cells = [];
    const ports = [];
    const edges = [];
    const built = [];

    (placements || []).forEach((p) => {
      const item = st.itemsById[p.itemId];
      if (!item || item.kind !== 'circuit') return;
      const tpl = D().template(item.templateId);
      const tf = transformTemplate(tpl, p.rotation || 0, !!p.mirrorY);
      const abs = tf.cells.map((c) => ({ x: c.x + p.x, y: c.y + p.y, itemId: item.id, templateId: tpl.id }));
      const aps = tf.ports.map((pt) => ({
        id: pt.id, dir: pt.dir, role: pt.role,
        cell: [pt.cell[0] + p.x, pt.cell[1] + p.y],
        itemId: item.id, templateId: tpl.id,
      }));
      built.push({ item, tpl, abs, aps, links: tf.links });
      abs.forEach((c) => cells.push(c));
      aps.forEach((pt) => ports.push(pt));
      tf.links.forEach(([a, b]) => edges.push({
        from: item.id + ':' + a, to: item.id + ':' + b, internal: true,
      }));
    });

    built.forEach((b) => {
      b.aps.filter((p) => p.role === 'in').forEach((pt) => {
        const [dx, dy] = DIRS[pt.dir];
        const src = [pt.cell[0] + dx, pt.cell[1] + dy];
        built.forEach((o) => {
          if (o.item.id === b.item.id) return;
          o.aps.filter((q) => q.role === 'out').forEach((q) => {
            if (q.cell[0] !== src[0] || q.cell[1] !== src[1]) return;
            if (q.dir !== opposite(pt.dir)) return;
            edges.push({ from: o.item.id + ':' + q.id, to: b.item.id + ':' + pt.id, external: true });
          });
        });
      });

      b.aps.filter((p) => p.role === 'out').forEach((pt) => {
        const [dx, dy] = DIRS[pt.dir];
        const dst = [pt.cell[0] + dx, pt.cell[1] + dy];
        built.forEach((o) => {
          if (o.item.id === b.item.id) return;
          o.aps.filter((q) => q.role === 'in').forEach((q) => {
            if (q.cell[0] !== dst[0] || q.cell[1] !== dst[1]) return;
            if (q.dir !== opposite(pt.dir)) return;
            edges.push({ from: b.item.id + ':' + pt.id, to: o.item.id + ':' + q.id, external: true });
          });
        });
      });
    });

    return { cells, ports, edges, built };
  }

  /* ------------------------------ 编译 ------------------------------ */

  /** 返回可直接保存 / 参与路由的 CompiledCircuit。 */
  function compile(st, unitId, placements) {
    const p = preview(st, unitId, placements);
    if (!p.ok) return { ok: false, errors: p.errors };
    const unit = st.roster.find((u) => u.id === unitId);
    return {
      ok: true,
      value: {
        unitId,
        bodyPreset: unit.bodyPreset,
        load: p.load,
        overload: p.overload || 0,
        cap: p.cap,
        occupied: p.occupied,
        placements: (placements || []).map((x) => ({
          itemId: x.itemId, x: x.x, y: x.y, rotation: x.rotation || 0, mirrorY: !!x.mirrorY,
        })),
      },
    };
  }

  /** 保存板面：几何、负荷、至少一个输出连通。失败不改 state。 */
  function saveLoadout(st, unitId, placements) {
    const unit = st.roster.find((u) => u.id === unitId);
    if (!unit) return { ok: false, errors: ['找不到角色'] };
    /* 只校验几何与负荷：不连通也能存盘。
       连通与否是玩法结果，不是保存条件——半成品板面必须能随时存下来。 */
    const p = preview(st, unitId, placements);
    if (!p.ok) return { ok: false, errors: p.errors };
    const next = V.State.clone(st);
    const u2 = next.roster.find((u) => u.id === unitId);
    u2.board.placements = (placements || []).map((x) => ({
      itemId: x.itemId, x: x.x, y: x.y, rotation: x.rotation || 0, mirrorY: !!x.mirrorY,
    }));
    return { ok: true, state: next, events: [], load: p.load, overload: p.overload, cap: p.cap };
  }

  /* 纹路贯通时蚀刻法额外乘算。工坊的「共鸣增幅」也读这个数，避免展示与结算各写一份。 */
  const ROUTE_MULT = 1.15;

  /**
   * 蚀刻法状态：覆盖率台阶 + 是否贯通 → 战斗要用的效果。
   * 覆盖率给「量」（乘算、起手能量），贯通只给额外乘算，不解锁机制——
   * 这样「只填满不管流向」也玩得下去，懂路由的人多吃一档。
   */
  function manuscriptState(st, unitId, placementsIn, msId) {
    const EMPTY = { mainMult: 1, supportMult: 1, startEnergy: 0 };
    const unit = (st.roster || []).find((u) => u.id === unitId);
    const ms = msId ? V.State.manuscriptsOf(unit).find(m => m.id === msId) : unit?.manuscript;
    if (!ms || !V.Manuscript) {
      return { ok: false, reason: '没有蚀刻法', pct: 0, tierId: null, tierName: '', routed: false, effects: EMPTY };
    }
    const plate = plateOf(unit);
    const oriented = V.Manuscript.orient(
      V.Manuscript.normalize(ms), ms.rotation || 0, !!ms.mirrorY,
    );
    const ox = ms.x || 0;
    const oy = ms.y || 0;
    if (!V.Manuscript.fits(oriented, plate.cellsList, ox, oy)) {
      return { ok: false, reason: '蚀刻法没落在板面上', pct: 0, tierId: null, tierName: '', routed: false, effects: EMPTY };
    }
    const lay = layout(st, placementsIn || unit.board.placements || []);
    const idx = V.Manuscript.pieceIndex(lay);
    const cov = V.Manuscript.coverage(oriented, ox, oy, idx);
    const rt = V.Manuscript.route(oriented, ox, oy, idx);

    /* 纹路增益按「对上的端口比例」结算：一枚纹章蹭一格只拿一份，压满才吃全额。
       portCells 只数是带开口的格——纹章内部的实心格本来就对不上任何蚀刻法格。 */
    const alignedSet = new Set(cov.alignedCells || []);
    const boost = {
      regen: 0, max: 0, skillCostCut: 0, attackMult: 0, skillMult: 0, lowHpRegen: 0,
      healMult: 0, dotMult: 0, shieldMult: 0,
    };
    ((lay && lay.built) || []).forEach((b) => {
      const bo = (b.tpl && b.tpl.boost) || {};
      const ports = new Set((b.aps || []).map((p) => p.cell.join(',')));
      if (!ports.size) return;
      let hit = 0;
      ports.forEach((key) => { if (alignedSet.has(key)) hit += 1; });
      if (!hit) return;
      const factor = Math.min(1, hit / ports.size);
      Object.keys(bo).forEach((k) => {
        if (typeof bo[k] === 'number') boost[k] = (boost[k] || 0) + bo[k] * factor;
      });
    });

    const eff = Object.assign({ mainMult: 1, supportMult: 1, startEnergy: 0 }, (cov.tier && cov.tier.effect) || {});
    eff.boost = boost;
    if (rt.ok) {
      eff.mainMult = Math.round(eff.mainMult * ROUTE_MULT * 100) / 100;
      eff.supportMult = Math.round(eff.supportMult * ROUTE_MULT * 100) / 100;
    }
    /* 负荷是价格：达到共鸣阶后，越重的蚀刻法吃得越狠（每点负荷 +3% 主修乘算） */
    const loadBonus = 1 + 0.03 * Math.max(0, (Number(ms.load) || 1) - 1);
    if (cov.tier && loadBonus > 1) eff.mainMult = Math.round(eff.mainMult * loadBonus * 100) / 100;
    eff.loadBonus = cov.tier ? Math.round(loadBonus * 100) / 100 : 1;
    return {
      ok: true,
      spec: D().manuscript(ms.id) || ms,
      pct: cov.pct,
      aligned: cov.aligned,
      total: cov.total,
      tierId: cov.tier ? cov.tier.id : null,
      tierName: cov.tier ? cov.tier.name : '',
      routed: rt.ok,
      effects: eff,
    };
  }

  /** 快速试铺一件闲置纹路，优先补齐选中拓片，其他纹路留在原位。 */
  function suggestPlacement(st, unit, draft, itemId, ms, rotation = 0, mirrorY = false) {
    const item = st.itemsById[itemId];
    if (item?.kind !== 'circuit' || draft.some(p => p.itemId === itemId)) return null;
    const plate = plateOf(unit);
    const used = new Set(layout(st, draft).cells.map(c => c.x + ',' + c.y));
    const target = ms?.fits ? ms : null;
    const previewState = { ...st, roster: [unit] };
    let best = null;
    let bestAligned = -1;
    for (const mirror of [mirrorY, !mirrorY]) {
      for (let turn = 0; turn < 4; turn++) {
        const rot = (rotation + turn) % 4;
        const shape = transformTemplate(D().template(item.templateId), rot, mirror);
        for (let y = 0; y < plate.size; y++) {
          for (let x = 0; x < plate.size; x++) {
            const legal = shape.cells.every(c => {
              const key = (c.x + x) + ',' + (c.y + y);
              return plate.cells.has(key) && !used.has(key);
            });
            if (!legal) continue;
            const pose = { itemId, x, y, rotation: rot, mirrorY: mirror };
            const aligned = target ? V.Manuscript.coverage(target.oriented, target.ox, target.oy,
              V.Manuscript.pieceIndex(layout(st, [pose]))).aligned : 0;
            if (aligned <= bestAligned || !preview(previewState, unit.id, [...draft, pose]).ok) continue;
            best = pose;
            bestAligned = aligned;
            if (!target || aligned === Math.min(shape.cells.length, target.oriented.cells.length)) return best;
          }
        }
      }
    }
    return best;
  }

  V.Circuit = {
    ROUTE_MULT, plateOf, loadCap, scarState, manuscriptState, suggestPlacement,
    opposite, rotateDir, flipNS, transformTemplate, preview, compile, saveLoadout, layout,
  };
})(globalThis.Ashen ||= {});
