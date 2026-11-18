'use strict';
/* 蚀刻法膜：压在生命金属上的一层纹路要求。

   覆盖按膜内实际占格计数；贯通另查入口、出口与连续的纹路。

   模块不碰战斗数值，只产出 {pct, tier, routed}，由上层决定怎么用。
   方向变换与 circuit.transformTemplate 严格同序：先上下翻转，再顺时针旋转，最后归一化。
*/
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const ORTH = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const ROT_CW = { N: 'E', E: 'S', S: 'W', W: 'N' };
  const FLIP_NS = { N: 'S', S: 'N', E: 'E', W: 'W' };
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const key = (x, y) => x + ',' + y;
  const unkey = (k) => k.split(',').map(Number);

  function cellKey(c) { return key(c[0], c[1]); }

  /**
   * 把蚀刻法定义整理成标准形状：cells 归一化到 0,0，veins 用 "x,y" 索引。
   * veins 里没列的格表示「只要占住就算填上」（不要求特定走向）。
   */
  function normalize(spec) {
    const cells = (spec.cells || []).map((c) => [c[0], c[1]]);
    if (!cells.length) return null;
    const minX = Math.min.apply(null, cells.map((c) => c[0]));
    const minY = Math.min.apply(null, cells.map((c) => c[1]));
    const shift = (p) => [p[0] - minX, p[1] - minY];
    const normCells = cells.map(shift);

    const veins = {};
    Object.keys(spec.veins || {}).forEach((k) => {
      const [x, y] = unkey(k);
      veins[key(x - minX, y - minY)] = (spec.veins[k] || []).slice();
    });

    /* 四个具名余裕点跟着格子一起平移 */
    const io = {};
    Object.keys(spec.io || {}).forEach((id) => {
      const p = spec.io[id];
      io[id] = { cell: [p.cell[0] - minX, p.cell[1] - minY], dir: p.dir };
    });

    return {
      id: spec.id,
      name: spec.name,
      tiers: (spec.tiers || []).slice().sort((a, b) => a.at - b.at),
      cells: normCells,
      veins,
      io,
      entry: spec.entry ? shift(spec.entry) : normCells[0],
      exits: (spec.exits || [spec.entry ? shift(spec.entry) : normCells[normCells.length - 1]]).map(shift),
      desc: spec.desc || '',
    };
  }

  /** 旋转 / 翻转一张膜：cells、veins 的方向、入口出口一起转 */
  function orient(ms, rotation, mirrorY) {
    if (!ms) return null;
    const rot = (((rotation | 0) % 4) + 4) % 4;
    const mir = mirrorY === true || Number(mirrorY) === 1;

    let cells = ms.cells.map((c) => ({ x: c[0], y: c[1] }));
    let dirs = {};
    Object.keys(ms.veins).forEach((k) => { dirs[k] = ms.veins[k].slice(); });
    let entry = { x: ms.entry[0], y: ms.entry[1] };
    let exits = ms.exits.map((c) => ({ x: c[0], y: c[1] }));
    let io = {};
    Object.keys(ms.io || {}).forEach((id) => {
      io[id] = { x: ms.io[id].cell[0], y: ms.io[id].cell[1], dir: ms.io[id].dir };
    });

    const applyDirs = (map) => {
      Object.keys(dirs).forEach((k) => { dirs[k] = dirs[k].map((d) => map[d] || d); });
      Object.keys(io).forEach((id) => { io[id].dir = map[io[id].dir] || io[id].dir; });
    };
    const remap = (fn) => {
      const nextDirs = {};
      cells.forEach((c) => {
        const n = fn(c);
        const old = dirs[key(c.x, c.y)];
        if (old) nextDirs[key(n.x, n.y)] = old;
        c.x = n.x; c.y = n.y;
      });
      dirs = nextDirs;
      entry = fn(entry);
      exits = exits.map(fn);
      Object.keys(io).forEach((id) => { io[id] = Object.assign(fn({ x: io[id].x, y: io[id].y }), { dir: io[id].dir }); });
    };
    const normalizeBack = () => {
      const minX = Math.min.apply(null, cells.map((c) => c.x));
      const minY = Math.min.apply(null, cells.map((c) => c.y));
      if (!minX && !minY) return;
      remap((p) => ({ x: p.x - minX, y: p.y - minY }));
    };

    if (mir) {
      const maxY = Math.max.apply(null, cells.map((c) => c.y));
      applyDirs(FLIP_NS);
      remap((p) => ({ x: p.x, y: maxY - p.y }));
      normalizeBack();
    }
    for (let i = 0; i < rot; i++) {
      const h = Math.max.apply(null, cells.map((c) => c.y)) + 1;
      applyDirs(ROT_CW);
      remap((p) => ({ x: h - 1 - p.y, y: p.x }));
      normalizeBack();
    }

    return {
      id: ms.id,
      name: ms.name,
      tiers: ms.tiers,
      cells: cells.map((c) => [c.x, c.y]),
      veins: dirs,
      io: (function () {
        const out = {};
        Object.keys(io).forEach((id) => { out[id] = { cell: [io[id].x, io[id].y], dir: io[id].dir }; });
        return out;
      })(),
      entry: [entry.x, entry.y],
      exits: exits.map((c) => [c.x, c.y]),
      rotation: rot,
      mirrorY: mir,
    };
  }

  /** 膜能否摆在这个位置：所有格都在板面上 */
  function fits(oriented, plateCells, ox, oy) {
    if (!oriented) return false;
    const plate = new Set((plateCells || []).map(cellKey));
    return oriented.cells.every((c) => plate.has(key(c[0] + ox, c[1] + oy)));
  }

  /** 找所有能放下的位置（左上角） */
  function placements(oriented, plateCells) {
    if (!oriented) return [];
    const plate = new Set((plateCells || []).map(cellKey));
    const out = [];
    for (let oy = -1; oy <= V.PlateGen.SIZE; oy++) {
      for (let ox = -1; ox <= V.PlateGen.SIZE; ox++) {
        if (oriented.cells.every(([x, y]) => plate.has(key(x + ox, y + oy)))) out.push([ox, oy]);
      }
    }
    return out;
  }

  function hasPlacement(base, plateCells) {
    if (!base || base.cells.length > plateCells.length) return false;
    for (const mirror of [false, true]) {
      for (let rotation = 0; rotation < 4; rotation++) {
        if (placements(orient(base, rotation, mirror), plateCells).length) return true;
      }
    }
    return false;
  }

  /**
   * 覆盖率。
   * @param oriented orient() 的结果
   * @param ox,oy 膜左上角在板面上的位置
   * @param pieceDirs Map<"x,y", string[]> 纹路在绝对坐标上提供的开口方向
   * @returns {{total:number, aligned:number, pct:number, tier:object|null, missing:Array}}
   */
  function asIndex(pieces) {
    if (!pieces) return { dirs: new Map(), occupied: new Set() };
    if (pieces.dirs && pieces.occupied) return pieces;
    const map = pieces instanceof Map ? pieces : new Map(Object.entries(pieces));
    return { dirs: map, occupied: new Set(map.keys()) };
  }

  function coverage(oriented, ox, oy, pieces) {
    const idx = asIndex(pieces);
    const dirs = idx.dirs;
    let total = 0;
    let aligned = 0;
    const missing = [];
    const alignedCells = [];

    oriented.cells.forEach((c) => {
      const ax = c[0] + ox;
      const ay = c[1] + oy;
      const k = key(ax, ay);
      const need = oriented.veins[key(c[0], c[1])] || [];
      const have = dirs.get(k) || [];
      total++;
      const ok = idx.occupied.has(k);
      if (ok) { aligned++; alignedCells.push(k); }
      else missing.push({ cell: [ax, ay], need, have });
    });

    const pct = total ? Math.round((aligned / total) * 100) : 0;
    let tier = null;
    (oriented.tiers || []).forEach((t) => { if (pct >= t.at) tier = t; });
    return { total, aligned, pct, tier, missing, alignedCells };
  }

  /**
   * 贯通：从入口沿「双方都开口」的相邻格走到了哪个出口。
   * 路径必须留在被覆盖的膜格内。
   *
   * v4.0 追加两件东西，脉冲编译要用：
   *   path   实际走过的格序列（BFS 父指针回溯，不是 visited 集合 ——
   *          集合里带着岔路，数不出「拐了几次弯」）；
   *   looped 这块膜上的通路上有没有闭环（电流能绕回来）。
   *          判据很朴素：把 reach 内的相邻连通格当无向边数一遍，
   *          树是 n-1 条，够到 n 条就至少有一个环。
   */
  function route(oriented, ox, oy, pieces) {
    const idx = asIndex(pieces);
    const cov = coverage(oriented, ox, oy, idx);
    const dirs = idx.dirs;
    const good = new Set(cov.alignedCells);
    const toAbs = (c) => key(c[0] + ox, c[1] + oy);

    const start = toAbs(oriented.entry);
    const matchesEnd = c => (oriented.veins[key(...c)] || []).every(d => (dirs.get(toAbs(c)) || []).includes(d));
    if (!good.has(start) || !matchesEnd(oriented.entry)) {
      return { ok: false, reason: 'entry', reach: [], path: [], looped: false };
    }

    const exits = new Set(oriented.exits.filter(matchesEnd).map(toAbs));
    const seen = new Set([start]);
    const parent = new Map();
    const queue = [start];
    let hit = null;
    while (queue.length) {
      const cur = queue.shift();
      if (exits.has(cur) && cur !== start) { hit = cur; break; }
      const [x, y] = unkey(cur);
      const have = dirs.get(cur) || [];
      Object.keys(ORTH).forEach((d) => {
        const nx = x + ORTH[d][0];
        const ny = y + ORTH[d][1];
        const nk = key(nx, ny);
        if (!good.has(nk) || seen.has(nk)) return;
        if (!have.includes(d) || !(dirs.get(nk) || []).includes(OPPOSITE[d])) return;
        seen.add(nk);
        parent.set(nk, cur);
        queue.push(nk);
      });
    }

    /* 回溯出唯一那条通路 */
    const path = [];
    if (hit) {
      let cur = hit;
      let guard = 0;
      while (cur != null && guard++ < 512) {
        path.push(cur);
        if (cur === start) break;
        cur = parent.get(cur);
      }
      path.reverse();
      if (path[0] !== start) path.length = 0;
    }

    /* 闭环：在 reach 子图上数无向边 */
    let edges = 0;
    seen.forEach((k) => {
      const [x, y] = unkey(k);
      const have = dirs.get(k) || [];
      Object.keys(ORTH).forEach((d) => {
        if (!have.includes(d)) return;
        const nk = key(x + ORTH[d][0], y + ORTH[d][1]);
        if (!seen.has(nk)) return;
        if (!(dirs.get(nk) || []).includes(OPPOSITE[d])) return;
        edges += 1;
      });
    });
    const looped = seen.size > 2 && edges / 2 >= seen.size;

    return { ok: !!hit, reach: [...seen], path, looped, exit: hit, coverage: cov };
  }

  /**
   * 一件纹路的**内部通路链**：从每个 in 端口格出发，沿件内四邻接格走到每个 out 端口格。
   *
   * 坐标原样透传 —— `pieceIndex` 传绝对坐标（layout 的 abs/aps），
   * 布线器传相对坐标（transformTemplate 的 cells/ports），同一套逻辑两处共用。
   *
   * 这一步是「多格纹路当通路中继」的全部秘密：一件 `long` 的 in 在 (0,0)、out 在 (2,0)，
   * 它的中间格本来没有任何端口，单看 aps 是穿不过去的；补上链上相邻格的口，
   * route() 才能「从 in 进、在体内走到 out、再出去」。
   *
   * @returns {Array<{cells:Array<{x:number,y:number}>, inDir:string, outDir:string, outId:string}>}
   */
  function internalChains(cellsIn, portsIn) {
    const cells = (cellsIn || []).map((c) => ({ x: c.x, y: c.y }));
    const ports = portsIn || [];
    if (!cells.length) return [];
    const at = new Map(cells.map((c, i) => [key(c.x, c.y), i]));
    const ins = ports.filter((p) => p.role === 'in');
    const outs = ports.filter((p) => p.role === 'out');
    const near = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
    const out = [];

    ins.forEach((pin) => {
      const start = at.get(key(pin.cell[0], pin.cell[1]));
      if (start == null) return;
      /* BFS 出一棵最短路径树，再对每个 out 回溯 —— 一件件只走一条「主动脉」，
         不像以前那样把件内所有相邻对都连上（那会把 cistern 的 3×2 连成一张网，
         通路可以随便斜穿，数出来的转角也就没意义了）。 */
      const parent = new Map([[start, null]]);
      const queue = [start];
      while (queue.length) {
        const cur = queue.shift();
        cells.forEach((c, i) => {
          if (parent.has(i)) return;
          if (!near(cells[cur], c)) return;
          parent.set(i, cur);
          queue.push(i);
        });
      }
      outs.forEach((pout) => {
        const end = at.get(key(pout.cell[0], pout.cell[1]));
        if (end == null) return;
        const chain = [];
        let n = end;
        let guard = 0;
        while (n != null && guard++ < 64) {
          chain.push(cells[n]);
          if (n === start) break;
          n = parent.get(n);
        }
        chain.reverse();
        if (!chain.length) return;
        if (chain[0].x !== pin.cell[0] || chain[0].y !== pin.cell[1]) return;
        out.push({ cells: chain, inDir: pin.dir, outDir: pout.dir, outId: pout.id });
      });
    });
    return out;
  }

  /** 纹路索引：把 Circuit.layout 的结果转成 {dirs: Map<"x,y",dirs[]>, occupied: Set} */
  function pieceIndex(layout) {
    const dirs = new Map();
    const occupied = new Set();
    const addDir = (x, y, d) => {
      const k = key(x, y);
      if (!dirs.has(k)) dirs.set(k, []);
      if (!dirs.get(k).includes(d)) dirs.get(k).push(d);
    };
    const connect = (a, b) => {
      const d = Object.keys(ORTH).find((k) => a.x + ORTH[k][0] === b.x && a.y + ORTH[k][1] === b.y);
      if (!d) return;
      addDir(a.x, a.y, d);
      addDir(b.x, b.y, OPPOSITE[d]);
    };

    ((layout && layout.built) || []).forEach((b) => {
      const cells = b.abs || [];
      cells.forEach((c) => occupied.add(key(c.x, c.y)));
      (b.aps || []).forEach((p) => addDir(p.cell[0], p.cell[1], p.dir));

      /* 多格纹路：按「in → out 的主动脉」补内部开口，通路可以穿体而过 */
      const chains = internalChains(cells, b.aps);
      chains.forEach((ch) => {
        for (let i = 1; i < ch.cells.length; i++) connect(ch.cells[i - 1], ch.cells[i]);
      });
    });
    return { dirs, occupied };
  }

  V.Manuscript = { normalize, orient, fits, placements, hasPlacement, coverage, route, pieceIndex, internalChains, ORTH };
})(globalThis.Ashen ||= {});
