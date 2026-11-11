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
   * 一个单位实际能放构件的板面：{cells:Set<'x,y'>, terminals, size, generated}
   * - 底盘带 plate 配置 → 用 PlateGen 按 seed 生成异形板面，终端由板面派生；
   * - 否则退回旧的 4x4 网格（老存档 / 测试用）。
   * 这是唯一决定「哪一格能放」的地方，别处不要再写死 4。
   */
  function plateOf(unit) {
    const body = D().body(unit && unit.bodyPreset);
    /* 显式覆写优先：测试与老存档用固定几何 */
    if (unit && unit.plateOverride && Array.isArray(unit.plateOverride.cells)) {
      const cells = new Set(unit.plateOverride.cells.map((c) => c[0] + ',' + c[1]));
      return {
        cells,
        terminals: unit.plateOverride.terminals || D().TERMINALS,
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
      /* 能量经济住在功法里：四个具名点由装备的功法给，板面不再决定。
         没有功法 → 没有终端 → 板面只是一块带槽位的金属。 */
      const terminals = {};
      if (unit.manuscript && V.Manuscript) {
        const oriented = V.Manuscript.orient(
          V.Manuscript.normalize(unit.manuscript),
          unit.manuscript.rotation || 0,
          !!unit.manuscript.mirrorY,
        );
        const ox = unit.manuscript.x || 0;
        const oy = unit.manuscript.y || 0;
        const LABEL = { clock: '时钟', damage: '受击', main: '攻势', support: '守势' };
        Object.keys((oriented && oriented.io) || {}).forEach((id) => {
          const p = oriented.io[id];
          const isIn = id === 'clock' || id === 'damage';
          terminals[id] = {
            id,
            cell: [p.cell[0] + ox, p.cell[1] + oy],
            dir: p.dir,
            role: isIn ? 'in' : 'out',
            kind: isIn ? 'input' : 'output',
            name: LABEL[id] || id,
            fromManuscript: true,
          };
        });
      }
      return {
        cells: new Set(gen.cells.map((c) => c[0] + ',' + c[1])),
        terminals,
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
      terminals: D().TERMINALS, size, generated: false,
    };
  }

  /**
   * preview(st, unitId, placements) -> {ok, errors, occupied, load, graph, reachableOutputs}
   * 同一函数供 UI 预览与真实保存使用；非法时 state 不变（本函数不写 state）。
   */
  function preview(st, unitId, placements) {
    const errors = [];
    const unit = st.roster.find((u) => u.id === unitId);
    if (!unit) return { ok: false, errors: ['找不到角色'], occupied: [], load: 0, reachableOutputs: [] };
    const body = D().body(unit.bodyPreset);
    const plate = plateOf(unit);

    /* 功法自己占格：构件不许压上去 */
    const msCells = new Set();
    if (plate.generated && unit.manuscript && V.Manuscript) {
      const or = V.Manuscript.orient(
        V.Manuscript.normalize(unit.manuscript),
        unit.manuscript.rotation || 0,
        !!unit.manuscript.mirrorY,
      );
      const ox = unit.manuscript.x || 0;
      const oy = unit.manuscript.y || 0;
      if (V.Manuscript.fits(or, plate.cellsList, ox, oy)) {
        or.cells.forEach((c) => msCells.add((c[0] + ox) + ',' + (c[1] + oy)));
      } else {
        errors.push(`功法「${unit.manuscript.name || unit.manuscript.id}」没有完整落在板面上`);
      }
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
      if (!item) { errors.push(`构件不存在：${p.itemId}`); return; }
      if (item.kind !== 'circuit') { errors.push(`不是回路构件：${p.itemId}`); return; }
      if (seenItems.has(p.itemId)) { errors.push(`同一构件被放置两次：${p.itemId}`); return; }
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
        if (msCells.has(key)) {
          errors.push(`${tpl.name}（${item.id}）压在了功法上（${c.x},${c.y}）`);
        }
        if (cellOwner.has(key)) {
          const other = cellOwner.get(key);
          if (other !== item.id) errors.push(`构件 ${other} 与 ${item.id} 在 (${c.x},${c.y}) 重叠`);
        } else {
          cellOwner.set(key, item.id);
        }
        occupied.push([c.x, c.y]);
      });

      /* 回路片必须在仓库或板面里，不能是随身背包里的东西（背包只在本局可用） */
      built.push({ itemId: item.id, templateId: item.templateId, tpl, x: p.x, y: p.y, rotation: p.rotation || 0, mirrorY: !!p.mirrorY, cells, ports });
    });

    /* 功法也吃负荷：多修一套就少放构件，这是唯一的平衡阀 */
    if (unit.manuscript) {
      const msLoad = Number(unit.manuscript.load) || 0;
      load += msLoad;
    }
    /* 异形板面格数多，负荷上限单独给；经典模式沿用老值 */
    const cap = (plate.generated && body.plate && body.plate.loadCap) ? body.plate.loadCap : body.loadCap;
    if (load > cap) errors.push(`负荷 ${load} 超过 ${body.name} 上限 ${cap}`);

    if (errors.length) {
      return { ok: false, errors, occupied, load, reachableOutputs: [], graph: null };
    }

    const graph = buildGraph(st, built, plate.terminals);
    if (!graph.ok) {
      return { ok: false, errors: graph.errors, occupied, load, reachableOutputs: [], graph: null };
    }

    const reachableOutputs = graph.value.reachableOutputs;
    return {
      ok: true, errors: [], occupied, load, reachableOutputs,
      graph: graph.value, bagError,
    };
  }

  /* ------------------------------ 端口图 ------------------------------ */

  function portKey(itemId, portId) { return itemId + ':' + portId; }

  /**
   * 构造有向图：极 → 构件入口 → 内部 links → 出口 → 相邻构件入口 … → 输出极。
   * 节点使用 placementId(即 itemId)+portId，保证可序列化与稳定排序。
   */
  function buildGraph(st, built, terminalSet) {
    const errors = [];
    const nodes = new Map(); // key -> {key, kind, itemId, portId?, dir, cell, role}
    const edges = []; // {from, to}

    const terminals = terminalSet || D().TERMINALS;

    Object.values(terminals).forEach((t) => {
      nodes.set('T:' + t.id, {
        key: 'T:' + t.id, kind: 'terminal', terminal: t.id,
        dir: t.dir, cell: t.cell.slice(), role: t.role,
      });
    });

    built.forEach((b) => {
      b.ports.forEach((pt) => {
        nodes.set(portKey(b.itemId, pt.id), {
          key: portKey(b.itemId, pt.id), kind: 'port', itemId: b.itemId, portId: pt.id,
          dir: pt.dir, cell: pt.cell.slice(), role: pt.role, templateId: b.templateId,
        });
      });
      /* 内部连通：in → out（有向） */
      b.tpl.links.forEach(([from, to]) => {
        edges.push({ from: portKey(b.itemId, from), to: portKey(b.itemId, to) });
      });
    });

    /* 入口端口 ← 相邻构件出口，或 ← 输入极 */
    built.forEach((b) => {
      b.ports.filter((p) => p.role === 'in').forEach((pt) => {
        const key = portKey(b.itemId, pt.id);
        const [dx, dy] = DIRS[pt.dir];
        const srcCell = [pt.cell[0] + dx, pt.cell[1] + dy];
        let matched = false;

        Object.values(terminals).forEach((t) => {
          if (t.role !== 'in') return;
          if (t.cell[0] === pt.cell[0] && t.cell[1] === pt.cell[1] && t.dir === pt.dir) {
            edges.push({ from: 'T:' + t.id, to: key });
            matched = true;
          }
        });

        built.forEach((other) => {
          if (other.itemId === b.itemId) return;
          other.ports.filter((o) => o.role === 'out').forEach((op) => {
            if (op.cell[0] !== srcCell[0] || op.cell[1] !== srcCell[1]) return;
            if (op.dir !== opposite(pt.dir)) return;
            edges.push({ from: portKey(other.itemId, op.id), to: key });
            matched = true;
          });
        });
        void matched;
      });

      /* 出口端口 → 相邻构件入口，或 → 输出极 */
      b.ports.filter((p) => p.role === 'out').forEach((pt) => {
        const key = portKey(b.itemId, pt.id);
        const [dx, dy] = DIRS[pt.dir];
        const dstCell = [pt.cell[0] + dx, pt.cell[1] + dy];

        Object.values(terminals).forEach((t) => {
          if (t.role !== 'out') return;
          if (t.cell[0] === pt.cell[0] && t.cell[1] === pt.cell[1] && t.dir === pt.dir) {
            edges.push({ from: key, to: 'T:' + t.id });
          }
        });

        built.forEach((other) => {
          if (other.itemId === b.itemId) return;
          other.ports.filter((o) => o.role === 'in').forEach((ip) => {
            if (ip.cell[0] !== dstCell[0] || ip.cell[1] !== dstCell[1]) return;
            if (ip.dir !== opposite(pt.dir)) return;
            edges.push({ from: key, to: portKey(other.itemId, ip.id) });
          });
        });
      });
    });

    /* 去重（同一对端口可能被两条路径重复登记） */
    const seenEdge = new Set();
    const uniqEdges = [];
    edges.forEach((e) => {
      if (!nodes.has(e.from) || !nodes.has(e.to)) return;
      const k = e.from + '->' + e.to;
      if (seenEdge.has(k)) return;
      seenEdge.add(k);
      uniqEdges.push(e);
    });

    /* Kahn 拓扑排序 + 环检测 */
    const indeg = new Map();
    const outAdj = new Map();
    nodes.forEach((n) => { indeg.set(n.key, 0); outAdj.set(n.key, []); });
    uniqEdges.forEach((e) => {
      indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
      (outAdj.get(e.from) || []).push(e.to);
      if (!outAdj.has(e.from)) outAdj.set(e.from, []);
    });

    const queue = [];
    nodes.forEach((n) => { if ((indeg.get(n.key) || 0) === 0) queue.push(n.key); });
    queue.sort();
    const order = [];
    while (queue.length) {
      const k = queue.shift();
      order.push(k);
      (outAdj.get(k) || []).slice().sort().forEach((to) => {
        indeg.set(to, (indeg.get(to) || 1) - 1);
        if (indeg.get(to) === 0) { queue.push(to); queue.sort(); }
      });
    }

    const withEdges = new Set();
    uniqEdges.forEach((e) => { withEdges.add(e.from); withEdges.add(e.to); });
    const stuck = [...withEdges].filter((k) => !order.includes(k));
    if (stuck.length) {
      errors.push(`回路存在有向闭环（${stuck.slice(0, 3).join('、')}），能量会无限循环`);
    }

    if (errors.length) return { ok: false, errors };

    /* 可达输出：从输入极出发能走到的输出极 */
    const reach = new Set();
    const stack = [...order].filter((k) => k.startsWith('T:') && nodes.get(k).role === 'in');
    while (stack.length) {
      const k = stack.pop();
      if (reach.has(k)) continue;
      reach.add(k);
      (outAdj.get(k) || []).forEach((to) => { if (!reach.has(to)) stack.push(to); });
    }
    const reachableOutputs = ['main', 'support'].filter((id) => reach.has('T:' + id));

    return {
      ok: true,
      value: {
        nodes: [...nodes.values()].map((n) => ({ ...n })),
        edges: uniqEdges,
        order,
        reachableOutputs,
        reach: [...reach].sort(),
        loadedItems: built.map((b) => b.itemId),
        cells: built.reduce((acc, b) => acc.concat(b.cells.map((c) => [c.x, c.y])), []),
      },
    };
  }

  /**
   * layout(st, placements)：容错版布局，供 UI 画格子/端口/连线。
   * 不做合法性判断（非法摆放也照画），权威校验仍走 preview。
   */
  function layout(st, placements, terminalsIn) {
    const cells = [];
    const ports = [];
    const edges = [];
    const terminals = terminalsIn || D().TERMINALS;
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
        Object.values(terminals).forEach((t) => {
          if (t.role !== 'in') return;
          if (t.cell[0] === pt.cell[0] && t.cell[1] === pt.cell[1] && t.dir === pt.dir) {
            edges.push({ from: 'T:' + t.id, to: b.item.id + ':' + pt.id, terminal: true });
          }
        });
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
        Object.values(terminals).forEach((t) => {
          if (t.role !== 'out') return;
          if (t.cell[0] === pt.cell[0] && t.cell[1] === pt.cell[1] && t.dir === pt.dir) {
            edges.push({ from: b.item.id + ':' + pt.id, to: 'T:' + t.id, terminal: true });
          }
        });
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
        occupied: p.occupied,
        reachableOutputs: p.reachableOutputs,
        graph: p.graph,
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
    return { ok: true, state: next, events: [], load: p.load, reachableOutputs: p.reachableOutputs };
  }

  /**
   * 功法状态：覆盖率台阶 + 是否贯通 → 战斗要用的效果。
   * 覆盖率给「量」（乘算、起手能量），贯通只给额外乘算，不解锁机制——
   * 这样「只填满不管流向」也玩得下去，懂路由的人多吃一档。
   */
  function manuscriptState(st, unitId, placementsIn) {
    const EMPTY = { mainMult: 1, supportMult: 1, startEnergy: 0 };
    const unit = (st.roster || []).find((u) => u.id === unitId);
    if (!unit || !unit.manuscript || !V.Manuscript) {
      return { ok: false, reason: '没有功法', pct: 0, tierId: null, tierName: '', routed: false, effects: EMPTY };
    }
    const plate = plateOf(unit);
    const oriented = V.Manuscript.orient(
      V.Manuscript.normalize(unit.manuscript),
      unit.manuscript.rotation || 0,
      !!unit.manuscript.mirrorY,
    );
    const ox = unit.manuscript.x || 0;
    const oy = unit.manuscript.y || 0;
    if (!V.Manuscript.fits(oriented, plate.cellsList, ox, oy)) {
      return { ok: false, reason: '功法没落在板面上', pct: 0, tierId: null, tierName: '', routed: false, effects: EMPTY };
    }
    const lay = layout(st, placementsIn || unit.board.placements || [], plate.terminals);
    const idx = V.Manuscript.pieceIndex(lay);
    const cov = V.Manuscript.coverage(oriented, ox, oy, idx);
    const rt = V.Manuscript.route(oriented, ox, oy, idx);

    const eff = Object.assign({ mainMult: 1, supportMult: 1, startEnergy: 0 }, (cov.tier && cov.tier.effect) || {});
    if (rt.ok) {
      eff.mainMult = Math.round(eff.mainMult * 1.1 * 100) / 100;
      eff.supportMult = Math.round(eff.supportMult * 1.1 * 100) / 100;
    }
    return {
      ok: true,
      spec: unit.manuscript,
      pct: cov.pct,
      aligned: cov.aligned,
      total: cov.total,
      tierId: cov.tier ? cov.tier.id : null,
      tierName: cov.tier ? cov.tier.name : '',
      routed: rt.ok,
      effects: eff,
    };
  }

  /* ------------------------------ 能量路由 ------------------------------ */

  function token(tags) { return { tags: (tags || []).slice() }; }
  function pulse(n, tags) {
    const out = [];
    for (let i = 0; i < (n || 0); i++) out.push(token(tags));
    return out;
  }

  function emptyRuntime() {
    return { capacitors: {}, splitCursor: {}, outputs: { main: [], support: [] }, dissipated: 0 };
  }

  /**
   * route(compiled, runtime, inputs, context)
   * inputs = {clock: tokens[], damage: tokens[]}
   * context = {hpPct: 0..1}
   * 返回 {runtime, events}；不修改入参。
   */
  function route(compiled, runtime, inputs, context) {
    const g = compiled && compiled.graph;
    const rt = {
      capacitors: { ...(runtime && runtime.capacitors || {}) },
      splitCursor: { ...(runtime && runtime.splitCursor || {}) },
      outputs: {
        main: ((runtime && runtime.outputs && runtime.outputs.main) || []).slice(),
        support: ((runtime && runtime.outputs && runtime.outputs.support) || []).slice(),
      },
      dissipated: 0,
    };
    const events = [];
    if (!g) return { runtime: rt, events };

    const nodeMap = new Map(g.nodes.map((n) => [n.key, n]));
    const adj = new Map();
    g.edges.forEach((e) => {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from).push(e.to);
    });

    const tokensAt = new Map();
    const inject = (key, toks) => {
      if (!toks || !toks.length) return;
      if (!tokensAt.has(key)) tokensAt.set(key, []);
      tokensAt.get(key).push(...toks);
    };

    Object.entries(inputs || {}).forEach(([id, toks]) => {
      if (!toks || !toks.length) return;
      if (!nodeMap.has('T:' + id)) return;
      inject('T:' + id, toks);
    });

    const cap = D().DESIGN.chargeCap;
    const outCap = D().DESIGN.outputCap;

    g.order.forEach((key) => {
      const node = nodeMap.get(key);
      if (!node) return;
      const toks = tokensAt.get(key) || [];
      if (!toks.length) return;

      /* 输出极：储存，溢出消散 */
      if (node.kind === 'terminal' && node.role === 'out') {
        const id = node.terminal;
        const room = Math.max(0, outCap - rt.outputs[id].length);
        const keep = toks.slice(0, room);
        rt.outputs[id].push(...keep);
        const lost = toks.length - keep.length;
        if (lost) {
          rt.dissipated += lost;
          events.push({ type: 'energyOverflow', outputId: id, amount: lost });
        }
        return;
      }

      if (node.kind === 'terminal') {
        (adj.get(key) || []).forEach((to) => inject(to, toks));
        return;
      }

      const tpl = D().template(node.templateId);

      /* 入口节点的特殊行为 */
      if (node.role === 'in') {
        if (tpl.capacitor) {
          const store = (rt.capacitors[node.itemId] || []).slice();
          store.push(...toks);
          let emitted = [];
          if (store.length >= cap) {
            emitted = store.slice(0, cap);
            store.splice(0, cap);
            /* 发出的 4 单位带 surge */
            emitted = emitted.map((t) => token([...t.tags.filter((x) => x !== 'surge'), 'surge']));
            events.push({ type: 'capacitorSurge', itemId: node.itemId, amount: emitted.length });
          }
          while (store.length > cap) { store.pop(); rt.dissipated += 1; }
          rt.capacitors[node.itemId] = store;
          if (emitted.length) (adj.get(key) || []).forEach((to) => inject(to, emitted));
          return;
        }

        if (tpl.gate) {
          const hpPct = context && typeof context.hpPct === 'number' ? context.hpPct : 1;
          if (hpPct >= tpl.gate.hpBelow) {
            rt.dissipated += toks.length;
            events.push({ type: 'gateBlocked', itemId: node.itemId, amount: toks.length });
            return;
          }
        }

        if (tpl.ember) {
          toks.forEach((t) => { if (!t.tags.includes('ember')) t.tags.push('ember'); });
        }

        const outs = (adj.get(key) || []).slice().sort();
        if (tpl.split && tpl.split.length === 2) {
          /* 轮流分配给两个出口：2 单位 → 1+1，绝不复制 */
          let cursor = rt.splitCursor[node.itemId] || 0;
          const buckets = { 0: [], 1: [] };
          toks.forEach((t) => {
            buckets[cursor].push(t);
            cursor = cursor === 0 ? 1 : 0;
          });
          rt.splitCursor[node.itemId] = cursor;
          /* 出口顺序固定：split 数组顺序对应 outs 排序后的两个出口 */
          const ordered = splitTargets(adj.get(key) || [], tpl, node.itemId);
          if (ordered.length === 2) {
            inject(ordered[0], buckets[0]);
            inject(ordered[1], buckets[1]);
          } else {
            outs.forEach((to) => inject(to, toks));
          }
          return;
        }

        outs.forEach((to) => inject(to, toks));
        return;
      }

      /* 出口端口：继续沿外部连线走 */
      (adj.get(key) || []).forEach((to) => inject(to, toks));
    });

    return { runtime: rt, events };
  }

  /** splitter 的两个出口按端口 id（outA/outB）稳定排序，不依赖边的插入顺序。 */
  function splitTargets(adjList, tpl, itemId) {
    const wanted = tpl.split.map((pid) => portKey(itemId, pid));
    const found = wanted.filter((k) => adjList.includes(k));
    return found;
  }

  /* ------------------------------ 便捷查询 ------------------------------ */

  function outputTokens(runtime, id) {
    const arr = (runtime && runtime.outputs && runtime.outputs[id]) || [];
    return arr;
  }

  function hasSurge(tokens) {
    return tokens.some((t) => t.tags.includes('surge'));
  }

  function hasEmber(tokens) {
    return tokens.some((t) => t.tags.includes('ember'));
  }

  /** 消耗指定输出上恰好 cost 个单位；不足则返回 null。 */
  function consumeOutput(runtime, id, cost) {
    const arr = outputTokens(runtime, id);
    if (arr.length < cost) return null;
    const used = arr.slice(0, cost);
    const rest = arr.slice(cost);
    const next = {
      capacitors: { ...runtime.capacitors },
      splitCursor: { ...runtime.splitCursor },
      outputs: { main: runtime.outputs.main.slice(), support: runtime.outputs.support.slice() },
      dissipated: runtime.dissipated || 0,
    };
    next.outputs[id] = rest;
    return { runtime: next, used };
  }

  /** 调谐返还：只放回当前输出储存，不产生新脉冲。 */
  function refund(runtime, id, tags) {
    const next = {
      capacitors: { ...runtime.capacitors },
      splitCursor: { ...runtime.splitCursor },
      outputs: { main: runtime.outputs.main.slice(), support: runtime.outputs.support.slice() },
      dissipated: runtime.dissipated || 0,
    };
    if (next.outputs[id].length < D().DESIGN.outputCap) next.outputs[id].unshift(token(tags || []));
    return next;
  }

  V.Circuit = {
    plateOf, manuscriptState,
    opposite, rotateDir, flipNS, transformTemplate, preview, compile, saveLoadout, layout,
    buildGraph, route, emptyRuntime, pulse, token, outputTokens,
    hasSurge, hasEmber, consumeOutput, refund, portKey,
  };
})(globalThis.Ashen ||= {});
