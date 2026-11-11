# 灰烬回廊 B 路线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现用户选定的 B 路线，把现有原型升级为规则可靠、策略清晰、可反复游玩且美术统一的完整浏览器游戏。

**Architecture:** 原生 JavaScript、CSS、Canvas。将大文件逐步拆成数据、可独立测试的逻辑、持久化和界面；经典脚本按顺序加载到 globalThis.Ashen。美术 agent 只写 assets/art/v1，coding agent 消费固定路径并实现界面，不等待图片才开始。

**Tech Stack:** 浏览器原生 API；Node.js 22+ 的 node:test 做逻辑测试；Playwright 仅作开发依赖；无运行时 CDN、框架或打包要求。

**Spec:** `../specs/2026-11-11-upgrade-b-design.md`；视觉与资源接口 `../../art/2026-11-11-art-contract.md`。

## Global Constraints

- 原生 JavaScript+CSS+Canvas，不引入 React、Vue、Phaser 或运行时 CDN。开发测试工具可作为 devDependencies。
- 保留双击 index.html 可运行，也提供本地 HTTP 预览。
- 逻辑层不依赖 DOM；渲染不得消费游戏 RNG；画面切换不重复注册事件或启动多份计时器。
- 保护 v1 存档；不将拆分代码与重置用户进度捆绑。
- 图片、按钮、数值、提示分层实现；美术资产路径由 art-contract 固定。
- 本文件所有新路径和 API 是待实现契约，不是现有功能；行号只是阅读锚点，按函数名定位。

## Review Focus

1. 关闭页面时处于战斗、已结算战斗或待选择事件：恢复后不重打免费领货、不重发收益、不遗失选择。
2. 连点节点、购买、撤离、升星：最多执行一次事务；取消/失败不扣资源、不丢装备。
3. 旧档缺字段、坏档、重复物品归属、含 HTML 的导入名称：拒绝非法输入且不破坏有效旧档。
4. 图片全缺失、file:// 离线、窄屏、键盘：仍能完成远征，最终美术到位后无裁切和焦点问题。
5. 战斗同 tick 多人就绪、DOT 致死、首领转阶段：事件顺序确定，死者不行动，倍率不改变随机结果。

## 文件结构和职责

```text
index.html                         # 保留入口、按依赖顺序 defer 加载
game.js                            # 最终仅兼容入口/说明；不能同时保留旧 boot 和新 boot
style.css                          # 基础 reset 与分层样式入口；旧覆盖需清理
src/
  data/catalog.js                  # 职业/技能/羁绊/敌人/祝福/装备特色/难度
  core/random.js                   # 可保存、可重放 RNG
  core/state.js                    # 默认状态、查找、合法操作与一致性校验
  core/storage.js                  # schema、迁移、检查点、导出导入
  systems/roster.js                # 队伍、升星、遣散、招募、属性/羁绊
  systems/equipment.js             # 装备、物品归属、锁定、筛选、出售、对比
  systems/expedition.js            # 节点/事件/商人/祝福/收益与终局
  systems/combat.js                # 单步逻辑、目标/技能选择、伤害、统计、首领
  ui/assets.js                    # 固定资产映射、缓存、失败降级
  ui/components.js                # 卡片、图标、条、tooltip、确认/选择弹层
  ui/screens.js                   # 标题/营地/队伍/招募/地图/装备/仓库/祭坛/结果
  ui/battle-view.js               # Canvas、战斗 HUD、动画；不修改战斗结果
  ui/input.js                     # click/change/keydown 单一分发及 focus 管理
  app.js                          # dispatch、恢复、tick/RAF 生命周期、音效设置
styles/
  tokens.css                      # 美术协议 token、字体、spacing
  layout.css                      # 页面布局、断点
  components.css                  # 卡片/按钮/弹层/状态与动效
tests/
  helpers/load-game.cjs            # VM载入真实经典脚本，提供确定性fixture
  fixtures/v1-save.json            # 合法旧档
  unit/*.test.cjs                  # node:test，测试真实逻辑结果
  e2e/game.spec.cjs                # Playwright，避免被 node --test 误发现
scripts/serve.cjs                  # 只读静态预览，仅绑定127.0.0.1，拒绝路径穿越
scripts/simulate.cjs               # 固定种子报告
playwright.config.cjs
package.json                      # 只加开发命令和测试依赖
README.md                         # 运行、测试、存档、资源目录与已知限制
```

