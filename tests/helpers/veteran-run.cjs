'use strict';
/* 老兵回路测试公用夹具：只调用真实命令，不实现领域逻辑。 */
const { loadVeteran } = require('./load-veteran.cjs');

/**
 * @param {number} seed
 * @param {{generated?: boolean}} [opts] generated: 用 77 格异形板（默认是 14 格经典夹具）
 *
 * 六标之后蚀刻法骨架有 6~54 格，14 格经典板塞不下两门，也不再能代表真实对局；
 * 需要「两块骨架」或想看真实面板的用例请用 generated。
 */
function boot(seed, opts) {
  const A = loadVeteran();
  const V = A.Veteran;
  const generated = !!(opts && opts.generated);
  return { A, V, st: V.State.create(seed == null ? 4242 : seed, generated ? {} : { classicPlate: true }) };
}

function fullTeam(V, st) {
  for (const [skinId, bodyPreset, name, method] of [
    ['warden','sturdy','磐石','ward'], ['cleric','conduit','烛火','needle'],
  ]) {
    const unit = V.State.makeUnit(st,{skinId,bodyPreset,name});
    V.State.equipPreset(st,unit,'basic');
    if (st.plateMode === 'plate') V.State.equipManuscript(st,unit,method);
    st.team[st.roster.length] = unit.id;
    st.roster.push(unit);
  }
  return st;
}

function startRun(A, st, seed) {
  const r = A.Veteran.Expedition.start(st, { seed: seed == null ? 4242 : seed });
  if (!r.ok) throw new Error('start 失败：' + JSON.stringify(r.error));
  return r.state;
}

/** 把当前层的三个节点替换成指定类型。 */
function setNodes(A, st, types) {
  const D = A.Veteran.Data;
  st.run.nodes = types.map((t, i) => ({
    id: 'n' + st.run.floor + '_' + i,
    type: t,
    consumed: false,
    name: D.nodeType(t).name,
    desc: D.nodeType(t).desc,
    risk: D.nodeType(t).risk,
    artId: D.nodeType(t).artId,
    icon: D.nodeType(t).icon,
  }));
  return st;
}

/** 打开遭遇并开打，返回 {st, battle}。 */
function fight(A, st, kind) {
  const V = A.Veteran;
  const nodeId = st.run.nodes[0].id;
  let r = V.Encounter.open(st, nodeId);
  if (!r.ok) throw new Error('open 失败：' + JSON.stringify(r.error));
  st = r.state;
  if (kind && kind !== st.run.encounter.kind) {
    /* 测试需要指定遭遇类型时，直接换蓝图（不走 UI 路径） */
    const gen = V.Combat.generateEncounter(st, kind);
    st = gen.state;
    st.run.encounter.enemyBlueprint = gen.enemyBlueprint;
    st.run.encounter.combatRngStart = gen.combatRngStart;
    st.run.encounter.kind = kind;
  }
  r = V.Encounter.startAttempt(st);
  if (!r.ok) throw new Error('startAttempt 失败：' + JSON.stringify(r.error));
  return { st: r.state, battle: r.state.run.battle };
}

function stepUntilOver(A, st, limit) {
  const V = A.Veteran;
  let ticks = 0;
  const cap = limit || 4000;
  while (st.run && st.run.battle && !st.run.battle.over && ticks < cap) {
    const r = V.Combat.step(st);
    if (!r.ok) throw new Error('step 失败：' + JSON.stringify(r.error));
    st = r.state;
    ticks += 1;
  }
  return { st, ticks };
}

/** 造一件指定模板的纹路并放进仓库。 */
function makePart(A, st, spec) {
  const V = A.Veteran;
  const part = V.State.makePart(st, spec || { kind: 'circuit', templateId: 'straight' });
  st.itemsById[part.id] = part;
  st.stash.push(part.id);
  return part;
}

