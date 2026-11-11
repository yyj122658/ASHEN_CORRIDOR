# 老兵回路版美术交付：8 / 8

工具：内置imagegen，使用现有camp图作为画风参考。所有八图为独立生成的原始PNG，未重画或覆盖此前美术。最终提示词和源输出路径见PROMPTS.md。

## 代码入口

新玩法设计与实现计划：

- `docs/superpowers/specs/2026-11-11-veteran-circuit-design.md`
- `docs/superpowers/plans/2026-11-11-veteran-circuit-implementation.md`
- `docs/art/2026-11-11-veteran-art-contract.md`

本目录只交付图像与说明，游戏逻辑尚需coding agent按计划实现。不要将素材总览当作已完成的新工坊UI。

## 真实资源

manifest.json中path相对项目根目录；新增veteran.html仍在项目根，所以可直接使用。manifest仅供开发与验收，不要求file://运行时fetch。

| ID | 实际尺寸 | Alpha | 用途 |
|---|---|---|---|
| veteran.scene.workshop | 1536×1024 | 否 | 工坊/营地入口横幅，主焦点65% 50%，左侧文字留白 |
| veteran.scene.field | 1536×1024 | 否 | 营火现场烙印事件，焦点55% 55% |
| veteran.scene.recovery | 1536×1024 | 否 | 战史/归营整备页，焦点60% 50% |
| veteran.surface.board | 1254×1254 | 否 | 低对比金属底材，正方形，不代表任何占格 |
| veteran.relic.channel | 1254×1254 | 是 | straight/elbow/ember的收藏品物件图 |
| veteran.relic.capacitor | 1254×1254 | 是 | 储能腔物件图 |
| veteran.relic.splitter | 1254×1254 | 是 | 分流器物件图 |
| veteran.relic.threshold | 1254×1254 | 是 | 阈值闸物件图 |

共约12.57MiB原始PNG。工坊只加载当前场景和可见构件，场景按页面加载，避免全预加载阻塞。需要压缩时另建派生目录，保留PNG原件及manifest哈希。

## 必须代码绘制的部分

4×4格子、屏蔽格、真实polyomino占格、端口方向、内部links、外部匹配连线、能量流向、选中/非法/负荷状态、文本按钮，全部采用HTML/SVG/Canvas。

四张物件图不是可拖动拼块的碰撞轮廓，不可用图片非透明区域计算cells。放置板上的构件可以用精确SVG形状加极淡材质；收藏库/详情卡用本套物件图，形成精细图像与准确交互的分工。

金属底材中心较安静，但仍需用低透明实色遮罩或调暗，让线路、端口与格边有足够对比。场景图仅放横幅/事件区，不盖住工坊的三栏操作面板。透明物件可用object-fit:contain，建议保留至少8%内边距；96px缩略图检查后再确定最终卡片比例。

## 复用资产与降级

已有v1场景/肖像、battle-v1剑士与骨兵逐帧动画继续保留。skin只决定外观，不决定新规则的职业权限。当前八图不包含全新武器逐帧动画，也不假称完成全部角色武器外观。

资源失败用渐变底+SVG功能符号降级，不阻塞新玩法。旧Art.BASE固定v1，接入新目录时请使用独立V.Art映射，避免把新相对路径错误拼到v1目录。

## 验收材料

manifest.json：8项ready、实际尺寸、字节与哈希。
QA.json：解码、尺寸、透明通道与哈希通过。
contact-sheet.html/png：八图缩略总览。
PROMPTS.md：内置imagegen最终提示词与来源。

最终游戏仍须coding agent验证1440×900、390×844、缺图、file://、板面旋转/翻转、连通解释及回转时动画重置。