可把同职责的小文件合并，不能用覆盖全局函数的第二个补丁脚本代替清晰拆分。每搬迁一组就删除旧的执行副本，保留可运行页面。

## 公共数据与 API 契约

所有脚本使用 `(function(A){ ... })(globalThis.Ashen ||= {})` 风格，不向 window 散落新函数。以下签名统一使用 `A = globalThis.Ashen`。

DomainResult：`{ok:boolean, state:GameState, events:DomainEvent[], error?:{code:string,message:string}}`。命令失败返回原状态且 events=[]；成功返回新状态。所有领域动作无 DOM、无 localStorage、无 setTimeout，无隐式 Math.random。Selectors 返回值不能泄漏可变引用。

```text
GameState:
  schemaVersion: 2
  gold/shards/bestDepth/runs/extracts/wins: 非负整数
  bagCap: 8                              # 迁移时保留合法旧值
  nextId: 正整数                          # 在存档内延续，避免恢复后ID碰撞
  shopRefresh: 非负整数
  roster: Unit[]
  itemsById: Record<ItemId,Item>
  stash: ItemId[]
  team: [UnitId|null,UnitId|null,UnitId|null,UnitId|null]
  shop: {offerId,unit:Unit,sold:boolean}[]
  upgrades: {bag,atk,hp,rec}
  difficulty: 'normal'|'deep'|'nightmare'
  unlockedDifficulties: string[]
  achievements: string[]
  settings: {sound:boolean,volume:number,reducedMotion:boolean,speed:1|2|3}
  rngState: uint32                         # 招募等营地随机
  run: Run|null
  settlement: Settlement|null
  logs: {msg,kind}[]                       # 数据，不存HTML/DOM

Unit: {id,cls,star,name,equip:{weapon:ItemId|null,armor:ItemId|null,
       trinket:ItemId|null},stress,hp,affliction,virtue,note}
Item: {id,slot,q,ilvl,base,prefix,stats,locked:boolean,traitId:string|null}
Run: {id,seed,rngState,difficulty,stage,floor,maxFloor:7,completedFloors,
      completedNodeIds:string[],activeNodeId:string|null,nodes:Node[],
      party:{uid,slot,hp,stress}[],bag:ItemId[],pendingLoot:ItemId[],
      goldFound,shards,kills,blessings:string[],blessingOffers:string[],
      event:EventState|null,battle:BattleState|null,settled:boolean}
stage: 'map'|'event'|'loot'|'blessing'|'battle'|'battleResult'
Node: {id,type,consumed,risk:'low'|'medium'|'high',rewardTags:string[]}
EventState: {eventId,choiceIds:string[],resolved:boolean,resultKey?,goods?,bought?}
BattleState: {id,kind,tick,round,over,win,allies:CombatUnit[],enemies:CombatUnit[],
              logs:DomainEvent[],rewardApplied:boolean,stats,roundEffects}
CombatUnit: {id,sourceUnitId?,side,slot,hp,maxHp,atk,def,spd,crit,acc,eva,
             gauge,cds,buffs,alive,skills,passiveId?,traitIds,actionCount,
             bossPhase,phaseTriggered,intent,skipActions,kills,shield,...derivedStats}
Settlement: {id,runId,type:'extract'|'flee'|'clear'|'wipe',gold,shards,
             items:ItemId[],lostItems:ItemSummary[],completedFloors,stats,adviceKeys}
```

