'use strict';
/* 功法膜：压在生命金属上的一层纹路要求。

   核心规则只有一条：**纹路同向才算填上**。
   格子被构件占住但纹路方向不对，不计入覆盖率，也不导电——
   否则「填满」会退化成多边形装箱。

   由此推出两个视角，共用同一套判定：
   - 覆盖率：膜上要求的纹路格，有多少格被同向的构件纹路覆盖（分母永远是膜，不是板面）；
   - 贯通：这些对上的格能否从入口连到出口（相邻格互相开口才算连通）。

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
   * 把功法定义整理成标准形状：cells 归一化到 0,0，veins 用 "x,y" 索引。
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

    return {
      id: spec.id,
      name: spec.name,
      tiers: (spec.tiers || []).slice().sort((a, b) => a.at - b.at),
      cells: normCells,
      veins,
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

    const applyDirs = (map) => {
      Object.keys(dirs).forEach((k) => { dirs[k] = dirs[k].map((d) => map[d] || d); });
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
        if (fits(oriented, plateCells, ox, oy)) out.push([ox, oy]);
      }
    }
    return out;
  }

  /**
   * 覆盖率。
   * @param oriented orient() 的结果
   * @param ox,oy 膜左上角在板面上的位置
   * @param pieceDirs Map<"x,y", string[]> 构件在绝对坐标上提供的开口方向
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
      /* 两件事都要满足：这一格真的被构件占住（没构件就不是填上），
         且要求的走向全部出现。构件多出来的开口不影响——多余的纹路只是白铺。 */
      const occupied = idx.occupied.has(k);
      const ok = occupied && need.every((d) => have.indexOf(d) >= 0);
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
   * 只走已对上的格——没对上的格本来就不导电。
   */
  function route(oriented, ox, oy, pieces) {
    const idx = asIndex(pieces);
    const cov = coverage(oriented, ox, oy, idx);
    const dirs = idx.dirs;
    const good = new Set(cov.alignedCells);
    const toAbs = (c) => key(c[0] + ox, c[1] + oy);

    const start = toAbs(oriented.entry);
    if (!good.has(start)) return { ok: false, reason: 'entry', reach: [] };

    const exits = new Set(oriented.exits.map(toAbs));
    const seen = new Set([start]);
    const queue = [start];
    let hit = null;
    while (queue.length) {
      const cur = queue.shift();
      if (exits.has(cur) && cur !== start) { hit = cur; break; }
      const [x, y] = unkey(cur);
      const have = dirs.get(cur) || [];
      Object.keys(ORTH).forEach((d) => {
        if (have.indexOf(d) < 0) return;
        const nx = x + ORTH[d][0];
        const ny = y + ORTH[d][1];
        const nk = key(nx, ny);
        if (!good.has(nk) || seen.has(nk)) return;
        const back = OPPOSITE[d];
        if ((dirs.get(nk) || []).indexOf(back) < 0) return;
        seen.add(nk);
        queue.push(nk);
      });
    }
    return { ok: !!hit, reach: [...seen], exit: hit, coverage: cov };
  }

  /** 构件索引：把 Circuit.layout 的结果转成 {dirs: Map<"x,y",dirs[]>, occupied: Set} */
  function pieceIndex(layout) {
    const dirs = new Map();
    const occupied = new Set();
    ((layout && layout.built) || []).forEach((b) => {
      (b.abs || []).forEach((c) => occupied.add(key(c.x, c.y)));
      b.aps.forEach((p) => {
        const k = key(p.cell[0], p.cell[1]);
        if (!dirs.has(k)) dirs.set(k, []);
        dirs.get(k).push(p.dir);
      });
    });
    return { dirs, occupied };
  }

  V.Manuscript = { normalize, orient, fits, placements, coverage, route, pieceIndex, ORTH };
})(globalThis.Ashen ||= {});
