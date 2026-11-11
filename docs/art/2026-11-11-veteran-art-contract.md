# 老兵回路版：美术与代码并行协议

本轮只新增 `assets/art/veteran-v1/`，不覆盖v1场景/肖像和battle-v1动画。coding agent负责交互、CSS与SVG，另一agent制作以下八张独立图片。

## 固定资产路径与用途

| ID | 路径（相对项目根） | 目标构图 | 消费位置 |
|---|---|---|---|
| veteran.scene.workshop | assets/art/veteran-v1/scenes/workshop.png | 3:2，暗紫石室、旧铜工作台、暖炉，左侧低细节 | 工坊标题横幅/营地入口 |
| veteran.scene.field | assets/art/veteran-v1/scenes/field-inscription.png | 3:2，废弃营火旁的临时烙印台与发热金属片 | 营火现场烙印事件 |
| veteran.scene.recovery | assets/art/veteran-v1/scenes/recovery.png | 3:2，营地静养角落、旧行军床、铠甲与暖灯，无人物 | 战史/归营整备页横幅 |
| veteran.surface.board | assets/art/veteran-v1/surfaces/living-metal.png | 1:1，暗金属板、周边自然锻造纹理、中心平静 | 网格底材，真实格子由代码叠加 |
| veteran.relic.channel | assets/art/veteran-v1/relics/ember-channel.png | 1:1透明，旧铜与生命金属导能残片，微弱余烬 | straight/elbow/ember收藏品缩略图 |
| veteran.relic.capacitor | assets/art/veteran-v1/relics/pulse-chamber.png | 1:1透明，锈铜脉冲储能腔与暗晶核心 | capacitor缩略图 |
| veteran.relic.splitter | assets/art/veteran-v1/relics/prism-splitter.png | 1:1透明，三叉分流生命金属构件，淡紫晶体 | splitter缩略图 |
| veteran.relic.threshold | assets/art/veteran-v1/relics/threshold-seal.png | 1:1透明，虹膜式阈值闸与金属箍 | threshold缩略图 |

目标比例按提示词控制，实际尺寸以交付manifest记录为准。未生成的图片不得标为ready；逐张生成、验证、复制到上述路径。复用现有camp作为画风参考：精细像素插画、有限色板、冷紫石材和暖琥珀灯火，古旧生命金属和仪式工坊，不加入现代PCB、科幻屏幕或另一个美术时代。

所有图不含文字、标签、UI、按钮、格线或代表游戏规则的端口。四张构件图是物件插画，不决定真实占格形状；玩家放置的L/I/T形格块与端口须用SVG精确绘制。不可拿缩略图轮廓做碰撞判断。

## 工坊布局指导

桌面三栏：左侧老兵肖像/战史，中间4×4板面与可选连线示意，右侧构件库与占格/负荷说明。下方行为规则、预设、撤销/重做与保存。横幅环境仅装饰标题区，不把重要字压在杂乱工作台上。

板面底图适度降低对比，格子、屏蔽格、输入/输出、已占构件、可放置/非法状态各有代码绘制的纹理或图标，不能仅靠颜色。流向动画只表达已编译路径，不在视觉层生成实际能量。手机分成老兵/板面/库标签页，支持点选→旋转→点击放置，不依赖拖拽或hover。

首屏仅加载当前需要的场景，构件缩略图按需。资源未到/失败时用渐变底与SVG功能图标，不阻塞代码开发。所有图片相对veteran.html路径加载，不强制fetch manifest，保持file://可运行。

## 交付材料

manifest.json：version、style、assets[id]={path,width,height,alpha,objectPosition,status,bytes,sha256}。

PROMPTS.md：实际最终提示词及参考；INTEGRATION.md：接入说明；contact-sheet.html/png：美术总览；QA.json：尺寸、解码、透明度与哈希检查。资源总览是美术验收，不是最终工坊页面已经联调的证据。