补充约束：普通物品必须恰好属于仓库/某角色装备/远征背包/待处理掉落/未售商人货物中的一个位置。已售商人物品和结算快照可保留历史 itemId 引用，但不计第二份所有权；丢弃物品从 registry 清理。shop 的候选 Unit 不在 roster，不占 team。makeItem 返回的候选物品须在所属命令事务中分配归属后才提交到 registry，避免中间态被保存。持久化不保存 runtime UI 状态、计时器和图片对象。

`DomainEvent` 至少有 `{type,actorId?,targetId?,amount?,meta?}`；日志文案在 UI 层格式化，不把 HTML 带进存档。唯一 ID 由状态内序列或 RNG 产生，不能依赖毫秒时间导致测试及恢复碰撞。以上省略的 derivedStats 由 calcStats 明确返回，允许实现者补足，不改变本设计的玩法公式。

---

### Task 1：建立可运行基线、测试入口和分层骨架

**Files:** 修改 index.html/game.js/style.css；创建 src/data/catalog.js、core/random.js、core/state.js、测试helper、package.json、scripts/serve.cjs。

**Interfaces:** `A.Data` 提供原有静态表；`A.Random.next(uint32)->{value:number,state:uint32}`；`A.State.create()->GameState`；`A.State.validate(state)->{ok,errors:string[]}`。random seed=0 要可用且确定，随机值范围[0,1)。

- [ ] 备份当前三个源文件到 `.backups/pre-upgrade-b/`，存在则另建时间戳目录；记录原大小/哈希。先运行原版语法检查并保存基线截图。
- [ ] 创建测试 helper，用 Node VM 执行真实经典脚本，测试不用重新实现领域逻辑。
- [ ] 写并运行 RED：`random.test.cjs` 验证保存中间 RNG state 后重放产生完全相同后续序列；`state.test.cjs` 验证默认阵容可用、重复 ID/跨位置重复物品被拒绝。
- [ ] 最小实现 RNG 和新状态初始化；提取原始静态数据，保留现有职业/品质/技能 ID。
- [ ] index 按 data→random→state→systems→storage→UI→app 顺序 defer；在后续模块到位前用明确的临时兼容入口保持可运行，不同时调用两次 boot。
- [ ] 添加命令：`npm test`=`node --test`；`npm run dev`=`node scripts/serve.cjs`；`npm run test:e2e`=`playwright test`；`npm run simulate`=`node scripts/simulate.cjs`（后两脚本在对应任务实现）。
- [ ] 验证 GREEN：npm test；http://127.0.0.1:4173 和 file:// 均可进入标题页，无重复初始化。

### Task 2：队伍、属性、升星和装备事务

**Files:** src/systems/roster.js、equipment.js；data/catalog.js；tests/unit/roster.test.cjs、equipment.test.cjs。

**Interfaces:** `A.Roster.calcStats(state,unitId,partyIds)->Stats`；`A.Roster.move(state,unitId,toSlot)->DomainResult`；`A.Roster.starUp(state,targetId,fodderId)->DomainResult`；`A.Roster.dismiss(state,unitId)->DomainResult`；`A.Roster.recruit(state,offerId)`、`refreshShop(state)`、`comfort(state,unitId)`、`upgrade(state,key)` 均返回 DomainResult；`A.Roster.synergies(state,partyIds)->SynergySummary[]`。

`A.Equipment.equip(state,unitId,itemId)`、`unequip(state,unitId,slot)`、`toggleLock(state,itemId)`、`sell(state,itemIds)` 均返回 DomainResult；`filter(state,{slot,minQuality,locked,sort})->Item[]`；`compare(state,unitId,itemId)->{before,after,delta,traitChanges}`；`makeItem(state,{ilvl,bias})->{state,item}`。Stats 用 healingReceivedMult 替代负值 healTaken。

