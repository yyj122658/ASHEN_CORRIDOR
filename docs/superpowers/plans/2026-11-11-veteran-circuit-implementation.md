# 老兵远征与生命金属回路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可完整游玩的老兵回路版：角色可培养、构筑可调试、遭遇可重试、败退可保人，且不损坏现版与旧存档。

**Architecture:** 新入口veteran.html与Ashen.Veteran命名空间隔离新规则，复用已有纯RNG、场景和动画资产。领域逻辑用纯数据/确定性命令，先实现遭遇检查点和确认事务，再接身位、回路与养成。整个首版按依赖顺序完成，不以单个原型代替完整交付。

**Tech Stack:** 原生JS/CSS/Canvas/SVG；经典defer脚本；Node22+ node:test；既有Playwright测试工具。无新运行时框架/服务器依赖。

**Spec:** `../specs/2026-11-11-veteran-circuit-design.md`。美术接口：`../../art/2026-11-11-veteran-art-contract.md`。

## Global Constraints

- coding agent负责所有运行时代码、HTML/CSS/SVG、Canvas、测试和资源接入。
- 美术agent只产出assets/art/veteran-v1/，不并行改运行时代码。
- 新逻辑置于src/veteran/，命名空间Ashen.Veteran，旧index.html和旧玩法仍可运行。
- 新存档key=ashen_corridor_veteran_v1；不改写ashen_corridor_v1/v2，不强制迁移旧远征。
- 回转不限次、同一敌人/初始RNG；奖励和长期养成只能在确认后提交。
- 永久死格、随机排异、永久野蛮烙印损伤、角色永久死亡不在首版。
- 格子、端口、线路、按钮、数值用真实代码绘制，不能烘焙进背景。
- 领域逻辑不依赖DOM/时钟/Math.random；动画不修改战斗结果。

## Review Focus

1. 同一战斗在全灭/获胜/重复点击/刷新后回转：HP、压力、RNG、nextId、收益、调谐都恢复，确认后不能再回转或重复领奖。
2. 一根行动造成多段伤害和多次低血触发：换位有界，队列仍是唯一4槽，状态归属跟人而非跟槽。
3. 分流/蓄能/受击能量形成反馈：不得复制能量、即时递归施法或通过自伤刷脉冲。
4. 营火把战利品装上身再撤退：本局新构件仍有风险归属，不得洗成安全带入资产。
5. 旧存档、资源缺失、file://与移动端：旧入口不被破坏，新版可操作、可退出，无需美术全部到位才可开发。

## 当前代码入口

现版源文件位于src/core、src/systems、src/ui，game.js已是说明。现有A.State.validate只接受schema2、cls与star；A.Storage硬编码v2；A.App加载即boot，不能在新入口直接加载旧app.js。现有队伍move没有职业硬限制；真正要新增的是线性身位效果与战斗中的原子换位。现有A.SpriteAnim按cls/enemyType识别，可通过显示适配对象复用，不能让skinId影响新战斗能力。

## 新文件与依赖

```text
veteran.html                        新入口；不载入旧app.js
styles/veteran.css                  仅新入口加载，复用现有tokens
src/veteran/
  data.js                          底盘、构件模板、武器、指令、调谐规则
  state.js                         默认档、ID、事务结果、一致性校验
  storage.js                       独立存档、导入导出和检查点验证
  roster.js                        招募、主手、战史、调谐
  circuit.js                       几何/旋转/端口图编译、能量路由
  tactics.js                       有限Gambit条件/目标/优先级解释
  positions.js                     swap/insert/援护/位置事务
  combat.js                        行动条、充能、伤害、预告、待确认报告
  expedition.js                    七层、节点、奖励、营火、收益归属
  encounter.js                     检查点、战前编辑、重试、确认、撤退
  art.js                           新资源ID映射和旧资源复用
  ui.js                            营地/工坊/战前/战斗/复盘/背包/战史
  view.js                          战场显示与换位插值，复用逐帧图集
  app.js                           唯一dispatch、循环、存档和恢复
tests/helpers/load-veteran.cjs
tests/unit/veteran-*.test.cjs
tests/e2e/veteran.spec.cjs
scripts/simulate-veteran.cjs
docs/verification/veteran-progress.md
```

