'use strict';
/* 老兵回路版界面：全部页面 + 异形生命金属/功法膜/回路板面 SVG。只读 state，动作交给 app.dispatch。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;
  const ST = () => V.State;

  /* ------------------------------ 基础 ------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function btn(label, act, opts) {
    const o = opts || {};
    const cls = ['btn', o.cls || ''].join(' ').trim();
    const idAttr = o.id ? ` id="${o.id}"` : '';
    const data = o.data ? Object.entries(o.data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('') : '';
    const dis = o.disabled ? ' disabled' : '';
    const style = o.style ? ` style="${o.style}"` : '';
    return `<button class="${cls}"${idAttr} data-act="${act}"${data}${dis}${style}>${label}</button>`;
  }

  function bar(v, max, cls) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
    return `<div class="bar ${cls || ''}"><i style="width:${pct.toFixed(1)}%"></i></div>`;
  }

  function panel(title, body, extra) {
    return `<section class="panel ${extra || ''}"><h2 class="panel-h">${title}</h2>${body}</section>`;
  }

  function tag(text, cls) { return `<span class="tag ${cls || ''}">${esc(text)}</span>`; }

  /* ------------------------------ 板面 SVG ------------------------------ */

  const CELL = 60;
  let svgUid = 0;

  const TEMPLATE_COLOR = {
    straight: '#263445', elbow: '#2B354C', splitter: '#3A2A4E',
    capacitor: '#423124', threshold: '#44242A', ember: '#472B1F',
  };
  const TEMPLATE_EDGE = {
    straight: '#6E8BA3', elbow: '#7A90B8', splitter: '#9E7AC4',
    capacitor: '#C49A5A', threshold: '#B86262', ember: '#D87843',
  };

  const DIR_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

  /* 功法膜纹路片段显式映射：文件名并非罗盘顺序，禁止自行推导 */
  const VEIN_ORDER = ['N', 'E', 'S', 'W'];
  const FRAG_FILE = {
    N: 'n', E: 'e', S: 's', W: 'w',
    NS: 'ns', EW: 'ew', NE: 'ne', ES: 'es', SW: 'sw', NW: 'wn',
    NES: 'nes', ESW: 'esw', NSW: 'swn', NEW: 'wne', NESW: 'nesw',
  };

  function veinFileName(dirs) {
    if (!dirs || !dirs.length) return '';
    const k = dirs.slice().sort((a, b) => VEIN_ORDER.indexOf(a) - VEIN_ORDER.indexOf(b)).join('');
    return FRAG_FILE[k] || '';
  }

  /* 工坊可预览的功法膜谱图（全部通过 V.Manuscript 判定，不改领域逻辑） */
  const WORKSHOP_MANUSCRIPTS = [
    {
      id: 'ash12',
      name: '余烬十二脉',
      desc: '4×3 古老回流拓片。要求 12 格同向导通，覆盖 40%/75%/100% 依次共鸣。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'],
        '0,1': ['W'], '1,1': ['E'], '2,1': ['N'], '3,1': ['N'],
        '0,2': ['W'], '1,2': ['E'], '2,2': ['S'], '3,2': ['S'],
      },
      entry: [0, 0],
      exits: [[3, 2]],
      tiers: [{ at: 40, id: 't1', name: '一阶 · 初鸣' }, { at: 75, id: 't2', name: '二阶 · 共振' }, { at: 100, id: 't3', name: '三阶 · 圆满' }],
    },
    {
      id: 'corridor5',
      name: '直贯五脉',
      desc: '窄型 5 格拓片，适配狭窄骨架与基础直弯配组。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],
      veins: { '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,1': ['E'] },
      entry: [0, 0],
      exits: [[3, 1]],
      tiers: [{ at: 40, id: 't1', name: '一阶 · 初鸣' }, { at: 80, id: 't2', name: '二阶 · 共振' }, { at: 100, id: 't3', name: '三阶 · 贯通' }],
    },
    {
      id: 'wide14',
      name: '重铸阔卷',
      desc: '5×3 重型拓片，仅厚实宽幅板面可完整容纳。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'], '4,0': ['S'],
        '0,1': ['N'], '1,1': ['W'], '2,1': ['E'], '3,1': ['W'], '4,1': ['N', 'S'],
        '1,2': ['W'], '2,2': ['E'], '3,2': ['W'], '4,2': ['N'],
      },
      entry: [0, 0],
      exits: [[4, 2]],
      tiers: [{ at: 35, id: 't1', name: '一阶 · 余温' }, { at: 70, id: 't2', name: '二阶 · 灼脉' }, { at: 100, id: 't3', name: '三阶 · 圆满' }],
    },
  ];

  function plateCellsList(plate) {
    if (plate.cellsList && plate.cellsList.length) return plate.cellsList;
    return [...plate.cells].map((k) => k.split(',').map(Number));
  }

  /** 通过 V.Manuscript 计算当前工坊角色的功法膜适配、覆盖率与贯通状态。 */
  function resolveManuscript(unit, plate, ui, layout) {
    if (!V.Manuscript || !plate) return null;
    const uui = ui || {};
    if (uui.wsMsId === 'none' && !(unit && unit.manuscript)) return { disabled: true, id: 'none' };
    const raw = (unit && unit.manuscript)
      || (D().MANUSCRIPTS || {})[uui.wsMsId]
      || (D().MANUSCRIPTS || {})[(D().MANUSCRIPT_ORDER || [])[0]];
    if (!raw) return null;
    const base = V.Manuscript.normalize(raw);
    if (!base) return null;

    const cellsList = plateCellsList(plate);
    const rot = (((uui.wsMsRot || 0) % 4) + 4) % 4;
    const mir = !!uui.wsMsMir;
    const oriented = V.Manuscript.orient(base, rot, mir);
    const validSpots = V.Manuscript.placements(oriented, cellsList);

    const manual = uui.wsMsOx != null && uui.wsMsOy != null;
    const spotIdx = validSpots.length ? (((uui.wsMsSpotIdx || 0) % validSpots.length) + validSpots.length) % validSpots.length : 0;
    const ox = manual ? Number(uui.wsMsOx) : (validSpots.length ? validSpots[spotIdx][0] : 0);
    const oy = manual ? Number(uui.wsMsOy) : (validSpots.length ? validSpots[spotIdx][1] : 0);
    const fits = V.Manuscript.fits(oriented, cellsList, ox, oy);

    let anyFits = validSpots.length > 0;
    if (!anyFits) {
      for (let m = 0; m < 2 && !anyFits; m++) {
        for (let r = 0; r < 4 && !anyFits; r++) {
          if (V.Manuscript.placements(V.Manuscript.orient(base, r, !!m), cellsList).length) anyFits = true;
        }
      }
    }

    let reason = '';
    if (!fits) {
      if (!anyFits) {
        reason = `摆不下：当前板面形状或孔洞缺少足够连续空位容纳「${base.name}」`;
      } else if (!validSpots.length) {
        reason = `当前朝向（旋${rot * 90}°${mir ? '·翻' : ''}）在此板面上无处落脚，请旋转、翻转或重置位置`;
      } else {
        reason = `当前落点 (${ox},${oy}) 超出板面有效金属格，请移回板内或重置落点`;
      }
    }

    const idx = V.Manuscript.pieceIndex(layout || { built: [] });
    const cov = V.Manuscript.coverage(oriented, ox, oy, idx);
    const rt = V.Manuscript.route(oriented, ox, oy, idx);
    return {
      disabled: false,
      id: raw.id,
      spec: raw,
      oriented,
      ox,
      oy,
      fits,
      anyFits,
      validSpots,
      spotIdx,
      rot,
      mir,
      cov,
      rt,
      reason,
    };
  }

  /** 计算视觉连通集合：区分完整通电（到输出极）与仅输入已到达。 */
  function traceVisualFlow(L) {
    const adjFwd = new Map();
    const adjRev = new Map();
    (L.edges || []).forEach((e) => {
      if (!adjFwd.has(e.from)) adjFwd.set(e.from, []);
      adjFwd.get(e.from).push(e.to);
      if (!adjRev.has(e.to)) adjRev.set(e.to, []);
      adjRev.get(e.to).push(e.from);
    });
    const bfs = (starts, adj) => {
      const vis = new Set(starts);
      const q = starts.slice();
      while (q.length) {
        const cur = q.shift();
        (adj.get(cur) || []).forEach((nxt) => {
          if (!vis.has(nxt)) { vis.add(nxt); q.push(nxt); }
        });
      }
      return vis;
    };
    const fwd = bfs(['T:clock', 'T:damage'], adjFwd);
    const rev = bfs(['T:main', 'T:support'], adjRev);
    return { fwd, rev };
  }

  /** 在多格构件内部沿相邻格心 BFS 找正交路径。 */
  function orthoCellPath(absCells, startCell, endCell) {
    const sk = startCell[0] + ',' + startCell[1];
    const ek = endCell[0] + ',' + endCell[1];
    if (sk === ek) return [startCell];
    const cellMap = new Map(absCells.map((c) => [c.x + ',' + c.y, [c.x, c.y]]));
    const prev = new Map([[sk, null]]);
    const q = [startCell];
    while (q.length) {
      const [cx, cy] = q.shift();
      const ck = cx + ',' + cy;
      if (ck === ek) break;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nk = (cx + dx) + ',' + (cy + dy);
        if (cellMap.has(nk) && !prev.has(nk)) {
          prev.set(nk, ck);
          q.push(cellMap.get(nk));
        }
      });
    }
    if (!prev.has(ek)) return [startCell, endCell];
    const path = [];
    let cur = ek;
    while (cur) {
      path.unshift(cellMap.get(cur));
      cur = prev.get(cur);
    }
    return path;
  }

  /** 沿网格边界生成不规则锯齿金属轮廓：只向格子外空隙生长，厚度 >=0.35 格，绝不侵犯可用格。 */
  function traceJaggedLoops(cellSet, cellsList, seedVal) {
    const has = (x, y) => cellSet.has(x + ',' + y);
    const noise = (a, b, c) => {
      let h = ((seedVal >>> 0) ^ Math.imul(a + 37, 374761393) ^ Math.imul(b + 53, 668265263) ^ Math.imul(c + 19, 1442695041)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };

    const rawEdges = [];
    cellsList.forEach(([x, y]) => {
      if (!has(x, y - 1)) rawEdges.push({ x0: x, y0: y, x1: x + 1, y1: y, dir: 0, nx: 0, ny: -1, ex: x, ey: y - 1 });
      if (!has(x + 1, y)) rawEdges.push({ x0: x + 1, y0: y, x1: x + 1, y1: y + 1, dir: 1, nx: 1, ny: 0, ex: x + 1, ey: y });
      if (!has(x, y + 1)) rawEdges.push({ x0: x + 1, y0: y + 1, x1: x, y1: y + 1, dir: 2, nx: 0, ny: 1, ex: x, ey: y + 1 });
      if (!has(x - 1, y)) rawEdges.push({ x0: x, y0: y + 1, x1: x, y1: y, dir: 3, nx: -1, ny: 0, ex: x - 1, ey: y });
    });

    const byStart = new Map();
    rawEdges.forEach((e, idx) => {
      e.id = idx;
      e.used = false;
      const k = e.x0 + ',' + e.y0;
      if (!byStart.has(k)) byStart.set(k, []);
      byStart.get(k).push(e);
    });

    const loops = [];
    for (let i = 0; i < rawEdges.length; i++) {
      if (rawEdges[i].used) continue;
      const loop = [];
      let cur = rawEdges[i];
      while (cur && !cur.used) {
        cur.used = true;
        loop.push(cur);
        const list = (byStart.get(cur.x1 + ',' + cur.y1) || []).filter((n) => !n.used);
        if (!list.length) break;
        if (list.length === 1) { cur = list[0]; continue; }
        /* 多岔口（对角相接）优先右转绕实心块，防止自交 */
        const pref = [(cur.dir + 1) % 4, cur.dir, (cur.dir + 3) % 4];
        let picked = list[0];
        for (let p = 0; p < pref.length; p++) {
          const hit = list.find((n) => n.dir === pref[p]);
          if (hit) { picked = hit; break; }
        }
        cur = picked;
      }
      if (loop.length >= 4) loops.push(loop);
    }

    const polyLoops = [];
    loops.forEach((edges) => {
      const m = edges.length;
      const props = edges.map((e, idx) => {
        const tx = e.x1 - e.x0;
        const ty = e.y1 - e.y0;
        const tight = has(e.ex + e.nx, e.ey + e.ny)
          || has(e.ex + e.nx + tx, e.ey + e.ny + ty)
          || has(e.ex + e.nx - tx, e.ey + e.ny - ty)
          || has(e.ex + tx, e.ey + ty)
          || has(e.ex - tx, e.ey - ty);
        const minD = tight ? 0.37 : 0.39;
        const maxD = tight ? 0.43 : 0.55;
        return {
          tight, minD, maxD,
          dA: minD + noise(e.x0, e.y0, idx + 1) * (maxD - minD),
          dB: minD + noise(e.x1, e.y1, idx + 7) * (maxD - minD),
        };
      });

      const pts = [];
      for (let i = 0; i < m; i++) {
        const prev = edges[(i - 1 + m) % m];
        const curr = edges[i];
        const pp = props[(i - 1 + m) % m];
        const cp = props[i];
        const turn = (curr.dir - prev.dir + 4) % 4;
        const vx = curr.x0;
        const vy = curr.y0;

        if (turn === 0) {
          const d = Math.min(Math.max(0.37, (pp.dB + cp.dA) / 2), pp.tight || cp.tight ? 0.43 : 0.53);
          pts.push([vx + d * curr.nx, vy + d * curr.ny]);
        } else if (turn === 1) {
          /* 外凸 90 度：先查外斜角格是否被其它实心分支占住，占住则贴墙角绕过 */
          const diagX = curr.ex + prev.nx;
          const diagY = curr.ey + prev.ny;
          if (has(diagX, diagY)) {
            pts.push([vx + 0.37 * prev.nx, vy + 0.37 * prev.ny]);
            pts.push([vx + 0.37 * curr.nx, vy + 0.37 * curr.ny]);
          } else {
            const dP = Math.max(0.39, pp.dB);
            const dC = Math.max(0.39, cp.dA);
            const cInset = Math.max(0.365, dC * 0.94);
            const pInset = Math.max(0.365, dP * 0.94);
            pts.push([vx + dP * prev.nx + cInset * curr.nx, vy + dP * prev.ny + cInset * curr.ny]);
            pts.push([vx + pInset * prev.nx + dC * curr.nx, vy + pInset * prev.ny + dC * curr.ny]);
          }
        } else if (turn === 3) {
          /* 内凹 90 度或孔洞拐角：安全缩进空角格内，永不越界 */
          const dc = 0.37 + noise(vx, vy, i + 23) * 0.04;
          pts.push([vx + dc * (prev.nx + curr.nx), vy + dc * (prev.ny + curr.ny)]);
        } else {
          pts.push([vx + Math.max(0.37, cp.dA) * curr.nx, vy + Math.max(0.37, cp.dA) * curr.ny]);
        }

        /* 每格边内插锯齿顶点：首尾遇内凹角时自动让出内壁厚 ≥0.37 格 */
        const nextEdge = edges[(i + 1) % m];
        const nextTurn = (nextEdge.dir - curr.dir + 4) % 4;
        const tStart = turn === 3 ? 0.44 : 0.30;
        const tEnd = nextTurn === 3 ? 0.56 : 0.70;
        const tSamples = tEnd - tStart >= 0.22 ? [tStart, tEnd] : [(tStart + tEnd) * 0.5];
        const dx = curr.x1 - curr.x0;
        const dy = curr.y1 - curr.y0;
        tSamples.forEach((t, ti) => {
          const d = cp.minD + noise(curr.x0 + ti * 3, curr.y0 + ti * 5, i + 31) * (cp.maxD - cp.minD);
          pts.push([curr.x0 + dx * t + d * curr.nx, curr.y0 + dy * t + d * curr.ny]);
        });
      }
      if (pts.length >= 3) polyLoops.push(pts.map(([px, py]) => [px * CELL, py * CELL]));
    });
    return polyLoops;
  }

  /** 按当前板面（异形 / 经典）算出精确像素包围盒与底材多边形。 */
  function computeBoardGeo(plate, seedVal) {
    const cellsList = plateCellsList(plate);
    const termOut = plate.generated ? 34 : 14;
    const rawTermLoc = (t) => {
      const [dx, dy] = DIR_VEC[t.dir];
      const cx = t.cell[0] * CELL + CELL / 2;
      const cy = t.cell[1] * CELL + CELL / 2;
      return [cx + dx * (CELL / 2 + termOut), cy + dy * (CELL / 2 + termOut)];
    };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };

    let metalLoops = null;
    if (plate.generated) {
      metalLoops = traceJaggedLoops(plate.cells, cellsList, seedVal);
      metalLoops.forEach((loop) => loop.forEach(([x, y]) => grow(x, y)));
    } else {
      const size = plate.size || 4;
      grow(-6, -6);
      grow(size * CELL + 6, size * CELL + 6);
    }

    Object.values(plate.terminals || {}).forEach((t) => {
      const [tx, ty] = rawTermLoc(t);
      if (t.dir === 'W') { grow(tx - 40, ty - 14); grow(tx + 6, ty + 14); }
      else if (t.dir === 'E') { grow(tx - 6, ty - 14); grow(tx + 40, ty + 14); }
      else if (t.dir === 'N') { grow(tx - 24, ty - 24); grow(tx + 24, ty + 6); }
      else { grow(tx - 24, ty - 6); grow(tx + 24, ty + 24); }
    });

    const pad = 12;
    const gx = Math.ceil(pad - minX);
    const gy = Math.ceil(pad - minY);
    const cw = Math.ceil(maxX + gx + pad);
    const ch = Math.ceil(maxY + gy + pad);
    const slabPath = metalLoops ? metalLoops.map((loop) => 'M' + loop.map(([x, y]) => `${(x + gx).toFixed(1)} ${(y + gy).toFixed(1)}`).join(' L') + ' Z').join(' ') : '';
    return { gx, gy, cw, ch, termOut, slabPath, cellsList };
  }

  /** 绘制连成整块的一体化多格金属底座与外轮廓（实心金框兜底）。 */
  function renderUnifiedBody(absCells, fill, edgeStroke, isSelected, isError, gx, gy, cls) {
    const PAD = 4;
    const set = new Set(absCells.map((c) => c.x + ',' + c.y));
    const has = (x, y) => set.has(x + ',' + y);
    const out = [];
    const xy = (x, y) => [gx + x * CELL, gy + y * CELL];

    absCells.forEach((c) => {
      const [px, py] = xy(c.x, c.y);
      const w = CELL - PAD * 2;
      out.push(`<rect class="part-cell" x="${px + PAD}" y="${py + PAD}" width="${w}" height="${w}" rx="2" fill="${fill}"/>`);
      if (has(c.x + 1, c.y)) {
        out.push(`<rect class="part-bridge" x="${px + CELL - PAD - 1}" y="${py + PAD}" width="${PAD * 2 + 2}" height="${w}" fill="${fill}"/>`);
      }
      if (has(c.x, c.y + 1)) {
        out.push(`<rect class="part-bridge" x="${px + PAD}" y="${py + CELL - PAD - 1}" width="${w}" height="${PAD * 2 + 2}" fill="${fill}"/>`);
      }
      if (has(c.x + 1, c.y) && has(c.x, c.y + 1) && has(c.x + 1, c.y + 1)) {
        out.push(`<rect class="part-bridge" x="${px + CELL - PAD - 1}" y="${py + CELL - PAD - 1}" width="${PAD * 2 + 2}" height="${PAD * 2 + 2}" fill="${fill}"/>`);
      }
    });

    const edges = [];
    const hiEdges = [];
    absCells.forEach((c) => {
      const [px, py] = xy(c.x, c.y);
      const x0 = px + PAD;
      const y0 = py + PAD;
      const x1 = px + CELL - PAD;
      const y1 = py + CELL - PAD;
      if (!has(c.x, c.y - 1)) {
        const sx = has(c.x - 1, c.y) && !has(c.x - 1, c.y - 1) ? px - PAD : x0;
        const ex = has(c.x + 1, c.y) && !has(c.x + 1, c.y - 1) ? px + CELL + PAD : x1;
        edges.push(`M${sx} ${y0} H${ex}`);
        hiEdges.push(`M${x0 + 1} ${y0 + 1.5} H${x1 - 1}`);
      }
      if (!has(c.x, c.y + 1)) {
        const sx = has(c.x - 1, c.y) && !has(c.x - 1, c.y + 1) ? px - PAD : x0;
        const ex = has(c.x + 1, c.y) && !has(c.x + 1, c.y + 1) ? px + CELL + PAD : x1;
        edges.push(`M${sx} ${y1} H${ex}`);
      }
      if (!has(c.x - 1, c.y)) {
        const sy = has(c.x, c.y - 1) && !has(c.x - 1, c.y - 1) ? py - PAD : y0;
        const ey = has(c.x, c.y + 1) && !has(c.x - 1, c.y + 1) ? py + CELL + PAD : y1;
        edges.push(`M${x0} ${sy} V${ey}`);
        hiEdges.push(`M${x0 + 1.5} ${y0 + 1} V${y1 - 1}`);
      }
      if (!has(c.x + 1, c.y)) {
        const sy = has(c.x, c.y - 1) && !has(c.x + 1, c.y - 1) ? py - PAD : y0;
        const ey = has(c.x, c.y + 1) && !has(c.x + 1, c.y + 1) ? py + CELL + PAD : y1;
        edges.push(`M${x1} ${sy} V${ey}`);
      }
    });

    const stroke = isError ? '#D36A65' : isSelected ? '#F2CF7E' : edgeStroke;
    const sw = isSelected || isError ? 2.2 : 1.7;
    const clsAttr = cls ? ` class="${cls}"` : '';
    out.push(`<path${clsAttr} d="${edges.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>`);
    out.push(`<path d="${hiEdges.join(' ')}" fill="none" stroke="rgba(255,244,214,0.22)" stroke-width="1"/>`);
    return out.join('');
  }

  /**
   * boardSvg(state, unitId, placements, opts)
   * 四层 Z 序：底材（锯齿金属） → 功法膜（半透明片段） → 构件纹章（实心金框） → 高亮/通电/交互。
   * opts: {interactive, pickId, locked, ms}
   */
  function boardSvg(state, unitId, placements, opts) {
    const o = opts || {};
    const unit = state.roster.find((u) => u.id === unitId);
    const body = D().body(unit ? unit.bodyPreset : 'sturdy');
    const plate = V.Circuit.plateOf(unit || { bodyPreset: 'sturdy', plateSeed: 1 });
    const terminals = plate.terminals || D().TERMINALS;
    const geo = computeBoardGeo(plate, unit && unit.plateSeed != null ? unit.plateSeed : 1);
    const gx = geo.gx;
    const gy = geo.gy;
    const cellsList = geo.cellsList;
    const blocked = new Set(!plate.generated && body && body.blocked ? body.blocked.map(([x, y]) => x + ',' + y) : []);

    const cellXY = (x, y) => [gx + x * CELL, gy + y * CELL];
    const cellCenter = (x, y) => [gx + x * CELL + CELL / 2, gy + y * CELL + CELL / 2];
    const portPoint = (pt) => {
      const [cx, cy] = cellXY(pt.cell[0], pt.cell[1]);
      const [dx, dy] = DIR_VEC[pt.dir];
      return [cx + CELL / 2 + dx * (CELL / 2 - 2), cy + CELL / 2 + dy * (CELL / 2 - 2)];
    };
    const terminalPoint = (t, outward) => {
      const [cx, cy] = cellXY(t.cell[0], t.cell[1]);
      const [dx, dy] = DIR_VEC[t.dir];
      const d = outward ? CELL / 2 + geo.termOut : CELL / 2 - 2;
      return [cx + CELL / 2 + dx * d, cy + CELL / 2 + dy * d];
    };

    const L = V.Circuit.layout(state, placements, terminals);
    const cellsUsed = new Set(L.cells.map((c) => c.x + ',' + c.y));
    const flow = traceVisualFlow(L);
    const locked = o.locked instanceof Set ? o.locked : new Set(o.locked || []);
    const fid = 'b_' + (++svgUid);

    /* 识别碰撞/不在板面上，标红到格上 */
    const cellOwners = new Map();
    const errorCells = new Set();
    const errorItems = new Set();
    L.built.forEach((b) => {
      b.abs.forEach((c) => {
        const k = c.x + ',' + c.y;
        if (!plate.cells.has(k)) {
          errorCells.add(k);
          errorItems.add(b.item.id);
        }
        if (cellOwners.has(k)) {
          errorCells.add(k);
          errorItems.add(b.item.id);
          errorItems.add(cellOwners.get(k));
        } else {
          cellOwners.set(k, b.item.id);
        }
      });
    });

    const parts = [];
    parts.push(`<svg class="board${o.pickId ? ' has-pick' : ''}" viewBox="0 0 ${geo.cw} ${geo.ch}"
      data-cell="${CELL}" data-gx="${gx}" data-gy="${gy}" data-n="${plate.size}"
      data-ms-ox="${o.ms && !o.ms.disabled ? (o.ms.ox || 0) : ''}"
      data-ms-oy="${o.ms && !o.ms.disabled ? (o.ms.oy || 0) : ''}"
      data-ms-cells="${o.ms && !o.ms.disabled && o.ms.oriented ? o.ms.oriented.cells.map((c) => c.join(',')).join(';') : ''}"
      xmlns="http://www.w3.org/2000/svg" role="img" aria-label="生命金属回路板面">`);
    parts.push(`<defs>
      <pattern id="${fid}_metal" width="256" height="256" patternUnits="userSpaceOnUse">
        <rect width="256" height="256" fill="#211A2D"/>
        <image href="assets/art/rune-set-v2/living-metal.png" x="0" y="0" width="256" height="256" preserveAspectRatio="none"/>
      </pattern>
      <pattern id="${fid}_mem" width="256" height="256" patternUnits="userSpaceOnUse">
        <rect width="256" height="256" fill="rgba(40,34,62,0.22)"/>
        <image href="assets/art/inscription-v1/membrane-texture.png" x="0" y="0" width="256" height="256" preserveAspectRatio="none"/>
      </pattern>
      <filter id="${fid}_ms_on" x="-30%" y="-30%" width="160%" height="160%">
        <feFlood flood-color="#F2CF7E" result="c"/>
        <feComposite in="c" in2="SourceGraphic" operator="in" result="ink"/>
        <feGaussianBlur in="ink" stdDeviation="1.8" result="halo"/>
        <feMerge><feMergeNode in="halo"/><feMergeNode in="ink"/></feMerge>
      </filter>
      <filter id="${fid}_ms_off" x="-20%" y="-20%" width="140%" height="140%">
        <feFlood flood-color="#8B84A8" result="c"/>
        <feComposite in="c" in2="SourceGraphic" operator="in"/>
      </filter>
      <pattern id="${fid}_blk" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(180,95,88,0.22)" stroke-width="2"/>
      </pattern>
      <pattern id="${fid}_err" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(211,106,101,0.45)" stroke-width="2"/>
      </pattern>
    </defs>`);

    /* === 第 1 层：底材（异形锯齿金属 / 经典 4x4 退化路径） === */
    parts.push('<g class="layer-base" pointer-events="none">');
    parts.push(`<rect class="board-bg" x="0" y="0" width="${geo.cw}" height="${geo.ch}" rx="4"/>`);
    if (plate.generated) {
      parts.push(`<path class="plate-metal-slab" d="${geo.slabPath}" fill="url(#${fid}_metal)" fill-rule="nonzero"/>`);
      parts.push(`<path class="plate-metal-bevel" d="${geo.slabPath}"/>`);
      const rimEdges = [];
      cellsList.forEach(([x, y]) => {
        const [px, py] = cellXY(x, y);
        parts.push(`<rect class="plate-cell-bed" x="${px + 0.5}" y="${py + 0.5}" width="${CELL - 1}" height="${CELL - 1}"/>`);
        if (!plate.cells.has(x + ',' + (y - 1))) rimEdges.push(`M${px} ${py} h${CELL}`);
        if (!plate.cells.has(x + ',' + (y + 1))) rimEdges.push(`M${px} ${py + CELL} h${CELL}`);
        if (!plate.cells.has((x - 1) + ',' + y)) rimEdges.push(`M${px} ${py} v${CELL}`);
        if (!plate.cells.has((x + 1) + ',' + y)) rimEdges.push(`M${px + CELL} ${py} v${CELL}`);
      });
      parts.push(`<path class="plate-edge-rim" d="${rimEdges.join(' ')}"/>`);
    } else {
      const n = plate.size;
      parts.push(`<rect class="board-frame" x="${gx - 2}" y="${gy - 2}" width="${CELL * n + 4}" height="${CELL * n + 4}" rx="2"/>`);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (!blocked.has(x + ',' + y)) continue;
          const [px, py] = cellXY(x, y);
          parts.push(`<rect class="cell-blocked" x="${px + 1}" y="${py + 1}" width="${CELL - 2}" height="${CELL - 2}"/>
            <rect x="${px + 1}" y="${py + 1}" width="${CELL - 2}" height="${CELL - 2}" fill="url(#${fid}_blk)"/>
            <circle cx="${px + CELL / 2}" cy="${py + CELL / 2}" r="7" fill="rgba(16,12,18,0.85)" stroke="rgba(180,95,88,0.45)" stroke-width="1.2"/>
            <path d="M${px + CELL / 2 - 3} ${py + CELL / 2 - 3} l6 6 M${px + CELL / 2 + 3} ${py + CELL / 2 - 3} l-6 6" stroke="rgba(211,106,101,0.6)" stroke-width="1.4"/>`);
        }
      }
      for (let i = 0; i <= n; i++) {
        parts.push(`<line class="grid" x1="${gx + i * CELL}" y1="${gy}" x2="${gx + i * CELL}" y2="${gy + n * CELL}"/>`);
        parts.push(`<line class="grid" x1="${gx}" y1="${gy + i * CELL}" x2="${gx + n * CELL}" y2="${gy + i * CELL}"/>`);
      }
    }
    parts.push('</g>');

    /* === 第 2 层：功法膜（半透明底膜 + 单色片段 feFlood 染色） === */
    parts.push('<g class="layer-manuscript" pointer-events="none">');
    const ms = o.ms;
    if (ms && !ms.disabled && ms.oriented && ms.fits) {
      const aligned = new Set(ms.cov.alignedCells || []);
      const entryKey = (ms.oriented.entry[0] + ms.ox) + ',' + (ms.oriented.entry[1] + ms.oy);
      const exitKeys = new Set((ms.oriented.exits || []).map((c) => (c[0] + ms.ox) + ',' + (c[1] + ms.oy)));
      ms.oriented.cells.forEach(([lx, ly]) => {
        const ax = lx + ms.ox;
        const ay = ly + ms.oy;
        const ak = ax + ',' + ay;
        const [px, py] = cellXY(ax, ay);
        const on = aligned.has(ak);
        parts.push(`<rect x="${px + 1.5}" y="${py + 1.5}" width="${CELL - 3}" height="${CELL - 3}" fill="url(#${fid}_mem)" opacity="${on ? '0.78' : '0.42'}"/>`);
        parts.push(`<rect class="${on ? 'ms-cell-on' : 'ms-cell-off'}" x="${px + 2}" y="${py + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="2"/>`);

        const dirs = ms.oriented.veins[lx + ',' + ly] || [];
        const file = veinFileName(dirs);
        if (file) {
          parts.push(`<image href="assets/art/inscription-v1/${file}.png" x="${px}" y="${py}" width="${CELL}" height="${CELL}" preserveAspectRatio="none" filter="url(#${fid}_ms_${on ? 'on' : 'off'})" opacity="${on ? '0.94' : '0.42'}"/>`);
        }
        if (ak === entryKey) {
          parts.push(`<circle class="ms-io-mark" cx="${px + 9}" cy="${py + 9}" r="3.2"/>`);
        } else if (exitKeys.has(ak)) {
          parts.push(`<polygon class="ms-io-mark exit" points="${px + CELL - 9},${py + CELL - 13} ${px + CELL - 5},${py + CELL - 9} ${px + CELL - 9},${py + CELL - 5} ${px + CELL - 13},${py + CELL - 9}"/>`);
        }
      });
      /* 可拖命中区：功法膜和构件一样能被抓起换位置 */
      if (o.interactive !== false) {
        parts.push('<g class="layer-ms-hit">');
        ms.oriented.cells.forEach(([lx, ly]) => {
          const [px, py] = cellXY(lx + ms.ox, ly + ms.oy);
          parts.push(`<rect class="ms-hit" x="${px + 1}" y="${py + 1}" width="${CELL - 2}" height="${CELL - 2}"
            fill="transparent" pointer-events="all" data-act="wsMsGrab" data-id="ms" role="button"
            tabindex="0"><title>拖动功法膜换位置</title></rect>`);
        });
        parts.push('</g>');
      }
    }
    parts.push('</g>');

    /* === 第 3 层：构件纹章（实心金框 + 纹理实图） === */
    const placementById = new Map((placements || []).map((p) => [p.itemId, p]));
    const overlayFlows = [];
    const builtData = [];
    parts.push('<g class="layer-runes">');
    L.built.forEach((b) => {
      const pl = placementById.get(b.item.id) || { x: 0, y: 0 };
      const fill = TEMPLATE_COLOR[b.tpl.id] || '#2C2A3A';
      const isSelected = o.pickId === b.item.id;
      const isErr = errorItems.has(b.item.id);
      const isLocked = locked.has(b.item.id);

      const inPorts = b.aps.filter((p) => p.role === 'in');
      const outPorts = b.aps.filter((p) => p.role === 'out');
      const partLive = b.aps.some((p) => flow.fwd.has(b.item.id + ':' + p.id) && flow.rev.has(b.item.id + ':' + p.id));
      const partCharged = b.aps.some((p) => flow.fwd.has(b.item.id + ':' + p.id));
      const goldFrame = partLive ? '#E6BF6B' : partCharged ? '#C9A75E' : '#A48549';

      parts.push(`<g class="part-group ${isSelected ? 'selected' : ''} ${partLive ? 'live' : partCharged ? 'charged' : 'dormant'} ${isLocked ? 'locked' : ''}"
        data-act="wsGrab" data-id="${b.item.id}" data-px="${pl.x}" data-py="${pl.y}">
        <title>${esc(b.tpl.name)} · 点击选中 · 拖拽移动 · 右键/滚轮旋转${isLocked ? '' : ' · 双击卸下'}</title>`);
      parts.push(renderUnifiedBody(b.abs, fill, goldFrame, isSelected, isErr, gx, gy, 'part-outline'));

      const tracePaths = [];
      inPorts.forEach((ip) => {
        outPorts.forEach((op) => {
          const ik = b.item.id + ':' + ip.id;
          const ok = b.item.id + ':' + op.id;
          const isLinkLive = flow.fwd.has(ik) && flow.rev.has(ok) && flow.fwd.has(ok) && flow.rev.has(ik);
          const isLinkCharged = flow.fwd.has(ik) && flow.fwd.has(ok);
          const pts = [portPoint(ip)];
          orthoCellPath(b.abs, ip.cell, op.cell).forEach(([cx, cy]) => pts.push(cellCenter(cx, cy)));
          pts.push(portPoint(op));
          tracePaths.push({ d: 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L'), isLinkLive, isLinkCharged });
        });
      });
      tracePaths.forEach((tp) => {
        parts.push(`<path class="rune-groove" d="${tp.d}"/>`);
        const cls = tp.isLinkLive ? 'rune-flow live' : tp.isLinkCharged ? 'rune-flow charged' : 'rune-flow dormant';
        parts.push(`<path class="${cls}" d="${tp.d}"/>`);
      });

      const avgX = b.abs.reduce((s, c) => s + cellCenter(c.x, c.y)[0], 0) / b.abs.length;
      const avgY = b.abs.reduce((s, c) => s + cellCenter(c.x, c.y)[1], 0) / b.abs.length;
      const c0 = cellCenter(b.abs[0].x, b.abs[0].y);
      const flowCol = partLive ? '#F2CF7E' : partCharged ? '#7FBBC8' : '#7A6F63';
      if (b.tpl.capacitor) {
        parts.push(`<polygon points="${avgX},${avgY - 12} ${avgX + 12},${avgY} ${avgX},${avgY + 12} ${avgX - 12},${avgY}" fill="#1B1326" stroke="${flowCol}" stroke-width="1.6"/>
          <circle cx="${avgX}" cy="${avgY}" r="3.5" fill="${partLive ? '#AD8AC7' : flowCol}"/>`);
      } else if (b.tpl.split) {
        const junc = b.abs.find((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => b.abs.some((o2) => o2.x === c.x + dx && o2.y === c.y + dy)).length >= 3) || b.abs[0];
        const [jx, jy] = cellCenter(junc.x, junc.y);
        parts.push(`<polygon points="${jx},${jy - 7} ${jx + 7},${jy} ${jx},${jy + 7} ${jx - 7},${jy}" fill="#241833" stroke="${flowCol}" stroke-width="1.5"/>`);
      } else if (b.tpl.gate) {
        const mx = (portPoint(inPorts[0])[0] + portPoint(outPorts[0])[0]) / 2;
        const my = (portPoint(inPorts[0])[1] + portPoint(outPorts[0])[1]) / 2;
        parts.push(`<circle cx="${mx}" cy="${my}" r="8" fill="#1E1016" stroke="#D36A65" stroke-width="1.4"/>
          <line x1="${mx - 4}" y1="${my}" x2="${mx + 4}" y2="${my}" stroke="#D36A65" stroke-width="1.6"/>`);
      } else if (b.tpl.ember) {
        const mx = (portPoint(inPorts[0])[0] + portPoint(outPorts[0])[0]) / 2;
        const my = (portPoint(inPorts[0])[1] + portPoint(outPorts[0])[1]) / 2;
        parts.push(`<polygon points="${mx},${my - 7} ${mx + 5},${my} ${mx},${my + 7} ${mx - 5},${my}" fill="#2B140C" stroke="#D87843" stroke-width="1.5"/>`);
      } else {
        parts.push(`<polygon points="${c0[0]},${c0[1] - 4} ${c0[0] + 4},${c0[1]} ${c0[0]},${c0[1] + 4} ${c0[0] - 4},${c0[1]}" fill="#15121E" stroke="${flowCol}" stroke-width="1.1"/>`);
      }

      const bx0 = gx + Math.min.apply(null, b.abs.map((c) => c.x)) * CELL;
      const by0 = gy + Math.min.apply(null, b.abs.map((c) => c.y)) * CELL;
      const runeTag = V.RuneArt && V.RuneArt.image
        ? V.RuneArt.image(b.tpl.id, {
          x: bx0, y: by0, cell: CELL,
          rotation: pl.rotation || 0, mirrorY: !!pl.mirrorY,
          cls: partLive ? 'rune-live' : partCharged ? 'rune-charged' : 'rune-dormant',
        })
        : '';
      if (runeTag) parts.push(runeTag);

      const labelCell = b.abs.slice().sort((a, c) => c.y - a.y || a.x - c.x)[0];
      const [lx, ly] = cellXY(labelCell.x, labelCell.y);
      parts.push(`<text class="part-label" x="${lx + CELL / 2}" y="${ly + CELL - 8}" text-anchor="middle">${esc(b.tpl.name)}</text>`);
      if (isLocked) {
        parts.push(`<text class="part-lock" x="${lx + CELL - 9}" y="${ly + 14}" text-anchor="end">锁</text>`);
      }
      b.abs.forEach((c) => {
        const [hx, hy] = cellXY(c.x, c.y);
        parts.push(`<rect class="part-hit" x="${hx}" y="${hy}" width="${CELL}" height="${CELL}" fill="transparent"/>`);
      });
      parts.push('</g>');

      tracePaths.forEach((tp) => {
        if (tp.isLinkLive) overlayFlows.push(`<path class="rune-pulse" d="${tp.d}"/>`);
        else if (tp.isLinkCharged && runeTag) overlayFlows.push(`<path class="rune-flow charged overlay" d="${tp.d}"/>`);
      });
      builtData.push({ b, isSelected, isErr });
    });
    parts.push('</g>');

    /* === 第 4 层：高亮 / 通电动画 / 端子 / 错误标红 / 交互命中 === */
    parts.push('<g class="layer-highlights">');
    parts.push('<g class="layer-fx" pointer-events="none">');
    overlayFlows.forEach((fHtml) => parts.push(fHtml));

    const seenEdge = new Set();
    const portPoints = new Map();
    L.ports.forEach((p) => portPoints.set(p.itemId + ':' + p.id, portPoint(p)));
    Object.values(terminals).forEach((t) => portPoints.set('T:' + t.id, portPoint(t)));
    L.edges.forEach((e) => {
      if (e.internal) return;
      const k = e.from + '>' + e.to;
      if (seenEdge.has(k)) return;
      seenEdge.add(k);
      const a = portPoints.get(e.from);
      const b = portPoints.get(e.to);
      if (!a || !b) return;
      const isLive = flow.fwd.has(e.from) && flow.fwd.has(e.to) && flow.rev.has(e.from) && flow.rev.has(e.to);
      const isCharged = flow.fwd.has(e.from) && flow.fwd.has(e.to);
      const cls = isLive ? 'link-flow live' : isCharged ? 'link-flow charged' : 'link-flow';
      parts.push(`<line class="link ${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
      if (isLive) parts.push(`<circle class="link-spark" cx="${(a[0] + b[0]) / 2}" cy="${(a[1] + b[1]) / 2}" r="2.2"/>`);
    });

    builtData.forEach(({ b, isSelected, isErr }) => {
      if (isSelected) parts.push(renderUnifiedBody(b.abs, 'none', '#F2CF7E', true, isErr, gx, gy, 'part-unified-frame'));
      b.aps.forEach((p) => {
        const [px, py] = portPoint(p);
        const cls = p.role === 'in' ? 'port-in' : 'port-out';
        const pk = b.item.id + ':' + p.id;
        const lit = flow.fwd.has(pk) && flow.rev.has(pk) ? 'lit' : flow.fwd.has(pk) ? 'charged' : '';
        parts.push(`<circle class="${cls} ${lit}" cx="${px}" cy="${py}" r="3.6"/>`);
      });
    });

    /* 终端（画在 plate.terminals 所指板面边界外沿） */
    Object.values(terminals).forEach((t) => {
      const [x1, y1] = portPoint(t);
      const [x2, y2] = terminalPoint(t, true);
      const isIn = t.role === 'in';
      const active = isIn ? flow.fwd.has('T:' + t.id) : (flow.fwd.has('T:' + t.id) && flow.rev.has('T:' + t.id));
      const litCls = active ? (isIn ? 'term-lit-in' : 'term-lit-out') : 'term-dim';
      parts.push(`<line class="link ${isIn ? 'link-in' : 'link-out'} ${active ? 'term-wire-lit' : ''}" x1="${x2}" y1="${y2}" x2="${x1}" y2="${y1}"/>`);
      parts.push(`<rect class="terminal ${isIn ? 'terminal-in' : 'terminal-out'} ${litCls}" data-term="${t.id}" x="${x2 - 4}" y="${y2 - 4}" width="8" height="8" rx="1"/>`);
      let lx = x2;
      let ly = y2 + 3;
      let anchor = 'middle';
      if (t.dir === 'W') { lx = x2 - 8; anchor = 'end'; }
      else if (t.dir === 'E') { lx = x2 + 8; anchor = 'start'; }
      else if (t.dir === 'N') { ly = y2 - 9; }
      else { ly = y2 + 15; }
      parts.push(`<text class="terminal-label ${active ? 'lit' : ''}" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(t.name)}</text>`);
    });

    /* 冲突/不在板面红框 */
    errorCells.forEach((k) => {
      const [ex, ey] = k.split(',').map(Number);
      if (ex < 0 || ey < 0 || ex >= plate.size || ey >= plate.size) return;
      const [px, py] = cellXY(ex, ey);
      parts.push(`<rect class="cell-err" x="${px + 2}" y="${py + 2}" width="${CELL - 4}" height="${CELL - 4}" fill="url(#${fid}_err)"/>`);
    });
    parts.push('</g>');

    if (o.interactive) {
      /* 功法膜占的格不算空格：它们有自己的拖拽命中层，不能被「点空格放置」抢走 */
      const msCells = new Set();
      if (o.ms && !o.ms.disabled && o.ms.oriented && o.ms.fits) {
        o.ms.oriented.cells.forEach(([lx, ly]) => msCells.add((lx + o.ms.ox) + ',' + (ly + o.ms.oy)));
      }
      if (plate.generated) {
        cellsList.forEach(([x, y]) => {
          if (cellsUsed.has(x + ',' + y) || msCells.has(x + ',' + y)) return;
          const [px, py] = cellXY(x, y);
          parts.push(`<rect class="hit" x="${px}" y="${py}" width="${CELL}" height="${CELL}" data-act="wsCell" data-id="${x},${y}" role="button" tabindex="0"><title>格 (${x},${y}) 点击放置选中构件</title></rect>`);
        });
      } else {
        for (let y = 0; y < plate.size; y++) {
          for (let x = 0; x < plate.size; x++) {
            if (cellsUsed.has(x + ',' + y) || msCells.has(x + ',' + y)) continue;
            const [px, py] = cellXY(x, y);
            parts.push(`<rect class="hit" x="${px}" y="${py}" width="${CELL}" height="${CELL}" data-act="wsCell" data-id="${x},${y}" role="button" tabindex="0"><title>格 (${x},${y})${blocked.has(x + ',' + y) ? ' 屏蔽格（不可放置）' : ' 点击放置选中构件'}</title></rect>`);
          }
        }
      }
    }
    parts.push('<g class="drop-ghost" pointer-events="none" style="display:none"></g>');
    parts.push('</g>');

    parts.push('</svg>');
    return parts.join('');
  }

  /** 微型占格轮廓 SVG：供构件库、仓库、掉落界面一眼区分形状与端口。 */
  function miniShapeSvg(templateId, rotation, mirrorY) {
    const tpl = D().template(templateId);
    if (!tpl) return '';
    const tf = V.Circuit.transformTemplate(tpl, rotation || 0, !!mirrorY);
    const maxX = Math.max(0, ...tf.cells.map((c) => c.x));
    const maxY = Math.max(0, ...tf.cells.map((c) => c.y));
    const span = Math.max(maxX + 1, maxY + 1, 2);
    const step = 11;
    const pad = 4;
    const size = span * step + pad * 2;
    const ox = pad + ((span - (maxX + 1)) * step) / 2;
    const oy = pad + ((span - (maxY + 1)) * step) / 2;
    const fill = TEMPLATE_COLOR[templateId] || '#2C2A3A';
    const edge = TEMPLATE_EDGE[templateId] || '#8A6F32';
    const cells = tf.cells.map((c) => `<rect x="${(ox + c.x * step + 0.6).toFixed(1)}" y="${(oy + c.y * step + 0.6).toFixed(1)}" width="${step - 1.2}" height="${step - 1.2}" rx="1.2" fill="${fill}" stroke="${edge}" stroke-width="0.9"/>`).join('');
    const runeImg = V.RuneArt && V.RuneArt.image
      ? V.RuneArt.image(templateId, { x: ox, y: oy, cell: step, rotation: rotation || 0, mirrorY: !!mirrorY })
      : '';
    const ports = tf.ports.map((pt) => {
      const [dx, dy] = DIR_VEC[pt.dir];
      const px = ox + pt.cell[0] * step + step / 2 + dx * (step / 2 - 0.5);
      const py = oy + pt.cell[1] * step + step / 2 + dy * (step / 2 - 0.5);
      return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.9" fill="${pt.role === 'in' ? '#7FBBC8' : '#F2CF7E'}" stroke="#0B0910" stroke-width="0.6"/>`;
    }).join('');
    return `<svg class="mini-shape" viewBox="0 0 ${size} ${size}" aria-hidden="true">${cells}${runeImg}${ports}</svg>`;
  }

  /* ------------------------------ 通用片段 ------------------------------ */

  function partName(state, id) {
    const it = state.itemsById[id];
    if (!it) return '（已失效）';
    if (it.kind === 'weapon') return D().weapon(it.templateId).name;
    return D().template(it.templateId).name;
  }

  function partMeta(state, id) {
    const it = state.itemsById[id];
    if (!it) return '';
    if (it.kind === 'weapon') {
      const w = D().weapon(it.templateId);
      return `主手 · 占 ${w.cells} 格 · ${w.main.energy} 能量`;
    }
    const t = D().template(it.templateId);
    return `回路 · ${t.cells.length} 格 · 负荷 ${t.load}`;
  }

  function partIcon(state, id) {
    const it = state.itemsById[id];
    if (!it) return '';
    if (it.kind === 'weapon') return tag('主手', 'tag-weapon');
    return tag('回路', 'tag-circuit');
  }

  /** Gambit 的人类可读描述，避免在界面上暴露内部 id。 */
  function ruleText(r) {
    if (!r) return '';
    const conds = (r.conditions || []).map((c) => {
      const meta = D().CONDITIONS.find((x) => x.id === c.type);
      if (!meta) return String(c.type);
      if (c.type === 'always') return meta.name;
      if (c.type === 'atSlot') return `${meta.name}${c.value}号位`;
      return `${meta.name}${c.value}%`;
    }).join(' 且 ') || '总是';
    const tgt = (D().TARGETS.find((x) => x.id === r.target) || {}).name || r.target;
    const act = (D().ACTIONS.find((x) => x.id === r.action) || {}).name || r.action;
    return `${conds} → ${act}（${tgt}）`;
  }

  function slotFitBadge(state, u, slot) {
    if (!u || !u.weaponId) return '';
    const it = state.itemsById[u.weaponId];
    if (!it || it.kind !== 'weapon') return '';
    const tid = it.templateId;
    if (tid === 'shortBlade') {
      return slot === 0
        ? '<span class="tag tag-ok">前锋适位 · 160%</span>'
        : '<span class="tag tag-warn">限1号位 · 将退回普攻</span>';
    }
    if (tid === 'longSpear') {
      if (slot === 0) return '<span class="tag tag-ok">1号位 · 突刺单体</span>';
      if (slot === 1) return '<span class="tag tag-ok">2号位 · 贯穿2人</span>';
      return '<span class="tag tag-warn">限1/2号位 · 不可用</span>';
    }
    if (tid === 'heavyCannon') {
      if (slot === 3) return '<span class="tag tag-ok">4号位 · 省能2⚡</span>';
      if (slot === 0) return '<span class="tag tag-warn">1号位自伤10%</span>';
      return '<span class="tag">需4⚡ · 4号位减半</span>';
    }
    if (tid === 'towerShield') {
      return slot === 0
        ? '<span class="tag tag-ok">1号位 · 减伤20%</span>'
        : '<span class="tag">标准站位</span>';
    }
    if (tid === 'ritualStaff') {
      return '<span class="tag tag-circuit">全位 · 治疗/法术</span>';
    }
    return '';
  }

  function hpLine(u, st) {
    const s = V.Roster.stats(st, u);
    const hp = u.hp == null ? s.maxHp : Math.min(u.hp, s.maxHp);
    return `<div class="mini">
      <span class="mini-name">${esc(u.name)}</span>
      <span class="mini-val">${hp}/${s.maxHp}</span>
      ${bar(hp, s.maxHp, 'hp')}
    </div>`;
  }

  /* ------------------------------ 标题 ------------------------------ */

  function titleScreen(state, ui) {
    const hasSave = !!ui.hadSave;
    const meta = hasSave
      ? `最深 ${state.bestDepth} 层 · ${state.gold} 金币 · ${state.roster.length} 位传奇`
      : '培养并保护你的传奇 · 可逆装配 · 遭遇可无限重试';
    return `<div class="v-title">
      <div class="v-title-bg">${V.Art.v1Tag('scene.camp', 'title-bg-img')}</div>
      <div class="v-title-glow"></div>
      <div class="v-title-frame">
        <div class="v-crest">✦</div>
        <h1 class="v-title-main">灰烬回廊</h1>
        <div class="v-title-sub">A S H E N &nbsp; C O R R I D O R</div>
        <div class="v-rule"></div>
        <p class="v-quote">“它每天夜里都会重新长出墙。”</p>
        ${btn(hasSave ? '继 续 远 征' : '开 始 一 次 远 征', 'titleStart', { cls: 'v-cta' })}
        <div class="v-title-meta">${esc(meta)}</div>
        <div class="v-title-tools">
          ${btn('⚙ 设置与存档', 'openSettings', { cls: 'ghost xs' })}
          ${btn('导出存档', 'exportSave', { cls: 'ghost xs' })}
          ${btn('导入存档', 'importSave', { cls: 'ghost xs' })}
          ${hasSave ? btn('抹去存档', 'resetSave', { cls: 'ghost xs danger' }) : ''}
        </div>
        ${ui.importOpen ? `<div class="v-import">
          <textarea id="importBox" rows="4" placeholder="把导出的存档文本粘到这里"></textarea>
          ${btn('确认导入', 'importConfirm', { cls: 'gold xs' })}
        </div>` : ''}
      </div>
      <div class="v-title-hint">活着撤离，东西才入仓。死在回廊里，什么也带不回来。</div>
    </div>`;
  }

  /* ------------------------------ 营地 ------------------------------ */

  function campScreen(state, ui) {
    const party = state.team.filter(Boolean);
    return `
    ${V.Art.sceneBanner('scene.camp', 'scene-camp', '灰烬前哨',
    `${state.roster.length} 位传奇 · 金币 ${state.gold} · 遗物 ${state.shards}`)}
    <div class="camp-cols">
      <div class="camp-col">
      ${panel('四位传奇', `<div class="vet-grid">${state.team.map((uid, slot) => {
        const u = uid ? state.roster.find((x) => x.id === uid) : null;
        const stressCls = u && u.stress >= 70 ? 'danger' : u && u.stress >= 40 ? 'warn' : '';
        return `<div class="vet-slot ${u ? '' : 'empty'}">
          <div class="vet-slot-no">${slot + 1}号位</div>
          ${u ? `
            ${V.Art.portraitTag(u.skinId, 'vet-slot-portrait')}
            <div class="vet-name">${esc(u.name)}</div>
            <div class="vet-body">${esc(D().body(u.bodyPreset).name)}</div>
            <div class="vet-weapon">${esc(partName(state, u.weaponId))}</div>
            ${hpLine(u, state)}
            <div class="vet-stress ${stressCls}">压力 ${u.stress}/100</div>
            <div class="mt1">${btn('查看', 'inspectUnit', { cls: 'ghost xs', data: { id: u.id } })}</div>
          ` : '<div class="vet-empty">空位</div>'}
        </div>`;
      }).join('')}</div>`)}
      ${panel('战史', state.roster.map((u) => {
    const h = V.Roster.history(state, u.id);
    return `<div class="hist-row">
      <span class="hist-name">${esc(u.name)}</span>
      <span class="muted tiny">合格撤离 ${h.eligibleRuns} 次 · 逻辑槽 ${h.logicSlots}</span>
      <span class="muted tiny">${h.attunement.traitId ? `调谐：${esc(h.attunement.traitName)}` : `调谐 ${h.attunement.runs}/${h.attunement.need}`}</span>
    </div>`;
  }).join(''))}
      </div>

      <div class="camp-col">
      ${panel('出发准备', `
        <p class="muted small">远征 7 层。<b class="gold">活着回来，东西才入仓。</b>
        战斗可以无限次「重新整备」，敌人和初始种子不会变。</p>
        <div class="row wrap mt3">
          ${btn('⚔ 下潜', 'startRun', { cls: 'gold', disabled: party.length === 0 })}
          ${btn('队伍编成', 'go', { cls: 'ghost', data: { v: 'team' } })}
          ${btn('工坊', 'go', { cls: 'ghost', data: { v: 'workshop' } })}
          ${btn('招募台', 'go', { cls: 'ghost', data: { v: 'recruit' } })}
          ${btn('仓库', 'go', { cls: 'ghost', data: { v: 'stash' } })}
          ${btn('战史', 'go', { cls: 'ghost', data: { v: 'history' } })}
        </div>
        <div class="row wrap mt3">
          <span class="muted small">难度</span>
          ${['normal', 'deep', 'nightmare'].map((d) => btn(
    { normal: '常规', deep: '深入', nightmare: '梦魇' }[d], 'setDifficulty',
    { cls: state.difficulty === d ? 'gold xs' : 'ghost xs', data: { id: d } },
  )).join('')}
        </div>
        <div class="mt3 muted small">已解锁难度：${state.unlockedDifficulties.map((d) => esc({ normal: '常规', deep: '深入', nightmare: '梦魇' }[d])).join('、')}</div>
      `)}
      ${panel('怎么玩', `<ol class="howto">
        <li><b>编队</b>：四人各站一个身位，1 号位最靠前。短刃只能在前排出力；长矛站 2 号位能贯穿两个人；重炮 4 号位省能量。</li>
        <li><b>回路</b>：出手要用能量。「时钟」每次行动前送 2 单位，「受击」再送 2 单位。<span class="gold">能量不会自己变多</span>，只会被分流或蓄住。</li>
        <li><b>整备</b>：打不过就「重新整备」。敌人和初始种子不变，改身位和指令再来一次，不要钱。</li>
        <li><b>撤离</b>：活着回来东西才入仓。营火烙印很强，但烙进去的构件仍算本局风险池。</li>
      </ol>`)}
      </div>
    </div>`;
  }

  /* ------------------------------ 队伍 ------------------------------ */

  function teamScreen(state, ui) {
    const selected = state.roster.find((u) => u.id === ui.teamUnit) || state.roster[0];
    return `
    <div class="grid-2">
      ${panel('上场顺序', `<p class="muted small">1 号位最靠近敌人。短刃必须站 1 号位；长矛 2 号位能贯穿；重炮 4 号位最省能量。</p>
        <div class="vet-grid mt3">${state.team.map((uid, slot) => {
    const u = uid ? state.roster.find((x) => x.id === uid) : null;
    return `<div class="vet-slot ${u ? '' : 'empty'}">
      <div class="vet-slot-no">${slot + 1}号位</div>
      ${u ? V.Art.portraitTag(u.skinId, 'vet-slot-portrait') + `<div class="vet-name">${esc(u.name)}</div><div class="vet-weapon">${esc(partName(state, u.weaponId))}</div><div class="mt1">${slotFitBadge(state, u, slot)}</div>`
    : '<div class="vet-empty">空位</div>'}
      <div class="row tight mt2 slot-ops">
        ${slot > 0 ? btn('←', 'teamMove', { cls: 'ghost xs', data: { from: String(slot), to: String(slot - 1) } }) : ''}
        ${btn('换上', 'teamPick', { cls: 'ghost xs', data: { id: String(slot) } })}
        ${u ? btn('换下', 'teamClear', { cls: 'ghost xs', data: { id: String(slot) } }) : ''}
        ${slot < 3 ? btn('→', 'teamMove', { cls: 'ghost xs', data: { from: String(slot), to: String(slot + 1) } }) : ''}
      </div>
    </div>`;
  }).join('')}</div>
        ${ui.teamPickSlot != null ? `<div class="picker mt3"><div class="muted small mb2">选择角色放到 ${ui.teamPickSlot + 1} 号位</div>
        <div class="row wrap">${state.roster.map((u) => btn(u.name, 'teamSet', { cls: 'ghost xs', data: { slot: String(ui.teamPickSlot), id: u.id } })).join('')}</div></div>` : ''}
      `)}

      ${panel('传奇', `<div class="row wrap">${state.roster.map((u) => btn(
    `${u.name}${state.team.includes(u.id) ? ' ●' : ''}`, 'inspectUnit',
    { cls: u.id === selected.id ? 'gold xs' : 'ghost xs', data: { id: u.id } },
  )).join('')}</div>
      ${selected ? unitDetail(state, selected) : ''}`)}
    </div>`;
  }

  function unitDetail(state, u) {
    const s = V.Roster.stats(state, u);
    const w = state.itemsById[u.weaponId];
    const h = V.Roster.history(state, u.id);
    const weapons = state.stash.filter((id) => state.itemsById[id].kind === 'weapon');
    return `<div class="u-detail mt3">
      ${V.Art.portraitTag(u.skinId, 'unit-portrait')}
      <div class="u-detail-head"><b>${esc(u.name)}</b>
        <span class="muted small">${esc(D().body(u.bodyPreset).name)} · 压力 ${u.stress} · 逻辑槽 ${u.logicSlots}</span></div>
      <div class="stat-row">
        <span>生命 ${s.maxHp}</span><span>攻击 ${s.atk}</span><span>防御 ${s.def}</span><span>速度 ${s.spd}</span>
        <span>负荷 ${s.loadCap}</span>
      </div>
      <div class="mt2 small">主手：<b class="gold">${esc(partName(state, u.weaponId))}</b>
        <span class="muted">${esc(w ? D().weapon(w.templateId).main.desc : '')}</span></div>
      ${h.attunement.traitId
    ? `<div class="small success mt1">调谐已解锁：${esc(h.attunement.traitName)} — ${esc(h.attunement.traitDesc)}</div>`
    : `<div class="small muted mt1">调谐进度 ${h.attunement.runs}/${h.attunement.need}（同一主手三次合格撤离）</div>`}
      <div class="mt2 small">${weapons.length ? `换主手：${weapons.map((id) => btn(partName(state, id), 'equipWeapon', { cls: 'ghost xs', data: { uid: u.id, id } })).join(' ')}` : '<span class="muted">仓库里没有别的主手</span>'}</div>
      <div class="mt2 row wrap">${btn('编辑行为指令', 'editRules', { cls: 'ghost xs', data: { id: u.id } })}
        ${btn(state.gold >= 30 ? '安抚降压（30 金）' : '安抚（缺金币）', 'comfort', { cls: 'ghost xs', data: { id: u.id }, disabled: state.gold < 30 || u.stress === 0 })}</div>
    </div>`;
  }

  /* ------------------------------ 规则编辑 ------------------------------ */

  function rulesScreen(state, ui) {
    const u = state.roster.find((x) => x.id === ui.ruleUnit);
    if (!u) return panel('行为指令', '<p class="muted">先选一个角色。</p>');
    const rules = ui.ruleDraft || u.gambits;
    const inRun = !!(state.run && state.run.encounter);
    const pool = inRun
      ? state.run.encounter.preparation.formation.filter(Boolean).map((id) => state.roster.find((x) => x.id === id)).filter(Boolean)
      : state.roster;
    const w = state.itemsById[u.weaponId];
    const wMeta = w && w.kind === 'weapon' ? D().weapon(w.templateId) : null;
    const slotIdx = inRun ? state.run.encounter.preparation.formation.indexOf(u.id) : state.team.indexOf(u.id);

    return panel(`${esc(u.name)} 的行为指令`, `
      <div class="row wrap mb2">${pool.map((x) => btn(x.name, 'editRules', {
    cls: x.id === u.id ? 'gold xs' : 'ghost xs', data: { id: x.id },
  })).join('')}
        <div class="spacer"></div>
        ${slotIdx >= 0 ? slotFitBadge(state, u, slotIdx) : ''}
      </div>
      ${wMeta ? `<div class="tiny muted mb2">当前主手：<b class="gold">${esc(wMeta.name)}</b> — ${esc(wMeta.main.desc)}</div>` : ''}
      <p class="muted small">按从上到下的顺序检查，第一条条件、目标、能量与身位都合法的指令生效；均不可用时退回基础攻击。</p>
      <div class="rules mt2">${rules.map((r, i) => `<div class="rule-row ${r.enabled === false ? 'disabled' : ''}">
        <div class="rule-no">${i + 1}</div>
        <div class="rule-body">
          <div class="row wrap tight">
            <span class="muted tiny">条件</span>
            ${r.conditions.map((c, ci) => `<select data-act="ruleCond" data-id="${i}:${ci}">
              ${D().CONDITIONS.map((x) => `<option value="${x.id}" ${x.id === c.type ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>${c.type !== 'always' ? `<select data-act="ruleCondVal" data-id="${i}:${ci}">
              ${(c.type === 'atSlot' ? [1, 2, 3, 4] : D().THRESHOLDS).map((v) => `<option value="${v}" ${v === c.value ? 'selected' : ''}>${v}${c.type === 'atSlot' ? '号位' : '%'}</option>`).join('')}
            </select>` : ''}`).join('')}
            ${r.conditions.length < 2 ? btn('+条件', 'ruleAddCond', { cls: 'ghost xs', data: { id: String(i) } }) : ''}
          </div>
          <div class="row wrap tight mt1">
            <span class="muted tiny">目标</span>
            <select data-act="ruleTarget" data-id="${i}">
              ${D().TARGETS.map((x) => `<option value="${x.id}" ${x.id === r.target ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>
            <span class="muted tiny">动作</span>
            <select data-act="ruleAction" data-id="${i}">
              ${D().ACTIONS.map((x) => `<option value="${x.id}" ${x.id === r.action ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>
            <span class="tiny muted rule-preview">${esc(ruleText(r))}</span>
          </div>
        </div>
        <div class="rule-ops row tight">
          ${i > 0 ? btn('↑', 'ruleMoveUp', { cls: 'ghost xs', data: { id: String(i) } }) : ''}
          ${i < rules.length - 1 ? btn('↓', 'ruleMoveDown', { cls: 'ghost xs', data: { id: String(i) } }) : ''}
          ${btn(r.enabled === false ? '启用' : '停用', 'ruleToggle', { cls: r.enabled === false ? 'ghost xs' : 'on xs', data: { id: String(i) } })}
          ${btn('删', 'ruleDel', { cls: 'ghost xs danger', data: { id: String(i) } })}
        </div>
      </div>`).join('')}</div>
      <div class="row wrap mt3">${rules.length < u.logicSlots ? btn('+ 添加一条', 'ruleAdd', { cls: 'ghost' }) : `<span class="muted small">已用满 ${u.logicSlots} 个槽位</span>`}
        <div class="spacer"></div>
        ${btn('保存', 'ruleSave', { cls: 'gold' })}
        ${btn(inRun ? '返回战前整备' : '取消', 'ruleCancel', { cls: 'ghost' })}</div>
      ${ui.ruleErrors && ui.ruleErrors.length ? `<div class="err-box mt2">${ui.ruleErrors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
    `);
  }

  /* ------------------------------ 工坊 ------------------------------ */

  function draftSignature(list) {
    return (list || []).map((p) => `${p.itemId}:${p.x},${p.y},${p.rotation || 0},${p.mirrorY ? 1 : 0}`).sort().join('|');
  }

  /** 渲染功法膜覆盖率与贯通状态面板（分母永远是膜格数，摆不下时灰掉并给出明确原因）。 */
  function manuscriptPanelBody(plate, ms, unit, state) {
    const catalog = (D().MANUSCRIPT_ORDER || []).map((id) => D().MANUSCRIPTS[id]);
    const vault = (state && state.manuscriptVault) || [];
    const inVault = (id) => vault.some((m) => m.id === id);
    const equippedId = unit && unit.manuscript ? unit.manuscript.id : null;

    const picker = `<div class="row wrap tight mb2">
      ${catalog.map((m) => btn(`${m.name}${inVault(m.id) ? '' : '（未拥有）'}`, 'wsMsPick', {
        cls: ms && !ms.disabled && ms.id === m.id ? 'gold xs' : 'ghost xs',
        data: { id: m.id },
      })).join('')}
      ${btn('无', 'wsMsPick', { cls: ms && ms.disabled ? 'gold xs' : 'ghost xs', data: { id: 'none' } })}
    </div>
    <div class="row wrap tight mb2">
      ${equippedId
    ? btn('卸下功法', 'wsMsUnequip', { cls: 'ghost xs danger' })
    : (ms && !ms.disabled && inVault(ms.id)
      ? btn('把「' + esc(ms.spec.name) + '」装上', 'wsMsEquip', { cls: 'gold xs' })
      : '<span class="tiny muted">仓库里还没有这套功法（副本掉落 / 祭坛兑换）</span>')}
    </div>`;

    if (!ms || ms.disabled) {
      return `${picker}<div class="tiny muted">已关闭功法膜预览，仅显示生命金属底材与电路。</div>`;
    }

    const unfit = !ms.fits;
    const tierName = ms.cov.tier ? ms.cov.tier.name : '未达台阶';
    const pctText = `${ms.cov.aligned}/${ms.cov.total} = ${ms.cov.pct}%`;
    const cellsList = plateCellsList(plate);
    const altFit = unfit && V.Manuscript
      ? (D().MANUSCRIPT_ORDER || []).map((id) => D().MANUSCRIPTS[id])
        .find((m) => m && m.id !== ms.id && V.Manuscript.placements(V.Manuscript.normalize(m), cellsList).length > 0)
      : null;

    return `<div class="ms-panel ${unfit ? 'ms-unfit' : ''}" data-ms-fits="${ms.fits ? '1' : '0'}">
      ${picker}
      <div class="row wrap tight">
        <span class="small"><b class="${unfit ? 'danger' : 'gold'}">${esc(ms.spec.name)}</b> <span class="tiny muted">· 膜 ${ms.cov.total} 格</span></span>
        <div class="spacer"></div>
        <span class="tag ${unfit ? '' : ms.cov.tier ? 'tag-weapon' : ''}" data-ms-tier>${esc(unfit ? '无法覆盖' : tierName)}</span>
      </div>
      <div class="mt2">
        <div class="row tiny muted">
          <span>覆盖率（分母为膜格数）</span>
          <div class="spacer"></div>
          <span class="${unfit ? 'muted' : 'gold'}" data-ms-cov>${esc(pctText)}</span>
        </div>
        ${bar(ms.cov.aligned, ms.cov.total, ms.cov.pct >= 100 ? 'energy' : 'hp')}
      </div>
      <div class="ms-tier-row tiny muted">
        <span class="tag ${ms.rt.ok ? 'tag-circuit' : ''}" data-ms-route>贯通：${ms.rt.ok ? '已贯通' : '未贯通'}</span>
        <span>台阶：${ms.spec.tiers.map((t) => `${t.at}%`).join(' / ')}</span>
      </div>
      <div class="row wrap tight mt2">
        ${btn('旋膜 ⟳', 'wsMsRotate', { cls: 'ghost xs' })}
        ${btn('翻膜 ⇅', 'wsMsFlip', { cls: 'ghost xs' })}
        ${btn(`换落点 (${ms.validSpots.length ? `${ms.spotIdx + 1}/${ms.validSpots.length}` : '0'})`, 'wsMsShift', { cls: 'ghost xs', disabled: ms.validSpots.length <= 1 })}
      </div>
      ${unfit ? `<div class="ms-reason" data-ms-reason><div>${esc(ms.reason)}</div>${altFit ? btn(`切到可放的「${altFit.name}」`, 'wsMsPick', { cls: 'ghost xs mt1', data: { id: altFit.id } }) : ''}</div>` : ''}
    </div>`;
  }

  function workshopScreen(state, ui) {
    const unit = state.roster.find((u) => u.id === ui.wsUnit) || state.roster[0];
    const draft = ui.wsDraft || (unit ? unit.board.placements : []);
    const pv = unit ? V.Circuit.preview(state, unit.id, draft) : { ok: false, errors: ['没有角色'], occupied: [], load: 0, reachableOutputs: [] };
    const body = unit ? D().body(unit.bodyPreset) : null;
    const plate = V.Circuit.plateOf(unit || { bodyPreset: 'sturdy', plateSeed: 1 });
    const cellsList = plateCellsList(plate);
    const an = plate.generated && V.PlateGen ? V.PlateGen.analyze(cellsList) : null;
    const layout = V.Circuit.layout(state, draft, plate.terminals);
    const ms = resolveManuscript(unit, plate, ui, layout);

    const locked = new Set(ui.wsLocked || []);
    const draftIds = new Set(draft.map((p) => p.itemId));
    const originIds = unit ? unit.board.placements.map((p) => p.itemId) : [];
    const isDirty = unit && ui.wsMode !== 'inscribe' && draftSignature(draft) !== draftSignature(unit.board.placements);

    /* 构件库：仓库里的闲置回路 + （工坊模式下）本角色原板卸下来暂未放置的构件 */
    const stashCircuits = state.stash.filter((id) => state.itemsById[id] && state.itemsById[id].kind === 'circuit');
    const detachedOrigins = ui.wsMode === 'inscribe' ? [] : originIds.filter((id) => !stashCircuits.includes(id));
    const poolIds = [...stashCircuits, ...detachedOrigins].filter((id) => !draftIds.has(id));

    const pickedItem = ui.wsPick ? state.itemsById[ui.wsPick] : null;
    const pickedPlaced = ui.wsPick ? draft.find((p) => p.itemId === ui.wsPick) : null;
    const pickedTpl = pickedItem && pickedItem.kind === 'circuit' ? D().template(pickedItem.templateId) : null;
    const loadCap = body ? body.loadCap : 1;
    const loadOver = body && pv.load > body.loadCap;

    const surface = !plate.generated ? V.Art.imgTag('veteran.surface.board', 'board-surface-img') : '';
    return `
    ${V.Art.sceneBanner('veteran.scene.workshop', 'scene-workshop', '工坊', '可逆装配 · 停摆的构件不伪造连通')}
    <div class="ws-layout">
      <aside class="ws-left">
        ${panel('传奇', `<div class="row wrap">${state.roster.map((u) => btn(u.name, 'wsUnit', {
    cls: u.id === unit.id ? 'gold xs' : 'ghost xs', data: { id: u.id },
  })).join('')}</div>
        ${unit ? `<div class="mt2 small muted">底盘：<b class="text-hi">${esc(body.name)}</b> · 负荷上限 ${body.loadCap}</div>
        ${plate.generated && an
      ? `<div class="tiny muted mt1">板面：${an.count} 格 · ${an.width}×${an.height}${an.holes ? ` · ${an.holes} 孔` : ''} · 最长连 ${an.longestRun}</div>`
      : `<div class="tiny muted mt1">屏蔽格：${body.blocked.map((b) => `(${b[0]},${b[1]})`).join(' ')}</div>`}` : ''}`)}
        ${panel('校验', `<div class="row wrap">
            <span class="${pv.ok ? 'success' : 'danger'} small"><b>${pv.ok ? '板面合法' : '板面有问题'}</b></span>
            <div class="spacer"></div>
            <span class="tiny muted">占格 ${pv.occupied.length}/${cellsList.length}</span>
          </div>
          <div class="mt2">
            <div class="row tiny muted"><span>负荷</span><div class="spacer"></div><span class="${loadOver ? 'danger' : ''}">${pv.load} / ${body ? body.loadCap : '?'}</span></div>
            ${bar(pv.load, loadCap, loadOver ? 'hp' : 'energy')}
          </div>
          <div class="row wrap tight mt2">
            <span class="tiny muted">输出：</span>
            <span class="tag ${pv.reachableOutputs.includes('main') ? 'tag-weapon' : ''}">主手 ${pv.reachableOutputs.includes('main') ? '● 已接通' : '○ 未接通'}</span>
            <span class="tag ${pv.reachableOutputs.includes('support') ? 'tag-circuit' : ''}">保护 ${pv.reachableOutputs.includes('support') ? '● 已接通' : '○ 未接通'}</span>
          </div>
          ${(!pv.ok && pv.errors.length) || (ui.wsErrors && ui.wsErrors.length)
    ? `<div class="err-box mt2">${(ui.wsErrors && ui.wsErrors.length ? ui.wsErrors : pv.errors).slice(0, 4).map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
          ${pv.ok && !pv.reachableOutputs.length ? '<div class="mt2 tiny muted">还没有接通任何输出——可以先存下来，回头在工坊里接。</div>' : ''}`)}
        ${panel('功法膜覆盖率', manuscriptPanelBody(plate, ms, unit, state))}
      </aside>

      <div class="ws-board">
        <div class="board-stack">
          ${surface ? `<div class="board-surface">${surface}</div>` : ''}
          ${boardSvg(state, unit.id, draft, { interactive: true, pickId: ui.wsPick, locked, ms })}
        </div>
        ${pickedTpl ? `<div class="ws-focus mt2">
          <div class="row wrap tight">
            ${V.RuneArt && V.RuneArt.thumb ? V.RuneArt.thumb(pickedTpl.id, 'ws-focus-thumb') : ''}
            <span class="gold small">${esc(pickedTpl.name)}</span>
            <span class="tag">${pickedTpl.cells.length} 格</span>
            <span class="tag">负荷 ${pickedTpl.load}</span>
            <span class="tiny muted">${pickedPlaced ? `位于 (${pickedPlaced.x},${pickedPlaced.y}) · 拖动移位 / 滚轮·右键旋转 / 双击卸下` : '悬停板面看落点 · 点击或拖拽放置 · 滚轮/R旋转'} · 旋${pickedPlaced ? pickedPlaced.rotation : ui.wsRot}${(pickedPlaced ? pickedPlaced.mirrorY : ui.wsMirror) ? ' 翻' : ''}</span>
          </div>
          <div class="tiny muted mt1">${esc(pickedTpl.desc)}</div>
        </div>` : `<div class="ws-focus muted tiny mt2">点选或拖拽右侧构件到${plate.generated ? '异形金属' : ' 4×4 '}板面；双击右侧可直接装上，双击板上可直接卸下，滚轮或右键随时旋转。</div>`}
        <div class="row wrap tight mt2">
          ${btn('旋转 ⟳ (R)', 'wsRotate', { cls: 'ghost sm', disabled: !ui.wsPick })}
          ${btn('翻转 ⇅ (F)', 'wsFlip', { cls: 'ghost sm', disabled: !ui.wsPick })}
          ${ui.wsPick ? btn('取消选中 (Esc)', 'wsCancelPick', { cls: 'ghost sm' }) : ''}
          ${btn('撤销', 'wsUndo', { cls: 'ghost sm', disabled: !(ui.wsHist && ui.wsHist.length) })}
          ${btn('重做', 'wsRedo', { cls: 'ghost sm', disabled: !(ui.wsRedo && ui.wsRedo.length) })}
          ${btn('清空', 'wsClear', { cls: 'ghost sm danger', disabled: !draft.some((p) => !locked.has(p.itemId)) })}
          <div class="spacer"></div>
          ${ui.wsMode === 'inscribe' ? '' : btn(isDirty ? '保存板面 *' : '保存板面', 'wsSave', { cls: isDirty ? 'gold sm dirty' : 'gold sm' })}
        </div>
        ${ui.wsMode === 'inscribe' ? '' : `<div class="row wrap tight mt2">
          <span class="tiny muted">辅助布线：</span>
          ${btn('自动接通', 'wsAutoConnect', { cls: 'ghost xs' })}
          ${btn('基础直供', 'wsPreset', { cls: 'ghost xs', data: { id: 'basic' } })}
          ${btn('蓄能回路', 'wsPreset', { cls: 'ghost xs', data: { id: 'charge' } })}
          ${isDirty ? btn('还原已存', 'wsRevert', { cls: 'ghost xs' }) : ''}
        </div>`}
        <div class="ws-hint-strip">
          <span><i class="leg-dot live"></i>金线：已接通</span>
          <span><i class="leg-dot charged"></i>蓝线：未通输出</span>
          <span><i class="leg-dot dormant"></i>灰线：休眠</span>
          <span class="muted"><b>滚轮/右键/R</b> 旋转 · <b>F</b> 翻转 · <b>双击</b> 装/卸 · <b>Del</b> 卸下 · <b>Esc</b> 取消选</span>
        </div>
      </div>

      <aside class="ws-right">
        ${panel(`构件库（${poolIds.length}）`, `
          <div class="muted tiny mb2">拖到板面、点选悬停预览放置，或双击快速装上。${ui.wsMode === 'inscribe' ? '原构件不能删除。' : ''}</div>
          <div class="part-list">${poolIds.length ? poolIds.map((id) => {
    const it = state.itemsById[id];
    const t = D().template(it.templateId);
    const isPicked = ui.wsPick === id;
    const rot = isPicked ? ui.wsRot : 0;
    const mir = isPicked ? ui.wsMirror : false;
    return `<button class="part-item ${isPicked ? 'on' : ''}" data-act="wsPick" data-id="${id}" data-stash="1"
      ${locked.has(id) ? 'disabled' : ''}>
      <span class="part-shape-box">${miniShapeSvg(t.id, rot, mir)}</span>
      <span class="part-text">
        <span class="part-name">${esc(t.name)} <span class="tiny muted">· ${t.cells.length}格 · 负荷${t.load}</span></span>
        <span class="part-meta">${esc(t.desc)}</span>
      </span>
    </button>`;
  }).join('') : '<div class="muted small">没有闲置构件了</div>'}</div>
        `)}
        ${panel(`板面上的构件（${draft.length}）`, `<div class="part-list">${draft.length ? draft.map((p) => {
    const it = state.itemsById[p.itemId];
    if (!it) return '';
    const t = D().template(it.templateId);
    const isLocked = locked.has(p.itemId) || ui.wsMode === 'inscribe';
    return `<div class="part-item ${ui.wsPick === p.itemId ? 'on' : ''}" data-act="wsPick" data-id="${p.itemId}">
      <span class="part-shape-box">${miniShapeSvg(t.id, p.rotation, p.mirrorY)}</span>
      <span class="part-text">
        <span class="part-name">${esc(t.name)}</span>
        <span class="part-meta">(${p.x},${p.y}) · 旋${p.rotation}${p.mirrorY ? ' 翻' : ''} · 负荷${t.load}</span>
      </span>
      <span class="row tight">
        ${isLocked ? '' : btn('移', 'wsRemove', { cls: 'ghost xs danger', data: { id: p.itemId } })}
      </span>
    </div>`;
  }).join('') : '<div class="muted small">板面空着</div>'}</div>`)}
        ${ui.wsMode === 'inscribe' ? `<div class="col mt2">
          ${btn('按推荐布局摆放', 'wsAutoLayout', { cls: 'ghost sm' })}
          ${btn('确认烙印（生命上限 ×0.8，压力 +40）', 'wsInscribe', { cls: 'gold sm', disabled: !(pv.ok && pv.reachableOutputs.length) })}
          ${btn('取消', 'cancelInscribe', { cls: 'ghost sm' })}
          <div class="muted tiny">原构件必须保留；新增构件只能有一件。直接拖动原构件就能换位置。</div>
        </div>` : ''}
      </aside>
    </div>`;
  }

  /* ------------------------------ 招募 / 仓库 / 战史 ------------------------------ */

  function recruitScreen(state, ui) {
    const offers = state.shop || [];
    return panel('招募台', `
      <div class="row mb3"><span class="muted small">金币 <b class="gold">${state.gold}</b> · 营地人数 ${state.roster.length}/8</span>
        <div class="spacer"></div>${btn('打听新血（12 金）', 'refreshShop', { cls: 'gold sm', disabled: state.gold < 12 })}</div>
      <div class="grid-3">${offers.length ? offers.map((o) => `<div class="recruit-card ${o.sold ? 'sold' : ''}">
        ${V.Art.portraitTag(o.skinId, 'recruit-portrait')}
        <div class="recruit-name">${esc(o.name)}</div>
        <div class="muted small">${esc(D().body(o.bodyPreset).name)} · ${esc(D().weapon(o.weaponId).name)}</div>
        <div class="muted tiny mt1">${esc(D().body(o.bodyPreset).desc)}</div>
        <div class="row mt2"><span class="gold">${o.price} 金</span>
          <div class="spacer"></div>
          ${o.sold ? '<span class="muted small">已招募</span>'
    : btn('招募', 'recruitOffer', { cls: 'gold xs', data: { id: o.id }, disabled: state.gold < o.price })}
        </div>
      </div>`).join('') : `<div class="empty-call panel-wide">
        <div class="small">火塘边暂时没有闲散的老兵。</div>
        <div class="tiny muted mt1">花 12 金币向灰烬前哨打听一轮，可立刻物色三位新传奇（随机底盘与主手）。</div>
      </div>`}</div>
      ${ui.shopMsg ? `<div class="err-box mt2">${esc(ui.shopMsg)}</div>` : ''}
    `);
  }

  function stashScreen(state) {
    const list = state.stash;
    return panel(`仓库（${list.length} 件）`, `
      <p class="muted small">远征里捡到的构件，活着回来后在这里。${btn('去工坊装配', 'go', { cls: 'ghost xs', data: { v: 'workshop' } })}</p>
      <div class="part-list mt2">${list.length ? list.map((id) => {
    const it = state.itemsById[id];
    const tpl = it && it.kind === 'circuit' ? D().template(it.templateId) : null;
    const desc = tpl ? tpl.desc : (it && it.kind === 'weapon' ? D().weapon(it.templateId).main.desc : '');
    return `<div class="part-item static">
        ${tpl ? `<span class="part-shape-box">${miniShapeSvg(tpl.id, 0, false)}</span>` : '<span class="relic-thumb"></span>'}
        <span class="part-text">
          <span class="part-name">${esc(partName(state, id))}</span>
          <span class="part-meta">${esc(partMeta(state, id))}${desc ? ' · ' + esc(desc) : ''}</span>
        </span>
        ${partIcon(state, id)}
      </div>`;
  }).join('') : '<div class="muted">空的。</div>'}</div>
    `);
  }

  function historyScreen(state, ui) {
    const u = state.roster.find((x) => x.id === ui.histUnit) || state.roster[0];
    const h = u ? V.Roster.history(state, u.id) : null;
    return `${V.Art.sceneBanner('veteran.scene.recovery', 'scene-recovery', '战史', '谁活下来了，谁没有')}
    <div class="grid-2">
      ${panel('传奇', `<div class="row wrap">${state.roster.map((x) => btn(x.name, 'inspectHistory', {
    cls: x.id === (u && u.id) ? 'gold xs' : 'ghost xs', data: { id: x.id },
  })).join('')}</div>
        ${h ? `<div class="mt3">
          <div class="small">合格撤离 <b class="gold">${h.eligibleRuns}</b> 次</div>
          <div class="small mt1">逻辑槽 ${h.logicSlots} 个${h.logicSlots < 3 ? `，再 ${h.nextSlotIn} 次合格撤离解锁第 3 个` : ''}</div>
          <div class="small mt1">调谐：${h.attunement.traitId
    ? `<b class="gold">${esc(h.attunement.traitName)}</b> — ${esc(h.attunement.traitDesc)}`
    : `${h.attunement.runs}/${h.attunement.need}（${esc(h.attunement.weaponName || '无主手')}）`}</div>
        </div>` : ''}`)}
      ${panel('最近记录', h && h.records.length ? h.records.map((r) => `<div class="hist-row">
        <span class="hist-name">${esc({ extract: '撤离', clear: '通关', emergency: '紧急撤退', defeat: '败退' }[r.kind] || r.kind)}</span>
        <span class="muted tiny">${r.depth} 层</span>
        <span class="${r.eligible ? 'success' : 'muted'} tiny">${esc(r.reason)}</span>
      </div>`).join('') : '<div class="muted small">还没有记录。</div>')}
    </div>`;
  }

  /* ------------------------------ 地图 ------------------------------ */

  function mapScreen(state, ui) {
    const r = state.run;
    const pct = ((r.floor - 1) / D().DESIGN.maxFloor) * 100;
    return `
    <div class="map-head">
      <div class="map-floor">第 ${r.floor} / ${D().DESIGN.maxFloor} 层</div>
      <div class="map-bar"><i style="width:${pct}%"></i></div>
      <div class="muted small">已完成 ${r.completedFloors} 层 · 背包 ${V.Expedition.bagUsed(state)}/${D().DESIGN.bagCapacity} 格</div>
    </div>
    <div class="party-strip">${r.party.map((p) => {
    const u = state.roster.find((x) => x.id === p.uid);
    const s = V.Roster.stats(state, u);
    const hp = p.hp == null ? s.maxHp : p.hp;
    return `<div class="party-chip">
      <span class="pc-name">${esc(u.name)}</span>
      <span class="pc-slot">${p.slot + 1}号位</span>
      ${bar(hp, s.maxHp, 'hp')}
      <span class="pc-hp">${hp}/${s.maxHp}</span>
      <span class="pc-stress ${p.stress >= 70 ? 'danger' : ''}">压力 ${p.stress}</span>
    </div>`;
  }).join('')}</div>
    <div class="nodes">${r.nodes.map((n) => {
    const disabled = n.consumed;
    const riskLabel = { low: '低危', medium: '中危', high: '高危', deadly: '致命', none: '安全' }[n.risk] || n.risk;
    return `<button class="node-card risk-${n.risk} ${disabled ? 'done' : ''}" data-act="chooseNode" data-id="${n.id}" ${disabled ? 'disabled' : ''}>
      <div class="node-art">${A.Art && A.Art.getArt(n.artId) ? A.Art.imgTag(n.artId, 'node-img', n.name) : ''}
        <span class="node-risk-badge risk-${n.risk}">${esc(riskLabel)}</span>
      </div>
      <div class="node-name">${esc(n.name)}</div>
      <div class="node-desc muted tiny">${esc(n.desc)}</div>
      <div class="node-risk">${esc(riskLabel)}</div>
    </button>`;
  }).join('')}</div>
    <div class="row mt3">
      ${btn('带着现有收获撤离', 'extractNow', { cls: 'gold' })}
      <span class="muted small">撤离才把背包和金币带回营地。现在背包 ${r.bag.length} 件。</span>
    </div>`;
  }

  /* ------------------------------ 战前 ------------------------------ */

  function prebattleScreen(state, ui) {
    const r = state.run;
    const enc = r.encounter;
    if (!enc) return panel('战前', '<p class="muted">没有锁定遭遇。</p>');
    const bp = enc.enemyBlueprint;
    const prep = enc.preparation;
    const attempt = enc.attemptNumber;

    return `
    <div class="grid-2">
      ${panel('敌方', `<div class="enemy-list">${bp.units.map((u) => `<div class="enemy-row">
        ${u.isBoss ? V.Art.bossTag(u.enemyType, 'enemy-boss-img') : ''}
        <span class="enemy-name ${u.isBoss ? 'boss' : ''}">${esc(u.name)}</span>
        <span class="muted tiny">${u.hp} 生命 · ${u.atk} 攻击 · ${u.def} 防御 · ${u.spd} 速度</span>
        ${u.isBoss ? tag('首领', 'tag-boss') : ''}
      </div>`).join('')}</div>
      <div class="muted small mt2">敌人与初始种子已固定。重试不会换敌人。</div>`)}

      ${panel('整备', `
        <div class="muted small">调整四个人的身位与行为指令。不能换队员，也不能拆回路。</div>
        <div class="vet-grid mt2">${prep.formation.map((uid, slot) => {
    const u = uid ? state.roster.find((x) => x.id === uid) : null;
    const partyEntry = u ? r.party.find((p) => p.uid === u.id) : null;
    const stStats = u ? V.Roster.stats(state, u) : null;
    const curHp = u && partyEntry ? (partyEntry.hp == null ? stStats.maxHp : partyEntry.hp) : 0;
    return `<div class="vet-slot ${u ? '' : 'empty'}">
      <div class="vet-slot-no">${slot + 1}号位</div>
      ${u ? V.Art.portraitTag(u.skinId, 'vet-slot-portrait')
        + `<div class="vet-name">${esc(u.name)}</div>
           <div class="vet-weapon">${esc(partName(state, u.weaponId))}</div>
           <div class="tiny muted">${curHp}/${stStats.maxHp} · 压${partyEntry ? partyEntry.stress : 0}</div>
           <div class="mt1">${slotFitBadge(state, u, slot)}</div>` : '<div class="vet-empty">空位</div>'}
      <div class="row tight mt2 slot-ops">
        ${slot > 0 ? btn('←', 'prepMove', { cls: 'ghost xs', data: { from: String(slot), to: String(slot - 1) } }) : ''}
        ${btn('换位', 'prepPick', { cls: 'ghost xs', data: { id: String(slot) } })}
        ${slot < 3 ? btn('→', 'prepMove', { cls: 'ghost xs', data: { from: String(slot), to: String(slot + 1) } }) : ''}
      </div>
    </div>`;
  }).join('')}</div>
        ${ui.prepSlot != null ? `<div class="picker mt2"><div class="muted small mb2">把 ${ui.prepSlot + 1} 号位换成</div>
          <div class="row wrap">${prep.formation.map((uid) => {
    if (!uid) return '';
    const u = state.roster.find((x) => x.id === uid);
    return btn(u.name, 'prepSwap', { cls: 'ghost xs', data: { a: String(ui.prepSlot), uid } });
  }).join('')}</div></div>` : ''}
        <div class="mt3 small">指令预览：</div>
        ${state.roster.filter((u) => prep.formation.includes(u.id)).map((u) => {
    const rules = (prep.rules[u.id] || u.gambits).filter((x) => x.enabled !== false);
    return `<div class="rule-line"><span class="muted tiny">${esc(u.name)}</span>
      <span class="tiny">${rules.length ? rules.map((x) => esc(ruleText(x))).join(' / ') : '（仅基础攻击）'}</span></div>`;
  }).join('')}
        <div class="row wrap mt3">
          ${btn(attempt > 0 ? '开始（第 ' + (attempt + 1) + ' 次尝试）' : '开始战斗', 'startAttempt', { cls: 'gold' })}
          ${btn('编辑指令', 'editRules', { cls: 'ghost', data: { id: prep.formation.filter(Boolean)[0] } })}
        </div>
        <div class="row mt2">
          ${btn('紧急撤退（保留一半本局收获）', 'retreatEmergency', { cls: 'ghost danger sm' })}
        </div>
        ${attempt > 0 ? `<div class="muted tiny mt2">已经试过 ${attempt} 次。重试不消耗任何资源。</div>` : ''}
      `)}
    </div>
    ${retreatPreviewPanel(state, ui)}`;
  }

  function retreatPreviewPanel(state, ui) {
    const p = V.Expedition.previewRetreat(state, 'emergency');
    if (!p.ok) return '';
    return panel('紧急撤退会付出什么', `
      <div class="small">保留新构件 <b class="gold">${p.keepParts.length}</b> 件（共 ${p.keepParts.length + p.lostParts.length} 件），其余丢弃。</div>
      <div class="small mt1">金币 +${p.gold} · 遗物 +${p.shards} · 参战压力 +${p.stress}</div>
      <div class="small muted mt1">带入的主手与回路全部保留。本次不算合格撤离。</div>
    `, 'panel-danger');
  }

  /* ------------------------------ 战斗 ------------------------------ */

  function battleScreen(state, ui) {
    const b = state.run && state.run.battle;
    if (!b) return panel('战斗', '<p class="muted">没有战斗。</p>');
    return `
    <div class="battle-top">
      <span class="bt-round">回合 ${b.round}</span>
      <span class="bt-tick muted tiny">第 ${b.tick} 刻</span>
      <div class="spacer"></div>
      <button class="btn ghost xs" id="btlTactic" data-act="setTactic">战术：${({ balance: '均衡', focus: '集火', safe: '保守' })[b.tactic] || '均衡'}</button>
      <button class="btn ghost xs" id="btlSpeed" data-act="cycleSpeed">速度 ×${ui.speed || 1}</button>
      <button class="btn ghost xs" data-act="togglePause">${ui.paused ? '继续' : '暂停'}</button>
    </div>
    <div class="battle-stage"><canvas id="cv" width="960" height="300"></canvas></div>
    <div class="battle-bars">
      <div class="side allies">${b.allies.map((u) => battleBar(u)).join('')}</div>
      <div class="side enemies">${b.enemies.map((u) => battleBar(u)).join('')}</div>
    </div>
    <div class="battle-actions">
      ${b.over ? btn(b.win ? '结算战果' : '查看结果', 'reviewNow', { cls: 'gold', id: 'btlNext' })
    : '<span class="muted tiny" id="btlWait">战斗进行中…（按空格切换倍率）</span>'}
      ${btn('重新整备', 'rewind', { cls: 'ghost sm' })}
      ${btn('紧急撤退', 'retreatEmergency', { cls: 'ghost sm danger' })}
    </div>
    <div class="battle-log" id="battleLog">${(b.logs || []).slice(-14).map((l) => `<div class="lg ${logClass(l)}">${esc(l.text || '')}</div>`).join('')}</div>`;
  }

  function logClass(l) {
    if (l.type === 'miss' || l.type === 'blocked') return 'dim';
    if (l.type === 'crit' || l.type === 'death' || l.type === 'defeat') return 'bad';
    if (l.type === 'heal' || l.type === 'shield' || l.type === 'victory') return 'good';
    if (l.type === 'surge' || l.type === 'telegraph' || l.type === 'phase') return 'warn';
    return '';
  }

  function battleBar(u) {
    const isAlly = u.side === 'ally';
    const energy = u.runtime ? [V.Circuit.outputTokens(u.runtime, 'main').length, V.Circuit.outputTokens(u.runtime, 'support').length] : null;
    const gPct = Math.max(0, Math.min(100, ((u.gauge || 0) / 60) * 100));
    const hasBurn = (u.buffs || []).some((x) => x.k === 'burn' || x.k === 'bleed');
    const hasGuard = (u.buffs || []).some((x) => x.k === 'guard' || x.k === 'dmgReduce');
    return `<div class="unit-bar ${u.alive === false ? 'dead' : ''} ${u.isBoss ? 'boss' : ''}">
      <div class="ub-top"><span class="ub-name">${esc(u.name)}</span>
        <span class="ub-slot">${u.slot + 1}号</span></div>
      ${bar(u.hp, u.maxHp, 'hp')}
      <div class="bar gauge"><i style="width:${gPct.toFixed(0)}%"></i></div>
      <div class="ub-meta">
        <span>${u.hp}/${u.maxHp}</span>
        ${u.shield > 0 ? `<span class="shield">盾${u.shield}</span>` : ''}
        ${energy ? `<span class="energy" title="主手/保护能量">⚡${energy[0]}/${energy[1]}</span>` : ''}
        ${u.skipActions > 0 ? tag('被压住', 'tag-warn') : ''}
        ${u.charging ? tag('蓄力', 'tag-boss') : ''}
        ${hasBurn ? tag('灼烧', 'tag-warn') : ''}
        ${hasGuard ? tag('减伤', 'tag-circuit') : ''}
        ${u.refract > 0 ? tag('残影', 'tag-circuit') : ''}
      </div>
      ${u.lastBlockReason && isAlly ? `<div class="ub-reason" title="${esc(u.lastBlockReason)}">${esc(u.lastBlockReason.slice(0, 28))}</div>` : ''}
    </div>`;
  }

  /* ------------------------------ 复盘 ------------------------------ */

  function reviewScreen(state, ui) {
    const enc = state.run && state.run.encounter;
    const p = enc && enc.pendingResult;
    if (!p) return panel('结果', '<p class="muted">还没有待确认结果。</p>');
    const rep = p.report || {};
    const win = p.outcome === 'win';
    return `
    ${panel(win ? '战斗胜利（待确认）' : p.outcome === 'timeout' ? '拖到极限（待确认）' : '小队失去战斗能力', `
      <div class="row wrap mb3">
        <span class="chip">回合 ${rep.round || 0}</span>
        <span class="chip">造成 ${Math.round((rep.stats && rep.stats.damage) || 0)}</span>
        <span class="chip">承受 ${Math.round((rep.stats && rep.stats.taken) || 0)}</span>
        <span class="chip">治疗 ${Math.round((rep.stats && rep.stats.healing) || 0)}</span>
      </div>
      <div class="small muted">确认之前，奖励、战史与伤痕都不会落账。可以无限次重新整备。</div>
      ${win ? `<div class="mt3 small">确认后获得：金币 +${p.rewardSpec.gold} · 遗物 +${p.rewardSpec.shards} ·
        ${p.rewardSpec.drops.length} 件构件（确认时才分配物品）</div>`
    : `<div class="mt3 small danger">败退会失去本局所有新收获；带入的主手与回路保留，压力 +${D().DESIGN.defeat.stress}。</div>`}
      <div class="row mt3">
        ${win ? btn('确认结果', 'confirmResult', { cls: 'gold' }) : ''}
        ${btn('重新整备', 'rewind', { cls: 'ghost' })}
        ${win ? btn('紧急撤退', 'retreatEmergency', { cls: 'ghost danger sm' }) : btn('确认败退', 'retreatDefeat', { cls: 'gold danger' })}
      </div>
    `)}
    <div class="battle-log">${(rep.logs || []).slice(-20).map((l) => `<div class="lg ${logClass(l)}">${esc(l.text || '')}</div>`).join('')}</div>`;
  }

  /* ------------------------------ 掉落 ------------------------------ */

  function lootScreen(state, ui) {
    const r = state.run;
    const pending = r.pendingLoot;
    const used = V.Expedition.bagUsed(state);
    const free = D().DESIGN.bagCapacity - used;
    return `
    ${panel(`战利品（背包 ${used}/${D().DESIGN.bagCapacity} 格）`, `
      ${pending.length ? `<div class="muted small mb2">背包放不下这些。选择带走、替换，或丢掉。</div>` : '<div class="success small">都处理完了。</div>'}
      <div class="part-list">${pending.map((id) => {
    const it = state.itemsById[id];
    if (!it) return '';
    const t = D().template(it.templateId);
    const cells = t.cells.length;
    return `<div class="part-item static">
      <span class="part-shape-box">${miniShapeSvg(t.id, 0, false)}</span>
      <span class="part-text">
        <span class="part-name">${esc(t.name)}</span>
        <span class="part-meta">${cells} 格 · 负荷 ${t.load} · ${esc(t.desc)}</span>
      </span>
      <span class="row tight">
        ${btn('带走', 'lootTake', { cls: 'gold xs', data: { id }, disabled: cells > free })}
        ${btn('丢掉', 'lootDiscard', { cls: 'ghost xs danger', data: { id } })}
        ${r.bag.length ? btn('替换…', 'lootReplacePick', { cls: 'ghost xs', data: { id } }) : ''}
      </span>
      ${ui.replaceFor === id ? `<div class="row wrap mt1">${r.bag.map((bid) => btn(`换掉 ${esc(partName(state, bid))}`, 'lootReplace', {
    cls: 'ghost xs', data: { id, drop: bid },
  })).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>
      ${r.bag.length ? `<div class="mt3"><div class="muted small mb2">背包里（撤离才入仓）</div>
        <div class="part-list">${r.bag.map((id) => `<div class="part-item static">
          <span class="part-name">${esc(partName(state, id))}</span>
          <span class="part-meta">${esc(partMeta(state, id))}</span></div>`).join('')}</div></div>` : ''}
      <div class="row mt3">
        ${btn('继续', 'finishNode', { cls: 'gold', disabled: pending.length > 0 })}
        ${btn('紧急撤退', 'retreatEmergency', { cls: 'ghost danger sm' })}
      </div>
      <div class="muted tiny mt2">已入账：金币 +${r.goldFound} · 遗物 +${r.shards} —— 但只有活着回营才真的算数。</div>
    `)}`;
  }

  /* ------------------------------ 事件 / 营火 / 商人 / 祝福 ------------------------------ */

  function eventScreen(state, ui) {
    const ev = D().event(state.run.event.eventId);
    const resolved = state.run.event.resolved;
    return panel(ev.title, `
      <div class="story">${esc(ev.text)}</div>
      ${resolved
    ? `<div class="story mt2 success">${esc(state.run.event.resultText)}</div>
         <div class="row mt3">${btn('继续', 'eventDone', { cls: 'gold' })}</div>`
    : `<div class="mt3">${ev.choices.map((c) => `<button class="choice" data-act="chooseEvent" data-id="${c.id}">
          ${esc(c.label)}<span class="hint">${esc(c.hint || '')}</span></button>`).join('')}</div>`}
    `);
  }

  function campNodeScreen(state) {
    const r = state.run;
    return `${V.Art.sceneBanner('veteran.scene.field', 'scene-field', '',
    `第 ${r.floor} 层 · 每名角色本局可现场烙印一次`)}
    ${panel('废弃营火', `
      <div class="story">火还有余温。铁在这里会变软一点。</div>
      <div class="row wrap mt3">
        ${btn('休息（恢复 45% 生命，压力 -30）', 'campRest', { cls: 'gold' })}
        ${btn('继续前进', 'finishNode', { cls: 'ghost' })}
      </div>
      <div class="mt4">
        <h3 class="sub-h">现场烙印</h3>
        <p class="muted small">把刚捡到的构件直接烙进板面。代价是本局生命上限 ×0.8、压力 +40。
        每名角色每局只能一次。烙进去的构件仍算本局风险池：撤退时可能丢。</p>
        <div class="row wrap">${r.party.map((p) => {
    const u = state.roster.find((x) => x.id === p.uid);
    const gate = V.Expedition.inscribable(state, u.id);
    return `<div class="inscribe-card">
      <div class="vet-name">${esc(u.name)}</div>
      <div class="muted tiny">${gate.ok ? '可以烙印' : esc(gate.reason)}</div>
      ${btn('烙印…', 'inscribeStart', { cls: 'ghost xs', data: { id: u.id }, disabled: !gate.ok })}
    </div>`;
  }).join('')}</div>
      </div>
    `)}`;
  }

  function merchantScreen(state) {
    const r = state.run;
    return panel('游商', `
      <div class="story">它不该在这里。但它确实在卖东西。</div>
      <div class="row mb2"><span class="muted small">金币 ${state.gold}</span></div>
      <div class="part-list">${(r.shop || []).map((o) => {
    const it = state.itemsById[o.itemId];
    return `<div class="part-item static">
      <span class="part-name">${esc(partName(state, o.itemId))}</span>
      <span class="part-meta">${esc(partMeta(state, o.itemId))}</span>
      <span class="row tight"><span class="gold">${o.price}</span>
        ${o.sold ? '<span class="muted tiny">已售</span>'
    : btn('买', 'buyOffer', { cls: 'gold xs', data: { id: o.id }, disabled: state.gold < o.price || !it })}
      </span>
    </div>`;
  }).join('')}</div>
      <div class="row mt3">${btn('离开', 'finishNode', { cls: 'ghost' })}</div>
    `);
  }

  function blessingScreen(state) {
    const r = state.run;
    const opts = r.blessingOptions || D().BLESSING_ORDER.slice(0, 3);
    return panel('本局祝福', `
      <div class="story">火里能听见一点别的东西。</div>
      <div class="grid-3 mt3">${opts.map((id) => {
    const b = D().blessing(id);
    return `<button class="blessing-card" data-act="chooseBlessing" data-id="${id}">
      <div class="bl-name">${esc(b.name)}</div>
      <div class="muted tiny">${esc(b.desc)}</div>
    </button>`;
  }).join('')}</div>
    `);
  }

  function settlementScreen(state) {
    const s = state.settlement;
    if (!s) return panel('结算', '<p class="muted">没有结算。</p>');
    return `${V.Art.sceneBanner('scene.camp', 'scene-settlement', s.title, s.eligible ? '合格撤离' : '不算合格撤离')}
    ${panel(s.title, `
      <div class="story">${esc({
    extract: '身后的门关上了。你们活了下来，东西还在。',
    clear: '那扇门后面的东西终于不动了。',
    emergency: '你们转身就跑。一半的收获丢在了路上。',
    defeat: '被抬回来的。东西没能带回来。',
  }[s.mode] || '')}</div>
      <div class="row wrap mt3">
        <span class="chip">完成 ${s.depth} 层</span>
        <span class="chip">金币 +${s.gold}</span>
        <span class="chip">遗物 +${s.shards}</span>
        <span class="chip">构件 +${s.items.length}</span>
      </div>
      <div class="${s.eligible ? 'success' : 'muted'} small mt2">${esc(s.reason)}</div>
      ${s.items.length ? `<div class="part-list mt2">${s.items.map((id) => `<div class="part-item static">
        <span class="part-name">${esc(partName(state, id))}</span><span class="part-meta">${esc(partMeta(state, id))}</span></div>`).join('')}</div>` : ''}
      <div class="row mt3">${btn('回营地', 'settleClose', { cls: 'gold' })}</div>
    `)}`;
  }

  /* ------------------------------ 汇总 ------------------------------ */

  const NEEDS_RUN = ['map', 'prebattle', 'battle', 'review', 'loot', 'event', 'campNode', 'merchant', 'blessing'];

  function screen(state, ui) {
    /* 没有远征却停在远征界面（读档/调试）：退回营地，不抛错 */
    if (NEEDS_RUN.includes(ui.screen) && !state.run) ui.screen = 'camp';
    switch (ui.screen) {
      case 'title': return titleScreen(state, ui);
      case 'camp': return campScreen(state, ui);
      case 'team': return teamScreen(state, ui);
      case 'rules': return rulesScreen(state, ui);
      case 'workshop': return workshopScreen(state, ui);
      case 'recruit': return recruitScreen(state, ui);
      case 'stash': return stashScreen(state);
      case 'history': return historyScreen(state, ui);
      case 'map': return mapScreen(state, ui);
      case 'prebattle': return prebattleScreen(state, ui);
      case 'battle': return battleScreen(state, ui);
      case 'review': return reviewScreen(state, ui);
      case 'loot': return lootScreen(state, ui);
      case 'event': return eventScreen(state, ui);
      case 'campNode': return campNodeScreen(state);
      case 'merchant': return merchantScreen(state);
      case 'blessing': return blessingScreen(state);
      case 'settlement': return settlementScreen(state);
      default: return panel('未知界面', '<p class="muted">回到营地。</p>');
    }
  }

  function modalHtml(state, ui) {
    if (!ui.modal) return '';
    const s = state.settings || { sound: true, speed: 1, reducedMotion: false };
    if (ui.modal === 'settings') {
      return `<div class="modal-backdrop">
        <div class="modal-dim" data-act="closeModal"></div>
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="设置与存档">
          <div class="row mb2">
            <h2 class="panel-h" style="margin:0;border:none;padding:0">设置与存档</h2>
            <div class="spacer"></div>
            ${btn('✕', 'closeModal', { cls: 'ghost xs' })}
          </div>
          <div class="setting-list">
            <div class="setting-row">
              <div><div>合成音效</div><div class="tiny muted">点击、命中、暴击与回路充能短音</div></div>
              ${btn(s.sound !== false ? '已开启' : '已静音', 'toggleSound', { cls: s.sound !== false ? 'gold xs' : 'ghost xs' })}
            </div>
            <div class="setting-row">
              <div><div>默认战斗倍率</div><div class="tiny muted">进入战斗时的初始播放速度</div></div>
              <div class="row tight">${[1, 2, 3].map((sp) => btn(`×${sp}`, 'setDefaultSpeed', { cls: (s.speed || 1) === sp ? 'gold xs' : 'ghost xs', data: { id: String(sp) } })).join('')}</div>
            </div>
            <div class="setting-row">
              <div><div>减弱动效</div><div class="tiny muted">关闭回路流光动画与战场震屏</div></div>
              ${btn(s.reducedMotion ? '已开启' : '关闭', 'toggleMotion', { cls: s.reducedMotion ? 'gold xs' : 'ghost xs' })}
            </div>
          </div>
          <div class="mt3 pt2 border-top">
            <div class="sub-h">存档管理</div>
            <div class="row wrap tight mt2">
              ${btn('生成导出文本', 'modalExport', { cls: 'ghost sm' })}
              ${btn('复制导出文本', 'copySaveText', { cls: 'ghost sm' })}
              ${ui.hadSave ? btn('抹去存档…', 'resetSave', { cls: 'ghost sm danger' }) : ''}
            </div>
            <textarea id="modalSaveBox" class="mt2" rows="4" placeholder="导出时会填入 JSON；或者把存档 JSON 粘到这里点击导入">${esc(ui.modalSaveText || '')}</textarea>
            <div class="row mt2">
              ${btn('导入此存档', 'modalImportConfirm', { cls: 'gold sm' })}
            </div>
          </div>
        </div>
      </div>`;
    }
    if (ui.modal === 'confirmReset') {
      return `<div class="modal-backdrop">
        <div class="modal-dim" data-act="closeModal"></div>
        <div class="modal-card modal-sm" role="dialog" aria-modal="true" aria-label="抹去存档确认">
          <h2 class="panel-h danger">抹去全部进度？</h2>
          <p class="small muted">此操作会清空当前浏览器的全部远征、传奇与仓库记录，且无法撤回。</p>
          <div class="row mt3">
            <div class="spacer"></div>
            ${btn('取消', 'closeModal', { cls: 'ghost sm' })}
            ${btn('确认抹去', 'confirmResetSave', { cls: 'gold danger sm' })}
          </div>
        </div>
      </div>`;
    }
    return '';
  }

  function hud(state, ui) {
    if (ui.screen === 'title') return '';
    return `<span class="hud-brand">灰烬回廊</span>
      <span class="hud-sep"></span>
      <span class="hud-item">金币 <b class="gold">${state.gold}</b></span>
      <span class="hud-item">遗物 <b>${state.shards}</b></span>
      <span class="hud-item">最深 <b>${state.bestDepth}</b> 层</span>
      <div class="spacer"></div>
      ${btn('⚙ 设置', 'openSettings', { cls: 'ghost xs' })}
      ${btn('标题', 'toTitle', { cls: 'ghost xs' })}`;
  }

  const NAV = [
    ['camp', '营地'], ['team', '队伍'], ['workshop', '工坊'],
    ['recruit', '招募'], ['stash', '仓库'], ['history', '战史'],
  ];

  function nav(state, ui) {
    if (['title'].includes(ui.screen) || state.run) return '';
    const showNav = ['camp', 'team', 'workshop', 'recruit', 'stash', 'history', 'rules'].includes(ui.screen);
    if (!showNav) return '';
    return NAV.map(([v, n]) => `<button class="nav-btn ${ui.screen === v ? 'on' : ''}"
      data-act="go" data-v="${v}" ${state.run ? 'disabled' : ''}>${n}</button>`).join('');
  }

  /** 拖拽幽灵用：某件构件在给定旋转/翻转下的相对格、端口与配色（真实几何，不另写一套） */
  function partShape(state, itemId, rotation, mirrorY) {
    const L = V.Circuit.layout(state, [{ itemId, x: 0, y: 0, rotation: rotation || 0, mirrorY: !!mirrorY }]);
    const b = L.built && L.built[0];
    if (!b) return null;
    const xs = b.abs.map((c) => c.x);
    const ys = b.abs.map((c) => c.y);
    return {
      name: b.tpl.name,
      templateId: b.tpl.id,
      rot: rotation || 0,
      mir: !!mirrorY,
      color: TEMPLATE_COLOR[b.tpl.id] || '#4A4A5A',
      edgeColor: TEMPLATE_EDGE[b.tpl.id] || '#8A6F32',
      cells: b.abs.map((c) => ({ x: c.x, y: c.y })),
      ports: b.aps.map((p) => ({ cell: p.cell.slice(), dir: p.dir, role: p.role })),
      minX: Math.min.apply(null, xs),
      minY: Math.min.apply(null, ys),
      maxX: Math.max.apply(null, xs),
      maxY: Math.max.apply(null, ys),
    };
  }

  V.UI = {
    screen, hud, nav, modalHtml, boardSvg, miniShapeSvg, esc, btn, bar,
    partName, partMeta, logClass, battleBar, ruleText, partShape,
    MANUSCRIPTS: WORKSHOP_MANUSCRIPTS, resolveManuscript, plateCellsList,
  };
})(globalThis.Ashen ||= {});