- [ ] 写 RED：升星材料穿三件装备时三件均退仓且锁定不变；目标自身装备不动；非法/同 ID 材料失败无扣除；遣散归还装备。
- [ ] 写 RED：稀疏 team `[null,null,id,null]` 重排/入战不前移；同一角色不能占两槽；候补消耗不意外删除另一同职业上场角色。
- [ ] 写 RED：绝望角色接受100点基础治疗时实得70；计算属性不修改原始职业表/装备；全队4人羁绊展示值与实际累计值一致。
- [ ] 写 RED：出售含锁定物品时拒绝整笔事务；UI筛选后传入的未锁 ID 集合只卖该集合；不存在或重复ID不重复付钱。
- [ ] 按设计实现角色与装备动作；用唯一归属 registry；先实现换装后属性对比，再做操作文案。
- [ ] 实现六职业被动数据及四种特色装备数据；触发逻辑在 Task 4。
- [ ] GREEN：npm test；保持当前招募价、12金刷新、星级倍率不随意改动。

### Task 3：探索状态机、祝福、统一掉落及结算

**Files:** src/systems/expedition.js、data/catalog.js；tests/unit/expedition.test.cjs、settlement.test.cjs。

**Interfaces:** `A.Expedition.start(state,{difficulty,seed})`、`enterNode(state,nodeId)`、`chooseEvent(state,choiceId)`、`resolveLoot(state,itemId,{action:'accept'|'discard'|'replace',replaceId?})`、`buy(state,offerId,{replaceId?})`、`merchantHeal(state)`、`chooseBlessing(state,blessingId)`、`finishNode(state)`、`extract(state,mode:'extract'|'flee')`、`wipe(state)` 均返回 DomainResult；`A.Expedition.previewSettlement(state,mode)->SettlementPreview`。战斗进入/完成由 Task 4 对接。

- [ ] RED：入场立撤 gold/shards净变化均0，completedFloors=0；完成一层再撤遗物+2；再次调用终局命令不重复结算。
- [ ] RED：双击节点和已选择事件不能重复产物/扣血；完成一次节点只增加一层记录；层数不越过7；首领胜利满包时先battleResult再loot，处理完才记录第7层和自动撤离。
- [ ] RED：所有来源的掉落遇到满包进入 pendingLoot；替换只丢指定物品；全部处理前不能推进；商人取消替换不扣金币、不标售出、不进仓库。
- [ ] RED：2/4/6层掉落处理后必到祝福阶段，三选项不同且不含已持有；选一次后推进一次，持久化只有 ID。
- [ ] RED：逃离时奇数物品按向上取半、金币和战斗遗物向下取半；未完成层不算探索收益；全灭遗物为0，不误加撤离次数。
- [ ] 实现显式阶段；事件池转为稳定 ID+静态 resolver，不序列化函数；界面文案数据与执行结果一致。
- [ ] 拾荒祝福只作用后续金币一次；禁忌契约压力倍率统一入口，不能由伤害每段重复施加敌方总压力。
- [ ] GREEN：npm test；保存至少一个含满包、商人、祝福的可重放 fixture。

### Task 4：确定性战斗、战术、被动、特色装备与首领

**Files:** src/systems/combat.js、data/catalog.js；tests/unit/combat.test.cjs、boss.test.cjs、traits.test.cjs。

**Interfaces:** `A.Combat.create(state,kind)->DomainResult`；`A.Combat.step(state)->DomainResult`；`A.Combat.chooseSkill(state,actorId)->string`；`A.Combat.targets(state,actorId,skillId)->string[]`；`A.Combat.setTactic(state,tactic)->DomainResult`；`A.Combat.continue(state)->DomainResult`；`A.Combat.applyHeal(state,sourceId,targetId,amount)->DomainResult`；`A.Combat.report(state)->BattleReport`。step 是一个完整逻辑 tick，所需随机全部读写 run.rngState。

