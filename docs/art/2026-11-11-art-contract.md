# 灰烬回廊：美术方向、资产路径与并行接入协议

日期：2026-11-11。状态：本轮仅确定规格；下列图片尚未生成。玩法依赖见 `../superpowers/specs/2026-11-11-upgrade-b-design.md`。

## 1. 风格与职责

方向名：余烬前哨。暗黑奇幻的精细像素插画，采用有限色板、清楚轮廓、克制抖色，温暖营火与冷紫雾形成视觉对照。石砌遗迹、锈铁、旧皮革、褪色布料贯穿全部图片。画面要精致、有叙事感，也要能与现有 Canvas 像素人物共存。

保留：灰烬回廊名称、六职业的原有颜色身份、低饱和黑暗气氛、横版战斗。

避免：写实照片、现代 UI 画入图片、过亮霓虹、卡通大头、每张图不同画风、满屏细碎噪点、看不清主体的纯黑。

美术 agent：图片、风格参考、实际尺寸及裁切建议、资产清单。coding agent：HTML/CSS、交互、可访问性、图标 SVG、加载器、Canvas合成与降级。双方只通过固定资产路径交接，不同时编辑 CSS/JS。

## 2. 资产目录（相对项目根目录）

```text
assets/art/v1/
  scenes/
    camp.png
    corridor.png
    boss-chamber.png
  portraits/
    blade.png
    warden.png
    ranger.png
    warlock.png
    cleric.png
    rogue.png
  nodes/
    battle.png
    elite.png
    chest.png
    event.png
    camp.png
    merchant.png
    boss.png
  enemies/
    gatekeeper.png
    memory-eater.png
  manifest.json
  PROMPTS.md
  contact-sheet.png
```

`manifest.json`、PROMPTS.md 与 contact-sheet.png 是生成后的验收材料，本轮不创建空文件假装交付。素材版本更新另存 v2，不直接覆盖已验收 v1。

## 3. 交付顺序和规格

优先组：3 张场景+6 张职业肖像，共9张；用于主界面立即建立统一风格。增强组：7张节点插画+2张首领肖像，共9张；完整计划合计18张，不包含战斗角色逐帧动画。

下表尺寸是目标构图/使用规格，生成工具的实际输出尺寸可能不同；交付时记录真实宽高。消费者必须基于比例和焦点适配，不能假定工具一定生成某个精确尺寸。

| 稳定资产 ID | 文件 | 目标比例/参考尺寸 | 构图要求 |
|---|---|---|---|
| scene.camp | scenes/camp.png | 3:2，1536×1024 | 右侧古老回廊入口，中下部小营火，左侧约40%低细节暗区；标题/营地共用 |
| scene.corridor | scenes/corridor.png | 3:1，1536×512 | 横版正侧视，地平面在高83%左右，中央留空，拱柱向远处递进，无角色 |
| scene.boss | scenes/boss-chamber.png | 3:1，1536×512 | 与走廊同视角同地面线，右侧远处封印门、余烬裂隙，中央不放大障碍物 |
| portrait.blade | portraits/blade.png | 1:1，1024×1024 | 红褐旧甲剑士，断口长剑；胸像，面部位于中心略上 |
| portrait.warden | portraits/warden.png | 1:1 | 蓝灰重甲盾卫，盾与磨损头盔，沉稳姿态 |
| portrait.ranger | portraits/ranger.png | 1:1 | 暗橄榄兜帽、旧金箭羽、弓，眼神清晰 |
| portrait.warlock | portraits/warlock.png | 1:1 | 紫黑法袍、暗晶法杖，克制紫光，不能全脸黑暗 |
| portrait.cleric | portraits/cleric.png | 1:1 | 骨白布衣、旧金圣徽、暖灯，疲惫而坚定 |
| portrait.rogue | portraits/rogue.png | 1:1 | 蓝灰兜帽、双匕首、暗皮甲；轮廓与游侠明显区分 |
| node.battle | nodes/battle.png | 3:2，1536×1024 | 石廊中锈剑与骸骨剪影，冷雾中有明确威胁 |
| node.elite | nodes/elite.png | 3:2 | 高大缝合守卫远景剪影、危险红余烬，视觉强于普通战斗 |
| node.chest | nodes/chest.png | 3:2 | 裂缝漏暖光的旧木箱，地面有锈铁与灰尘 |
| node.event | nodes/event.png | 3:2 | 有裂隙的石墙、门缝与不明阴影，保留未知感 |
| node.camp | nodes/camp.png | 3:2 | 废弃营火近景、小凳和破毯，无人物 |
| node.merchant | nodes/merchant.png | 3:2 | 兜帽游商与旧货摊、暖黄灯，诡异但可辨认商品 |
| node.boss | nodes/boss.png | 3:2 | 封印门和巨大轮廓，构图适合末层单卡 |
| enemy.gatekeeper | enemies/gatekeeper.png | 1:1 | 红锈铁巨型守门人半身，重武器、裂隙火光 |
| enemy.memoryEater | enemies/memory-eater.png | 1:1 | 紫灰幽魂半身、破碎面具、记忆碎光，与守门人形态区分 |