/**
 * v4.0 的「把板面铺起来」：贪心用直导/弯折/储能铺满蚀刻法覆盖的格。
 *
 * 为什么平衡测试需要它：v4.0 的面板完全由拓扑编译产出 ——
 * 只装蚀刻法、不摆纹路，就是一个 25 点完整度的裸心核（旧世界是固定 140）。
 *
 * 占格自己算，不依赖 V.Circuit.layout：layout 是容错视图，摆重了它照样算；
 * 这里要的是「绝不重叠」的确定性，所以逐件展开成绝对格、自己维护占用集。
 */
function buildBoard(A, st, u, opts) {
  const V = A.Veteran;
  const D = V.Data;
  const plate = V.Circuit.plateOf(u);
  const cap = V.Circuit.loadCap(u);
  const cellsOfPlacement = (p) => {
    const item = st.itemsById[p.itemId];
    if (!item || item.kind !== 'circuit') return [];
    const tpl = D.TEMPLATES[item.templateId];
    if (!tpl) return [];
    return V.Circuit.transformTemplate(tpl, p.rotation || 0, !!p.mirrorY)
      .cells.map((c) => (c.x + p.x) + ',' + (c.y + p.y));
  };

  const placements = (u.board.placements || []).slice();
  const used = new Set();
  placements.forEach((p) => cellsOfPlacement(p).forEach((k) => used.add(k)));

  const targets = new Set();
  V.State.manuscriptsOf(u).forEach((ms) => V.State.manuscriptCells(ms).forEach((c) => targets.add(c.join(','))));
  const cells = targets.size ? [...targets] : plate.cellsList.map((c) => c.join(','));

  const want = (opts && opts.templates) || ['straight', 'elbow', 'capacitor', 'rivet'];
  const pieces = [];
  want.forEach((id) => {
    for (let rot = 0; rot < 4; rot++) {
      for (const mir of [false, true]) {
        /* rot / mir 必须一起带进候选里：摆回去的时候要用同一套变换，
           否则「验证过的形状」和「实际摆的形状」不是同一个，compile 直接判非法。 */
        pieces.push({
          id, rot, mir,
          tf: V.Circuit.transformTemplate(D.TEMPLATES[id], rot, mir),
          load: D.TEMPLATES[id].load,
        });
      }
    }
  });

  let load = 0;

  /* 路由优先（opts.route）：先在蚀刻法的入口/出口格各放一件「开口对得上」的直导纹，
     再从入口开始贪心。纯覆盖贪心会让入口/出口没有对应开口 —— 于是 route 永远不成立，
     整条脉冲层（直导缩间隔、弯折增压、直导闪避）在流派测试里全是死的。 */
  if (opts && opts.route) {
    const ms = V.State.manuscriptsOf(u)[0];
    if (ms) {
      const or = V.Manuscript.orient(
        V.Manuscript.normalize(V.Data.manuscript(ms.id) || ms),
        ms.rotation || 0, !!ms.mirrorY,
      );
      const ends = [[or.entry, or.veins[or.entry.join(',')] || []]]
        .concat((or.exits || []).map((c) => [c, or.veins[c.join(',')] || []]));
      ends.forEach(([cell, dirs]) => {
        const ax = cell[0] + (ms.x || 0);
        const ay = cell[1] + (ms.y || 0);
        if (used.has(ax + ',' + ay)) return;
        for (const id of ['straight', 'rivet', 'elbow']) {
          for (let rot = 0; rot < 4; rot++) {
            for (const mir of [false, true]) {
              const tf = V.Circuit.transformTemplate(D.TEMPLATES[id], rot, mir);
              /* 以「端口落在 (ax,ay) 上」为准整件平移，再看该格的开口是否满足要求 */
              for (const anchor of tf.ports) {
                const ox = ax - anchor.cell[0];
                const oy = ay - anchor.cell[1];
                const here = tf.ports
                  .filter((pt) => pt.cell[0] + ox === ax && pt.cell[1] + oy === ay)
                  .map((pt) => pt.dir);
                if (!dirs.length || !dirs.every((d) => here.includes(d))) continue;
                const keys = tf.cells.map((c) => (c.x + ox) + ',' + (c.y + oy));
                if (!keys.every((k) => plate.cells.has(k))) continue;
                if (keys.some((k) => used.has(k))) continue;
                if (load + D.TEMPLATES[id].load > cap) continue;
                keys.forEach((k) => used.add(k));
                load += D.TEMPLATES[id].load;
                const item = V.State.makePart(st, { kind: 'circuit', templateId: id });
                st.itemsById[item.id] = item;
                placements.push({ itemId: item.id, x: ox, y: oy, rotation: rot, mirrorY: mir });
                return;
              }
            }
          }
        }
      });
    }
  }

  cells.forEach((cell) => {
    if (used.has(cell)) return;
    const [tx, ty] = cell.split(',').map(Number);
    let best = null;
    pieces.forEach((p) => {
      p.tf.cells.forEach((a) => {
        const ox = tx - a.x;
        const oy = ty - a.y;
        const keys = p.tf.cells.map((c) => (c.x + ox) + ',' + (c.y + oy));
        if (!keys.every((k) => plate.cells.has(k))) return;
        if (keys.some((k) => used.has(k))) return;
        if (load + p.load > cap) return;
        const gain = keys.filter((k) => targets.has(k) && !used.has(k)).length;
        if (!gain) return;
        const score = gain * 10 - p.load;
        if (!best || score > best.score) best = { ...p, ox, oy, keys, score };
      });
    });
    if (!best) return;
    best.keys.forEach((k) => used.add(k));
    load += best.load;
    const item = V.State.makePart(st, { kind: 'circuit', templateId: best.id });
    st.itemsById[item.id] = item;
    /* 上阵的纹路只能属于板面 —— 再 push 进 stash 会被校验判成「一处物件两处归属」 */
    placements.push({ itemId: item.id, x: best.ox, y: best.oy, rotation: best.rot, mirrorY: !!best.mir });
  });

  /* 配额补齐：贪心只看「覆盖多少格」，纯功能件（储能 / 余烬 / 闸系）常常抢不过直导。
     流派测试需要它们真的在板面上，所以给一张必装清单，各补一件。 */
  ((opts && opts.ensure) || []).forEach((id) => {
    if (placements.some((p) => (st.itemsById[p.itemId] || {}).templateId === id)) return;
    const tpl = D.TEMPLATES[id];
    for (let rot = 0; rot < 4; rot++) {
      for (const mir of [false, true]) {
        const tf = V.Circuit.transformTemplate(tpl, rot, mir);
        for (let y = 0; y < plate.size; y++) {
          for (let x = 0; x < plate.size; x++) {
            const keys = tf.cells.map((c) => (c.x + x) + ',' + (c.y + y));
            if (!keys.every((k) => plate.cells.has(k))) continue;
            if (keys.some((k) => used.has(k))) continue;
            keys.forEach((k) => used.add(k));
            const item = V.State.makePart(st, { kind: 'circuit', templateId: id });
            st.itemsById[item.id] = item;
            placements.push({ itemId: item.id, x, y, rotation: rot, mirrorY: mir });
            return;
          }
        }
      }
    }
  });

  /* 收尾去重：不管上面哪一步算漏了，最终列表必须做到「一格只有一个主人」。
     重叠件直接丢弃（宁可少装一件，也不能让状态校验失败）。 */
  const acc = new Set();
  const finalList = [];
  placements.forEach((p) => {
    const keys = cellsOfPlacement(p);
    if (!keys.length) { finalList.push(p); return; }
    if (keys.some((k) => acc.has(k))) return;
    keys.forEach((k) => acc.add(k));
    finalList.push(p);
  });

  u.board.placements = finalList;
  return finalList;
}


