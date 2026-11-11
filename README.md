# 灰烬回廊 · Ashen Corridor

像素风横版自动战斗。**单入口**：`index.html` 一套玩法、一份存档、一个名字。

玩法内核是「底盘 + 主手 + 生命金属回路」：四个老兵线性站位，出手要花回路里的能量，
打不过可以无限次「重新整备」，**活着撤离东西才入仓**。
原生 JavaScript + CSS + Canvas，无框架、无运行时 CDN、无打包步骤。

2026-11-11 起，原先并行的两个版本合成一个：老的「职业 / 升星 / 羁绊 / 随机装备」玩法退役，
由「老兵回路」规则集接管入口，游戏名保持《灰烬回廊》；旧的 `ashen_corridor_v1` / `v2` 存档不再读取。

---

## 核心循环

营地装配 → 下潜七层 → 每层三选一 → 遭遇战可无限「重新整备」 → 活着撤离才入仓。

- **四位线性身位**：1 号位最靠前。短刃只能在 1 号位出力，长矛 2 号位能贯穿两人，重炮 4 号位更省能量。
- **生命金属回路**：4×4 板面，用直管 / 弯管 / 分流 / 蓄能 / 阈值闸 / 余烬把 `时钟` 与 `受击`
  接到 `主手` 与 `保护`。能量是整数单元，分流不复制、蓄能 4 才发、闭环会被编译器拒绝。
- **行为指令**：条件 + 目标 + 动作，按顺序取第一条合法项，最多 AND 两个条件。不执行时界面会说明原因
  （缺能量、身位不对、没有合法目标）。
- **可逆整备**：敌人、初始种子、检查点在第一次进入节点时固定。打不过就重来，不要钱；
  改身位或指令可能改变出手顺序。
- **营火现场烙印**：把本局捡到的构件直接烙进板面，代价是本局生命上限 ×0.8、压力 +40。
  烙进去的东西仍算本局风险池——撤退时按获得顺序保留一半。
- **老兵保护**：紧急撤退保留一半新收获与全部带入资产；确认败退则失去本局新收获，
  但**不永久杀人、不扒装备**。合格撤离（≥3 层）累计解锁第 3 条指令槽与主手一阶调谐。

---

## 运行

**方式一：双击 `index.html`**
不需要服务器、不需要联网，直接在现代浏览器（Chrome / Edge / Firefox / Safari）打开即可。

**方式二：本地 HTTP 预览**

```bash
npm run dev
# http://127.0.0.1:4173/
```

服务器只监听 127.0.0.1，拒绝路径穿越，是只读静态服务。

> 两种方式都能完整游玩。`file://` 下唯一的限制是 Canvas 读取像素会被浏览器拒绝（图片跨源），这只影响自动化测试，不影响画面与操作。

**在线试玩**：https://yyj122658.github.io/ASHEN_CORRIDOR/ （`gh-pages` 分支，只含运行时文件）

---

## 测试

```bash
npm test            # 117 项逻辑单元测试（node:test，无 DOM）
npm run test:e2e    # 56 项浏览器端到端（需要 playwright + 本机 Chrome）
npm run simulate    # 固定种子模拟，终端输出
```

端到端需要开发依赖：

```bash
npm i -D playwright
```

---

## 目录结构

```text
index.html                     唯一入口，按序 defer 加载经典脚本
styles/
  tokens.css                   颜色/字体/间距 token
  veteran.css                  全部界面样式（含 v1 美术接入）
src/
  core/random.js               可保存可重放的确定性 RNG（mulberry32）
  core/state.js                纯工具：深拷贝
  veteran/data.js              底盘、主手、回路构件、敌人、首领、祝福、事件
  veteran/state.js             状态形状、默认队伍、一致性校验、存档 key
  veteran/circuit.js           4×4 板面：放置、连通、编译、能量单元
  veteran/tactics.js           行为指令求值（条件 / 目标 / 动作）
  veteran/positions.js         四位身位与目标选择
  veteran/combat.js            行动条、能量脉冲、伤害、首领阶段
  veteran/encounter.js         遭遇模板与蓝图锁定（可逆整备）
  veteran/expedition.js        节点状态机、三选一、营火烙印、结算与撤退
  veteran/roster.js            属性、编队、招募、遣散、战史与调谐
  veteran/storage.js           存档编解码、坏档保护、导入导出
  veteran/art.js               美术映射（veteran-v1 + v1 双源）
  veteran/ui.js                全部页面模板 + 4×4 板面 SVG
  veteran/view.js              Canvas 战场、HUD、日志
  veteran/app.js               唯一 dispatch、渲染、循环、存档
  ui/assets.js                 v1 固定资源映射与失败降级
  ui/sprite-anim.js            逐帧动画（atlas 驱动）
tests/
  unit/*.test.cjs              逻辑测试
  e2e/game.spec.cjs            浏览器端到端
scripts/
  serve.cjs                    只读预览服务器
  simulate-veteran.cjs         固定种子模拟
assets/art/v1/                 场景 / 立绘 / 节点插画 / 首领肖像
assets/art/veteran-v1/         工坊 / 营火 / 静养场景、板面底材、构件物件图
assets/art/battle-v1/          逐帧动画图集
```

