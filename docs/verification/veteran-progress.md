# 老兵回路版：执行记录

日期：2026-11-11。按 `plan` 的 Task 1–12 推进；基线文档 `specs/2026-11-11-veteran-circuit-design.md`、
`art/2026-11-11-veteran-art-contract.md`。

## 交付物

```text
veteran.html                     新入口，不载入旧 app.js
styles/veteran.css               仅新入口加载，复用 tokens.css
src/veteran/data.js              底盘 / 主手 / 构件 / Gambit / 敌人 / 事件 / 祝福
src/veteran/state.js             默认档、构件、归属、一致性校验
src/veteran/circuit.js           4x4 几何、旋转镜像、端口图编译、能量路由、容错布局
src/veteran/tactics.js           有限条件 + 目标 + 动作求值
src/veteran/positions.js         四槽 swap / insertFront / anchored 与三种 mod
src/veteran/combat.js            行动条、clock/damage 脉冲、五种主手、surge、首领阶段
src/veteran/encounter.js         检查点、重试、唯一确认
src/veteran/expedition.js        七层节点、营火烙印、背包、撤离/撤退事务
src/veteran/roster.js            招募、换主手、战史、一阶调谐、板面保存
src/veteran/storage.js           独立存档 ashen_corridor_veteran_v1
src/veteran/ui.js                全部页面 + 板面 SVG
src/veteran/view.js              Canvas 战场、位置插值、动画复用与降级
src/veteran/app.js               唯一 dispatch、唯一循环、唯一存档
tests/helpers/load-veteran.cjs   沙箱
tests/helpers/veteran-run.cjs    场景夹具
tests/unit/veteran-*.test.cjs    6 个测试文件
tests/e2e/veteran.spec.cjs       浏览器验证
scripts/simulate-veteran.cjs     固定种子模拟
```

## 逐任务状态

| Task | 状态 | 说明 |
|---|---|---|
| 1 入口/数据/状态 | ✅ | 三底盘五行主手六构件；`veteran.html` 不启动旧 `A.App`；旧 key 不被触碰 |
| 2 回路几何 | ✅ | 三底盘 × 四条线路 fixture 全通；旋转四次/翻转两次还原；闭环、越界、重叠、屏蔽、超负荷都有具体原因 |
| 3 能量与指令 | ✅ | 分流不复制、蓄能 4 才发、阈值闸消散、ember/surge 每动作一次；脉冲不刷自伤/DOT/护盾 |
| 4 身位 | ✅ | insertFront 依次后移；anchored 阻挡；每回合换位/援护各限一次；一次根行动最多一个换位 |
| 5 战斗 | ✅ | 五主手规则、稳定排序、死者不行动、首领半血一次、timeout 进 review |
| 6 检查点 | ✅ | 同节点不重生成；rewind 恢复 HP/压力/背包/nextId/RNG；confirm 双击不重复发奖 |
| 7 探索与归属 | ✅ | 背包按格数；烙印未确认不扣代价；撤退恢复 startLoadouts；撤离幂等 |
| 8 招募/战史/调谐 | ✅ | 3 层以下不计合格；两次合格解锁第 3 槽；三次同主手解锁特性；换人不继承 |
| 9 存档 | ✅ | 五阶段 roundtrip；坏档保留原串不覆盖；嵌套检查点、重复归属被拒 |
| 10 界面 | ✅ | 工坊点选放置/旋转/翻转/撤销/重做/预设；战前整备；复盘；掉落；事件；营火；商人；祝福 |
| 11 美术接入 | ⚠️ 部分 | 复用 v1 场景与肖像、battle-v1 剑士/骸骨兵动画；`assets/art/veteran-v1/` 八张图尚未交付，全部走降级 |
| 12 模拟与交付 | ✅ | 固定种子模拟、七层端到端、桌面与手机截图 |

## 开发中发现并修掉的真实 bug

1. **第 7 层无法结束远征**：`finishNode` 调 `advance()` 却丢弃其返回值，`advance` 里再调
   `extract` 返回的是新 state，`next` 仍是旧对象 → 循环不退出。改为 `finishNode` 自己判断
   楼层并在第 7 层直接返回 `extract` 的结果。
2. **完成层数恒为 0**：`chooseNode` 对战斗节点直接 `return Encounter.open(...)`，
   从未写入 `activeNodeId`，于是 `finishNode` 找不到节点、不记 `completedFloors`。
   结果所有撤离都不合格、调谐永远不解锁。现在 `Encounter.open` 自己写 `activeNodeId`，
   `finishNode` 还额外回退到 `lockedNodeId`。
3. **存档阶段白名单漏项**：`State.validate` 只接受 `map/prebattle/battle/battleReview/loot`，
   在营火、事件、商人处存的档会被自己判成坏档，读档直接清空。已补齐 9 个阶段。
4. **烙印生命被乘两次 0.8**：先写入 `maxHpModifiers` 再取「烙印前最大生命」，
   得到 128 后又乘 0.8 = 102。改为先取值再改修正。
5. **战斗结束画面变黑**：界面重建换掉 `<canvas>` 后没有重新绑定上下文，`ctx` 指向已移除的节点。
   现在每次渲染战场都重新绑定，同时保留位置插值。
6. **伤害统计口径错**：`b.stats.damage` 把敌方打出的伤害也算进去（726 vs 实际 576）。
   改为按受击方阵营分别累计。
7. **烙印编辑可以「保存板面」**：远征中调用 `saveBoard` 必然失败；烙印模式隐藏了工坊专用按钮。
8. **布局指令显示内部 id**：战前预览显示 `allyHpBelow→support`，改为中文可读文本。

## 与设计文档的偏差（已确认是有意为之）

1. **蓄能预设占格**：文档写「占格六、load3」。模板表里 capacitor 是 4 格、load2，
   与 elbow 组合后是 **7 格 / load3**。以模板表为准，测试断言 7/3。
2. **每层喘息**：新增层间恢复 12% 生命。文档只写了营火休息与回营满血；
   不加这一条七层端到端几乎必死（见 results）。
3. **第 7 层必须先打首领**：文档写「第 7 层胜利也必须确认并处理掉落后才通关」。
   实现上第 7 层点非首领节点只是消耗该节点，`completedFloors` 不增加，仍然要打首领才结算。
4. **营火/商人没有「紧急撤退」入口**：按 spec §7，紧急撤退只在 prebattle/battle/review 可用；
   营火节点用「继续前进」离开。

## 未完成 / 已知限制

1. `assets/art/veteran-v1/` 八张图未交付，工坊横幅、营火烙印、收藏品缩略全部走渐变降级。
   路径已按 art-contract 预留，图片到位后只需在 `view.js` / `ui.js` 里接 `A.Art.imgTag`。
2. 事件只有 3 个、祝福 6 个、敌人 6 种（含 2 首领），长线重复感明显。
3. 没有音效与音乐：新入口不加载旧 `Sfx`。
4. `file://` 下 Canvas 仍无法读像素（跨源污染），不影响显示。
5. 未做无障碍审计（有焦点样式与 aria-live，但没做屏幕阅读器实测）。
6. 数值只做过固定种子模拟，没有真人试玩计时。