/* ========================================================================
   端口图自动布线器（v4.0 四标）
   ------------------------------------------------------------------------
   为什么需要它：`Manuscript.route()` 的判据是「相邻两格彼此开口」——
   A 格朝 d 有口、B 格（d 方向的邻居）朝 opposite(d) 有口，才算一条边；
   而且整条通路必须落在**蚀刻法自己的格**里。多格纹路（elbow/capacitor…）
   的端口只在两端，中间格没有任何口，所以它们**永远不可能出现在通路上**。
   能出现在通路上的，只有「单格 + 同格给出两向端口」的四种件：
     rivet(straight W/E) · jack(straight 拐角) · flint(ember 拐角) · pinValve(threshold 直连)
   因此正确做法是：先按端口把「通路」一格一格拼出来（每格一件单格件），
   再用多格件去填通路之外的格（覆盖率、负载、储能/闸系配额）。
   ======================================================================== */

const RD = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const ROPP = { N: 'S', S: 'N', E: 'W', W: 'E' };

/* 流派偏好只决定「同功能先用谁」，不决定「能不能用」。
   jack 挪进 elbow 家族之后，直导流的拐角只能靠 elbow 件，所以 straight 里也得给 elbow 留权重。 */
const FAMILY_PREF = {
  straight: { straight: 3, threshold: 1.5, elbow: 1, ember: 0.5, capacitor: 0.2, splitter: 0.2 },
  elbow: { elbow: 3, capacitor: 1.2, threshold: 1, straight: 1, ember: 0.5, splitter: 0.6 },
  ember: { ember: 3, threshold: 2.5, elbow: 1, straight: 1, capacitor: 0.3, splitter: 0.3 },
};

