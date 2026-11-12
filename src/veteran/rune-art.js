'use strict';
/* 以格为单位绘制金属上的凹刻。板面、缩略图与拖拽共同使用这套变换。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const metal = {
    straight: '#b2c8b8', elbow: '#aec2cb', splitter: '#c5b8cf',
    capacitor: '#cdbc92', threshold: '#c4aaa1', ember: '#d8aa77',
  };
  const sides = { W: [-1,0], E: [1,0], N: [0,-1], S: [0,1] };

  /* 每条支路按出口顺序给出刀纹的中轴；第三个数是此处纹束的展宽倍率。
     两端与贴边的一小段从实际端口导出，所有模板共用接缝的间距和切向。 */
  const spines = {
    straight: [[[.7,.55,1.4],[1.35,.45,.8]]],
    elbow: [[[.85,.48],[1.34,.68,1.4],[1.49,1.27]]],
    splitter: [[[.67,1.5,.72],[.98,1.5,0],[1.18,1.32],[1.40,.83,1.4],[1.58,.53]],
               [[.67,1.5,.72],[.98,1.5,0],[1.18,1.68],[1.40,2.17,1.4],[1.58,2.47]]],
    capacitor: [[[.48,.62],[.39,1.19],[.65,1.64,1.6],[1.23,1.67,1.6],[1.57,1.27],[1.51,.79],[1.64,.52]]],
    threshold: [[[.55,.48,.5],[.83,.33,1.4],[1.14,.62,.55],[1.46,.5,1.4]]],
    ember: [[[.55,.58,.65],[.85,.36,1.5],[1.22,.62,.6],[1.52,.47,1.2]]],
    rivet: [[[.51,.50,1.75]]],
    long: [[[.75,.55,1.25],[1.55,.39,1.45],[2.34,.53,.7]]],
    tee: [[[.76,.49,.72],[1.08,.49,0],[1.45,.51],[2.25,.47]],[[.76,.49,.72],[1.08,.49,0],[1.41,.68],[1.5,1.38]]],
    cross: [[[.78,1.5,.72],[1.09,1.5,0],[1.40,1.35],[1.5,.66]],[[.78,1.5,.72],[1.09,1.5,0],[1.5,1.50,1.45],[2.25,1.5]],
            [[.78,1.5,.72],[1.09,1.5,0],[1.40,1.65],[1.5,2.34]]],
    jack: [[[.43,.45],[.49,.31]]],
    rail: [[[1,.53],[2,.41,1.65],[3,.53]]],
    dogleg: [[[.8,.42],[1.26,.60],[1.47,1.22,1.3],[1.84,1.54],[2.47,1.45]]],
    hairpin: [[[.8,.45],[1.65,.38],[2.44,.56],[2.64,1.03],[2.41,1.48,1.5],[1.77,1.53]]],
    kneejoint: [[[.82,.46],[1.28,.50,1.4],[1.49,.72]]],
    crook: [[[.48,.79],[.34,1.57,1.45],[.58,2.30],[1.24,2.52]]],
    clevis: [[[.68,.5,.72],[.98,.5,0],[1.27,.44],[1.49,.25]],[[.68,.5,.72],[.98,.5,0],[1.27,.56],[1.49,.75]]],
    spillway: [[[.82,.5],[1.58,.5,0],[2.37,.5]],[[.82,.5],[1.58,.5,0],[2.23,.68],[2.48,1.31]]],
    wishbone: [[[1.5,1.72,.75],[1.5,1.55,0],[1.14,1.43],[.63,1.29],[.47,.64]],
               [[1.5,1.72,.75],[1.5,1.55,0],[1.86,1.43],[2.37,1.29],[2.53,.64]]],
    bellowsCell: [[[.72,.60,.7],[1.23,.37,1.7],[1.75,.64,.8],[2.30,.43,1.45]]],
    coil: [[[.52,.62],[.90,.76],[1.49,.61],[1.70,.40],[1.40,.31],[1.22,.62],[1.33,1.13,1.35],[1.51,1.56]]],
    cistern: [[[.66,.51],[1.24,.37],[1.81,.46],[1.88,.87],[1.31,1.06],[.66,1.22],[.53,1.56],[1.14,1.70,1.45],[2.25,1.50]]],
    ampoule: [[[1.51,.70],[1.68,1.09],[2.23,1.27],[2.55,1.54],[2.23,1.73],[1.33,1.62,1.55],[.64,1.48]]],
    pinValve: [[[.5,.51,.4]]],
    sluice: [[[.61,.58],[1.08,.38,1.6],[1.53,.55],[1.40,.96,.65],[1.5,1.56]]],
    reed: [[[.83,.62],[1.56,.46,1.75],[2.21,.49],[2.48,.29]]],
    flint: [[[.41,.45,.55],[.54,.66,1.25]]],
    fuse: [[[.6,.54,.7],[1.03,.30,1.55],[1.47,.64,.75],[1.91,.37,1.6],[2.43,.53]]],
    brazier: [[[1.48,2.36],[1.43,1.90],[.86,1.74],[.48,1.48],[.80,1.28],[1.45,1.49],[2.18,1.70],[2.52,1.48],[2.20,1.26],[1.63,1.11],[1.48,.61]]],
    wickbend: [[[.55,.54],[.39,.96],[.67,1.45],[1.29,1.62,.65],[1.85,1.35,1.55],[2.30,1.48],[2.48,1.26]]],
  };

  function direction(a,b) {
    const dx=b[0]-a[0], dy=b[1]-a[1], length=Math.hypot(dx,dy);
    return [dx/length, dy/length];
  }
  function portPoint(port, inset) {
    const [dx,dy]=sides[port.dir];
    return [port.cell[0]+.5+dx*(.5-inset), port.cell[1]+.5+dy*(.5-inset)];
  }
  function strand(points, lane, lip) {
    const last=points.length-1;
    const tangents = points.map((p, i) => {
      if (i <= 1) return direction(points[0], points[1]);
      if (i >= last - 1) return direction(points[last-1], points[last]);
      if (p[2] === 0) return direction(points[i-1], p);
      return direction(points[i-1], points[i+1]);
    });
    const knots=points.map(([x,y,width=1],i)=>{
      const [dx,dy]=tangents[i];
      const offset = lane * width + (i === 0 || i === last ? 0 : lip);
      return [x - dy * offset, y + dx * offset];
    });
    const xy=(x,y)=>round(x)+' '+round(y);
    let d='M'+xy(...knots[0]);
    for(let i=1;i<=last;i++){
      const [ax,ay]=knots[i-1], [bx,by]=knots[i];
      const h=Math.hypot(bx-ax,by-ay)/3;
      const [ux,uy]=tangents[i-1], [vx,vy]=tangents[i];
      d+=' C'+xy(ax+ux*h,ay+uy*h)+' '+xy(bx-vx*h,by-vy*h)+' '+xy(bx,by);
    }
    return d;
  }

  function engraved(tpl) {
    const shadows = [], lips = [];
    tpl.links.forEach(([input,output],i)=>{
      const inlet=tpl.ports.find(p=>p.id===input), outlet=tpl.ports.find(p=>p.id===output);
      const points=[portPoint(inlet,0),portPoint(inlet,.16),...spines[tpl.id][i],portPoint(outlet,.16),portPoint(outlet,0)];
      for (const lane of [-.085, 0, .085]) {
        shadows.push(strand(points, lane, 0));
        lips.push(strand(points, lane, .014));
      }
    });
    const strokes=(paths,color,width)=>paths.map(d=>`<path d="${d}" stroke="${color}" stroke-width="${width}"/>`).join('');
    return `<g class="etched-grain" fill="none">
      ${strokes(shadows,'#15191b',.047)}
      <g class="cut-lips">${strokes(lips,metal[tpl.family || tpl.id],.021)}</g>
    </g>`;
  }

  const RUNES = Object.fromEntries(Object.values(V.Data.TEMPLATES).map(tpl => [tpl.id, {
    cols: 1 + Math.max(...tpl.cells.map(([x]) => x)),
    rows: 1 + Math.max(...tpl.cells.map(([, y]) => y)),
    engraving: engraved(tpl),
  }]));
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
    const W0 = r.cols;
    const H0 = r.rows;
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

  function relief(id, r, rotation, mirrorY) {
    const rot = (((rotation | 0) % 4) + 4) % 4;
    const row = mirrorY === true || Number(mirrorY) === 1 ? 1 : 0;
    return `<svg class="etch-relief" width="${r.cols}" height="${r.rows}" viewBox="${rot*r.cols} ${row*r.rows} ${r.cols} ${r.rows}" overflow="hidden"><image href="assets/art/etch-depth/${id}.webp" width="${4*r.cols}" height="${2*r.rows}" preserveAspectRatio="none"/></svg>`;
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
    return `<g class="rune${cls}" pointer-events="none" transform="translate(${round(x)},${round(y)}) scale(${round(cell)}) matrix(${m.join(',')})"${op}>${r.engraving}${relief(id,r,o.rotation,o.mirrorY)}</g>`;
  }

  /** HTML 缩略图（纹路库、仓库、板面纹路列表用） */
  function thumb(id, cls, turn = 0) {
    const r = rune(id);
    if (!r) return '';
    if (turn) {
      const {cols,rows} = sizeFor(id,turn);
      return `<svg class="rune-thumb ${cls || ''}" viewBox="0 0 ${cols} ${rows}" aria-hidden="true">${image(id,{cell:1,rotation:turn})}</svg>`;
    }
    return `<svg class="rune-thumb ${cls || ''}" viewBox="0 0 ${r.cols} ${r.rows}" aria-hidden="true">${r.engraving}${relief(id,r,0,false)}</svg>`;
  }

  V.RuneArt = { RUNES, rune, matrixFor, sizeFor, image, thumb };
})(globalThis.Ashen ||= {});
