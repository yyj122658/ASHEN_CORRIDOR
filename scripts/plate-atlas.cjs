'use strict';
/* 生成「十四相轮廓图集」：docs/superpowers/specs/2026-11-14-metal-shape-atlas.md
 *
 * 为什么放在 scripts/ 而不是临时脚本：这份图集是美术的底稿，需要能随时重出一遍。
 * 轮廓、包围盒、孔洞数全部来自 PlateGen 实跑，图里的形状永远和代码一致；
 * 手绘示意图会和代码漂移，所以这里一行手画的形状都没有。
 *
 * 用法：node scripts/plate-atlas.cjs
 */
const fs = require('fs');
const path = require('path');
const { loadVeteran, ROOT } = require('../tests/helpers/load-veteran.cjs');

const A = loadVeteran();
const V = A.Veteran;
const G = V.PlateGen;
const D = V.Data;

const SEED = 7;
const OUT = path.join(ROOT, 'docs/superpowers/specs/2026-11-14-metal-shape-atlas.md');

const AXIS = '0123456789AB';

/* 一相一个底盘、一位传奇：相是你长成什么样，底盘是这块铁的俗称，传奇是它长在谁身上 */
const bodyOf = {};
Object.values(D.BODIES).forEach((b) => { bodyOf[b.archetype] = b; });
const legendOf = {};
D.SKINS.forEach((s) => {
  const b = D.BODIES[s.metal];
  if (b) legendOf[b.archetype] = s.name;
});

function renderCells(cells) {
  const grid = Array.from({ length: G.SIZE }, () => Array(G.SIZE).fill('·'));
  cells.forEach(([x, y]) => { grid[y][x] = '█'; });
  return grid;
}

const order = Object.keys(G.ARCHETYPES);
const rows = [];
const blocks = [];

order.forEach((key, i) => {
  const arch = G.ARCHETYPES[key];
  const r = G.generate({ archetype: key, seed: SEED });
  const info = G.analyze(r.cells);
  const body = bodyOf[key];
  const legend = legendOf[key] || '—';
  const bodyName = body ? body.name : '—';

  const w = arch.west || { name: '—', zh: '—', form: '—' };
  rows.push(`| ${i + 1} | \`${key}\` | **${w.zh}** | ${w.name} | ${w.form} | **${arch.name}** | ${arch.source || '—'} | ${arch.likeness || '—'} | ${bodyName} | ${legend} | ${info.width}×${info.height} | ${info.holes} |`);

  blocks.push(`### ${i + 1}. ${w.zh} · ${w.name}（\`${key}\`）`);
  blocks.push('');
  blocks.push(`> 圣髑院登记：${w.form} · ${w.name}`);
  blocks.push(`> 东土《铁相录》录作：${arch.name}　（${arch.source || '—'}）`);
  blocks.push(`> 作坊里的外号：${arch.likeness || '—'}`);
  blocks.push('');
  blocks.push(`${info.count} 格 / 包围盒 ${info.width}×${info.height} / 孔洞 ${info.holes} / 最长直线段 ${info.longestRun} / 连通 ${info.connected ? '是' : '否'}`);
  blocks.push('');
  blocks.push('```');
  blocks.push(`  ${AXIS.split('').join('')}`);
  renderCells(r.cells).forEach((row, y) => {
    blocks.push(String(y).padStart(2, '0') + row.join(''));
  });
  blocks.push('```');
  blocks.push('');
});

const head = `# 十四相轮廓图集（程序实测）

> 由 \`scripts/plate-atlas.cjs\` 从 \`src/veteran/plate-gen.js\` 实跑生成，**不是手绘示意**。seed=${SEED}。
> 用途：① 美术出图的底稿；② 定稿时核对「名字和形状对不对得上」。
> 每相恒为 **77 格**，包围盒 12×12。\`█\` = 可刻格，\`·\` = 空。
>
> 相名有两套，是同一批形状的两个学派各自的正名：
> **西方**是圣髑院《圣铁登记册》——把每块活金属当圣髑登记，先定形制再填名字，格式必须齐，所以一列整齐；
> **东方**是《铁相录》——读书人从旧书里摘现成词，摘的人不敢改字，原文多长就多长，所以长短不齐。
> 一个问「它像什么」，一个问「它该归入哪一类」。作坊里的人私下另有外号，那是口头的话，进不了册页。
> 相是「形状的类」，底盘是「某个人手上那块铁」，别混用。

## 一览

| # | archetype | 西名 | 原文 | 形制 | 东名 | 出处 | 作坊里的外号 | 底盘俗称 | 代表传奇 | 实测包围盒 | 孔洞 |
|---|---|---|---|---|---|---|---|---|---|---|---|
`;

const tail = `## 交给画图的 AI：出图规格

**只画轮廓，不画格子。** 格线由程序画——美术画的格线永远不会和 12×12 对齐，一错位整块板面就废了。

规格：

1. 每相一张，画布 1024×1024，正中摆 12×12 网格（每格 64px，留 128px 白边）。
2. 轮廓严格按上面 ASCII 走：\`█\` 的地方是金属，\`·\` 的地方是空的、要能看见背景。
3. 金属质感：**锈蚀的活铁**。暗铁底，边缘有锈斑和氧化痕，轮廓内侧一圈抛光的亮边（对应「共振 = 抛光 + 留纹」）。
4. 一张图**只画一种相**，不要在图里放别的形状做对比，也不要加文字标注。
5. 输出 PNG 透明背景；轮廓外的区域全透明。

可直接粘贴的 prompt（把 \`{相名}\` 和 \`{轮廓描述}\` 换掉）：

\`\`\`
A single flat slab of ancient rusted living iron, viewed straight from above,
drawn as a solid silhouette on a pure transparent background.
Shape: {轮廓描述}. The shape must be a solid connected piece — no holes except where the reference has them.
Material: dark oxidized iron, mottled rust patches, faint hairline cracks,
a thin polished rim along every cut edge where the rust has been worn away.
Style: painterly prop illustration, top-down orthographic, hard silhouette edge,
soft inner shading, no grid lines, no text, no props, no background.
Transparent background, PNG, 1024x1024, the slab centered and filling ~70% of the canvas.
\`\`\`

「轮廓描述」直接抄一览表那一行的形状词，也可以直接用「作坊里的外号」那句当提示。例如：

- 原质 → \`a plain wide rectangle, 11 units wide by 7 tall, no notches at all\`
- 竖带 → \`a narrow vertical beam, 5 to 7 units wide, running the full height, square ends\`
- 圣物匣 → \`a thick ring: a wide square wall with a large rectangular hollow center\`
- 长镰 → \`a sickle blade: a thick arc with a deep bite out of its inner edge, one small hole\`
- 苦鞭 → \`a vertical spine with two rows of horizontal ribs sticking out on both sides\`
- 命轮 → \`a round plate with a ring of square teeth around its rim\`

## 待确认

- **原质偏宽横、竖带偏窄纵**：两者都是「长条」，靠方向区分（原质横向、竖带纵向）。如果观感上仍然容易混，建议把原质改成 9×9 的近实心方块，把「横长条」这个身份让给别的相。
- **圣物匣的孔洞偏大**（65 格空）。设定上「心刻不到」，孔大是对的；但美术出图时那块空白会显得像「没画满」，需要在材质上做出「断裂的空腔」而不是「被擦掉的区域」。
`;

fs.writeFileSync(OUT, head + rows.join('\n') + '\n\n## 逐相轮廓\n\n' + blocks.join('\n') + tail, 'utf8');
console.log('wrote', OUT);
console.log(`${order.length} 相，全部 ${G.PLATE_TARGET} 格`);