加载顺序：旧catalog/random与纯State工具（不调用旧create）→新data/state/circuit/tactics/positions/roster/combat/expedition/encounter/storage→旧Art与atlas-data/SpriteAnim→新art/view/ui/app。系统函数调用相互依赖时在函数执行时取V模块，不在脚本顶层提前调用尚未加载模块。

## 公共契约

V=Ashen.Veteran。命令成功返回`{ok:true,state,events:Event[]}`，失败返回`{ok:false,state:原输入,events:[],error:{code,message}}`。不修改输入。Selectors也不泄漏可变状态引用。Event结构沿用type/actorId/targetId/amount/meta，view只消费事件。

```text
VeteranState:
  version:1, ruleset:'veteran', nextId, rngState
  gold, shards, roster:Unit[], team:[id|null,id|null,id|null,id|null]
  itemsById:Record<id,Part>, stash:id[], shop:Offer[]
  settings, bestDepth, unlockedDifficulties, logs, settlement|null
  run:Run|null
Unit:
  id,name,skinId,bodyPreset,stress,affliction|null
  weaponId:物品实例id, board:{placements:Placement[]}
  gambits:Rule[], logicSlots:2|3, history:{eligibleRunIds:string[],records:HistoryRecord[]}
Part:
  id,kind:'weapon'|'circuit',templateId,modId|null
  acquiredRunId:string|null,acquiredSeq:number
  attunements:Record<UnitId,{eligibleRunIds:string[],traitId:string|null}>
Placement: {itemId,x,y,rotation:0|1|2|3,mirrorY:boolean}
Rule: {id,enabled,conditions:[{type,value?}],target,action}
Run:
  id,difficulty,floor,completedFloors,completedNodeIds,stage,rngState
  party:[{uid,slot,hp,stress}],nodes,lockedNodeId|null
  startLoadouts:Record<UnitId,{weaponId,board,gambits}>
  bag:id[],pendingLoot:id[],provisionalBindings:[{unitId,itemId,placement}]
  fieldLayouts:Record<UnitId,Placement[]> # 全部临时摆放，引用不额外计所有权
  goldFound,shards,blessings,fieldInscribedUnitIds:string[],maxHpModifiers
  encounter:Encounter|null,battle:Battle|null
Encounter:
  id,enemyBlueprint,combatRngStart,checkpoint:CampaignSnapshot
  preparation:{formation:[id|null...],rules:Record<UnitId,Rule[]>}
  attemptNumber,confirmId|null,pendingResult|null
CampaignSnapshot:
  完整VeteranState的纯数据副本，但run.encounter=null、run.battle=null、stage='prebattle'
PendingResult:
  outcome:'win'|'loss'|'timeout',report,runDelta,rewardSpec:{gold,shards,drops:DropSpec[]}
BattleUnit:
  id,sourceUnitId,side,slot,skinId,enemyType,基础与当前属性
  hp,stress,affliction,alive,gauge,cds,buffs,shield,skipActions
  outputCharges:Record<terminalId,{tags:string[]}[]> # 最多4个1单位token
  capacitors:Record<itemId,{tags:string[]}[]>,splitCursor:Record<itemId,0|1>,pendingDamagePulse:0|2
  movementUsedRound,coverUsedRound,actionCount,stats
```

每个真实物品恰好有一处所有权（stash/weapon/board/bag/pending/merchant/provisional），snapshot/startLoadouts/fieldLayouts/历史引用不计第二份。provisional构件不同时记入bag或永久board；有fieldLayouts时它是本局有效板面，否则使用永久board。rewardSpec的DropSpec是未入账描述，没有物品ID，不进入registry；confirm才分配ID。checkpoint中带入旧临时绑定可存在，但不能再包含checkpoint。itemId本身就是placementId，因为同一物品只能放置一次；capacitor保存能量token及tags，不能仅保存数量；splitCursor保存奇数能量分流后的下一出口。

战斗尝试的HP/压力/状态/统计只写BattleUnit和pendingResult.runDelta，未确认前不提交长期roster/history或本局已得收益。confirm按runDelta一次写回run.party及相关角色状态；retreat则基于checkpoint状态和固定代价结算。满压力判定沿用静态负面/美德规则，但只在确认战斗或撤退时执行一次，不因review刷新重掷。