---

## 存档

- 存储 key：`ashen_corridor_veteran_v1`，结构 `{schemaVersion:1, ruleset:'veteran', savedAt, state}`。
- 旧的 `ashen_corridor_v1` / `ashen_corridor_v2` **不再读取、也不会被改写**，留在浏览器里。
- 损坏时不会静默抹档：原串另存为 `ashen_corridor_veteran_v1_broken_<时间戳>` 并报告 `corrupt`。
- 设置里可导出 JSON；导入会先完整校验（schema、数值范围、ID 唯一性、物品归属），通过后才替换。
- 战斗每 tick 最多每秒落盘一次，`visibilitychange` / `pagehide` 会强制刷新。
  页面被强杀时最多回退到最后一个检查点，不承诺零丢失。

---

## 美术资源

两套资源并存，映射分别写在 `src/veteran/art.js` 与 `src/ui/assets.js`，**不 fetch manifest**，保证 `file://` 可用。

| 组 | 内容 | 用在哪 |
|---|---|---|
| `assets/art/v1/` 场景（3 张） | camp / corridor / boss-chamber | 标题页背景、营地横幅、战场背景、结算横幅 |
| `assets/art/v1/` 立绘（6 张） | 六套皮肤 | 老兵卡、队伍卡、单位详情、招募台 |
| `assets/art/v1/` 节点插画（7 张） | 战斗 / 精英 / 宝箱 / 事件 / 营火 / 商队 / 首领 | 地图节点卡片 |
| `assets/art/v1/` 首领肖像（2 张） | gatekeeper / memory-eater | 战前敌方面板 |
| `assets/art/veteran-v1/`（8 张） | 工坊 / 营火 / 静养、板面底材、四类构件 | 工坊、营火、战史、仓库 |

加载策略：
- 启动只预加载 `scene.camp`（标题页与营地共用）。
- 下潜时预加载 `scene.corridor` 与 `scene.boss` 两张战场图。
- 立绘、节点插画走 `<img loading="lazy">` 按需加载。

降级链路仍然保留（图片目录被删也能玩）：
- 横幅失败 → 隐藏破图，露出渐变底。
- 立绘失败 → 卡片保留文字布局。
- 战斗背景失败 → 程序化砖墙、石柱与火把。

---

## 战斗逐帧动画（battle-v1）

剑士与骸骨兵使用 48 帧逐帧动画（2 角色 × 4 动作 × 6 帧，8 张图集），其余单位继续使用程序化像素绘制。

| 项 | 实现 |
|---|---|
| 角色识别 | 我方按皮肤 `skinId === 'blade'`；骸骨兵按 `enemyType === 'bone'`，不按名字/ID 猜 |
| 资源 | 读取 `assets/art/battle-v1/atlas` 的 `rect / pivot / durationMs` |
| 状态优先级 | death > hurt > attack > idle |
| 多段伤害 | 同一动画未播完不重启，不会反复抽刀 |
| 死亡 | 播完保持末帧 |
| 暂停 | `dt = 0` 冻结，恢复不跳帧 |
| 倍率 | 视觉时间按 `min(speed, 2)` 缩放，逻辑 tick 不受影响 |
| 刷新恢复 | 按存活状态重新初始化，不重放历史伤害事件 |
| 降级 | 图集加载失败时整只回退程序绘制 |

绘制按每帧 `pivot` 对齐脚底锚点，倒地帧的 `pivotY` 变化被完整使用，不会悬空。

---

## 验证记录（2026-11-11 合并后）

| 项目 | 结果 |
|---|---|
| `npm test` | **117 / 117 通过** |
| `npm run test:e2e` | **56 / 56 通过**，无未捕获异常 |
| 360 / 390 / 768 / 1440 宽度 | 横向溢出均为 0px |
| 全资源加载失败 | 工坊仍可用、可操作，无异常 |
| `file://` 直接打开 | 完整可玩 |
| 单入口 | `veteran.html` 与旧玩法模块已移除，断言覆盖 |

---

## 已知限制

1. **没有真人试玩计时**。10–15 分钟目标只有 tick 推算，没有实测。
2. **没有跑完整 7 层远征的自动化胜率**。模拟只覆盖单场战斗。
3. **战斗中关闭页面再打开** 会回到标题页（不后台推进战斗），不做战斗内断点续打。
4. **音效是合成短音**，只有点击/命中/暴击/拾取/胜负五种，没有环境音与音乐。
5. **敌人只有 5 种模板 + 2 个首领**，长线重复感会逐渐明显。
6. **`file://` 下 Canvas 无法读取像素**（跨源污染），不影响显示与操作。
7. **未做完整的无障碍审计**：有焦点样式、`aria-live` 提示、44px 触控目标，但没有屏幕阅读器实测。
8. **只有剑士与骸骨兵有逐帧动画**，其余单位仍是程序绘制，同屏风格存在差异。
9. **46 MB 原始 PNG 未做衍生压缩**。WebP/AVIF 派生与小尺寸缩略图未做；HTTP 部署建议先出一套派生资源。
10. **旧玩法内容已随代码删除**：六职业、升星、羁绊、随机装备词条、祭坛都不再存在（git 历史可查）。