- [ ] RED：腐尸可以释放重砸；治疗不对满血优先；仍有减伤增益时不无意义重放；保守/集火在同一残血fixture选择不同优先动作。
- [ ] RED：CD=2使用后两次自身行动不可用；一次眩晕只跳过一次行动；buff按全局回合且不在施加当刻扣时长。
- [ ] RED：同tick两人ready时两者最多各行动一次；前一行动已结束战斗则后一人不行动；第6tick先DOT/状态/回复后行动，DOT致死者不行动，行动新状态不在本tick立刻衰减；双方同回合DOT全灭判失败；多段击杀后不攻击已死目标。
- [ ] RED：前后排目标权重、背刺目标符合设计；渲染/1倍/3倍推进相同tick次数时战斗和RNG完全一致。
- [ ] RED：首领只有一次50%转阶段；大招前一行动有intent；只剩一个目标仍释放首领全体机制技能。
- [ ] RED：余烬刃只增益灼烧目标，守夜印只在开战触发一次，回响灯只计算真实溢出且总盾≤30%maxHp，追猎符最多三层；同名trait三件按一次生效，不重复护盾/触发/层数；有效治疗统计不包含溢出。
- [ ] RED：六个被动各有正/负条件fixture；游侠仅第3/6次伤害行动提高命中且第4次恢复，治疗/眩晕不推进伤害行动计数；刺客首次多段行动全部获加成且第二次不再获得。
- [ ] 实现六职业被动（详见设计）；暴击、负面、压力、防护、DOT的事件触发顺序集中在 combat，不散落渲染器。
- [ ] 胜利只应用一次奖励与战后治疗，转battleResult；continue有待处理掉落时先转loot，最后一件取舍结束才调用finishNode；无掉落直接finishNode。完成节点以后才处理祝福/下一层/首领自动撤离。报告保存成员贡献和基于事件的建议。
- [ ] GREEN：npm test；无 DOM 环境运行完整普通战斗、精英、两种首领；tick设上限并明确报告平局/异常，不能死循环。

### Task 5：v1迁移、远征/战斗恢复、导入导出

**Files:** src/core/storage.js；tests/fixtures/v1-save.json；tests/unit/storage.test.cjs。

**Interfaces:** `A.Storage.migrateV1(raw)->GameState`；`encode(state)->string`；`decode(text)->{ok,state?,errors:string[]}`；`load(storage)->{status:'new'|'loaded'|'migrated'|'corrupt',state?,errors}`；`save(storage,state)->{ok,error?}`；`importSave(storage,text)->{ok,state?,errors}`。storage参数为localStorage兼容对象，编码/校验部分纯函数。

- [ ] RED：含角色装备/仓库/售出招募项的v1 fixture迁移前后资产和货币守恒，v1原串不变；缺upgrades子字段补默认，不覆盖已有等级。
- [ ] RED：战斗中和battleResult分别round-trip，恢复后相同种子继续得到同结果且不重发奖；事件选择、loot、blessing、商人已售状态均恢复。
- [ ] RED：损坏JSON、未知schema、NaN/非法数值、重复ID、跨仓库与装备重复归属、超限数组拒绝且旧档不变。
- [ ] RED：含`<img onerror=...>`的名称作为普通文本展示；导入不会执行任何内容；导入成功前保存最近有效备份。
- [ ] 实现v2优先、v1迁移/恢复入口；localStorage写满时提示并允许导出当前内存进度，不能静默称已保存。
- [ ] 提供稳定的序列化DTO，不保存游戏对象循环引用；导入验证首领阶段、CD、合法技能ID与stage之间的一致性。
- [ ] GREEN：npm test；UI恢复将在Task6/8覆盖；README明确最多回退最近持久化检查点。

### Task 6：应用生命周期与全部操作界面

**Files:** src/app.js、ui/input.js、ui/components.js、ui/screens.js、ui/battle-view.js；index.html。

**Interfaces:** `A.App.dispatch({type,payload})->void` 是唯一用户操作入口；`A.App.getState()->GameState`供UI只读；`A.UI.render(state,uiState)`；`A.BattleView.renderFrame(state,time)`；`A.BattleView.updateHud(state)`；`A.UI.renderModal(model)`；`A.App.pause()/resume()`。UI临时状态包括screen、筛选、弹层、focusedAction，与存档分离。