新入口从V.State.create开始，不自动搬旧档；主手由weapon实例templateId决定，skinId与旧cls只可在显示适配层相互映射。

---

### Task 1：独立入口、数据、状态与测试基线

**Files:** veteran.html、data.js、state.js、load-veteran.cjs、veteran-state.test.cjs。
**Interfaces:** V.State.create()/clone()/validate(st)；V.State.ok/fail/takeId；V.Data定义设计全部ID与参数。validate返回`{ok,errors:string[]}`。

- [ ] 保存当前源文件/测试基线，记录npm test结果，不修改现有游戏存档。已有未提交改动不得覆盖。
- [ ] RED：新档4人/4槽，全部底盘的基础线路合法；旧key不被触碰；重复角色/构件引用与超限数字被拒绝。
- [ ] 实现三底盘、五主手、六构件数据；四人自动可用，默认两条Gambit；初始仓库提供重炮和一套可换的蓄能片。取消新模式的星级、羁绊与随机白值成长。
- [ ] 默认队列塔盾/长矛/短刃/仪式杖；短刃shadowAdvance、盾ironCover、杖refractRetreat直接可用，不能全等随机掉落才出现核心机制。
- [ ] 新入口只载入需要的经典脚本，空壳显示“老兵回路版”，不启动旧A.App。
- [ ] GREEN：npm test；新入口http与file可开，旧index仍可开。任务完成记录到veteran-progress.md。

### Task 2：回路几何与编译

**Files:** circuit.js、veteran-circuit.test.cjs。
**Interfaces:** V.Circuit.preview(st,unitId,placements)->{ok,errors,occupied,load,graph,reachableOutputs}；compile同签名返回可序列化CompiledCircuit；V.Circuit.saveLoadout(st,unitId,placements)->Result。

- [ ] RED：基础straight(0,1)+elbow(2,1)接通main，占格5/load2；cap同位替换占格6/load3；三个底盘均通过。
- [ ] RED：三底盘上mirrored elbow(0,2)+straight(2,2)接通damage→main；splitter(0,0)+straight(2,0)/(2,2)同时接通clock→support/main；模板包围盒空格可与屏蔽格共存。
- [ ] RED：旋转四次或上下翻转两次恢复原ports/cells；先翻转后旋转顺序固定；邻接无匹配端口不导通；越界/重叠/屏蔽格/超负荷拒绝且输入不变；有向循环给出明确错误。
- [ ] 实现90度旋转与有向端口图，图节点使用placementId+portId；内部links与外部配对分开。编译结果含稳定拓扑序，不读RNG。
- [ ] GREEN：npm test；至少两种有效线路fixture，UI预览与真实保存使用同一校验器。

### Task 3：能量路由与有限行为规则

**Files:** circuit.js、tactics.js、veteran-energy.test.cjs、veteran-tactics.test.cjs。
**Interfaces:** V.Circuit.route(compiled,runtime,inputs,context)->{runtime,events}；V.Tactics.evaluate(context,rules)->{action,targetIds,outputId,cost,reasons}；V.Tactics.validate(rules,logicSlots)->{ok,errors}。

- [ ] RED：splitter输入2只能输出1+1；cap两次2蓄成4才发出；储能上限4；gate关闭丢弃本次能量；ember/surge各动作触发一次。
- [ ] RED：实际HP受伤触发一次pendingDamagePulse；护盾、自伤、DOT不刷脉冲；跳过的眩晕行动不产生clock、不消耗待处理damage。
- [ ] RED：非法指令/超槽/未知操作拒绝；第一条缺能量或位置不合法应解释并继续下一条；都不可用时基本攻击。
- [ ] 实现有限条件+目标解析，不用eval；每次有效行动clock→damage→蓄能路由→可用性解释→选一条动作。surge动作成本4且倍率2、压力3；不会在路由阶段直接施法。
- [ ] GREEN：npm test；同输入运行结果相同，路径追踪只产数据不依赖图像。

### Task 4：线性身位与有界换位

