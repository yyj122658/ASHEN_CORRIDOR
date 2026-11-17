# 像素资产清洗与全站换肤（2026-11-16）

> 96 张 AI 原图 → `assets/art/curated/` → 全站皮肤与战斗/工坊接线。
> 清洗脚本 `scripts/process-art-assets.py`，样式 `styles/tokens.css` + `styles/pixel-skin.css`。

---

## 1. 输入与产出

| 批次 | 张数 | 内容 |
|---|---|---|
| `Ashen_Corridor_49_assets.zip` | 49 | 14 传奇小人、14 敌人、3 层域背景、14 相板面、4 图标 |
| `Ashen_Corridor_batch2_37_assets.zip` | 37 | 14 头像、6 功能场景、7 节点、4 图标、6 特效 |
| `Ashen_Corridor_batch3_10_UI_assets.zip` | 10 | 九宫格边框、槽位、三态按钮、分割线、进度条框 |

产出 **99 个文件**（96 张原图 + 3 张 `biome_*_battle.png` 战斗适配版）。

```
assets/art/curated/
├─ allies/       14 × 64×64
├─ enemies/      9 × 64×64 · 2 × 80×80（精英）· 3 × 112×112（首领）
├─ portraits/    14 × 96×96
├─ plates/       14 × 120×120
├─ nodes/         7 × 48×48
├─ icons/         8 × 32×32
├─ vfx/           6 × 64×64
├─ backgrounds/   3 × 640×360 + 3 × 960×300（战斗）
├─ scenes/        6 × 640×360
└─ ui/            4 × 48×48 · 3 × 96×32 · 2 × 192×32 · 1 × 256×24
```

旧目录 `v1/`、`veteran-v1/`、`battle-v1/`、`battle-v3/` **一个文件都没动**：
`battle-v3/*.webp` 仍是战斗动画条带的来源，`rune-set-v2/living-metal.png` 仍是板面底材。

---

## 2. 清洗流水线（顺序不可换）

1. **泛洪去背**（BFS + `scipy.ndimage.label`）
   从四角出发，只清「与角落底色欧氏距离 ≤ 32 **且与角落连通**」的像素。
   判据是「离角落色多远」而不是「离邻居色多远」，所以内部暗影即使很深也不会被误伤 ——
   它只要不与角落连成一片就安全。**从不做全局换色。**
2. **裁边**
   透明精灵按 alpha 包围盒（留 1px）；`btn_*` / `bar_frame` / `header_banner` / `divider_ornate`
   按「非底色（距 `#1E2230` > 24）且不透明」的包围盒，裁掉外圈深色宽边。
3. **九宫格预处理**
   `panel_frame` / `bar_frame`：取左侧 28% 处的一列**真实像素**，横向平铺覆盖上下边框正中 18% 的菱形凸起。
   抄像素而不是画直线，锤纹、描边、氧化色全部原样保留。
   `bar_frame` 额外把中心槽掏空（内部 16%–84% 行、5%–95% 列里与 `#1E2230` 相近的像素设透明）。
4. **内腔压暗**
   四张 UI 原图的「框内」是亮橙实底，直接拿去做 `border-image ... fill` 会把面板刷成橙色。
   按 `border-image-slice` 的同一比例把内腔压成 `#1E2230`（`slot_active` 压成透明，因为它要叠在别的槽上）。
5. **邻近降采样 + 十色吸附**
   全程 `Image.NEAREST`；最后把 `alpha ≥ 128` 的像素吸到十色。

> 一个踩过的坑：色差算距离时用了 `int16`，`240² = 57600` 溢出成负数，最近色全错
> （深蓝黑被判成炬火橙）。泛洪阈值同样受影响。全部改 `int32` 之后才对。
> 这条留在脚本注释里，改这个文件的人先看一眼。

## 3. 十色板（唯一的色源）

```
#0F111A 深轮廓黑   #1E2230 深渊蓝黑   #4F5968 石板灰    #7A838F 金属灰   #D4CABB 骨石白
#BC8C50 古铜金     #E0963F 炬火橙     #57A6A7 共振青    #79508F 秘仪紫   #A64D4F 危机红
```

同一份色值出现在三个地方，改色必须三处同改：
`scripts/process-art-assets.py` 的 `PALETTE`、`styles/tokens.css` 的 `:root`、
（可选）任何新图。

---

## 4. CSS 收口

改版前三套色系同时生效：`tokens.css` 的暗紫、`atelier.css` 在 `:root` 重定义的冷灰绿、
`expedition.css` 里 `.ex-page` 自带的 `--ex-*`。

- `atelier.css` 的 `:root` 整块删除，只留一句注释说明为什么。
- `expedition.css` 的 `--ex-*` 改成**别名**（`var(--surface)` 等），值全部来自 tokens。
  文件里其余写死的十六进制是局部高光/阴影，留在原处不影响统一。
- `tokens.css` 成为唯一色源，新增 `--ink`（最深色，轮廓与硬投影用）。

## 5. 像素皮肤（`styles/pixel-skin.css`，index.html 末尾引入）