/**
 * 候选件目录。
 *
 * - `singles`：一格内给出两向端口的件（rivet / jack / flint / pinValve），
 *   进向是其中一向、出向是另一向，所以每种姿态拆成两条候选。
 * - `segs`：多格件的「主动脉」，从 in 端口格沿件内相邻格走到 out 端口格。
 *   这是本轮的重点：`long / rail / elbow / hairpin / capacitor` 现在能当通路中继，
 *   不再只能铺在通路之外。
 *
 * 坐标一律相对件自身的左上角，落位时整体平移。
 */
const _catCache = new Map();
function pieceCatalog(V, style) {
  const hit = _catCache.get(style);
  if (hit && hit.V === V) return hit.cat;
  const D = V.Data;
  const pref = FAMILY_PREF[style] || FAMILY_PREF.straight;
  const singles = [];
  const segs = [];
  const seen = new Set();

  Object.keys(D.TEMPLATES).forEach((id) => {
    const tpl = D.TEMPLATES[id];
    for (let rot = 0; rot < 4; rot++) {
      for (const mir of [false, true]) {
        const tf = V.Circuit.transformTemplate(tpl, rot, mir);
        /* 姿态去重：单格件转 90° 只换方向，多格件镜像后可能一模一样 */
        const sig = id + '|'
          + tf.cells.map((c) => c.x + ',' + c.y).sort().join(';') + '|'
          + tf.ports.map((p) => p.cell.join(',') + p.dir + p.role).sort().join(';');
        if (seen.has(sig)) continue;
        seen.add(sig);

        const fam = V.Circuit.familyOf(tpl);
        const load = tpl.load || 1;
        const base = pref[fam] || 0;
        const cells = tf.cells.map((c) => ({ x: c.x, y: c.y }));

        if (cells.length === 1) {
          const dirs = [...new Set(tf.ports.map((p) => p.dir))];
          if (dirs.length !== 2) continue;
          /* 两向各作一次「进向」 */
          dirs.forEach((inDir) => {
            singles.push({
              kind: 'single', id, rotation: rot, mirrorY: mir, load, family: fam,
              cells, inDir, outDir: dirs.find((d) => d !== inDir) || dirs[0],
              score: base,
            });
          });
        } else {
          V.Manuscript.internalChains(tf.cells, tf.ports).forEach((ch) => {
            if (ch.cells.length < 2) return;
            segs.push({
              kind: 'seg', id, rotation: rot, mirrorY: mir, load, family: fam,
              cells: ch.cells.map((c) => ({ x: c.x, y: c.y })),
              inDir: ch.inDir, outDir: ch.outDir,
              /* 长件多给一点分：它一格能顶好几格的直导格数 */
              score: base + Math.min(2, ch.cells.length * 0.25),
            });
          });
        }
      }
    }
  });

  const byScore = (a, b) => b.score - a.score || a.load - b.load;
  singles.sort(byScore);
  segs.sort(byScore);
  const cat = { singles, segs };
  _catCache.set(style, { V, cat });
  return cat;
}

