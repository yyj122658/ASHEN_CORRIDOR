'use strict';
/* 以格为单位绘制金属上的凹刻。板面、缩略图与拖拽共同使用这套变换。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const metal = {
    straight: '#57A6A7', elbow: '#57A6A7', splitter: '#57A6A7',
    capacitor: '#57A6A7', threshold: '#BC9C50', ember: '#EC963F',
  };
  const sides = { W: [-1,0], E: [1,0], N: [0,-1], S: [0,1] };
  let waxUid = 0;
  let footprintUid = 0;

  function edgeLoops(cells) {
    const occupied = new Set(cells.map(cell => cell.join(',')));
    const edges = [];
    const add = (x0, y0, x1, y1, dir, nx, ny, ex, ey) => {
      if (!occupied.has(ex + ',' + ey)) edges.push({x0, y0, x1, y1, dir, nx, ny, ex, ey});
    };
    for (const key of occupied) {
      const [x, y] = key.split(',').map(Number);
      add(x, y, x+1, y, 0, 0, -1, x, y-1);
      add(x+1, y, x+1, y+1, 1, 1, 0, x+1, y);
      add(x+1, y+1, x, y+1, 2, 0, 1, x, y+1);
      add(x, y+1, x, y, 3, -1, 0, x-1, y);
    }
    const byStart = new Map();
    for (const edge of edges) {
      const key = edge.x0 + ',' + edge.y0;
      if (!byStart.has(key)) byStart.set(key, []);
      byStart.get(key).push(edge);
    }
    const visited = new Set();
    const loops = [];
    for (const start of edges) {
      if (visited.has(start)) continue;
      const loop = [];
      let edge = start;
      while (edge && !visited.has(edge)) {
        visited.add(edge);
        loop.push(edge);
        if (edge.x1 === start.x0 && edge.y1 === start.y0) break;
        const next = byStart.get(edge.x1 + ',' + edge.y1) || [];
        // Follow the right wall to keep diagonally touching regions separate.
        edge = [1, 0, 3].map(turn => (edge.dir + turn) % 4)
          .map(dir => next.find(e => e.dir === dir && !visited.has(e))).find(Boolean);
      }
      loops.push(loop);
    }
    return loops;
  }

  function contourPath(cells, cell, ox = 0, oy = 0) {
    return edgeLoops(cells).map(loop => 'M' + loop
      .filter((edge, i) => edge.dir !== loop[(i + loop.length - 1) % loop.length].dir)
      .map(({x0, y0}) => (ox + x0*cell) + ' ' + (oy + y0*cell)).join('L') + 'Z').join('');
  }

  const blueprintTints = {
    straight: '#57A6A7', elbow: '#BC9C50', splitter: '#D4CABB',
    capacitor: '#57A6A7', threshold: '#EC963F', ember: '#EC963F',
  };

  function blueprint(templateId, rotation = 0, mirrorY = false) {
    const tpl = V.Data.template(templateId);
    if (!tpl) return '';
    const shape = V.Circuit.transformTemplate(tpl, rotation, mirrorY);
    const cells = shape.cells.map(({x, y}) => [x, y]);
    const width = Math.max(...cells.map(([x]) => x)) + 1;
    const height = Math.max(...cells.map(([, y]) => y)) + 1;
    const span = Math.max(width, height) >= 4 ? Math.max(5, width, height) : 4;
    const step = 36 / span;
    const ox = 4 + Math.floor((span - width)/2) * step;
    const oy = 4 + Math.floor((span - height)/2) * step;
    const grid = Array.from({length: span + 1}, (_, n) => {
      const pos = 4 + n * step;
      return `M4 ${pos}H40M${pos} 4V40`;
    }).join('');
    const family = V.Circuit.familyOf(tpl);
    const tint = blueprintTints[family] || blueprintTints.straight;
    const rim = family === 'capacitor' ? '#7A838F' : tint;
    const footprint = contourPath(cells, step, ox, oy);
    const ports = shape.ports.map(port => {
      const [dx, dy] = sides[port.dir];
      const x = ox + (port.cell[0] + .5 + dx/2) * step;
      const y = oy + (port.cell[1] + .5 + dy/2) * step;
      const fill = port.role === 'in' ? '#57A6A7' : '#BC9C50';
      const mark = port.role === 'in'
        ? 'M2 -2.5H0L-2 0L0 2.5H2Z' : 'M-1.3 -2.5H1.3V2.5H-1.3Z';
      const angle = {E:0,S:90,W:180,N:270}[port.dir];
      return `<path class="rune-port-cut" data-role="${port.role}" data-dir="${port.dir}"
        transform="translate(${x} ${y}) rotate(${angle})" d="${mark}" fill="${fill}" stroke="#1E2230" stroke-width=".7"/>`;
    }).join('');
    return `<svg class="mini-shape rune-blueprint" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <rect width="44" height="44" fill="#1E2230"/><path d="${grid}" fill="none" stroke="#7A838F" stroke-opacity=".46" stroke-width="1"/>
      <path class="rune-blueprint-cells" d="${footprint}" fill="${tint}" fill-opacity=".33" fill-rule="evenodd" stroke="${rim}" stroke-width="1"/>
      ${cells.map(([x,y]) => `<rect class="rune-blueprint-cell" x="${ox+x*step+.8}" y="${oy+y*step+.8}" width="${step-1.6}" height="${step-1.6}" fill="${tint}" fill-opacity=".17"/>`).join('')}
      ${ports}</svg>`;
  }

  function membraneBadge(shape) {
    const w = Math.max(...shape.cells.map(([x]) => x)) + 1;
    const h = Math.max(...shape.cells.map(([, y]) => y)) + 1;
    const outline = contourPath(shape.cells, 10, 1, 1);
    const cuts = shape.cells.flatMap(([x,y]) => (shape.veins[x + ',' + y] || []).map(dir => {
      const [dx, dy] = sides[dir];
      return `M${10*x+6} ${10*y+6}l${dx*5} ${dy*5}`;
    })).join('');
    return `<svg class="ms-skeleton" viewBox="0 0 ${10*w+2} ${10*h+2}" aria-hidden="true">
      <path d="${outline}" fill="currentColor" fill-opacity=".21" fill-rule="evenodd" stroke="currentColor" stroke-width="1.2"/>
      <path d="${cuts}" fill="none" stroke="currentColor" stroke-opacity=".74" stroke-width=".8"/>
    </svg>`;
  }

  function waxFilm(oriented, size, selected) {
    if (!oriented.cells.length) return '';
    const id = 'wax_' + (++waxUid);
    const w = 60 * (1 + Math.max(...oriented.cells.map(c => c[0])));
    const h = 60 * (1 + Math.max(...oriented.cells.map(c => c[1])));
    const outline = contourPath(oriented.cells, 60);
    const veins = [];
    const cells = oriented.cells.map(([x, y]) => {
      const key = x + ',' + y;
      const cx = x * 60 + 30, cy = y * 60 + 30;
      const cuts = (oriented.veins[key] || []).filter(dir => sides[dir]).map(dir => {
        const [dx, dy] = sides[dir];
        const cut = `M${cx} ${cy}l${dx*30} ${dy*30}`;
        veins.push(cut);
        return `<path class="wax-vein-core" data-vein="${dir}" d="${cut}"/>`;
      }).join('');
      return `<g data-etch-cell="${key}">${cuts}</g>`;
    }).join('');
    const groove = veins.join('');
    const texture = A.Art.getArt('surface.wax').src;
    const arcane = V.Data.manuscript(oriented.id)?.rarity >= 5;
    return `<g class="wax-membrane${arcane ? ' arcane' : ''}" transform="scale(${size/60})" pointer-events="none">
      <defs>
        <linearGradient id="${id}_tone" x1="0" x2=".85" y1="0" y2="1">
          <stop stop-color="var(--wax-rim)"/><stop offset=".43" stop-color="var(--wax-body)"/>
          <stop offset="1" stop-color="var(--wax-deep)"/>
        </linearGradient>
        <linearGradient id="${id}_sheen" x1="0" x2=".65" y1="0" y2="1">
          <stop stop-color="#D4CABB" stop-opacity="0"/>
          <stop offset=".28" stop-color="#D4CABB" stop-opacity=".14"/>
          <stop offset=".58" stop-color="#D4CABB" stop-opacity="0"/>
        </linearGradient>
        <mask id="${id}_cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">
          <path d="${outline}" fill="white" fill-rule="evenodd"/>
          <path d="${groove}" fill="none" stroke="black" stroke-width="5" stroke-linecap="square"/>
        </mask>
      </defs>
      <g mask="url(#${id}_cut)">
        <path class="ms-field" d="${outline}" fill="url(#${id}_tone)" fill-rule="evenodd"/>
        <image class="wax-grain" href="${texture}" width="${w}" height="${h}" preserveAspectRatio="none"/>
        <path d="${outline}" fill="url(#${id}_sheen)" fill-rule="evenodd"/>
        <path class="wax-seal" d="${outline}"/>
        <path class="ms-contour${selected ? ' focused' : ''}" d="${outline}"${selected ? ' data-ms-outline="' + A.Art.safeText(oriented.id) + '"' : ''}/>
      </g>
      <path class="wax-vein-wall" d="${groove}"/>
      ${cells}
    </g>`;
  }

  function engravingFor(tpl) {
    const shape = V.Circuit.transformTemplate(tpl, 0, false);
    const tap = (cell, dir) => {
      const [dx, dy] = sides[dir];
      return [cell.x + .5 + dx / 2, cell.y + .5 + dy / 2];
    };
    const traces = V.Manuscript.internalChains(shape.cells, shape.ports).map(chain => [
      tap(chain.cells[0], chain.inDir),
      ...chain.cells.map(c => [c.x + .5, c.y + .5]),
      tap(chain.cells.at(-1), chain.outDir),
    ]);
    const paths = traces.map(trace => '<path d="M' + trace.map(p => p.join(' ')).join('L') + '"/>').join('');
    const bed = `<path d="${contourPath(shape.cells.map(c => [c.x, c.y]), 1)}" fill="#1E2230" fill-rule="evenodd" stroke="#4F5968" stroke-width=".02"/>`;
    return {
      cols: 1 + Math.max(...shape.cells.map(c => c.x)),
      rows: 1 + Math.max(...shape.cells.map(c => c.y)),
      cells: shape.cells, ports: shape.ports, traces, accent: metal[tpl.family || tpl.id] || metal.straight,
      engraving: `<g class="etched-grain">${bed}<g fill="none"><g stroke="#BC9C50" stroke-opacity=".55" stroke-width=".15">${paths}</g><g class="cut-lips" stroke="#4F5968" stroke-width=".08">${paths}</g></g></g>`,
    };
  }

  const RUNES = Object.fromEntries(Object.values(V.Data.TEMPLATES).map(tpl => [tpl.id, engravingFor(tpl)]));
  const ETCHINGS = Object.fromEntries(Object.values(V.Data.MANUSCRIPTS).map(spec => [spec.id, V.Manuscript.normalize(spec)]));
  function rune(id) { return Object.hasOwn(RUNES, id) ? RUNES[id] : null; }

  /* ---- 2x3 仿射矩阵：p' = T · R · M · p ---- */

  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }

  /**
   * 原画（rotation 0、未翻转）→ 目标朝向的矩阵。
   * 与 circuit.transformTemplate 同序：先按 bbox 上下翻转，再顺时针旋转，再平移到 0,0。
   */
  function matrixFor(id, rotation, mirrorY) {
    const r = rune(id);
    if (!r) return null;
    return poseMatrix(r.cols, r.rows, rotation, mirrorY);
  }

  function poseMatrix(W0, H0, rotation, mirrorY) {
    const rot = (((rotation | 0) % 4) + 4) % 4;
    const mir = mirrorY === true || Number(mirrorY) === 1;

    let m = [1, 0, 0, 1, 0, 0];
    if (mir) m = mul([1, 0, 0, -1, 0, H0], m); // translate(0,H0) · scale(1,-1)
    if (rot === 1) m = mul([0, 1, -1, 0, H0, 0], m); // translate(H0,0) · rotate(90)
    else if (rot === 2) m = mul([-1, 0, 0, -1, W0, H0], m);
    else if (rot === 3) m = mul([0, -1, 1, 0, 0, W0], m);
    return m;
  }

  /** 给定朝向占几列几格 */
  function sizeFor(id, rotation) {
    const r = rune(id);
    if (!r) return null;
    const rot = (((rotation | 0) % 4) + 4) % 4;
    return rot % 2 === 0 ? { cols: r.cols, rows: r.rows } : { cols: r.rows, rows: r.cols };
  }

  function round(n) { return Math.round(n * 1000) / 1000; }

  function relief(id, r) {
    const art = A.Art.getArt('conduit.idle.' + id);
    return `<svg class="etch-relief" width="${r.cols}" height="${r.rows}" overflow="hidden"><image href="${art.src}" width="${r.cols}" height="${r.rows}" preserveAspectRatio="none"/></svg>`;
  }

  function spriteTile(id, index, cols, rows, x, y, size, cls) {
    const art = A.Art.getArt(id);
    const view = `${index % cols * 64} ${Math.floor(index / cols) * 64} 64 64`;
    return `<svg class="conduit-tile ${cls}" x="${x-size/2}" y="${y-size/2}" width="${size}" height="${size}"
      viewBox="${view}" overflow="hidden" aria-hidden="true"><image href="${art.src}" width="${64*cols}" height="${64*rows}"/></svg>`;
  }

  function conduitTile(index, x, y, size, cls = '') {
    return spriteTile('conduit.blueprint', index, 4, 9, x, y, size, cls);
  }

  function conduitOverlay(kind, x, y, size, cls = '') {
    return spriteTile('conduit.overlays', { lock: 0, fuse: 1, blocked: 2 }[kind], 3, 1, x, y, size, cls);
  }

  function plateNode(core, x, y) {
    const rim = core ? 'M6 1H14V4H17V7H20V13H17V16H14V19H6V16H3V13H0V7H3V4H6Z'
      : 'M0 0H20V6H17V14H20V20H0V14H3V6H0Z';
    const mark = core ? 'M8 5H12V8H15V12H12V15H8V12H5V8H8Z' : 'M8 5H12V8H15V12H12V15H8V12H5V8H8Z M9 9H11V11H9Z';
    return `<g transform="translate(${round(x)} ${round(y)})" aria-hidden="true">
      <path class="plate-node-rim" d="${rim}"/><path class="plate-node-mark" d="${mark}" fill-rule="evenodd"/>
    </g>`;
  }

  function etchImage(oriented, cell) {
    const base = Object.hasOwn(ETCHINGS, oriented.id) && ETCHINGS[oriented.id];
    if (!base) return '';
    const expected = V.Manuscript.orient(base, oriented.rotation, oriented.mirrorY);
    const signature = shape => JSON.stringify([shape.cells, shape.veins, shape.entry, shape.exits, shape.io]);
    // 裁切过的旧谱、异形底盘谱使用同一套精确的矢量降级。
    if (signature(oriented) !== signature(expected)) return '';
    const cols = 1 + Math.max(...base.cells.map(p => p[0]));
    const rows = 1 + Math.max(...base.cells.map(p => p[1]));
    const m = poseMatrix(cols, rows, oriented.rotation, oriented.mirrorY);
    return `<image class="etch-asset" href="assets/art/topology-v4/etch-relief/${base.id}.webp" width="${cols}" height="${rows}"
      transform="scale(${round(cell)}) matrix(${m.join(',')})" pointer-events="none"/>`;
  }

  /**
   * SVG <image>。x/y 是纹路锚点（变换后 bbox 的左上角）在画布上的坐标，
   * cell 是画布上一格的边长。
   *
   * 几何全部在「格」单位里算（matrixFor 的平移量是格数），再用外层
   * scale(cell) 放大到画布尺寸 —— 如果把矩阵和像素尺寸混用，旋转量会差一个
   * 格距的倍数（旋转 0 时恰好是单位矩阵，看不出来）。
   */
  function image(id, opts) {
    const r = rune(id);
    if (!r) return '';
    const o = opts || {};
    const cell = o.cell || 60;
    const m = matrixFor(id, o.rotation, o.mirrorY);
    if (!m) return '';
    const x = o.x || 0;
    const y = o.y || 0;
    const cls = o.cls ? ' ' + o.cls : '';
    const op = o.opacity == null ? '' : ` opacity="${o.opacity}"`;
    return `<g class="rune${cls}" pointer-events="none" transform="translate(${round(x)},${round(y)}) scale(${round(cell)}) matrix(${m.join(',')})"${op}>${r.engraving}${relief(id,r)}</g>`;
  }

  function powered(id, x, y, cell, rotation, mirror) {
    const {cols, rows} = rune(id);
    const m = matrixFor(id, rotation, mirror);
    const art = pose => A.Art.getArt(`conduit.${pose}.${id}`).src;
    return `<g transform="translate(${round(x)},${round(y)}) scale(${round(cell)}) matrix(${m.join(',')})"
      ><image class="conduit-normal" href="${art('powered')}" width="${cols}" height="${rows}"/>
      <image class="conduit-hot" href="${art('hot')}" width="${cols}" height="${rows}"/></g>`;
  }

  /** 宝箱、背包、仓库和拖影用实际格距的酸蚀贴图。 */
  function footprint(id, turn = 0) {
    const size = sizeFor(id, turn);
    if (!size) return '';
    const shape = V.Circuit.transformTemplate(V.Data.TEMPLATES[id], turn, false);
    const rim = contourPath(shape.cells.map(({x, y}) => [x, y]), 1);
    const clip = 'rune-footprint-' + (++footprintUid);
    return `<svg class="rune-footprint" viewBox="0 0 ${size.cols} ${size.rows}" preserveAspectRatio="none" aria-hidden="true">
      <defs><clipPath id="${clip}"><path d="${rim}" clip-rule="evenodd"/></clipPath></defs>
      <g clip-path="url(#${clip})">${image(id, {cell:1, rotation:turn})}
        <path class="rune-footprint-rim" d="${rim}" fill="none" vector-effect="non-scaling-stroke"/>
      </g></svg>`;
  }

  /** 用于名称旁的紧凑图鉴徽章。 */
  function thumb(id, cls) {
    const r = rune(id);
    if (!r) return '';
    if (A.Art?.statusOf('rune.' + id) !== 'failed') {
      const icon = A.Art?.imgTag('rune.' + id, 'rune-catalogue-mark');
      if (icon) return `<span class="rune-thumb ${cls || ''}">${icon}<svg viewBox="0 0 ${r.cols} ${r.rows}" aria-hidden="true">${r.engraving}${relief(id,r)}</svg></span>`;
    }
    return `<svg class="rune-thumb ${cls || ''}" viewBox="0 0 ${r.cols} ${r.rows}" aria-hidden="true">${r.engraving}${relief(id,r)}</svg>`;
  }

  V.RuneArt = { RUNES, ETCHINGS, rune, matrixFor, sizeFor, image, powered, footprint, thumb, etchImage, conduitTile, conduitOverlay,
    edgeLoops, contourPath, waxFilm, blueprint, membraneBadge, plateNode };
})(globalThis.Ashen ||= {});