- [ ] RED（e2e）：反复进出标题/营地和暂停恢复，计时器只一份，暂停不推进tick，标题页不推进战斗。
- [ ] 实现所有页面与功能入口：前后排移动/羁绊预览、招募/升星预览、装备对比/锁定/筛选/出售、祭坛/难度/成就、地图/祝福/掉落替换、商人、三战术、结果统计、存档设置。
- [ ] 所有可交互元素真实button/input/select；click/change/keydown只注册一次；动作提交后按DomainResult展示错误，不由UI先扣资源。
- [ ] 战斗RAF只画画，setTimeout调逻辑tick；暂停同时暂停逻辑和视觉时间；存档间隔最多1秒；visibilitychange/pagehide刷新检查点。
- [ ] 战斗HUD按数据更新，别每tick重建所有按钮；保持焦点；模态框焦点锁定并在关闭后恢复。
- [ ] 导出JSON用Blob下载；导入用本地文件选择，先校验后确认覆盖；切屏不重置筛选和滚动，必要时明确恢复位置。
- [ ] GREEN：npm test + npm run test:e2e；此时即使全无新美术也能走完一局，但不宣称美术完成。

### Task 7：视觉系统与资产接入

**Files:** styles/*.css、style.css、src/ui/assets.js、components.js、screens.js、battle-view.js；美术资产只读取。

**Interfaces:** `A.Art.getArt(id)->{src,fallbackId,objectPosition,groundY?}|null`；`A.Art.preloadArt(ids)->Promise<{loaded,failed}>`；`A.Art.getImage(id)->HTMLImageElement|null`。ID/路径/焦点见art-contract，不通过fetch manifest使file://失效。

- [ ] 样式先建立token、布局、组件；清除旧.nodes全局!important和重复覆盖，而非再追加一轮互相冲突的样式。
- [ ] 按美术协议实现标题/营地横幅、四肖像卡、前后排、三路径插画卡、战斗HUD、仓库对比和结果页。
- [ ] 接入3场景、6肖像、7节点、2首领资源槽；首领肖像用于档案/意图卡，boss1→enemy.gatekeeper、boss2→enemy.memoryEater，不当作可动角色贴图；node缺失先用corridor降级，不用损坏img图标；头像缺失用职业徽记。
- [ ] Canvas保持320×100/GROUND84；按背景地面锚点裁切绘制，再画人物/粒子/伤害；修正现有isBoss/size不实际改变绘制比例的问题，使用围绕脚底的局部scale，HUD不一起放大。
- [ ] 统一线性SVG图标；品质边框+文字、状态图标+名称，不能仅靠颜色；正文14px以上，触控44px，清晰focus-visible。
- [ ] 加入用户首次交互后初始化的低音量音效和静音/音量设置；减少动画模式禁用屏幕震动、大位移动效和闪烁，不停止战斗逻辑。
- [ ] 验证360/390/768/1440宽无横向溢出；关键提示无需hover；首屏只预加载必要图片。
- [ ] 美术到位后截图1440×900和390×844；记录实际图片ready项。缺真实资产时可完成代码任务，最终交付需明确待联调，不把降级当成完整美术。

### Task 8：自动化端到端、离线及资产失败验证

**Files:** playwright.config.cjs、tests/e2e/game.spec.cjs、tests/helpers/*；必要时修复对应所属模块。

**Interfaces:** Playwright默认baseURL=http://127.0.0.1:4173，webServer用npm run dev；至少Chromium桌面和390px触控配置。浏览器二进制安装单独记录，不视为游戏生产依赖。

- [ ] 浏览器RED→GREEN：初次进入→调整站位→招募/升星→装备→远征→事件→满包取舍→祝福→战斗→撤离→仓库→祭坛。测试使用固定seed和可导入fixture，不用生产后门。
- [ ] 战斗中刷新后点击继续，保持HP/CD/首领阶段；battleResult刷新后继续只领奖一次；在事件/商人/祝福/loot页刷新均可完成流程。
- [ ] 连点购买/撤离/升星；取消损失确认；全灭后损失符合预览；UI禁用与domain校验同时存在。
- [ ] 拦截所有assets/art请求、禁音频，再完成一场远征；控制台无未捕获异常；资源失败有可读降级。
- [ ] file:// 单独打开测试，不能依赖预览服务器提供API、manifest fetch或CDN；localStorage不可用时提示并允许内存游玩/导出。
- [ ] 键盘走完设置、编队、弹层关闭；reduced-motion开启后画面反馈减弱但结果相同；手机截图检查长名称和数值。
- [ ] GREEN：npm test；npm run test:e2e；保存截图与测试报告到`artifacts/verification/`，不要把测试夹具/模拟结果伪装为真实玩家数据。

### Task 9：难度、成就与固定种子数值校准

**Files:** data/catalog.js、scripts/simulate.cjs、tests/unit/progression.test.cjs、balance.test.cjs；docs/balance/2026-11-11-baseline.md。

**Interfaces:** `A.Progression` 可在 expedition.js 中实现；`unlock(state,clearDifficulty)->GameState`、`achievements(state)->AchievementSummary[]`；模拟用真实`A.Combat.step`，固定seed1–200，每种阵容/难度报告胜率、tick/行动数、剩余HP、金币/遗物与装备分布。

- [ ] RED：普通通关才解锁深入，深入通关才解锁梦魇；无资源重复奖励；三成就只记录一次；未解锁难度不可通过命令绕过。
- [ ] 实现设计的难度倍率；不同难度使用相同基础fixture比较，避免用随机敌人差异混淆结果。
- [ ] 对双剑士+盾卫+牧师、双牧师+盾卫+游侠、双暗系+盾卫+牧师、四同职业阵容跑普通/精英/两首领固定种子；不能用简单“某阵容必须赢”掩盖平衡问题。
- [ ] 额外跑完整远征路线策略：优先恢复、优先收益、优先战斗三种；声明装备、升级、祝福选择、撤离策略和seed；检查收益都来自已完成节点。
- [ ] 时长从真实tick数量、1倍速delay、事件交互时间估算并用至少3局人工试玩校准；目标10–15分钟，倍率更快；未达到要报告，不擅自牺牲可读性。
- [ ] 发现压倒性强弱后只调整catalog参数，记录前后对比；价格/概率变更必须写明理由和模拟条件。最终输出绿色全测试与基线报告。

### Task 10：交叉评审与最终交付

**Files:** README.md、artifacts/verification/*、docs/balance/*；必要的修复所属原文件。

- [ ] 逐项核对设计第4–7节；不以测试通过替代缺失的功能和资源。
- [ ] 新上下文 reviewer 检查资产守恒、恢复/重复结算、战斗顺序、手机可用性、file模式和代码拆分；报告必须引用实际文件和复现路径。
- [ ] 重要问题先写可复现测试再修，跑完整suite；轻微视觉问题截图复核。
- [ ] 核对18个美术ID映射；交付时写清真实ready数量；补齐图片后最终复核两种屏幕尺寸与两种首领画面。
- [ ] README记录双击/HTTP运行方式、测试命令、存档迁移备份位置、玩法变化、全部资产来源/路径、已知限制。
- [ ] 最终交付包含：可运行代码；npm test、e2e、模拟输出；桌面/手机截图；变更说明；明确列出的未完成项。没做过的测试不写“通过”。

## 依赖与并行路线

```text
coding: Task1 → Task2 → Task3 → Task4 → Task5 → Task6 → Task7 → Task8 → Task9 → Task10
art:    camp风格锚点 → 另2场景+6肖像 → 7节点+2首领 → manifest/提示词/检查
                                              ↘ Task7资源接入 → Task10最终联调
```

同一个coding agent顺序实现最容易控制状态/接口一致性；不要求其额外开多个实现agent。Task7的基础布局与映射可以提前准备，但不要先写另一套领域逻辑。美术还没到不阻塞Task1–6；真实图片不能跳过最终视觉验收。

## 执行记录模板

每任务记录：改了什么；RED如何失败；GREEN命令和结果；与设计不同的决策及原因；剩余项。当前项目无Git时把记录保留在`docs/upgrade-b-progress.md`；如果已建Git则每任务可独立提交，不能删除用户未提交改动。