**Files:** positions.js、veteran-positions.test.cjs。
**Interfaces:** V.Positions.swap(units,a,b)/insertFront(units,unitId)->{ok,units,event?,reason?}；resolveAfterAction(battle,rootAction)->{battle,events}。units为固定4槽或等价带唯一slot集合，不能压缩空位。

- [ ] RED：insertFront第三人使旧0/1分别移到1/2，其余不动；swap只交换两位；空位保留；anchored不移动；无第五人和重复slot。
- [ ] RED：两人同时低血且有ironCover时只选一个候选；位置改变不再触发位置改变；同角色每回合至多一次对应触发；多段技能结束前不移动。
- [ ] RED：带shadowAdvance的短刃在slot2主手不可用时仍能普攻→前移，下次行动在slot0释放主手；不能要求先在后排使用只允许前排的技能才可移动。
- [ ] 实现三mod及根行动边界。buff、能量与统计按单位ID持有，不因slot交换转移给另一人。
- [ ] GREEN：npm test；用固定队列输出可读位置变更日志，动画尚未接入也能验证结果。

### Task 5：新战斗引擎与待确认结果

**Files:** combat.js、veteran-combat.test.cjs。
**Interfaces:** V.Combat.generateEncounter(st,kind)->{state,enemyBlueprint,combatRngStart}，只在首次open调用；V.Combat.create(st,enemyBlueprint,rngStart)/step(st)->Result；report(st)->只读报告，不能提交奖励。V.Combat.prepareResult(st)->PendingResult，结果仅写encounter.pendingResult。

- [ ] RED：主手按五种位置/能量规则执行；身体/skin不限制武器；guard/盾/DOT/治疗保持上限和有效治疗统计。
- [ ] RED：同tick稳定排序、行动后换位影响后续目标；死者不行动；首领预告/半血阶段只发生一次；timeout进入review而不直接清档。
- [ ] 使用现有伤害/行动条公式的纯算法，移除cls/star/jobSynergy的能力来源。旧敌人模板可转enemyBlueprint，但main输出/新Gambit不走旧scoreSkill。
- [ ] 添加三个固定遭遇fixture：普通骨兵、石傀扰位+骨兵、首领。扰位石傀每第三次行动把我方最后一名存活单位insertFront，遵守anchored规则，作为位置构筑的反制检验。
- [ ] RED：战斗胜负后state.gold/stash/history不增加，所有DropSpec未分配物品ID；图形/倍速不改变结果。
- [ ] GREEN：npm test；无DOM跑完整战斗，不以既有模拟胜率作为新版平衡证据。

### Task 6：遭遇检查点、重试与唯一确认

**Files:** encounter.js、veteran-rewind.test.cjs。
**Interfaces:** V.Encounter.open(st,nodeId)；editPreparation(st,patch)；startAttempt(st)；rewind(st)；confirm(st)；retreat(st,mode:'emergency'|'defeat')均Result。

- [ ] RED：固定敌人、RNG和完整checkpoint；连按open不重生成；快照中不存在自嵌套encounter。
- [ ] open先生成encounterId/敌人蓝图并推进一次RNG，再锁定nodeId，最后建立已推进RNG的checkpoint；startAttempt只应用preparation并从combatRngStart建战斗，禁止重复调用generateEncounter。
- [ ] RED：尝试中改变HP/压力/能量/背包/nextId后rewind完全恢复；同整备重打哈希相同；可保留上次formation/rules供编辑；attemptNumber增加但不推进养成。
- [ ] RED：胜利/全灭/timeout均可回转；确认后禁回转；确认双击不重复ID、掉落、战史、调谐和层数；未处理loot不能进下一层。
- [ ] 保存checkpoint后不允许在prebattle换队员、拆回路或回地图换节点。editPreparation只允许锁定四人的排列和合法Gambit；失败不改快照。
- [ ] 阶段固定map→prebattle→battle→battleReview→loot；confirm胜利提交runDelta/rewardSpec，再处理loot；失败review选择defeat才丢本局收益回营。
- [ ] GREEN：npm test；回转清空客户端动画/事件游标，在Task10接真实UI。

### Task 7：七层探索、营火烙印与风险归属