/**
 * 端口连通路径枚举（带件级回溯）。
 *
 * 与上一版的区别：一次可以落**整件**，落完直接从件尾的出向继续走。
 * 单格件等价于长度 1 的段，所以两种情形共用一个递归。
 */
function enumeratePaths(V, shape, ox, oy, style, limit) {
  const cat = pieceCatalog(V, style);
  const cells = new Set(shape.cells.map((c) => (c[0] + ox) + ',' + (c[1] + oy)));
  const entryKey = (shape.entry[0] + ox) + ',' + (shape.entry[1] + oy);
  const exitKeys = new Set(shape.exits.map((c) => (c[0] + ox) + ',' + (c[1] + oy)));
  if (exitKeys.has(entryKey) || !cells.has(entryKey)) return [];
  const veinsAt = (x, y) => shape.veins[(x - ox) + ',' + (y - oy)] || [];

  const out = [];
  const used = new Set();
  const dirsAt = new Map();
  const placed = [];
  let budget = 4000;

  const addDir = (k, d) => {
    if (!dirsAt.has(k)) dirsAt.set(k, new Set());
    dirsAt.get(k).add(d);
  };

  const fitsAt = (piece, ax, ay) => {
    const abs = [];
    for (const c of piece.cells) {
      const k = (c.x + ax) + ',' + (c.y + ay);
      if (!cells.has(k) || used.has(k)) return null;
      abs.push({ rel: c, k });
    }
    return abs;
  };

  /* 增量回滚：每一件记下自己往 dirsAt 里加了什么，撤销时精确摘掉。
     一格只会被一件占住，所以「摘掉本件加的方向」不会误伤别人。 */
  const commit = (piece, ax, ay, abs) => {
    const undo = [];
    abs.forEach(({ k }) => used.add(k));
    const push = (k, d) => {
      if (!dirsAt.has(k)) dirsAt.set(k, new Set());
      if (!dirsAt.get(k).has(d)) { dirsAt.get(k).add(d); undo.push([k, d]); }
    };
    if (piece.kind === 'single') {
      push(ax + ',' + ay, piece.inDir);
      push(ax + ',' + ay, piece.outDir);
    } else {
      push(abs[0].k, piece.inDir);
      push(abs[abs.length - 1].k, piece.outDir);
      for (let i = 1; i < abs.length; i++) {
        const a = abs[i - 1];
        const b = abs[i];
        const d = Object.keys(RD).find((k) => a.rel.x + RD[k][0] === b.rel.x && a.rel.y + RD[k][1] === b.rel.y);
        if (!d) continue;
        push(a.k, d);
        push(b.k, ROPP[d]);
      }
    }
    placed.push({ piece, ax, ay });
    return undo;
  };

  const rollback = (abs, undo) => {
    abs.forEach(({ k }) => used.delete(k));
    placed.pop();
    undo.forEach(([k, d]) => {
      const set = dirsAt.get(k);
      if (!set) return;
      set.delete(d);
      if (!set.size) dirsAt.delete(k);
    });
  };

  /** 在 (cx,cy) 落下一件：起点靠 vein 判定，其余靠「上一跳的方向」判定 */
  const step = (cx, cy, arrive) => {
    if (out.length >= limit || budget-- <= 0) return;
    const key0 = cx + ',' + cy;
    if (!cells.has(key0) || used.has(key0)) return;
    const isStart = arrive == null && key0 === entryKey;
    const veins = veinsAt(cx, cy);

    const tryPiece = (piece) => {
      /* 件的第一格要落在 (cx,cy) 上 */
      const head = piece.cells[0];
      const ax = cx - head.x;
      const ay = cy - head.y;
      /* 进向：起点的件，in 端口方向必须对上蚀刻法的入口刻线；其余必须对上「来向的反面」 */
      if (isStart) {
        if (!veins.length || !veins.every((v) => v === piece.inDir)) return;
      } else if (piece.inDir !== ROPP[arrive]) return;

      const abs = fitsAt(piece, ax, ay);
      if (!abs) return;
      const undo = commit(piece, ax, ay, abs);

      const lastAbs = abs[abs.length - 1];
      const lx = lastAbs.rel.x + ax;
      const ly = lastAbs.rel.y + ay;
      const lk = lx + ',' + ly;

      if (exitKeys.has(lk) && lk !== entryKey) {
        const got = dirsAt.get(lk) || new Set();
        const need = veinsAt(lx, ly);
        if (need.every((v) => got.has(v))) out.push(placed.map((p) => ({ ...p })));
      } else if (exitKeys.has(lk)) {
        /* 起点即终点：无解 */
      } else {
        const d = piece.outDir;
        const nx = lx + RD[d][0];
        const ny = ly + RD[d][1];
        if (cells.has(nx + ',' + ny) && !used.has(nx + ',' + ny)) step(nx, ny, d);
      }
      rollback(abs, undo);
    };

    cat.singles.forEach(tryPiece);
    cat.segs.forEach(tryPiece);
  };

  step(shape.entry[0] + ox, shape.entry[1] + oy, null);
  return out;
}