所有场景和肖像默认不透明背景。肖像暗底与边缘渐隐由真实图像构图+CSS遮罩配合，不依赖伪透明棋盘。没有请求透明的素材不得伪称透明。所有资产无文字、无水印、无按钮、无边框、无血条。

## 4. 视觉 token（coding agent 落地）

| token | 值 | 用途 |
|---|---|---|
| --bg | #0B0A10 | 主背景 |
| --surface | #17141F | 实体面板 |
| --surface-raised | #211B2B | 卡片、弹层 |
| --border | #514351 | 石材/金属分隔 |
| --text | #E5DBCA | 主文字 |
| --text-muted | #B0A597 | 次文字，实际对比度须验证 |
| --accent | #D9AD65 | 主操作、选中、金属高光 |
| --ember | #D87843 | 火焰、稀有反馈 |
| --danger | #D36A65 | 风险/损失 |
| --success | #8DB69B | 治疗/安全 |
| --ice | #7FBBC8 | 冰、控制 |
| --shadow | #AD8AC7 | 暗、遗物 |

布局按8px节奏，卡片间距16–24px。面板边角2–4px，边框1px+轻微内描边，避免每个元素都套粗方框。中文正文用本机可用的清晰字体栈；标题用宋体/衬线；数值用等宽。不要依赖外部字体 CDN。

图片不能承担正文背景的唯一可读性保障：叠加实色/渐变遮罩，文字区域保持足够对比。按钮 hover/active/disabled/focus 状态均由 CSS 提供。

## 5. 页面布局说明

### 标题

camp 作满幅环境图，黑紫遮罩；左侧文字、介绍、开始/继续按钮，右侧保留回廊入口。底部静音、设置与存档入口。移动端改为上图下操作。标题不能把“继续远征”指向只恢复营地，必须反映实际检查点。

### 营地

最大内容宽1280px。顶部品牌与金币/遗物/最深层；下方240–320px环境横幅，文字“灰烬前哨”、一句叙述、主按钮“进入回廊”。四张职业肖像卡展示队伍、站位、星级、压力、装备空槽。下方左侧羁绊和出发检查，右侧长期目标/战绩。招募、仓库、祭坛使用统一导航。

### 队伍与招募

前排两格、后排两格明确标注；每格肖像、名称、核心属性、技能提示和移动/装备操作。候补单独成区。招募卡在肖像上方保留职业元素标识，价格与招募按钮固定底部，避免卡高变化导致按钮跳位。

### 探索

顶部七层进度轨迹和当前祝福；中间三张路径卡，每张上部插画、下部名称/风险/收益。桌面三列，窄屏单列。底部固定于布局而非盖住内容的小队状态、背包和撤离操作。满包决策用明确弹层/面板，不能静默丢弃。

### 战斗

上方一行楼层、遭遇类型、回合、速度、暂停、战术；敌方意图在敌方 HUD；中间横版战场；下方四人信息卡显示 HP/护盾/压力/技能 CD/状态。日志可展开，默认只露最近几条关键事件。结算保留最后战场，附收益和成员贡献；不会通过重建整个页面每 tick 重置焦点。

