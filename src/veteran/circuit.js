'use strict';
/* 生命金属回路：4x4 几何、90 度旋转 / 上下翻转、有向端口图编译、余裕贯通。
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
   * - 底盘带金属相 → 用 PlateGen 读取固定板面、心核与锚点；
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
        clockCore: [],
        innateNodes: [],
      };
    }
    /* 形态挂在底盘上（14 种）；格数统一 77，由 PlateGen 的 PLATE_TARGET 决定 */
    const archetype = body && body.archetype;
    if (archetype && V.PlateGen) {
      const gen = V.PlateGen.generate({
        archetype,
      });
      return {
        cells: new Set(gen.cells.map((c) => c[0] + ',' + c[1])),
        cellsList: gen.cells,
        size: V.PlateGen.SIZE,
        generated: true,
        archetype: gen.archetype,
        clockCore: gen.clockCore || [],
        innateNodes: gen.innateNodes || [],
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
      size, generated: false, clockCore: [], innateNodes: [],
    };
  }

  /**
   * preview(st, unitId, placements) -> {ok, errors, occupied, load, overload, cap}
   * 同一函数供 UI 预览与真实保存使用；非法时 state 不变（本函数不写 state）。
   */
  /** 装配上限由板面格数派生：格子越多，能压的东西越多。
      两套板面两套系数——经典 4×4 夹具沿用 0.57（14 格 → 8 点），
      异形生成板面用 generatedCapPerCell（77 格 → 20 点）。理由见 data.js 的 DESIGN 注释。
      @param {object} unit @returns {number} */
  function loadCap(unit) {
    const plate = plateOf(unit);
    const perCell = plate.generated
      ? (D().DESIGN.generatedCapPerCell == null ? 0.72 : D().DESIGN.generatedCapPerCell)
      : D().DESIGN.capPerCell;
    const base = V.Derive.loadCap(plate.cells.size, perCell);
    if (plate.archetype === 'hundun') return base + 12;
    return !plate.generated && D().body(unit?.bodyPreset)?.innate?.id === 'sturdy' ? Math.round(base * 1.35) : base;
  }

  /**
   * 瘢痕减免：长进活金属里的纹不需要「维持」。
   * 一件纹路压住几处**激活**瘢痕，就从它的负荷里扣几点（扣到 0 为止）。
   *
   * 粒度对得上数据：`Expedition.inscriptionScar` 每次营火烙印只留 **1 处**瘢痕
   * （取该件纹路第一个未被占用的格），所以「一处 = 1 点」，不会出现一格减两点、
   * 也不会出现一件纹路凭空多减。减免只挂在纹路上，不挂在蚀刻法上——
   * 蚀刻法是蚀刻法，本来就不参与「肉身之纹」这本账。
   *
   * @param {{x:number,y:number}[]} cells 已摆放纹路的绝对格坐标
   * @param {Set<string>} scarCells
   * @param {number} cap 这件纹路本身的负荷（减免不超过它，避免负负荷）
   * @returns {number} 该件纹路能扣掉的点数
   */
  function scarRelief(cells, scarCells, cap) {
    if (!scarCells || !scarCells.size) return 0;
    let hit = 0;
    for (const c of cells) if (scarCells.has(c.x + ',' + c.y)) hit += 1;
    const limit = Number.isFinite(cap) ? cap : hit;
    return Math.max(0, Math.min(hit, limit));
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

    /* 蚀刻法是蚀刻法：必须落在金属上，纹路可在同格填入纹路。 */
    const etchings = V.State.manuscriptsOf(unit);
    const stencilCells = new Set();
    for (const ms of etchings) {
      const cells = V.State.manuscriptCells(ms).map(cell => cell.join(','));
      if (!cells.length || cells.some(cell => !plate.cells.has(cell))) errors.push(`蚀刻法「${ms.name}」没有完整落在板面上`);
      if (cells.some(cell => stencilCells.has(cell))) errors.push(`蚀刻法「${ms.name}」与另一门蚀刻法重叠`);
      cells.forEach(cell => stencilCells.add(cell));
    }

    /* 不传 placements 时回落到「场上布局 → 板面布局」，和 manuscriptState 同口径。
       传 [] 仍然是「空板面」（那是明确意图），所以只在 undefined 时回落。 */
    const list = placements
      || (st.run && st.run.fieldLayouts && st.run.fieldLayouts[unitId])
      || unit.board.placements
      || [];
    const seenItems = new Set();
    const occupied = [];
    const cellOwner = new Map(); // 'x,y' -> itemId
    const built = [];
    let load = 0;
    let scarSaved = 0;
    let bagError = null;

    /* 已长进肉里的瘢痕：这些格子上的纹路不必再「维持」，按处减免负荷 */
    const scarCells = new Set((unit.scars || []).map((s) => s.x + ',' + s.y));

    list.forEach((p) => {
      const item = st.itemsById[p.itemId];
      if (!item) { errors.push(`纹路不存在：${p.itemId}`); return; }
      if (item.kind !== 'circuit') { errors.push(`不是纹路：${p.itemId}`); return; }
      if (seenItems.has(p.itemId)) { errors.push(`同一纹路被放置两次：${p.itemId}`); return; }
      seenItems.add(p.itemId);

      const tpl = D().template(item.templateId);
      const tf = transformTemplate(tpl, p.rotation || 0, !!p.mirrorY);

      const cells = tf.cells.map((c) => ({ x: c.x + p.x, y: c.y + p.y }));
      /* 瘢痕减免：压住几处激活瘢痕就扣几点，扣到 0 为止（不会变成负负荷） */
      const relief = scarRelief(cells, scarCells, tpl.load);
      scarSaved += relief;
      load += Math.max(0, tpl.load - relief);

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
      built.push({ itemId: item.id, templateId: item.templateId, tpl, x: p.x, y: p.y, rotation: p.rotation || 0, mirrorY: !!p.mirrorY, cells, ports, relief });
    });

    /* 蚀刻法也吃负荷：多修一套就少放纹路，这是唯一的平衡阀。
       九标：单门超过 34 格的部分按比例免负荷（自承重），否则大卷「占满板面还收全额学费」。 */
    for (const ms of etchings) {
      const l = Number(ms.load) || 0;
      const n = V.State.manuscriptCells(ms).length;
      load += n > PULSE.manuscriptCellCap
        ? Math.max(1, Math.round((l * PULSE.manuscriptCellCap) / n))
        : l;
    }
    /* 异形板面格数多，负荷上限单独给；经典模式沿用老值 */
    const cap = loadCap(unit);
    /* 超载不再阻止装配：超出部分转成开局压力与回裕惩罚，玩家自己决定值不值 */
    const overload = Math.max(0, load - cap);

    if (errors.length) {
      return { ok: false, errors, occupied, load, overload, cap, scarSaved };
    }

    return { ok: true, errors: [], occupied, load, overload, cap, scarSaved, bagError };
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

  /* ---------------------------- 起手通路 ---------------------------- */

  /**
   * 给一门蚀刻法铺一条**接通的起手通路**。
   *
   * 为什么要有它：骨架从 2~14 格扩到 6~54 格之后，`PRESETS.basic` 那种
   * 「固定坐标摆几件」的起手板面必然接不通 —— 玩家开局第一眼看到的是「有板面但没有脉冲」。
   * 这里沿蚀刻法自己的格走一条从 entry 到 exit 的最短路，每格放一件**单格双向**纹路
   * （rivet / jack / flint / pinValve），按「来向的反面 + 出向 + 起终点刻线」挑姿态。
   *
   * 只做单格件，不串联 `long / elbow` 这类多格中继 —— 那是模拟器布线器（更重）的活。
   * @returns {Array|null} placements，失败返回 null
   */
  function autoLoadout(st, unit) {
    if (!V.Manuscript) return null;
    const plate = plateOf(unit);
    for (const ms of V.State.manuscriptsOf(unit)) {
      const oriented = V.Manuscript.orient(V.Manuscript.normalize(ms), ms.rotation || 0, !!ms.mirrorY);
      const ox = ms.x || 0;
      const oy = ms.y || 0;
      if (!oriented || !V.Manuscript.fits(oriented, plate.cellsList, ox, oy)) continue;
      const cells = new Set(oriented.cells.map(([x, y]) => `${x + ox},${y + oy}`));
      const plan = startingRoute(oriented, ox, oy, cells);
      if (!plan) continue;
      return plan.map(({ id, rot, mir, x, y }) => {
        const part = V.State.makePart(st, { kind: 'circuit', templateId: id });
        st.itemsById[part.id] = part;
        return { itemId: part.id, x, y, rotation: rot, mirrorY: mir };
      });
    }
    return null;
  }

  function startingRoute(oriented, ox, oy, cells) {
    const key = (x, y) => x + ',' + y;
    const entry = key(oriented.entry[0] + ox, oriented.entry[1] + oy);
    const exits = new Set(oriented.exits.map((c) => key(c[0] + ox, c[1] + oy)));
    if (!cells.has(entry) || exits.has(entry)) return null;
    const veinsOf = (k) => {
      const [x, y] = k.split(',').map(Number);
      return oriented.veins[key(x - ox, y - oy)] || [];
    };

    /* ① 从 entry 到最近 exit 的最短路（只在膜内走） */
    const ORTH = V.Manuscript.ORTH;
    const parent = new Map([[entry, null]]);
    const queue = [entry];
    let hit = null;
    while (queue.length && !hit) {
      const cur = queue.shift();
      if (exits.has(cur) && cur !== entry) { hit = cur; break; }
      const [x, y] = cur.split(',').map(Number);
      Object.keys(ORTH).forEach((d) => {
        const nk = key(x + ORTH[d][0], y + ORTH[d][1]);
        if (!cells.has(nk) || parent.has(nk)) return;
        parent.set(nk, cur);
        queue.push(nk);
      });
    }
    if (!hit) return null;
    const path = [];
    for (let cur = hit; cur != null; cur = parent.get(cur)) path.push(cur);
    path.reverse();
    if (path[0] !== entry || path.length < 2) return null;

    /* ② 逐格挑件：必需方向 = 来向的反面 + 出向 +（起终点）刻线 */
    const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
    const dirOf = (from, to) => {
      const [x1, y1] = from.split(',').map(Number);
      const [x2, y2] = to.split(',').map(Number);
      return Object.keys(ORTH).find((d) => x1 + ORTH[d][0] === x2 && y1 + ORTH[d][1] === y2);
    };
    const TILES = ['rivet', 'jack', 'flint', 'pinValve'];
    const placements = [];

    for (let i = 0; i < path.length; i += 1) {
      const cur = path[i];
      const [cx, cy] = cur.split(',').map(Number);
      const need = new Set();
      if (path[i - 1]) need.add(OPP[dirOf(path[i - 1], cur)]);
      if (path[i + 1]) need.add(dirOf(cur, path[i + 1]));
      if (i === 0 || i === path.length - 1) veinsOf(cur).forEach((d) => need.add(d));

      let chosen = null;
      for (const id of TILES) {
        const tpl = D().template(id);
        if (!tpl) continue;
        for (let rot = 0; rot < 4 && !chosen; rot += 1) {
          for (const mir of [false, true]) {
            const tf = transformTemplate(tpl, rot, mir);
            if (tf.cells.length !== 1) continue;
            const dirs = new Set(tf.ports
              .filter((pt) => pt.cell[0] === 0 && pt.cell[1] === 0)
              .map((pt) => pt.dir));
            if (![...need].every((d) => dirs.has(d))) continue;
            chosen = { id, rot, mir };
            break;
          }
        }
        if (chosen) break;
      }
      if (!chosen) return null;
      placements.push({ ...chosen, x: cx, y: cy });
    }
    return placements;
  }

  /* ------------------------------ 编译 ------------------------------ */

  /**
   * 返回可直接保存 / 参与贯通的 CompiledCircuit。
   *
   * v4.0 起它不只是几何编译，而是**战斗面板的唯一来源**：
   *   value.panel  结构完整度 / 脉冲幅值 / 回路阻抗 / 电容缓冲 / 心核节拍
   *   value.pulse  每门已装配蚀刻法的路径拓扑特征（直导格数、转弯数、分流、闭环…）
   * 上层（roster / combat / ui）一律读这两个，不再自己拍面板。
   */
  function compile(st, unitId, placements) {
    const p = preview(st, unitId, placements);
    if (!p.ok) return { ok: false, errors: p.errors };
    const unit = st.roster.find((u) => u.id === unitId);
    const list = placements || st.run?.fieldLayouts?.[unitId] || unit.board.placements || [];
    const lay = layout(st, list);
    const plate = plateOf(unit);
    const states = V.State.manuscriptsOf(unit).map((m) => manuscriptState(st, unitId, list, m.id));
    const panel = panelOf(st, unit, list, p, { plate, lay, states });
    const pulse = Object.fromEntries(states.filter((state) => state.ok).map((state) => [state.spec.id, state.pulse]));
    const anchors = new Set(plate.innateNodes.map(String));
    const protectedNodes = plate.archetype === 'zhibi'
      ? lay.built.filter((b) => b.abs.some(({x, y}) => anchors.has(`${x},${y}`))).map((b) => b.item.id)
      : [];
    return {
      ok: true,
      value: {
        unitId,
        bodyPreset: unit.bodyPreset,
        load: p.load,
        overload: p.overload || 0,
        cap: p.cap,
        scarSaved: p.scarSaved || 0,
        occupied: p.occupied,
        panel,
        pulse,
        protectedNodes,
        placements: list.map((x) => ({
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

  /* ------------------------------ 拓扑脉冲编译（v4.0） ------------------------------ */

  /* 六族纹路对脉冲的作用。数值集中在这里，改平衡只动这一块。
     之所以按「家族」而不是按模板 id 写：30 种纹路是 6 种电路元件的变体，
     直导系多一格少一格，不该改公式，只该改它有几格。 */
  const PULSE = {
    straight:   { interval: 0.03, cap: 0.20 },  // 每格直导：出招间隔 −3%，上限 −20%
    turn:       0.12,                            // 每次 90° 转折：幅值 +12%
    /* 六标：骨架扩到 6~54 格之后，通路能到二十几格，转角跟着涨到二十几次 ——
       直导有 −20% 的封顶、转角却没有，于是「弯折流」的幅值能到 ×5.4。
       补一个对称的封顶：最多计 8 次转折（+96%），回钩另算。
       七标：8 → 6（+72%）。8 次转折时弯折流在 F1 就能一回合清场，
       那不是「路线好」而是「倍率溢出」；6 次仍然明显强于直导（+72% vs −20%），
       但配上储能放电与回钩，它得靠**摆法**而不是靠**格子数**取胜。 */
    turnCap:    6,
    hairpin:    0.20,                            // 回钩 180° 折返：再 +20%
    split:      0.65,                            // 分流：单股拆多路，按 0.65 摊
    resonant:   1.45,                            // 下游重新汇合出闭环：谐振干涉
    capToShield: 0.20,                           // 储能：截留 20% 充进缓冲（八标：30% 让「有储能就免疫」）
    overload:   1.85,                            // 缓冲满溢后的过载放电（2.5 → 1.85：满仓一发太碾压）
    gate:       1.45,                            // 闸门：高热或有缓冲时放大（1.65 → 1.45）
    emberStress: 3,                              // 余烬：高压时泄 3 点压力
    emberCharge: 6,                              // 余烬：低压时反而蓄 6 点压力（八标：+3 进不了高热区）
    emberHot:   65,                              // 温控分界：低于它积蓄
    emberVent:  85,                              // 高于它泄压
    straightDodge: 0.015,                        // 每格直导额外 +1.5% 闪避
    straightDodgeCap: 0.12,                      // 上限 +12%
    emberPerStress: 0.005,                       // 余烬：每点压力转 +0.5% 幅值
    emberAmpCap:  0.55,                          // 余烬的压力增幅封顶（九标：转角延迟同时拖慢了 C，用增幅补回来）
    /* 八标：余烬单位带着炉温入场。
       起手余裕砍到 1/5、普攻节奏拉到 1.1s 之后，一场只有 ~7 次脉冲，
       `+6/次` 最快也要第 11 次命中才进 65 压的死区 —— 余烬的整条温控
       （泄压、砺、满压熔毁）实际全是死代码。把「起手压力」当成余烬的第三个参数：
       F49 高热覆盖 15.3% → 53.6%，而 A/B 没有余烬通路，数值一个字不动。 */
    emberWarm:   45,                             // 余烬：入场炉温（单位只在通路穿过余烬件时才吃）
    /* 六标：蚀刻法从 2~14 格扩到 6~54 格，满配占格从 ~20 升到 ~55，
       每格系数必须同步下调，否则完整度会翻到 200+。1.15 让满铺落在 60~100。 */
    hpPerCell:  1.15,
    /* 八标：闭环不再无上限堆血。满板 13 个闭环在旧口径下贡献 156 完整度（占面板 58%），
       于是「血最厚的那个」永远是最优解，而不是「路线最好的那个」。
       现在最多只认 3 个主环路：+18 完整度封顶；剩下的拓扑价值转去脉冲乘区（loopAmp）。 */
    hpPerLoop:  6,
    loopHpCap:  3,                               // 完整度只认前 3 个闭环
    loopAmp:    0.04,                            // 每个闭环 +4% 脉冲幅值
    loopAmpCap: 4,                               // 最多计 4 环 → +16%
    /* 九标 · A 流派的防御出口：直导通路每 2 格给 1 点「动能缓冲」，上限独立于储能系。
       直导是靠出手次数吃饭的流派，本身没有储能纹路 → shieldCap 恒为 0，
       在高强度层域里是纯玻璃炮。让它把「打得快」换成一层自维持的薄盾。 */
    kineticPerTwoCells: 1,                       // 每 2 格直导 +1 动能缓冲
    kineticCapCells: 2,                          // 上限 = 直导格 × 2
    kineticCapHard: 18,                          // 硬上限 18 点
    /* 九标 · B 流派的代价：信号过 90° 弯折要吃传输时间。
       每 1 次转角 +4% 出手间隔（上限 +24%）。24 转角的线圈炮从 0.86s 拉到 ~1.05s，
       单发爆发不动，持续 DPS 掉 20%~25%。 */
    turnDelay: 0.04,
    turnDelayCap: 0.24,
    /* 九标 · 大卷自承重：单门蚀刻法参与完整度/负荷计算的有效占格封顶 34 格。 */
    manuscriptCellCap: 34,
    defCoverage: 20,                             // 满覆盖 → 阻抗 +20
    /* 八标：软底 30 → 70 且拦截率硬封顶 45%。
       30 的曲线上，def 55 能拦 65%，叠上「先乘一次、结算再乘一次」的两次口径，
       敌人重击透进来只剩一成 —— 熔断阈值（8% 完整度）永远够不到，保险丝整条是死的。
       70 + 0.45 封顶之后，透进来的那一发才够踩到 6~9 点的熔断线。 */
    defBase:    70,                              // 阻抗拦截公式的软底
    defCap:     0.45,                            // 单次阻抗拦截率上限
    capShieldPerCell: 5,
    shieldCapPct: 0.45,                          // 缓冲上限同时不超过完整度的 45%
    /* 熔断阈值：单次穿透伤害要同时越过「绝对下限」与「完整度的百分比」才烧保险丝。
       八标第一版只挂 8%，完整度降到 86 之后门槛只有 7 点，敌方每一次普攻都够 ——
       A 流派一场被烧掉 7 个节点，整块板被自己的保险丝拆光（熔断 7.03/人）。
       绝对值下限是「这一下到底算不算重击」的判据，百分比负责让它跟着体型放大。 */
    fuseFloor:  36,                              // 绝对下限：低于它的直击不算重击
    fusePct:    0.08,                            // 相对下限：完整度的 8%
    capacitorDef: 2,                             // 储能系每格额外阻抗
    gateDef: 3,                                  // 闸系每格额外阻抗
  };

  const PULSE_FAMILY = {};
  ['straight', 'long', 'rail', 'rivet'].forEach((id) => { PULSE_FAMILY[id] = 'straight'; });
  ['elbow', 'dogleg', 'hairpin', 'kneejoint', 'crook', 'jack'].forEach((id) => { PULSE_FAMILY[id] = 'elbow'; });
  ['splitter', 'tee', 'cross', 'clevis', 'spillway', 'wishbone'].forEach((id) => { PULSE_FAMILY[id] = 'splitter'; });
  ['capacitor', 'bellowsCell', 'coil', 'cistern', 'ampoule'].forEach((id) => { PULSE_FAMILY[id] = 'capacitor'; });
  ['threshold', 'pinValve', 'sluice', 'reed'].forEach((id) => { PULSE_FAMILY[id] = 'threshold'; });
  ['ember', 'flint', 'fuse', 'brazier', 'wickbend'].forEach((id) => { PULSE_FAMILY[id] = 'ember'; });

  function familyOf(tpl) {
    if (!tpl) return 'other';
    return tpl.family || PULSE_FAMILY[tpl.id] || 'other';
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  /* 闪避按 1.5%/格 走，两位小数会把 0.015 抹成 0.02 —— 单独给一个三位口径 */
  const r3 = (v) => Math.round(v * 1000) / 1000;

  function nodesConnected(starts, terminals, dirs) {
    const remaining = new Set(terminals);
    const seen = new Set(starts);
    const queue = [...seen];
    for (const cell of queue) {
      if (remaining.delete(cell)) {
        if (!remaining.size) return true;
        continue;
      }
      const [x, y] = cell.split(',').map(Number);
      for (const dir of dirs.get(cell) || []) {
        const [dx, dy] = DIRS[dir];
        const next = `${x + dx},${y + dy}`;
        if (seen.has(next) || !dirs.get(next)?.includes(opposite(dir))) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  }

  /**
   * 沿一条贯通路径数拓扑特征。
   * `path` 来自 Manuscript.route 的父指针回溯 —— 是**唯一那条路**，
   * 不是 visited 集合；用集合数转弯会把岔路的拐角也算进来。
   */
  function pulseOf(lay, rt, plate, idx) {
    const owner = new Map();
    ((lay && lay.built) || []).forEach((b) => {
      (b.abs || []).forEach((c) => owner.set(c.x + ',' + c.y, b));
    });
    const path = (rt && rt.path) || [];
    const archetype = plate?.archetype;
    const anchorKeys = (plate?.innateNodes || []).map(String);
    const anchors = new Set(anchorKeys);
    const activeNodes = new Set();
    let straight = 0;
    let turns = 0;
    let capacitors = 0;
    let split = false;
    let gate = false;
    let ember = false;
    let hairpin = false;
    let elbowTurns = 0;
    let straightCapBonus = 0;
    let anchorTurns = 0;
    let cleanSplit = false;
    let gateBonus = 0;
    let shieldScale = 1;
    let prevDir = null;

    path.forEach((k, i) => {
      const tpl = owner.get(k)?.tpl;
      const fam = familyOf(tpl);
      if (fam === 'straight') straight += 1;
      if (fam === 'capacitor') capacitors += 1;
      if (fam === 'splitter') split = true;
      if (fam === 'threshold') gate = true;
      if (fam === 'ember') ember = true;
      if (tpl && tpl.id === 'hairpin') hairpin = true;
      if (anchors.has(k)) {
        if (archetype === 'xianghu' && fam === 'straight') {
          straightCapBonus = .08;
          activeNodes.add(k);
        }
        if ((archetype === 'zaohuyou' || archetype === 'sida') && fam === 'splitter') {
          cleanSplit = true;
          activeNodes.add(k);
        }
        if (archetype === 'sida' && fam === 'threshold') {
          gateBonus = .15;
          activeNodes.add(k);
        }
        if (archetype === 'jiuceng' && fam === 'capacitor') {
          const [x, y] = k.split(',').map(Number);
          const across = `${x},${y - 1}`;
          if ((path[i - 1] === across || path[i + 1] === across) && owner.get(across) === owner.get(k)) {
            shieldScale = 1.25;
            activeNodes.add(k);
          }
        }
      }
      if (i > 0) {
        const [x, y] = k.split(',').map(Number);
        const [px, py] = path[i - 1].split(',').map(Number);
        const dir = (x - px) + ',' + (y - py);
        if (prevDir !== null && dir !== prevDir) {
          turns += 1;
          /* 九标：只有**弯折件**上的转向才是「物理延时的来源」。
             余烬/闸系/直导件上的折角是同一枚元件内的走向，不该额外罚。
             这样 24 转角的线圈炮吃满延迟，9 转角的余烬流不会被连带拖死。 */
          if (fam === 'elbow') elbowTurns += 1;
          const bend = path[i - 1];
          if (archetype === 'suhui' && anchors.has(bend) && familyOf(owner.get(bend)?.tpl) === 'elbow') {
            anchorTurns += 1;
            activeNodes.add(bend);
          }
        }
        prevDir = dir;
      }
    });

    const onPath = anchorKeys.filter((k) => path.includes(k));
    let wallCells = 0;
    if (archetype === 'jiansui' && onPath.length) {
      wallCells = path.filter((cell) => {
        const [x, y] = cell.split(',').map(Number);
        return ((y === 3 || y === 8) && x >= 4 && x <= 7)
          || ((x === 3 || x === 8) && y >= 4 && y <= 7);
      }).length;
      if (wallCells) onPath.forEach((k) => activeNodes.add(k));
    }
    // 玄璜的两端可通过蚀刻法外的纹路接入同一条贯通线路。
    const dotStacks = archetype === 'xuanhuang' && anchorKeys.length >= 2 && path.length
      && nodesConnected(path, anchorKeys, (idx || V.Manuscript.pieceIndex(lay)).dirs) ? 2 : 1;
    const waistPressure = archetype === 'chuyao' && onPath.length ? 10 : 0;
    const twinShield = archetype === 'bingdi' && plate.clockCore.length === 2 && onPath.some((k) =>
      nodesConnected([k], plate.clockCore.map(String), (idx || V.Manuscript.pieceIndex(lay)).dirs)) ? 6 : 0;
    if (dotStacks > 1) anchorKeys.forEach((k) => activeNodes.add(k));
    if (waistPressure || twinShield) onPath.forEach((k) => activeNodes.add(k));

    /* 九标：直导缩间隔、弯折算延迟 —— 两个方向都写进同一个 intervalScale */
    const turnDelay = Math.min(PULSE.turnDelayCap, elbowTurns * PULSE.turnDelay);
    const intervalScale = 1 - Math.min(PULSE.straight.cap + straightCapBonus, straight * PULSE.straight.interval) + turnDelay;
    /* 八标：闭环的拓扑价值从「堆血」搬回「进攻」。
       完整度那边只认 3 个闭环（见 panelOf），这里把多出来的环路兑现成幅值：
       每环 +4%，最多计 4 环（+16%）。与弯折、分流各自独立乘区，互不冲抵。 */
    const loopCount = countLoops(lay);
    const loopAmp = 1 + Math.min(PULSE.loopAmpCap, loopCount) * PULSE.loopAmp;
    const turnAmp = 1 + Math.min(PULSE.turnCap, turns) * PULSE.turn + (hairpin ? PULSE.hairpin : 0);
    const splitAmp = split ? (rt?.looped ? PULSE.resonant : PULSE.split) : 1;
    const anchorAmp = (1 + .10 * anchorTurns / turnAmp) * (1 + .04 * wallCells)
      * (cleanSplit && !rt?.looped ? 1 / PULSE.split : 1);
    const ampMult = turnAmp * splitAmp * loopAmp * anchorAmp;
    /* 直导总线的机动性：每格直导顺带 +2% 闪避（上限 +16%）。
       这条是给「高频直导」补的生存位 —— 它输出靠出手次数，长线战斗里最缺的就是不挨打。 */
    const dodgeBonus = Math.min(PULSE.straightDodgeCap, straight * PULSE.straightDodge);

    return {
      path,
      straight,
      turns,
      elbowTurns,
      hairpin,
      split,
      looped: !!(rt && rt.looped),
      capacitors,
      gate,
      ember,
      intervalScale: r2(Math.max(0.5, intervalScale)),
      ampMult: r2(ampMult),
      dodgeBonus: r3(dodgeBonus),
      activeNodes: [...activeNodes],
      anchorAmp,
      cleanSplit,
      gateBonus,
      shieldScale,
      twinShield,
      dotStacks,
      waistPressure,
    };
  }

  /** 闭环数：并查集数「接上就成环」的边。整块板的连通图共用一套。 */
  function countLoops(lay) {
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) != null && parent.get(r) !== r) r = parent.get(r);
      parent.set(x, r);
      return r;
    };
    let loops = 0;
    ((lay && lay.edges) || []).forEach((e) => {
      if (parent.get(e.from) == null) parent.set(e.from, e.from);
      if (parent.get(e.to) == null) parent.set(e.to, e.to);
      const a = find(e.from);
      const b = find(e.to);
      if (a === b) loops += 1;
      else parent.set(a, b);
    });
    return loops;
  }

  /**
   * 战斗面板：从拓扑编译，不读任何「攻防血权重」。
   * 唯一进入公式的装配事实是：占了几格、成没成环、用了几个储能/闸系元件、主修覆盖多少。
   */
  function panelOf(st, unit, placements, p, compiled) {
    /* 和 preview 同口径：没传就是「场上布局 → 板面布局」，不是空板面 */
    const list = placements
      || (st.run && st.run.fieldLayouts && st.run.fieldLayouts[unit.id])
      || unit.board.placements
      || [];
    const lay = compiled?.lay || layout(st, list);
    const plate = compiled?.plate || plateOf(unit);
    const occupied = new Set(((p && p.occupied) || []).map(String));
    const used = occupied.size;
    const occupiedAnchors = plate.innateNodes.filter((c) => occupied.has(String(c))).length;
    const edgeAnchors = plate.archetype === 'dibuman' ? occupiedAnchors : 0;
    const loops = countLoops(lay);
    let caps = 0;
    let gates = 0;
    ((lay && lay.built) || []).forEach((b) => {
      const fam = familyOf(b.tpl);
      const n = (b.abs || []).length;
      if (fam === 'capacitor') caps += n;
      if (fam === 'threshold') gates += n;
    });
    const etchings = V.State.manuscriptsOf(unit);
    const states = compiled?.states || etchings.map((m) => manuscriptState(st, unit.id, list, m.id));
    const ms = states[0];
    const coverage = ms && ms.ok ? ms.pct : 0;
    const ch = V.Derive.chassis(D().body(unit.bodyPreset));
    /* 八标：完整度只认前 3 个闭环（+18 封顶）。
       旧口径 13 环能堆出 270 完整度，四名 A 流派合计 1140，而 F49 敌方三人只有 443 ——
       敌人还没轮到第二次脉动就被清完，靠「敌人出手」成立的熔断与打断全部空转。 */
    /* 九标：蚀刻法骨架的「有效占格」计入完整度，但单门封顶 34 格。
       R5~R7 的大卷占 32~54 格、负荷 11~12 点，却一格完整度都不给 —— 这是它们
       在后期章节压不出面板的直接原因（manuscript-growth 只剩第 1、4 章能赢）。
       超出 34 格的部分当作「自承重超导框架」：不再增加完整度，也不再按格计费。 */
    const msCells = etchings.reduce((a, m) => a + V.State.manuscriptCells(m).length, 0);
    const msEff = etchings.reduce((a, m) => a + Math.min(V.State.manuscriptCells(m).length, PULSE.manuscriptCellCap), 0);
    const effectiveCells = used + msEff;
    const maxHp = 25 + Math.round(effectiveCells * PULSE.hpPerCell)
      + Math.min(loops, PULSE.loopHpCap) * PULSE.hpPerLoop + edgeAnchors * 3;
    /* 八标：缓冲池双封顶 —— 每格 5 点，且不超过完整度的 45%。
       单靠「每格 6 点」时 B 流派能攒出 108 点盾，受击还现充 30%，
       一场 10 回合的战斗吃满 18 次攻击只掉 13 点完整度。 */
    const shieldScale = states.some((state) => state.pulse?.shieldScale === 1.25) ? 1.25 : 1;
    const twinShield = Math.max(0, ...states.map((state) => state.pulse?.twinShield || 0));
    const shieldCap = Math.round(Math.min(caps * PULSE.capShieldPerCell, Math.round(maxHp * PULSE.shieldCapPct)) * shieldScale)
      + edgeAnchors * 2 + twinShield;
    return {
      maxHp,
      atk: ch.atk,
      /* 阻抗 = 覆盖度给的 + 储能/闸系元件给的 */
      def: Math.round((coverage / 100) * PULSE.defCoverage) + caps * PULSE.capacitorDef + gates * PULSE.gateDef
        + (plate.archetype === 'xuanzhen' ? occupiedAnchors * 6 : 0),
      shieldCap,
      twinShield,
      spd: ch.spd,
      loops,
      usedCells: used,
      manuscriptCells: msCells,
      manuscriptEffectiveCells: msEff,
      effectiveCells,
      coverage,
      caps,
      gates,
    };
  }

  /**
   * 蚀刻法状态：覆盖率台阶 + 是否贯通 → 战斗要用的效果。
   * 覆盖率给「量」（乘算、起手余裕），贯通只给额外乘算，不解锁机制——
   * 这样「只填满不管流向」也玩得下去，懂贯通的人多吃一档。
   */
  function manuscriptState(st, unitId, placementsIn, msId) {
    const EMPTY = { mainMult: 1, supportMult: 1, startEnergy: 0 };
    const DEAD_PULSE = { path: [], straight: 0, turns: 0, hairpin: false, split: false, looped: false, capacitors: 0, gate: false, ember: false, intervalScale: 1, ampMult: 1, dodgeBonus: 0 };
    const DEAD = { ok: false, pct: 0, tierId: null, tierName: '', tierIndex: 0, routed: false, reachLen: 0, pulse: DEAD_PULSE, effects: EMPTY };
    const unit = (st.roster || []).find((u) => u.id === unitId);
    const ms = msId ? V.State.manuscriptsOf(unit).find(m => m.id === msId) : unit?.manuscript;
    if (!ms || !V.Manuscript) {
      return { ...DEAD, reason: '没有蚀刻法' };
    }
    const plate = plateOf(unit);
    const oriented = V.Manuscript.orient(
      V.Manuscript.normalize(ms), ms.rotation || 0, !!ms.mirrorY,
    );
    const ox = ms.x || 0;
    const oy = ms.y || 0;
    if (!V.Manuscript.fits(oriented, plate.cellsList, ox, oy)) {
      return { ...DEAD, reason: '蚀刻法没落在板面上' };
    }
    const lay = layout(st, placementsIn || unit.board.placements || []);
    const idx = V.Manuscript.pieceIndex(lay);
    const cov = V.Manuscript.coverage(oriented, ox, oy, idx);
    const rt = V.Manuscript.route(oriented, ox, oy, idx);
    const anchors = new Set(plate.innateNodes.map(String));

    /* 纹路增益按「对上的端口比例」结算：一枚纹路蹭一格只拿一份，压满才吃全额。
       portCells 只数是带开口的格——纹路内部的实心格本来就对不上任何蚀刻法格。 */
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
      const onTooth = plate.archetype === 'lunya' && b.abs.length <= 2 && b.abs.some((c) => anchors.has(`${c.x},${c.y}`));
      const factor = Math.min(1, hit / ports.size) * (onTooth ? 2 : 1);
      Object.keys(bo).forEach((k) => {
        if (typeof bo[k] === 'number') boost[k] = (boost[k] || 0) + bo[k] * factor;
      });
    });

    const spec = D().manuscript(ms.id) || ms;
    /* 虚室生白：凿户牖的板面只吃浅层——共鸣阶封顶在第二档。
       封顶放在**取档**这一步，而不是事后改 pct：界面显示的覆盖率仍然是真的，
       只是这一相把「深」换成了「广」（全招式消耗 −1，见 combat.js 的 innateCostCut）。 */
    const bodyInnate = unit && unit.bodyPreset && D().body(unit.bodyPreset)
      ? (D().body(unit.bodyPreset).innate || null) : null;
    const tierList = spec.tiers || [];
    const rawTierIndex = cov.tier ? tierList.findIndex((t) => t.id === cov.tier.id) : -1;
    const cappedTier = bodyInnate && bodyInnate.id === 'conduit' && rawTierIndex > 1
      ? tierList[1] : cov.tier;

    const eff = Object.assign({ mainMult: 1, supportMult: 1, startEnergy: 0 }, (cappedTier && cappedTier.effect) || {});
    eff.boost = boost;
    if (rt.ok) {
      eff.mainMult = Math.round(eff.mainMult * ROUTE_MULT * 100) / 100;
      eff.supportMult = Math.round(eff.supportMult * ROUTE_MULT * 100) / 100;
    }
    /* 负荷曾经是「价格」：每点负荷 +3% 主修乘算，等于高阶功法用收益抵掉自己的负荷成本。
       2026-11-15 删除——那条乘算让负荷越重越划算，收紧上限之后它会变成
       「装重的不亏，装轻的才亏」，与 §6.4「过用则裂」的整个方向相反。
       现在负荷是纯代价：深度与维持预算，不返利。字段保留恒为 1，老存档与界面不用改。 */
    eff.loadBonus = 1;
    /* 共鸣阶的**档位序号**：minTier 条件看的是这个数（1 = 一阶，2 = 二阶…），
       不是覆盖百分比——玩家在界面上看到的是「二阶」，那条件就该按二阶判 */
    const tierIndex = cappedTier ? tierList.findIndex((t) => t.id === cappedTier.id) + 1 : 0;
    return {
      ok: true,
      spec,
      pct: cov.pct,
      aligned: cov.aligned,
      total: cov.total,
      tierId: cappedTier ? cappedTier.id : null,
      tierName: cappedTier ? cappedTier.name : '',
      tierIndex,
      routed: rt.ok,
      /* 贯通路径的格数：周流回环（空腔喉管）按它加主修乘算 */
      reachLen: rt.ok && rt.reach ? rt.reach.length : 0,
      /* 拓扑脉冲：直导缩间隔、弯折抬幅值、分流摊开、闭环谐振 —— 全在这 */
      pulse: pulseOf(lay, rt, plate, idx),
      effects: eff,
    };
  }

  /** 快速试铺一件闲置纹路，优先补齐选中蚀刻法，其他纹路留在原位。 */
  function suggestPlacement(st, unit, draft, itemId, ms, rotation = 0, mirrorY = false) {
    const item = st.itemsById[itemId];
    if (item?.kind !== 'circuit' || draft.some(p => p.itemId === itemId)) return null;
    const plate = plateOf(unit);
    const used = new Set(layout(st, draft).cells.map(c => c.x + ',' + c.y));
    /* target 必须自己摆正：ms 记录上没有 fits 字段，以前这里恒为 null，
       于是「找位」实际是「取第一个能放下的位置」——板面一放大就彻底压不上蚀刻法。
       resolveManuscript 给的是 { spec, oriented, ox, oy }，已摆正的就直接用，
       只有传进裸 spec 时才现场 normalize + orient。 */
    const oriented = ms
      ? (ms.oriented
        || V.Manuscript.orient(
          V.Manuscript.normalize(ms.spec || ms),
          ms.rot != null ? ms.rot : (ms.rotation || 0),
          ms.mir != null ? ms.mir : !!ms.mirrorY))
      : null;
    const target = oriented
      ? { oriented, ox: ms.ox != null ? ms.ox : (ms.x || 0), oy: ms.oy != null ? ms.oy : (ms.y || 0) }
      : null;
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
    ROUTE_MULT, PULSE, plateOf, loadCap, scarState, scarRelief, manuscriptState, suggestPlacement,
    opposite, rotateDir, flipNS, transformTemplate, preview, compile, saveLoadout, layout,
    /* v4.0 拓扑编译：家族归属、路径特征、闭环计数、面板 */
    familyOf, pulseOf, countLoops, panelOf, autoLoadout,
  };
})(globalThis.Ashen ||= {});