/** 用真实 BFS 结果（pulse）给一条候选打分 */
function scorePulse(pulse, style) {
  if (!pulse || !pulse.path || pulse.path.length < 2) return -1e9;
  const len = pulse.path.length;
  if (style === 'straight') return pulse.straight * 12 + len * 3 - pulse.turns * 3;
  if (style === 'elbow') return pulse.turns * 16 + len * 2;
  return (pulse.ember ? 16 : 0) + (pulse.gate ? 12 : 0) + pulse.turns * 4 + len * 2;
}

/** 通路之外的格子：先用多格件盖住蚀刻法剩余格（换阻抗），再补整板 */
function fillRest(V, st, unit, plate, placements, budget, style, opts) {
  const D = V.Data;
  const cellsOf = (p, table) => {
    const item = table[p.itemId];
    if (!item || item.kind !== 'circuit') return [];
    const tpl = D.TEMPLATES[item.templateId];
    if (!tpl) return [];
    return V.Circuit.transformTemplate(tpl, p.rotation || 0, !!p.mirrorY)
      .cells.map((c) => (c.x + p.x) + ',' + (c.y + p.y));
  };

  const used = new Set();
  placements.forEach((p) => cellsOf(p, st.itemsById).forEach((k) => used.add(k)));
  const plateSet = new Set(plate.cellsList.map((c) => c.join(',')));
  const msSet = new Set();
  V.State.manuscriptsOf(unit).forEach((m) => V.State.manuscriptCells(m).forEach((c) => msSet.add(c.join(','))));

  const want = (opts && opts.fill) || ({
    straight: ['rivet', 'rail', 'long', 'jack', 'threshold', 'straight'],
    elbow: ['capacitor', 'bellowsCell', 'coil', 'cistern', 'ampoule', 'elbow', 'dogleg', 'hairpin'],
    ember: ['ember', 'fuse', 'threshold', 'brazier', 'pinValve', 'flint'],
  }[style] || ['straight']);

  const pieces = [];
  [...new Set(want)].forEach((id) => {
    const tpl = D.TEMPLATES[id];
    if (!tpl) return;
    for (let rot = 0; rot < 4; rot++) {
      for (const mir of [false, true]) {
        pieces.push({
          id, rot, mir, load: tpl.load || 1,
          family: V.Circuit.familyOf(tpl),
          tf: V.Circuit.transformTemplate(tpl, rot, mir),
        });
      }
    }
  });

  /* 同一族别刷满：储能件一块就 +6 缓冲，堆十块会把「缓冲上限」变成一条命。
     配额是「几件」，不是「几格」—— 一件 bellowsCell 本来就占三格。 */
  /* 调用方显式点名了纹路（opts.fill）就不加族配额：那是「我就要这几件」，
     再按流派拦一道会让护盾/储能类测试永远铺不上件。 */
  const famQuota = (opts && opts.famQuota)
    || ((opts && Array.isArray(opts.fill) && opts.fill.length) ? {} : {
      /* 八标：C 流派（ember）的配额提到 5 件余烬 / 5 件闸系。
         4 / 3 的时候，压力爬不到 warm 档（+6/次 × 4 件仍被 galley 稀释），
         实测高热覆盖率只有 10% —— 余烬流派的引擎根本没点亮。 */
      capacitor: style === 'elbow' ? 3 : 0,
      ember: style === 'ember' ? 5 : 0,
      threshold: style === 'ember' ? 5 : 3,
    });
  const famUsed = {};

  /* 蚀刻法剩余格优先（覆盖率换阻抗），之后铺满整板 */
  const order = [...msSet].filter((k) => plateSet.has(k))
    .concat(plate.cellsList.map((c) => c.join(',')));

  let load = 0;
  order.forEach((cell) => {
    if (used.has(cell)) return;
    const [tx, ty] = cell.split(',').map(Number);
    let best = null;
    pieces.forEach((p) => {
      if (load + p.load > budget) return;
      const quota = famQuota[p.family];
      if (quota != null && (famUsed[p.family] || 0) >= quota) return;
      p.tf.cells.forEach((a) => {
        const ox = tx - a.x;
        const oy = ty - a.y;
        const keys = p.tf.cells.map((c) => (c.x + ox) + ',' + (c.y + oy));
        if (!keys.every((k) => plateSet.has(k))) return;
        if (keys.some((k) => used.has(k))) return;
        const gain = keys.filter((k) => msSet.has(k) && !used.has(k)).length;
        const score = keys.length * 2 + gain * 6 - p.load;
        if (!best || score > best.score) best = { ...p, ox, oy, keys, score };
      });
    });
    if (!best) return;
    best.keys.forEach((k) => used.add(k));
    load += best.load;
    famUsed[best.family] = (famUsed[best.family] || 0) + 1;
    const item = V.State.makePart(st, { kind: 'circuit', templateId: best.id });
    st.itemsById[item.id] = item;
    placements.push({ itemId: item.id, x: best.ox, y: best.oy, rotation: best.rot, mirrorY: best.mir });
  });
  return { load, cells: used };
}

