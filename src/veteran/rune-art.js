'use strict';
/* 生命金属纹章渲染（独立模块，不改动板面既有逻辑）。
   输入是 assets/art/rune-set-v1/grid/ 下已校准到统一格距的切片：
   每张都按逻辑 cells 蒙版的列数/行数精确缩放，四边贴边。

   为什么单独一个文件：板面渲染（src/veteran/ui.js）正在被并行修改，
   把「纹章怎么画」抽出来，接线只需把画 flat 色块的地方换成本模块的一次调用，
   两边改动互不覆盖。

   用法（在 boardSvg 里）：
     const img = V.RuneArt.image(templateId, {
       x: GX + p.x * CELL, y: GY + p.y * CELL, cell: CELL,
       rotation: p.rotation, mirrorY: p.mirrorY,
     });
   旋转/翻转复用同一张原画，不另生成素材；变换与 circuit.transformTemplate 严格同序
   （先上下翻转，再顺时针旋转，最后归一化到 0,0），由 rune-art.test.cjs 逐组合校验。
*/
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  /* 默认相对页面根目录（index.html 在仓库根）。独立预览页可以用 setBase 改，
     不要把它写成相对模块文件的路径——那样游戏里又会指错。 */
  let basePath = 'assets/art/rune-set-v1/grid/';

  /* cols/rows 来自 grid/manifest.json，必须与 data.js 的 TEMPLATES 一致 */
  const RUNES = {
    straight: { file: 'straight.png', cols: 2, rows: 1 },
    elbow: { file: 'elbow.png', cols: 2, rows: 2 },
    splitter: { file: 'splitter.png', cols: 2, rows: 3 },
    capacitor: { file: 'capacitor.png', cols: 2, rows: 2 },
    threshold: { file: 'threshold.png', cols: 2, rows: 1 },
    ember: { file: 'ember.png', cols: 2, rows: 1 },
  };

  function rune(id) { return RUNES[id] || null; }

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

  /**
   * SVG <image>。x/y 是构件锚点（变换后 bbox 的左上角）在画布上的坐标，
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
    return `<g class="rune${cls}" transform="translate(${round(x)},${round(y)}) scale(${round(cell)})">`
      + `<image href="${basePath}${r.file}" x="0" y="0" width="${r.cols}" height="${r.rows}"`
      + ` preserveAspectRatio="none" transform="matrix(${m.map(round).join(',')})"${op}/></g>`;
  }

  /** HTML 缩略图（构件库、仓库、板面构件列表用） */
  function thumb(id, cls) {
    const r = rune(id);
    if (!r) return '';
    return `<img class="rune-thumb ${cls || ''}" src="${basePath}${r.file}" alt="" loading="lazy" decoding="async">`;
  }

  /** 预加载：板面一出现就把六张读进内存，避免拖拽时闪白 */
  function preload(ids) {
    return Promise.all((ids || Object.keys(RUNES)).map((id) => new Promise((resolve) => {
      const r = rune(id);
      if (!r) { resolve({ id, ok: false }); return; }
      const img = new Image();
      img.onload = () => resolve({ id, ok: true, img });
      img.onerror = () => resolve({ id, ok: false });
      img.src = basePath + r.file;
    })));
  }

  function setBase(p) { if (p) basePath = String(p); }

  V.RuneArt = {
    get BASE() { return basePath; },
    setBase, RUNES, rune, matrixFor, sizeFor, image, thumb, preload,
  };
})(globalThis.Ashen ||= {});