**Files:** expedition.js、veteran-expedition.test.cjs、veteran-ownership.test.cjs。
**Interfaces:** V.Expedition.start(st,opts)/chooseNode(st,id)/chooseEvent(st,choiceId)/chooseBlessing(st,id)/buy(st,offerId)/resolveLoot(st,id,decision)/inscribe(st,unitId,itemId,proposedPlacements)/finishNode(st)/extract(st)->Result；previewRetreat(st,mode)->LossPreview。chooseNode遇到战斗节点委托Encounter.open；非战斗节点由Expedition处理。最后一件loot处理后finishNode一次记录完成层，再进入祝福或下一层；第7层完成才自动正常撤离。

- [ ] RED：背包按cells数量累计≤24；主手占4；满包不吞件；0完成层正常返回无收益。
- [ ] RED：烙印未确认不扣HP/压力；确认后本局maxHp×0.8且当前HP等比，压力40，每角色每局一次；可重排旧件并添加一个新件，但原件集合不能减少，新增件必须本局所得。
- [ ] RED：默认线路加入ember后按spec三个底盘fixture均可接通并获得有效ember输出；fieldLayouts与provisional归属一致，不修改永久board。
- [ ] RED：临时绑定仍计风险池；紧急撤退按acquiredSeq保留ceil一半，所有原带入构件均保留；先恢复startLoadouts，保留下的新件进仓，不残留临时绑定。
- [ ] RED：全灭败退新收获全失，带入资产不损失，压力入场+20；紧急撤退入场+10；掉落不能通过烙印转成安全永久资产。
- [ ] RED：普通撤离/第7层通关各测一次完整事务：fieldLayouts固化、provisional新件转永久board、bag入仓、货币入账、本局maxHp修正清除、已确认压力保留、战史调谐仅计一次、run=null；刷新或重复调用不再提交。
- [ ] 沿用层数/祝福/首领节奏，所有节点与营火选择原子执行。危险节点不能因回转换掉；normal extract只允许map阶段。
- [ ] GREEN：npm test；构件唯一归属、临时/永久归属与registry清理一致。

### Task 8：招募、战史与一阶调谐

**Files:** roster.js、veteran-progression.test.cjs。
**Interfaces:** V.Roster.recruit(st,offerId)/equipWeapon(st,unitId,itemId)/setGambits(st,unitId,rules)->Result；recordExtraction(st,settlement)->Result；history(st,unitId)->HistoryView。

- [ ] RED：浅层/紧急/败退不计合格撤离；同runId不重复；两次合格解锁第三规则槽；三次主手人装关系解锁一次指定机制。
- [ ] RED：转移主手不删除旧主记录；当前使用者未达条件不借用旧主能力；回转期间尝试统计不进入永久history。
- [ ] 实现数据化战史与调谐，正常成长提供更多决策能力，不追加星级/羁绊/永久攻击倍率。拆回路在营地可逆，无死格代价。
- [ ] 招募先保留金币成本55–80可配置区间，底盘报价固定、随机仅外观/名称或预设选择，不产生不可用板。具体成本在Task12记录校准。
- [ ] GREEN：npm test；用户可看到为何没获得合格撤离/调谐进度。

### Task 9：新存档与回转边界恢复

**Files:** storage.js、veteran-storage.test.cjs。
**Interfaces:** V.Storage.encode/decode/load/save/import/export；schema只接受明确ruleset，decode完整validate后才替换。

- [ ] RED：prebattle/battle/review/loot/camp分别roundtrip；重启后可继续或回转；已确认结果不重新领奖。
- [ ] RED：伪造嵌套checkpoint、重复归属、越界grid/ports/能量/指令、敌人蓝图变化拒绝且旧有效档不变；只操作独立key。
- [ ] snapshot大小有界、只有一层，序列化无函数/DOM；已确认后彻底删除旧checkpoint。先存最近有效备份，写满时提示可导出。
- [ ] 恢复先停标题/继续，图像或UI事件不消耗RNG。合格进度与provisional字段持久化完整。
- [ ] GREEN：npm test；旧版测试与新版测试均应绿；旧v2仍能由旧index读写自己的key。

### Task 10：工坊、战前、回转和战史UI