/**
 * 流派定向自动布线：保证 Circuit.compile 出来的 pulse.path 非空（routed === true）。
 *
 * @param {object} A          载入后的 Ashen 命名空间
 * @param {object} st         状态
 * @param {object} unit       roster 里的角色
 * @param {object} [opts]     { style:'straight'|'elbow'|'ember', msId, fill:[] , overload:0.35 }
 * @returns {{ok:boolean, reason?:string, pulse?:object, route?:object, placements?:Array, pose?:object}}
 */
function autoRouteBoard(A, st, unit, opts) {
  const V = A.Veteran;
  const D = V.Data;
  const style = (opts && opts.style) || 'straight';
  const limit = (opts && opts.limit) || 12;
  const plate = V.Circuit.plateOf(unit);
  const cap = V.Circuit.loadCap(unit);

  const mss = V.State.manuscriptsOf(unit).filter(ms => !opts?.msId || ms.id === opts.msId);
  if (!mss.length) return { ok: false, reason: '没有装配蚀刻法' };

  /* ---- 第一步/第二步：枚举姿态 × 落点 × 端口通路 ---- */
  const candidates = [];
  for (const ms of mss) {
    const norm = V.Manuscript.normalize(D.manuscript(ms.id) || ms);
    if (!norm) continue;
    const free = V.State.freeManuscriptCells(unit, ms.id);
    for (const mir of [false, true]) {
      for (let rot = 0; rot < 4; rot++) {
        const shape = V.Manuscript.orient(norm, rot, mir);
        V.Manuscript.placements(shape, free).slice(0, 4).forEach(([ox, oy]) => {
          enumeratePaths(V, shape, ox, oy, style, limit).forEach((nodes) => {
            candidates.push({ ms, rot, mir, ox, oy, shape, nodes });
          });
        });
        if (candidates.length >= 40) break;
      }
      if (candidates.length >= 40) break;
    }
    if (candidates.length) break;
  }
  if (!candidates.length) return { ok: false, reason: '轮廓不兼容或没有完整的可布线路径' };

  /* ---- 用真实 route() 复核每条候选（BFS 可能走出一条更短的支路） ----
     注意：这里把候选件拼成一份「和 layout 同构」的 built，再交给 pieceIndex 求 dirs，
     这样复核用的连通图与真实布局**逐位一致**，不会出现「布线器以为通了、引擎说不通」。 */
  const scored = [];
  candidates.forEach((c) => {
    const built = c.nodes.map((p) => {
      const tf = V.Circuit.transformTemplate(D.TEMPLATES[p.piece.id], p.piece.rotation, p.piece.mirrorY);
      return {
        tpl: D.TEMPLATES[p.piece.id],
        abs: tf.cells.map((cc) => ({ x: cc.x + p.ax, y: cc.y + p.ay })),
        aps: tf.ports.map((pt) => ({
          role: pt.role, dir: pt.dir, cell: [pt.cell[0] + p.ax, pt.cell[1] + p.ay],
        })),
      };
    });
    const rt = V.Manuscript.route(c.shape, c.ox, c.oy, V.Manuscript.pieceIndex({ built }));
    if (!rt.ok || rt.path.length < 2) return;
    const pulse = V.Circuit.pulseOf({ built }, rt);
    const score = scorePulse(pulse, style);
    if (score <= -1e8) return;
    scored.push({ ...c, pulse, score, built });
  });
  if (!scored.length) return { ok: false, reason: '通路都走不通（端口没对上）' };
  scored.sort((a, b) => b.score - a.score);

  /* ---- 第三步：落地 + 余格填充 ---- */
  const best = scored[0];
  const ms = best.ms;
  const placements = best.nodes.map((p) => {
    const item = V.State.makePart(st, { kind: 'circuit', templateId: p.piece.id });
    st.itemsById[item.id] = item;
    return { itemId: item.id, x: p.ax, y: p.ay, rotation: p.piece.rotation, mirrorY: p.piece.mirrorY };
  });

  /* 蚀刻法姿态也要跟着锁定：通路坐标是相对这个姿态算出来的 */
  ms.x = best.ox;
  ms.y = best.oy;
  ms.rotation = best.rot;
  ms.mirrorY = best.mir;

  const pathLoad = best.nodes.reduce((a, n) => a + (n.piece.load || 1), 0);
  /* 蚀刻法自己也吃负荷（preview 里 load += ms.load）—— 漏了它，A/B 会稳定超载 3~5 点 */
  const msLoad = V.State.manuscriptsOf(unit).reduce((a, m) => a + (Number(m.load) || 0), 0);
  const budget = Math.round(cap * (1 + ((opts && opts.overload) || 0))) - pathLoad - msLoad;
  fillRest(V, st, unit, plate, placements, Math.max(0, budget), style, opts);

  unit.board.placements = placements;

  /* ---- 真实编译复核：这是最终裁判 ---- */
  const lay = V.Circuit.layout(st, placements);
  const idx = V.Manuscript.pieceIndex(lay);
  const rt = V.Manuscript.route(best.shape, ms.x, ms.y, idx);
  const pulse = V.Circuit.pulseOf(lay, rt);
  const cc = V.Circuit.compile(st, unit.id, placements);
  return {
    ok: !!rt.ok && !!pulse.path.length && !!(cc.ok && cc.value.panel.usedCells),
    reason: rt.ok ? '' : ('真实布局未连通：' + rt.reason),
    pulse, route: rt, placements,
    pose: { x: ms.x, y: ms.y, rotation: ms.rotation, mirrorY: ms.mirrorY },
    style,
    load: cc.ok ? cc.value.load : null,
    cap,
    panel: cc.ok ? cc.value.panel : null,
  };
}

function placeForStrike(b, attacker, target) {
  b.field[attacker.id] = b.field[target.id] + (attacker.side === 'ally' ? -18 : 18);
  b.fieldY[attacker.id] = b.fieldY[target.id];
}

module.exports = { fullTeam, boot, startRun, setNodes, fight, stepUntilOver, makePart, buildBoard, autoRouteBoard, placeForStrike };
