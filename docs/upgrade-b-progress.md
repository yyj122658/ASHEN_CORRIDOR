# B 路线执行记录

日期：2026-11-11。按 `plans/2026-11-11-upgrade-b-implementation.md` 的 10 个任务推进。

## Task 1 基线与骨架 ✅
- 备份原三文件到 `.backups/pre-upgrade-b/`，记录 sha256 前缀与字节数。
- 建立 `src/{data,core,systems,ui}`、`styles/`、`tests/`、`scripts/`、`artifacts/`。
- `A.Random`（mulberry32，seed=0 可用）、`A.State`（create/validate/takeId）。
- `npm test` 走 `node --test "tests/unit/*.test.cjs"`（Windows 下目录参数会被当模块，必须用 glob）。
- GREEN：17 项通过。

## Task 2 队伍与装备 ✅
- `A.Roster`：calcStats / synergies / move / setTeamSlot / starUp / dismiss / recruit / refreshShop / comfort / upgrade。
- `A.Equipment`：makeItem（不写 registry）/ equip / unequip / toggleLock / sell（整笔事务）/ filter / compare。
- 修复：升星材料装备完整退仓并保留 locked；稀疏队伍不前移；绝望改为 healingReceivedMult。
- GREEN：42 项通过。

## Task 3 探索与结算 ✅
- `A.Expedition`：start / enterNode / chooseEvent / resolveLoot / buy / merchantHeal / chooseBlessing / finishNode / extract / wipe / previewSettlement。
- 全部掉落走 `pendingLoot`；商人购买为事务；结算按 completedFloors。
- 修复真实 bug：`pushLoot` / `applyEffects` 因为 makeItem 返回新 state 而修改丢失，改为显式返回。
- GREEN：62 项通过。

## Task 4 战斗 ✅
- `A.Combat`：create / step / setTactic / continue / report / chooseSkill / targets。
- step 顺序：tick → 回合边界（DOT→递减→回复）→ 终局 → gauge → 稳定排序 → 逐行动 → 检查点。
- 普攻评分压到 5，确保 CD 技能优先（修复腐尸不放重砸）。
- 修复：victory 奖励里的 Math.random 改为 RNG；finalize 重复写 rngState。
- GREEN：87 项通过。

## Task 5 存档 ✅
- v2 key `ashen_corridor_v2`；`migrateV1` 保留 v1 原串；坏档不静默抹。
- 导入先校验后替换，保留 backup；名称按文本渲染。
- GREEN：106 项通过。

## Task 6 UI ✅
- `src/app.js` 单一 dispatch；12 个文件按序 defer。
- 全部页面：标题/营地/队伍/招募/仓库/祭坛/地图/战斗/掉落/祝福/事件/商人/结算。
- 战斗循环 setTimeout + rAF 分离；暂停；倍速只改 delay。
- 修复：btn 的 id 被写成 data-id 导致"继续"按钮永不出现。

## Task 7 视觉与资源 ✅（部分）
- 重写 style.css 为 token/layout/components 三层，删除全部旧覆盖。
- 接入 3 场景 / 6 肖像 / 7 节点；首领肖像后由美术补至 18/18。
- 修复：`preloadArt` 从未调用导致战斗背景不显示；图片降级 CSS 只覆盖肖像导致节点破图。
- Canvas 保持 320×100 / GROUND 84。

## Task 8 端到端 ✅
- 27 项覆盖：流程、编队、招募、仓库、祭坛、战斗、刷新恢复、资源全失败降级、360/390/768 溢出。
- GREEN：27/27。

## Task 9 数值校准 ✅（部分）
- `scripts/simulate.cjs`：4 阵容 × 3 难度 × 3 遭遇 × 120 seed。
- 发现首版严重失衡（2 星 100% 胜率、四剑士 1.3 回合），已将技能倍率下调约 20%、敌人 baseHp 155→260、baseAtk 19→23、首领 hp 2.2→2.65。
- 校准后普通遭遇 6.8–9.4 回合、首领 18–20 回合 / 73–92% 胜率。
- 未做完整远征胜率与真人试玩计时。

## Task 10 交付 ✅（部分）
- README、平衡报告、桌面/手机截图、进度记录。
- 未完成项已在 README「已知限制」列出。

## 追加：18/18 美术联调（14:31）
- 全部 18 张加载校验通过（`preloadArt` 返回 loaded=18 / failed=0）。
- 接入修正：
  - 战场背景按遭遇类型选择：普通/精英用 `scene.corridor`，首领用 `scene.boss`。
  - 首领战进入时预加载两张首领档案；`render` 重建后补 `updateHud`（此前敌人血条为空）。
  - `updateHud` 的预告选择器误命中「阶段 1」，改为 `.boss-intent`。
  - 首领/精英按脚底局部缩放（1.55× / 1.22×），HUD 不放大。
  - 首屏预加载从「3 场景 + 6 肖像」收窄到「1 场景 + 4 肖像」，战场图改为远征时加载。
- 回归：npm test 106/106，e2e 27/27，无异常。

## 追加：逐帧动画接入（15:33）
- 新增 `src/ui/sprite-anim.js`：atlas 读取、状态机、事件消费、绘制。
- `combat.js`：`enemyUnit` 传入 `enemyType`，`makeCombatUnit` 保存；日志加 `seq` 供表现层增量消费。
- `battle-view.js`：动画优先绘制、死亡分支后置、头顶信息抽成 `drawOverhead`、rAF 里推进动画。
- `index.html`：按序加载 `atlas-data.js` 与 `sprite-anim.js`（不用 fetch，file:// 可用）。
- 测试：`tests/unit/sprite-anim.test.cjs` 13 项、`tests/e2e/animation.spec.cjs` 11 项。
- 全量：npm test 119/119，game e2e 27/27，animation e2e 11/11。

## 追加：两个体验 bug 修复（15:52）
1. **速度按钮文字不更新**：战斗界面为保住 Canvas 与动画状态，`render()` 在 battle 阶段只调 `updateHud` 不重建 DOM，按钮文字从未被刷新。给 `#btlSpeed` / `#btlTactic` 加固定 id，在 `updateHud` 里同步文案。同源问题一并修掉（战术按钮也一直显示旧值）。
2. **事件选项「走血迹」文案承诺战斗但不打**：`fog-fork.blood` 的 hint 写着「战斗，但有战利品」，实现只有 loot + damage。
   - 新增声明式效果 `{t:'combat', kind}`，`chooseEvent` 遇到后切到 `battle` 阶段，app 立即 `Combat.create`，开场文本写入战斗日志首条（`type:'note'`）。
   - 战斗胜利后走正常奖励→掉落→finishNode，不会提前发战利品。
3. **顺带发现更严重的 bug**：`chooseEvent` 里 `const st` 却执行 `st = applyEffects(...)`，`applyEffects` 返回新 state 时对 const 赋值直接抛 TypeError，**所有事件选择都会中断**。改为 `let st`。
4. 回归测试 +3（事件正常结算、「走血迹」进战斗、无 combat 效果不触发战斗），e2e 的事件段改为能处理「点完选项直接开打」的分支。
- 全量：npm test 122/122，game e2e 27/27，animation e2e 11/11。
