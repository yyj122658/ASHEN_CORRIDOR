# 美术 v1 已交付：18 / 18

本目录由美术 agent 产出。工具：内置 imagegen。所有18张均为独立生成的原始PNG，已检查可解码、尺寸、唯一性和不透明背景。运行时代码、CSS与游戏状态由 coding agent 维护；本次未修改这些文件。

## 立即接入

从项目根目录读取 `assets/art/v1/manifest.json` 获取18个稳定ID的真实文件路径、尺寸、objectPosition、groundY和SHA-256。manifest是开发/验收材料，运行时可采用静态映射以支持file://；不要强制fetch它。

| 类别 | ID | 实际尺寸 |
|---|---|---|
| 营地/标题 | scene.camp | 1536×1024 |
| 普通战场 | scene.corridor | 2172×724，3:1 |
| 首领战场 | scene.boss | 2172×724，3:1 |
| 六职业 | portrait.blade / warden / ranger / warlock / cleric / rogue | 各1254×1254 |
| 七节点 | node.battle / elite / chest / event / camp / merchant / boss | 各1536×1024 |
| 首领档案 | enemy.gatekeeper / enemy.memoryEater | 各1254×1254 |

路径与前期art-contract一致。BOSS_TYPES的boss1→enemy.gatekeeper，boss2→enemy.memoryEater。首领肖像只放在档案/意图卡；不是战斗精灵，不应将不透明方图画作站立人物。

## 裁切与合成

- scene.camp主焦点65% 50%；左侧40%为标题留白。建议横幅object-fit:cover，position:65% 50%。标题压左侧，并加局部渐变遮罩，避免把整张图片都压黑。
- 六职业与首领肖像：正方形，object-position:50% 35%；头部/脸部集中在中上区，96px方形仍可分辨，卡片上需保留武器及服装轮廓。所有肖像均为不透明暗底。
- 七节点：3:2，建议显示3:2或轻微裁成16:10；先展示图，再在独立实色区域放风险、名称、按钮。不要把整段说明压在插画上。
- 两张战场：3:1；现有游戏viewport为3.2:1，需要轻微裁切，不能强行拉伸。推荐保持逻辑320×100、GROUND=84，并使用groundY=0.84作为站立地面锚点。
- 对战场使用cover裁切时，优先对齐地面，而不是一律居中。计算scale=max(canvasWidth/imageWidth,canvasHeight/imageHeight)；sourceViewHeight=canvasHeight/scale；sourceY=clamp(groundY×imageHeight−0.84×canvasHeight/scale,0,imageHeight−sourceViewHeight)。sourceX居中。
- 背景先在Canvas物理分辨率（例如960×300）绘制，再设3倍变换绘制320×100世界中的人物/粒子。避免把2172px背景先压进320px临时画布而过早丢失细节。角色的pixelated/nearest-neighbor规则与环境背景采样可分开。
- 图片里没有任何可交互UI或文字；所有按钮、血条、状态和名称必须仍为真实UI层。

## 加载与体积

原始PNG总计约42.98MiB，作为高质量源资产保留。首屏只加载camp和当前队伍肖像；节点、其他职业和首领按需加载，不要一次预加载18张。

如果编码侧增加WebP/AVIF或小尺寸派生资源，请输出到新的派生目录并更新自己的加载映射，保留本目录PNG原件和manifest校验；不要静默覆盖原件。图片缺失时保留此前约定的职业徽记/渐变底/Canvas背景降级。

## 交付与验收材料

- `manifest.json`：18项ready，真实尺寸、字节数和哈希。
- `PROMPTS.md`：每张最终提示词、参考图说明、原始生成输出路径。
- `contact-sheet.html`：离线可打开的全套缩略预览。
- `contact-sheet.png`：由该预览页渲染的总览图；这是预览排版，不是单张游戏资产。
- `QA.json`：逐文件的解码、尺寸、哈希、不透明及完整性验证。

已逐张查看生成输出，检查画风、主体、无文字/无界面与构图。最终游戏的1440×900、390×844布局和人物脚底合成仍需coding agent在接入后截图验证；独立素材验收不等于整页已经联调完成。