**Files:** ui.js、app.js、styles/veteran.css、veteran.html、veteran.spec.cjs。
**Interfaces:** V.App.dispatch(command)唯一入口；V.UI.render(state,uiState)，V.UI.workshop(state,unitId)；运行时只有一个tick与一个RAF，new UI不载旧A.App。

- [ ] 先实现完整操作：底盘选择、点击放置/旋转/删除/撤销/保存、线路解释、Gambit编辑、四位次、固定遭遇重试、结果确认、紧急撤退、战利品、战史/调谐。
- [ ] UI不先扣资源，所有点击经领域命令；模态框、危险代价与确认显示实际LossPreview；战斗开始后才启动计时器。
- [ ] RED→GREEN浏览器：失败→重新整备→换位/改指令→胜利→确认→只领奖一次；失败可退出；归营老兵资产仍在；营火烙印后重试不会消除营火代价。
- [ ] 回路失败原因显示具体格/端口/负荷；没释放技能显示缺能量/位置/目标，不输出笼统“条件不满足”。
- [ ] file://不fetch JSON启动；可提供预生成Data脚本或静态映射。360/390/768/1440无页面横向溢出，点击和键盘可完成工坊；游戏外壳不依赖拖拽。
- [ ] npm test、npm run test:e2e及node tests/e2e/veteran.spec.cjs全部执行，记录真实结果。

### Task 11：美术与现有动画接入

**Files:** art.js、view.js、ui.js；可对旧sprite-anim添加向后兼容skin识别，旧测试必须保留。
**Interfaces:** V.Art.get(id)/preload(ids)/image(id)，按art-contract稳定路径消费。V.View.frame(state,dt)/reset()/consume(events)。

- [ ] 新八图用于工坊/营火/战史/底材/收藏品缩略；实际polyomino cells、端口、连线全部SVG/HTML绘制。
- [ ] 复用v1走廊/首领/肖像和battle-v1两角色动画；skinId仅决定显示，武器能力来自新规则；骨兵按enemyType。未有对应动画时程序绘制降级，不假称全套新动画已完成。
- [ ] slot变化只做显示插值，不延迟领域逻辑；按单位ID维护动画和脚底锚点；回转reset视觉缓存和事件游标，不重播死亡/旧伤害。
- [ ] 回转按钮、危险代价、工坊保存等操作始终真实HTML。全部美术失败时仍能完成新模式流程。
- [ ] 截图1440×900、390×844、板面非法提示、战前整备、换位、全灭review；真实图片ready之前不标美术联调完成。

### Task 12：模拟、试玩与最终交接

**Files:** simulate-veteran.cjs、veteran-balance.test.cjs、docs/verification/veteran-results.md、README.md。

- [ ] 固定seed1–100，对三遭遇测试至少两种队列、直供/蓄能、默认/定制指令。报告结果和条件，不宣称固定某阵容必胜。
- [ ] 跑七层端到端，覆盖正常撤离、紧急、确认败退、野蛮烙印收益归属和一阶调谐。捕获任一非法状态立即失败，不能靠重试忽略。
- [ ] 进行小规模人工试玩：玩家能否预测一次换位、解释一处未出手、在重试中做出有效调整；记录实际整备/战斗/远征时长与撤退理由。
- [ ] 检查重试是否只重复碰运气；相同策略确定性必须成立，但新策略可以改变出手顺序。调整数据时记录前后证据。
- [ ] 新上下文reviewer复核五项Review Focus；重要缺陷补RED→GREEN后跑全测试。没有Git时保留执行记录，不虚构提交。
- [ ] 交付新入口与旧入口、所有测试结果、真实截图、未完成项和独立存档说明。待用户试玩后再讨论默认入口切换及旧角色迁移。

## 并行边界与开工提示

coding agent按Task1–12顺序实施，美术agent同步制作8张图。Task1–10无需等待图片；Task11按固定ID接入。美术和动画源文件不由coding agent重新生成/覆盖；可在独立派生目录做资源压缩并保持原件。

可直接给coding agent：按本plan与spec实现独立可玩的老兵回路版；保留旧index和v2存档，切勿把用户完整版里的永久死格/随机排异偷偷加回；先完成回转与确认事务，再完成构筑和探索；图片按新art-contract固定路径接入；全部阶段结束后提供测试、截图和明确未完成项。
