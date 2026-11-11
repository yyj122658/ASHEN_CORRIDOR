'use strict';
/* 生命金属板面生成：从原型种子长出「不规则的一块铁」。

   形状与容量分开：
   - 原型种子（archetype）只决定气质：内部有「毛坯区」macro 与「允许区」allow；
   - 目标格数（target）决定容量：所有同档底盘格数一致，避免「谁大用谁」的公式化配队。

   生成是纯函数：同一 seed + 同一 archetype + 同一 target 永远得到同一块铁，
   随机数只来自 A.Random（不读时钟、不读 Math.random），因此可以存档、可重放。

   约束（会被强制保证）：
   1. 单一连通块（四邻接），没有孤岛；
   2. 没有孤立格（每格至少一个面相邻），否则 2 格构件永远放不进去；
   3. 孔洞不会被后续补格填回；
   4. 格数精确等于 target（补不满时返回实际值并标记）。
*/
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const SIZE = 7;             // 包围盒 7×7
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const key = (x, y) => x + ',' + y;
  const unkey = (k) => k.split(',').map(Number);

  /* 原型种子：macro = 初始毛坯，allow = 允许长到的范围（形状身份靠它保住） */
  const ARCHETYPES = {
    full: {
      name: '方坯', target: 28,
      macro: () => true,
      allow: () => true,
    },
    bar: {
      name: '狭长', target: 22,
      macro: (x) => x >= 1 && x <= 4,
      allow: (x) => x >= 1 && x <= 4,
    },
    ring: {
      name: '环', target: 28, minHoles: 1,
      macro: (x, y) => !(x >= 2 && x <= 4 && y >= 2 && y <= 4),
      allow: (x, y) => !(x >= 2 && x <= 4 && y >= 2 && y <= 4),
    },
    ell: {
      name: 'L 角', target: 28, minHoles: 0,
      macro: (x, y) => !(x >= 4 && y >= 4),
      allow: (x, y) => !(x >= 4 && y >= 4),
    },
    cross: {
      name: '厚十字', target: 22,
      macro: (x, y) => (x >= 2 && x <= 4) || (y >= 2 && y <= 4),
      allow: (x, y) => (x >= 2 && x <= 4) || (y >= 2 && y <= 4),
    },
    square: {
      name: '小方', target: 28,
      macro: (x, y) => x >= 1 && x <= 6 && y >= 1 && y <= 6,
      allow: (x, y) => x >= 1 && x <= 6 && y >= 1 && y <= 6,
    },
  };

  function makeRng(seed) {
    let s = seed >>> 0;
    return function rnd() {
      const r = A.Random.next(s);
      s = r.state;
      return r.value;
    };
  }

  function neighbors(set, x, y) {
    let n = 0;
    for (let i = 0; i < 4; i++) if (set.has(key(x + ORTH[i][0], y + ORTH[i][1]))) n++;
    return n;
  }

  /** 最大连通块（四邻接） */
  function largestComponent(set) {
    const seen = new Set();
    let best = [];
    for (const k of set) {
      if (seen.has(k)) continue;
      const comp = [];
      const stack = [k];
      seen.add(k);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        const [x, y] = unkey(cur);
        for (let i = 0; i < 4; i++) {
          const nk = key(x + ORTH[i][0], y + ORTH[i][1]);
          if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      if (comp.length > best.length) best = comp;
    }
    return best;
  }

  function isConnected(set) { return largestComponent(set).length === set.size; }

  /**
   * 生成一块板面。
   * @param {object} opts {seed, archetype, target}
   * @returns {{cells:number[][], archetype:string, target:number, hit:boolean, seed:number}}
   */
  function buildOnce(archKey, arch, target, seed) {
    const rnd = makeRng(seed);

    let set = new Set();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) if (arch.macro(x, y)) set.add(key(x, y));
    }

    const canCut = (x, y) => {
      const trial = new Set(set);
      trial.delete(key(x, y));
      return trial.size > 0 && isConnected(trial);
    };

    /* 1. 边缘腐蚀：按裸露边数判概率；每删一格先验证整块仍连通 */
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!set.has(key(x, y))) continue;
        const exposed = 4 - neighbors(set, x, y) + (arch.allow(x, y) ? 0 : 4);
        if (exposed === 0) continue;
        const p = exposed >= 3 ? 0.6 : exposed === 2 ? 0.45 : 0.3;
        if (rnd() >= p) continue;
        if (canCut(x, y)) set.delete(key(x, y));
      }
    }

    /* 2. 咬口：1~2 处从边缘再切深一格 */
    const bites = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < bites; i++) {
      const bx = Math.floor(rnd() * SIZE);
      const by = Math.floor(rnd() * SIZE);
      if (!set.has(key(bx, by)) || neighbors(set, bx, by) > 2) continue;
      if (canCut(bx, by)) set.delete(key(bx, by));
    }

    /* 3. 孔洞：0~2 个，可能连成一条缝；不能把板面切成两块 */
    const holeCells = new Set();
    const holes = Math.floor(rnd() * 2.6);
    for (let i = 0; i < holes; i++) {
      const hx = 1 + Math.floor(rnd() * (SIZE - 2));
      const hy = 1 + Math.floor(rnd() * (SIZE - 2));
      if (neighbors(set, hx, hy) < 3) continue;
      const trial = new Set(set);
      const cut = [key(hx, hy)];
      trial.delete(key(hx, hy));
      if (rnd() < 0.55) {
        const horiz = rnd() < 0.5;
        const k2 = key(hx + (horiz ? 1 : 0), hy + (horiz ? 0 : 1));
        trial.delete(k2);
        cut.push(k2);
      }
      if (trial.size && isConnected(trial)) {
        set = trial;
        cut.forEach((k) => holeCells.add(k));
      }
    }

    /* 4. 收束到目标格数：多则啃边缘，少则补凹处（先补两面相邻的） */
    let guard = 0;
    while (set.size > target && guard++ < 400) {
      const cand = [...set].filter((k) => {
        const [x, y] = unkey(k);
        return neighbors(set, x, y) <= 2;
      });
      if (!cand.length) break;
      const pick = cand[Math.floor(rnd() * cand.length)];
      const [px, py] = unkey(pick);
      if (canCut(px, py)) set.delete(pick);
    }
    guard = 0;
    while (set.size < target && guard++ < 400) {
      const tight = [];
      const loose = [];
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const k = key(x, y);
          if (set.has(k) || holeCells.has(k) || !arch.allow(x, y)) continue;
          const n = neighbors(set, x, y);
          if (n >= 2) tight.push(k);
          else if (n === 1) loose.push(k);
        }
      }
      const cand = tight.length ? tight : loose;
      if (!cand.length) break;
      set.add(cand[Math.floor(rnd() * cand.length)]);
    }

    /* 5. 清孤立格，只保留最大连通块 */
    let changed = true;
    while (changed) {
      changed = false;
      for (const k of [...set]) {
        const [x, y] = unkey(k);
        if (neighbors(set, x, y) === 0) { set.delete(k); changed = true; }
      }
    }
    const finalSet = new Set(largestComponent(set));
    const cells = [...finalSet].map(unkey).sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));

    return {
      cells,
      archetype: archKey,
      target,
      seed,
      holes: analyze(cells).holes,
      hit: cells.length === target,
    };
  }

  /**
   * 对外入口。形状保证（格数命中 + 最小孔数）靠确定性重试：
   * 同一 seed 的重试序列固定，所以仍然可存档、可重放。
   */
  function generate(opts) {
    const o = opts || {};
    const archKey = ARCHETYPES[o.archetype] ? o.archetype : 'full';
    const arch = ARCHETYPES[archKey];
    const target = Number.isFinite(o.target) ? o.target : arch.target;
    const seed = (o.seed == null ? 1 : o.seed) >>> 0;
    const needHoles = arch.minHoles || 0;

    let best = null;
    for (let i = 0; i < 24; i++) {
      const trySeed = (seed + Math.imul(i, 0x9E3779B1)) >>> 0;
      const cand = buildOnce(archKey, arch, target, trySeed);
      cand.holes = analyze(cand.cells).holes;
      cand.hit = cand.cells.length === target && cand.holes >= needHoles;
      cand.seed = seed;
      if (!best) best = cand;
      else if (cand.hit && !best.hit) best = cand;
      else if (!best.hit && !cand.hit && Math.abs(cand.cells.length - target) < Math.abs(best.cells.length - target)) best = cand;
      if (cand.hit) return cand;
    }
    return best;
  }

  /**
   * 板面几何分析：宽高、孔洞数（不与外部连通的空格）、最长直线段。
   * 孔洞用「从包围盒边界向内泛洪」，剩下的空格就是被围住的洞。
   */
  function analyze(cells) {
    const set = new Set((cells || []).map((c) => key(c[0], c[1])));
    if (!set.size) {
      return { count: 0, width: 0, height: 0, holes: 0, longestRun: 0, connected: false };
    }
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);

    /* 泛洪外侧空格（包围盒外扩一圈作为起点） */
    const outside = new Set();
    const stack = [[minX - 1, minY - 1]];
    outside.add(key(minX - 1, minY - 1));
    while (stack.length) {
      const [x, y] = stack.pop();
      for (let i = 0; i < 4; i++) {
        const nx = x + ORTH[i][0];
        const ny = y + ORTH[i][1];
        if (nx < minX - 1 || ny < minY - 1 || nx > maxX + 1 || ny > maxY + 1) continue;
        const k = key(nx, ny);
        if (outside.has(k) || set.has(k)) continue;
        outside.add(k);
        stack.push([nx, ny]);
      }
    }
    let holes = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const k = key(x, y);
        if (!set.has(k) && !outside.has(k)) holes++;
      }
    }

    /* 最长连续段（横或竖） */
    let run = 0;
    for (let y = minY; y <= maxY; y++) {
      let cur = 0;
      for (let x = minX; x <= maxX + 1; x++) {
        if (set.has(key(x, y))) cur++;
        else { if (cur > run) run = cur; cur = 0; }
      }
    }
    for (let x = minX; x <= maxX; x++) {
      let cur = 0;
      for (let y = minY; y <= maxY + 1; y++) {
        if (set.has(key(x, y))) cur++;
        else { if (cur > run) run = cur; cur = 0; }
      }
    }

    return {
      count: set.size,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      holes,
      longestRun: run,
      connected: isConnected(set),
    };
  }

  V.PlateGen = { SIZE, ARCHETYPES, generate, analyze, isConnected };
})(globalThis.Ashen ||= {});
