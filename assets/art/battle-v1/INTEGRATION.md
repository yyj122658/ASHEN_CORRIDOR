# 剑士＋骸骨兵：逐帧动画接入

版本：battle-v1。两角色×四动作×六帧，共48帧。内置imagegen绘制，每张源序列3列2行；FFmpeg仅按格切帧，不重画、不缩放、不替换美术内容。所有游戏代码未由本次美术任务修改。

## 文件入口

- `preview.gif`：走廊场景上的完整动作连播预览，960×400。明确演示动作，不代表真实战斗过程。
- `preview.html`：离线可打开的交互预览，可选动作、暂停、逐帧、调整速度和显示锚点。
- `preview.png`：预览页面截图。
- `atlas.json`：生产接入的唯一清单；含源图、帧坐标、逐帧PNG路径、时长、脚底锚点和哈希。
- `atlas-data.js`：仅用于无需fetch的离线预览；与atlas.json内容相同。
- `blade/frames/{idle,attack,hurt,death}/01.png` 至 `06.png`：24张剑士逐帧PNG。
- `bone/frames/{idle,attack,hurt,death}/01.png` 至 `06.png`：24张骸骨兵逐帧PNG。
- `PROMPTS.md`：最终生成提示词、参考和源输出记录。
- `inspection.json`、`QA.json`：逐格边界、透明度及切帧像素一致性检查。

剑士攻击最终源图是 `blade/attack-v2.png`，清单已经指向它。`blade/attack.png`是保留的未采用草稿，曾有剑光跨格，不能接入。不要按目录通配符猜正式资源，应读取atlas。

## 动作与时间

| 动作 | 逐帧时长/ms | 循环 | 结束处理 |
|---|---|---|---|
| idle | 150,150,150,150,150,150 | 是 | 循环 |
| attack | 100,100,80,70,100,160 | 否 | 回idle |
| hurt | 60,60,80,100,110,130 | 否 | 回idle |
| death | 140,140,180,220,240,900 | 否 | 保持末帧 |

攻击视觉出手点为第4帧（零基index=3）。该标记只驱动剑光/音效，不能再计算一次伤害。生命、伤害、技能CD、RNG等继续完全由既有逻辑层决定。

## 朝向、坐标与显示

剑士朝右，骸骨兵朝左。所有单帧都是512×512 RGBA，透明区域已保留；源图1536×1024。推荐正常战场先试144px的整帧绘制宽度（在3倍世界坐标中为48单位），再按最终四人阵容截图校准；不要把整张角色重采样成旧32px高的方块精度。

每帧都有 `pivot={x,y}`，它表示该帧里的地面定位点。x固定256，y按实际脚底/落地轮廓记录。倒地动作角色原图位置有变化，所以不能硬编码所有帧同一pivotY，否则会悬空。

绘制伪代码（最终Canvas物理像素坐标）：

```js
const a = atlas.characters[characterId].animations[animationId];
const f = a.frames[frameIndex];
const s = desiredFrameWidth / 512;
ctx.drawImage(sheetImage,
  f.rect.x, f.rect.y, 512, 512,
  footX - f.pivot.x * s, footY - f.pivot.y * s,
  512 * s, 512 * s);
```

如已开启3倍世界变换，把footX/footY和desiredFrameWidth都换算到同一逻辑坐标体系，不能重复放大。另一种方式是直接加载f.path的逐帧PNG，此时源矩形为0,0,512,512。路径都相对于本目录；游戏根入口应加`assets/art/battle-v1/`前缀。

不要自动trim每帧再丢弃偏移；保留本清单坐标，才能避免呼吸时角色漂移。阴影由程序独立画，位于脚底，不需要抠图片里的影子。反向站位可以围绕footX水平镜像，pivot也必须一起变换。

## 对接当前事件

当前 `src/systems/combat.js` 已有：

- `act`：actorId，meta.skillId；伤害类动作触发攻击动画，只在一次act开始时启动，不能每段hit都重启。
- `hit` / `crit`：targetId触发hurt，若target已死则直接death。
- `death`：targetId进入death，结束后保持最后一帧。
- `miss`：攻击者仍播放已开始的attack，目标不播放hurt。

优先级建议death > hurt > attack > idle。暂停时冻结视觉播放时间；切屏/重播不得再次发出逻辑事件。两种剑士物理技能首版共用attack序列，可叠加不同程序特效。

我方可以直接按 `u.cls==='blade'` 选角色。当前战斗单位没有保留稳定的敌人种类字段：请coding agent在enemyUnit传入模板key，并在makeCombatUnit保存为 `enemyType`，之后 `enemyType==='bone'` 使用本套骸骨兵。不要把所有shape==='human'的敌人都当成骸骨兵，也不要按随机单位ID或中文显示名猜类型。旧存档缺enemyType时保持原程序绘制降级即可。

目前drawUnit里 `if(!u.alive)` 会直接画占位尸体并返回。接入时需优先处理本套death状态，避免该早退分支把死亡动画跳过。头顶血条、状态、护盾和意图仍由UI绘制，不属于图片。

## 验收与范围

已检查8张正式源图的透明通道、6格边界；48张PNG均可解码，切帧后的RGBA像素与源图对应格完全一致；25帧GIF预览可解码播放（24个演示姿势加末帧保持）。预览中按pivot对齐地面，未将背景画入角色图。

这是两角色四动作的第一版完整序列，不含移动/技能专属/多方向动画。最终四人战斗中的遮挡、击中反馈与真实事件时序，需要coding agent接入后再验证。不要把美术预览当作整场战斗已完成联调。

`tools/package.cjs`、`tools/render-preview.cjs`为可重现的本地资产打包/预览工具，不是游戏运行依赖；其中FFmpeg/Edge路径是本机路径，换机器需调整。游戏只消费PNG与atlas，不依赖这些工具。