两张首领半身图消费在首领战上方的“首领档案/意图卡”（桌面96–128px方形肖像+姓名/阶段/预告，手机64px+两行信息）。固定映射：原BOSS_TYPES key `boss1` → `enemy.gatekeeper`，`boss2` → `enemy.memoryEater`。它们是不透明肖像，不作为Canvas中的可动角色贴图；战场仍用像素人物绘制。

Canvas 逻辑空间推荐320×100，地面 GROUND=84，保持当前人物坐标。以等比视口显示（原960×300）；背景目标3:1与视口3.2:1之间只允许轻微裁切，禁止拉伸。根据地面锚点对齐再绘制人物。若以后改变逻辑比例，应把坐标与背景锚点集中配置，不散改常量。

### 装备、仓库、祭坛与结果

仓库上方筛选条，中间装备列表或网格，选择后展示与当前装备的对比；锁定状态不能只靠颜色。祭坛采用四张升级卡，展示当前等级、下一阶收益和成本。结果页突出“带回了什么/失去了什么”、复盘和回营主按钮。

## 6. 资源消费接口

coding agent 在 `src/ui/assets.js` 实现：

```js
// 稳定 ID -> 静态路径，不通过运行时 fetch(manifest.json)。
getArt(id) // -> {src, fallbackId, objectPosition, groundY?} | null
preloadArt(ids) // -> Promise<{loaded: string[], failed: string[]}>
```

约定：场景焦点默认50% 50%；camp 右侧入口主焦点65% 50%；肖像50% 35%；走廊/首领地面 groundY=0.84。manifest 最终可更新精确裁切建议，但不改稳定 ID。

- 文件路径都相对于 index.html，不能相对于 src/ui/assets.js 错拼路径。
- DOM 图片加载失败：隐藏坏图图标，显示带职业/节点标识的渐变底；背景失败：退回当前 Canvas 绘制。交互保持可用。
- 首屏仅预加载 camp 与当前队伍肖像；地图和首领按需加载；不要一次阻塞加载18张图片。
- 如背景未到，节点插画暂用 scene.corridor 裁切；肖像未到用职业色+SVG徽记。最终美术验收仍需真实图片。
- 图片不触发游戏逻辑，不消耗游戏 RNG；CSS图像与 Canvas 图像共享同一 ID映射。
- manifest.json 为开发/验收材料，纯静态文件模式不必 fetch 它。字段为 version、style、assets，assets[id]={path,width,height,alpha,objectPosition,groundY?,status}，status为ready后才算实际交付。

## 7. 生成提示词规范与执行路线（下一轮）

使用 imagegen 内置生成工具。每张资产单独生成；先生成 camp 作为风格锚点，查看并确认风格，再以它为参考完成另外两张场景和六职业肖像；之后节点、首领肖像。不得把一张包含18张小图的概念拼图当作最终18个文件。

通用提示词骨架：

> Use case: stylized-concept. Asset type: production art for the original browser game Ashen Corridor. Dark fantasy, richly crafted pixel illustration, deliberate limited palette, readable silhouettes, restrained dithering, weathered stone, rusted metal and worn fabric. Cold desaturated violet atmosphere with warm ember highlights. Match the established reference image. [填入上表该资产主体、构图、视角和留白要求]. No text, no UI, no border, no logo, no watermark. Keep important silhouettes readable at small game-card size.

对场景补充地面锚点、无角色、横版侧视；对肖像补充统一胸像距离、视角、面部高度和职业配色；对节点补充场景符号和小尺寸辨识度。精确像素尺寸以实际输出为准，不承诺生成工具的非公开尺寸控制。

下一轮生成后：逐张检查画风、构图、裁切、无文字与小尺寸可读性；把选定输出复制到本项目固定路径；记录最终提示词与真实尺寸；用交付清单说明ready项。源输出不能只留在模型工具的默认目录。

## 8. 联调验收

- camp 左侧能放标题和主操作，手机裁切不把入口主体完全切走。
- 六职业缩到96px仍可区分，脸和武器不被卡片裁没。
- 背景地面与人物脚底一致，角色与背景有明度分离。
- 节点缩到240px宽仍能区分战斗、宝箱、事件、营火、商人和首领。
- 真实宽高、文件存在、所有映射 ID、missing asset 降级均有检查记录。
- 1440×900与390×844截图验证的是最终界面，不只展示独立漂亮图片。