| 对象 | 做法 |
|---|---|
| 全部 `img` / `canvas` | `image-rendering: pixelated` + `crisp-edges` |
| `.panel` / `.modal-card` / 子卡片 | `border-image: panel_frame 12 fill`，6px；内底色 `--surface` |
| `#scar-tooltip` / `.u-detail` / 单元条 | `panel_sub 10 fill`，5px |
| `.btn` | `btn_secondary 10 14`，5px 8px（**不加 fill**） |
| `.btn.gold` / `.primary` / 保存 / 开始 | `btn_primary`，深色字 `--ink` |
| `.btn.danger` | `btn_danger` |
| 卡片 / 槽位 / 节点 | `slot_empty 12 fill`，6px；选中换 `slot_active` |
| `.bar` | `bar_frame 8 fill`，12px 高、2px 边框 |
| `.masthead` | 底部 6px `header_banner` 平铺条 |
| `.panel-h` | 底部 4px `divider_ornate` 平铺条 |
| 圆角 / 投影 | 全部 `border-radius: 0`，`box-shadow: 2px 2px 0 var(--ink)` |

三个刻意的偏离，都写进了 CSS 注释：

1. **`.btn` 不用 `fill`**：`btn_secondary` 的中间格是 `#4F5968` 石板灰，`fill` 会把每个次要按钮刷成一块灰板。
2. **`.btn.xs` / `.slot-ops .btn` 边框收窄到 3px 6px**：32px 宽的图标钮被 16px 边框吃掉就没字了。
3. **`.metal-surface-texture` 改成 `brightness(.88) contrast(1.18)`**：原值 1.75 会把板面底材提亮成一整块浅棕。

**所有 `border-image` 都配了 `border-color` + `background` 兜底**：
`test:ui` 有一条会 abort 掉 `**/assets/**`，图全缺时界面必须仍然可用。

---

## 6. 接线

### `src/ui/assets.js`（`A.Art`，69 条）
- `BASE` 改为 `assets/art/curated/`。
- 6 功能场景、5 层域背景（`scene.corridor/waterway/spring/furnace/boss`）、
  3 战斗背景（`scene.battle.*`，960×300）、14 头像、7 节点、14 敌人、14 静态小人（`sprite.*`）、6 特效（`vfx.*`）。
- 头像与小人**由 `SKINS` 推导**，不再手写六个 —— 手写的那份永远会漏掉后来加的八位。

### `src/veteran/art.js`（`V.Art`）
- 新增 8 图标（`veteran.icon.*`）与 14 板面轮廓（`veteran.plate.<archetype>`）。
- `get()` 支持带 `assets/` 前缀的绝对路径，旧 `veteran-v1` 条目照旧可用。
- `portraitTag` 的映射改为 `Object.fromEntries(SKINS.map(...))`。
- 新增 `plateTag(archetype)` / `iconTag(name)`，缺图返回空串。

### `src/veteran/view.js`
- `battleBgFor(b)`：1/4/7 章水下、2/5 章泉脉、3/6 章炉心，首领固定炉心。
- 画布仍 320×100 / `GROUND = 84` / `SCALE = 3`，**SpriteAnim 管线一行没动**。
- `drawStill()`：没有多帧图集时画 64px 静态小人（底部对齐、±1px 呼吸），
  只有连图都没加载才退回 7px 文字。
- 粒子层优先画 `vfx.*` 贴图，缺图继续走矢量；新增 `type === 'dot'` 事件 → 按异常种类出图。

### `src/veteran/ui.js`
- 工坊头部叠 `scene.workshop` 像素横幅；`.plate-owner` 换成板面轮廓（缺图退回立绘）。
- 营地卡 / 招募卡右下角叠 42px 板面轮廓角标。
- 瘢痕计数前加 `scar_mark`，超载数字前加 `rust_mark`。
- 事件 / 商人 / 营火 / 宝箱 / 撤离五个界面接 `scene.event` / `scene.merchant` / `scene.camp` / `scene.chest` / `scene.extract`。
- **`<svg class="board" data-cell="60">`、`.scar-cell`、`.ms-contour`、`.ms-field` 结构与类名一个没改。**

---

## 7. 验收

| 命令 | 结果 |
|---|---|
| `python scripts/process-art-assets.py` | 96 张全部导出，99 个文件，色数 ≤10 |
| `npm test` | 331 / 331 |
| `npm run test:ui` | 通过（16 组视口、选择器契约、无资源降级） |
| `npm run test:flow` | 通过（44 组全流程视口） |
| `npm run test:etching` | 通过 |
| `npm run test:battle-art` | 通过 |
| `npm run test:pack` | 通过 |
| `npm run test:kitchen` | 通过 |
| `node scripts/etching-inventory.cjs` | 80 门，0 条体检问题 |

改了两条陈旧断言（都与「数据早已缩到 14」有关，不是本轮引入的缺陷）：

- `battle-art`：`checked.heroes === 21` → `=== skins.length`（14）。原口径是 21 位传奇的时代，
  数据缩到 14 之后这条永远不可能成立；改成「覆盖全部皮肤」，语义没降级。
- `etching-ui`：`.recruit-card .portrait-atlas` 必须存在 → `.legend-portrait img, svg` 必须存在。
  14 人都有清洗头像之后，4×4 图集兜底不再触发，但断言的本意是「招募卡上有立绘」。
