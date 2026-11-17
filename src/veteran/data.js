'use strict';
/* 老兵回路版静态数据。只放纯数据与纯查表，不读 DOM / 时钟 / Math.random。
   设计基线：docs/superpowers/specs/2026-11-11-veteran-circuit-design.md */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  /* ------------------------------ 全局参数 ------------------------------ */
  const DESIGN = {
    /* 金属形态只影响装配条件，不再附赠职业面板。 */
    /* v4.0：攻/防/血锚点已废除。裸装心核基座写在 derive.js 的 CHASSIS 里，
       所有增量由 circuit.compile 按纹路拓扑产出 —— 这里不再有第二份面板。 */
    /* 负荷上限 = 板面格数 × 系数，但**两套板面两个系数**，别合并：
       - 经典 4×4 夹具（14 格，只给老存档与单测用）沿用 0.57 → 8 点；
       - 异形板面（77 格，真游戏）用 0.26 → 20 点。

       为什么异形板面反而更紧：0.57 那条是从「14 格配 8 点」反推出来的每格密度，
       直接套到 77 格上会得到 44 点——而装满 4 门功法加纹路只要 18~22 点，
       于是「超载转裂纹」在正常局内永远触发不了，负荷系统整条空转。
       压到 20 点之后，装第二门重功法就要开始算账，§6.4 的过用则裂才有机会发生。

       为什么夹具不跟着改：14 格 × 0.26 只有 4 点，老测试与老存档会成片崩。
       夹具是测量用的尺子，不是玩法；尺子跟着玩法变，就没法比较了。 */
    capPerCell: 0.57,
    /* 六标：蚀刻法从 2~14 格扩到 6~54 格，0.26（77 格 → 20 点）就再也压不满一门大卷了 ——
       骨架占了大半块板，纹路却只买得起 20 点，覆盖永远卡在三成。
       0.72 → 77 格 = 55 点，正好是「满配有效占格 ~55」的量级。 */
    generatedCapPerCell: 0.72,
    /* 超载转裂纹：每超 1 点负荷，开局压力 +8、自然回裕 -0.04/s。
       压力在 heatThreshold 之上算「高热」——超载扣的那一段回裕不再扣，
       金属被自己的热顶开了，维持纹路的那点阻力反而抵掉了。
       **但压力本身的 0.85 / 0.65 乘算照旧，裂的抛光惩罚也照旧**：
       免的只是超载那一笔，不是高压的代价（高压仍然是走钢丝，不是红利）。 */
    overload: { stressPerPoint: 8, regenPerPoint: 0.04, heatThreshold: 50 },
    /* 同时维持的功法数。超过 4 门，方向律与深度律会互相拉扯（正交抵消、斜交制约深度），
       装得下也刻不深，等于自废。硬上限只是把这个自然结论写死。 */
    manuscriptSlots: 4,
    gridSize: 4,
    /* 时间轴：一步 0.24s，战斗按秒推进 */
    stepSeconds: 0.24,
    /* v4.0：一次普攻 = 一次完整脉冲（1.1 倍幅值）。
       0.55 是旧世界（140 完整度 + 敌人 0.13 伤害缩放）的产物 —— 那时候敌人
       几乎打不动人，普攻砍半也无所谓。现在两边同量级，普攻还砍半就等于
       玩家天生比敌人少一半输出，3 打 2 必输。 */
    /* v4.0 五标：1.10s 一跳。0.5 的时候四人齐射能压到 16:1（我方 11.8 跳/s 对敌方 0.53），
       读不出来也打不出取舍。拉到 1.10 之后，单人对敌人是 3.8:1（enemyPace 不变），
       整队约 5:1 —— 这是「看得清楚」和「还有压力」的交点。 */
    /* 七标：敌我行动比重新对齐。3.8 的节点脉动（4.18s）配 1.10s 的四人小队，
       前中期的有效出手比落在 10:1 以上，敌人整场只挥得动两三下 ——
       于是「外围熔断」「打断重铸」这些**靠敌人重击才成立**的机制永远见不到。
       2.4 → 单节点 2.64s 一跳，整队比收敛到 ~6:1：还在四打一，但压力是可读的。 */
    autoAttack: { interval: 1.1, mult: 0.75 },
    /* 七标：起手余裕从「半满」砍到「四分之一」。半满意味着开场就能连放两招，
       招式永远轮不到「差一点」的窘境，枯竭停机因此从未发生。
       1/4 起手（满配约 4~5 点）刚好够第一手，第二手必须等回裕 —— 资源张力从这里开始。 */
    /* 招式能耗附加：所有主动招式在结算时多扣 1 点余裕（skillCost 里加，最低仍是 1）。
       0.55/s 的回裕下，1 点 = 1.82s 的等待 —— 足够让「这一手交不交」变成真问题。
       只对我方生效：敌方是核心节点，没有余裕预算这回事。 */
    skillEnergySurcharge: 1,
        /* 八标：回裕 0.55 → 0.42/s。从 0 恢复到 1 点要 2.38s ≈ 10 tick，
       已经**超过** 6 tick 的停机阈值 —— 空转会真的把人带走，不再只是「超载与被抽」的故事。
       配合 1/5 起手（见 combat.js 的 buildAlly），高耗能招式必须算余裕。 */
    energyBase: { regen: 0.42, max: 20 },
    energyPerHit: 0,
    baseSpeed: 10,
    /* 蚀刻法稀有度直接抬角色面板：这是除乘算之外唯一的成长维度 */
    /* v4.0：阶位不再膨胀属性。「高阶层」只是刻得更深，不是天生更大。 */
    /* v4.0：补丁常数全部归零。敌人的血与伤直接写进 ENEMIES 的「核心节点量级」，
       不再乘一层神秘系数 —— 想调平衡就改那张表，别在这里加一个 0.13。 */
    enemyDamageScale: 1,
    enemyHpScale: 1,
    /* 节点脉动比人慢：敌方是「核心节点」，不是决斗者。
       它们单次脉冲和玩家同量级（atk 8~14 对 10），但充能要更久，
       否则三个人齐射会在第一个回合把 2 人小队打穿（实测 4 回合减员 1 人）。
       这是节奏参数，不是伤害补丁 —— 改伤害请改 ENEMIES 的 atk。
       七标：3.8 → 2.4。3.8 是 4v1 时代的数；现在四人小队 + 深层的 3~4 名编队，
       再按 3.8 走会让敌人整场只挥两下，熔断与打断都成了摆设。 */
    /* 八标：节点脉动改成「浅层慢、深层快」的插值。
       全局压到 1.40 会让第 1~2 章（两人小队 + 1 阶骨架）直接不可通关；
       而全局留在 2.40 又会让 F36/F49 的敌人整场只挥两三下。
       从第 7 层的 2.40 线性收到第 49 层的 enemyPace —— 两头都成立。 */
    enemyPaceShallow: 2.40,
    enemyPace: 1.40,
    baseHit: 0.94,
    baseCrit: 0.10,
    baseDodge: 0.05,
    gaugeThreshold: 60,
    ticksPerRound: 6,
    bagCapacity: 24,
    weaponCells: 4,
    energyPulse: 2,
    chargeCap: 4,
    outputCap: 4,
    surgeSize: 4,
    surgeMult: 2,
    surgeStress: 3,
    supportShieldPct: 0.12,
    supportShieldCapPct: 0.30,
    guardReduce: 0.80,
    maxFloor: 49,
    blessingFloors: [2, 4, 6, 14, 21, 28, 35, 42],
    logicSlots: 2,
    logicSlotsMax: 3,
    logicUnlockExtracts: 2,
    attuneRuns: 3,
    fieldInscribe: { maxHpMult: 0.8, stress: 40 },
    /* 满压临界（过用则裂）。压力顶到 100 的那一刻，金属要做一次决断——一人一场只掷一次。
       大概率它裂：纹理方向律反转，原本「越紧绷越利」的那条纹，转头去撕它自己。
       满压的 ×1.25 在裂的人身上是 damageMult，回裕还要再乘 polishMult，受到的伤害另乘 takenMult。
       小概率它砺：不声张，压力自己卸掉一半，抛光反而更顺。砺不留记录。
       80 档仍是纯增益，所以最优打法是「顶到 99 不要到 100」——满压不是增益，是悬崖。 */
    resolve: {
      whetChance: 0.25,
      crack: { damageMult: 0.85, takenMult: 1.25, polishMult: 0.70 },
      whet: { stress: 50, polishMult: 1.20 },
    },
    emergency: { stress: 10, keepRatio: 0.5 },
    defeat: { stress: 20 },
    /* 异常 / 连携的一批常量。四种异常的结算逻辑在 combat.js 的 DOT 段，
       这里只放数字，改数值不用动代码。 */
    detonate: { mult: 1.25 },                          /* 引爆剩余总伤 ×1.25 */
    corrode: { defPerStack: 0.04, defCap: 0.4, stressMult: 1.3 }, /* 每层降防 4%（上限 40%），压力 +30% */
    /* afterTag 的接续窗口。5 秒是按余裕推出来的：基础回裕 1.0~1.6/s、第二招 4~12 点，
       攒够一手要 3~8 秒，窗口比这短就等于「永远差一点」。
       队友的窗口更短（3.5s）：跨角色接力要更讲究时机，不然一个队四个人永远互相续着。 */
    comboWindow: 5,
    comboWindowAlly: 3.5,
    recruitCost: { min: 55, max: 80 },
    /* v4.0：成长曲线按「绝对层数 / 6」摊。旧值（0.15 / 0.09）是给 140 完整度 + 0.13 伤害补丁
       的时代定的 —— 现在敌人数值直接生效，第 28 层的首领会抬到 atk 28 / hp 300，而玩家的
       面板只随装配涨，两边脱节。压到 0.06 / 0.035：最深一层血 ×1.48、幅值 ×1.28。

       七标：atkPerFloor 0.035 → 0.075。0.035 让 F49 的攻击只涨 28%，
       而玩家的板面在同一段里能翻一倍 —— 后半场因此一路 100% 通关。
       0.075 让 F49 的幅值到 ×1.60，与 ENEMIES 里整体上调的 30% 叠起来
       约 ×2.08：深层敌人的一下重击终于够得着熔断阈值。
       hpPerFloor 保持 0.06：完整度的成长不是问题（战斗早已够长），
       让它跟着攻击一起涨只会把回合数推到超时。 */
    /* 八标：逐层成长也分浅层 / 深层两档（第 7 层用 shallow，第 49 层用深层值，中间线性）。
       只把深层曲线拉陡会让第 2~3 章（2~3 人小队、1~2 阶骨架）变成数值墙；
       两档插值之后，浅层保持七标手感，深层才是重标后的压强。 */
    scaling: {
      hpPerFloor: 0.38, atkPerFloor: 0.14,
      hpPerFloorShallow: 0.10, atkPerFloorShallow: 0.075,
      defPerFloor: 0.02, minionHpMult: 0.72, bossMinionHpMult: 0.28,
    },
    floorRecovery: 0.12,
  };

  /* ------------------------------ 底盘（生命金属形态） ------------------------------ */
  /* 14 种形态，共 77 格。blocked 只服务经典 4×4 夹具（老存档与单测）。
     profile 是面板的分配权重（四项和 = 1），不再写死 hp/atk/def/spd——
     数值由 V.Derive 从 profile 派生，见 derive.js。
     保留 sturdy / agile / conduit 三个旧 id，老存档按同名回落到新形态。 */
  const BODIES = {
    sturdy: {
      id: 'sturdy', name: '厚铸躯壳', archetype: 'full',
      profile: { hp: 0.44, atk: 0.20, def: 0.26, spd: 0.10 },
      blocked: [[2, 3], [3, 3]],
      desc: '最大的一块铁。皮层厚、重心低，出手慢半拍。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'sturdy', name: '无相包容', desc: '板面负荷上限 +35%：母板更厚，压得住更多纹路。' },
    },
    agile: {
      id: 'agile', name: '轻量骨架', archetype: 'bar',
      profile: { hp: 0.30, atk: 0.24, def: 0.12, spd: 0.34 },
      blocked: [[0, 0], [2, 3]],
      desc: '窄长的梁。护不住，但每一下都比别人来得早。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'agile', name: '一往无前', desc: '板面每空出 10% 的格，输出脉冲幅值 +8%（最多 +40%）。' },
    },
    conduit: {
      id: 'conduit', name: '导流腔体', archetype: 'square',
      profile: { hp: 0.40, atk: 0.24, def: 0.18, spd: 0.18 },
      blocked: [[0, 0], [3, 3]],
      desc: '方整的坯。四项都不吃亏，也都不出挑。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'conduit', name: '虚室生白', desc: '每装配 1 门 1–2 阶浅层蚀刻法，全招式余裕消耗 −1（最低 1）；但所有蚀刻法最高只按共鸣二阶结算。' },
    },
    throat: {
      id: 'throat', name: '空腔喉管', archetype: 'ring',
      profile: { hp: 0.38, atk: 0.22, def: 0.16, spd: 0.24 },
      blocked: [[0, 0], [3, 3]],
      desc: '中间是空的。纹路只能绕着腔壁走，越绕越顺。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'throat', name: '周流回环', desc: '每形成一个闭合环路，脉冲幅值 +10%（上限 +60%）。' },
    },
    corner: {
      id: 'corner', name: '折角板', archetype: 'ell',
      profile: { hp: 0.42, atk: 0.22, def: 0.22, spd: 0.14 },
      blocked: [[0, 0], [3, 3]],
      desc: '缺一角。直角那一侧特别吃得住，缺的那边要拿纹路补。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'corner', name: '三隅稳固', desc: '每次 90° 转折的脉冲增益翻倍（每次 +24%），且每次转向补充电容缓冲。' },
    },
    aegis: {
      id: 'aegis', name: '覆盾', archetype: 'shield',
      profile: { hp: 0.46, atk: 0.18, def: 0.26, spd: 0.10 },
      blocked: [[0, 0], [3, 3]],
      desc: '上宽下收。正面最厚，两侧薄得能看见光。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'aegis', name: '正面如壁', desc: '位于队伍 1 号位时，自身获得护盾量 +25%，且防御减伤时反弹 35% 减免伤害。' },
    },
    waist: {
      id: 'waist', name: '两截', archetype: 'hourglass',
      profile: { hp: 0.32, atk: 0.26, def: 0.16, spd: 0.26 },
      blocked: [[0, 0], [3, 3]],
      desc: '中间掐断。两端各有一片开阔地，连接处只有两三格。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'waist', name: '两极共振', desc: '压力 ≥50 时脉冲幅值 ×1.45；单次受到超过生命上限 15% 的伤害额外 +5 压力。' },
    },
    twin: {
      id: 'twin', name: '孪生', archetype: 'bilobe',
      profile: { hp: 0.38, atk: 0.26, def: 0.18, spd: 0.18 },
      blocked: [[0, 0], [3, 3]],
      desc: '两团金属长在一起。纹路可以从一边铺到另一边。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'twin', name: '双生主修', desc: '第 2 门蚀刻法（第一辅修）按 100% 主修乘算结算，且不同标签的招式之间可直接触发连携。' },
    },
    ratchet: {
      id: 'ratchet', name: '棘轮', archetype: 'gear',
      profile: { hp: 0.34, atk: 0.24, def: 0.24, spd: 0.18 },
      blocked: [[0, 0], [3, 3]],
      desc: '边缘一圈齿。齿尖放不下大纹路，却能把细纹咬得很死。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'ratchet', name: '齿咬碎纹', desc: '板上每铺设 1 件占格不超过 2 格的纹路，基础回裕 +0.08/s（上限 +0.48/s）。' },
    },
    arc: {
      id: 'arc', name: '弧月', archetype: 'crescent',
      profile: { hp: 0.36, atk: 0.22, def: 0.14, spd: 0.28 },
      blocked: [[0, 0], [3, 3]],
      desc: '弯的一条。中间薄、两头厚，长纹路只能顺着弯铺。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'arc', name: '孤弧锋锐', desc: '主修蚀刻法达到 100% 覆盖且贯通时，所有攻击与招式无视目标 25% 防御，且引爆异常伤害 +20%。' },
    },
    terrace: {
      id: 'terrace', name: '阶台', archetype: 'stair',
      profile: { hp: 0.40, atk: 0.24, def: 0.22, spd: 0.14 },
      blocked: [[0, 0], [3, 3]],
      desc: '一级一级错下去。三个高度各有各的落点。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'terrace', name: '累土递进', desc: '战斗每经过 1 个完整回合（6 步），全招式伤害与治疗叠加 +4%（上限 +32%）。' },
    },
    ripple: {
      id: 'ripple', name: '波纹带', archetype: 'zigzag',
      profile: { hp: 0.34, atk: 0.26, def: 0.14, spd: 0.26 },
      blocked: [[0, 0], [3, 3]],
      desc: '起伏的一条。顺着波峰能连成长线，横着切却处处错开。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'ripple', name: '曲径通幽', desc: '板上每铺设 1 件曲折纹路，闪避率 +3%（上限 +18%）、招式引导时间 −15%（最多 −60%）。' },
    },
    spine: {
      id: 'spine', name: '脊梁', archetype: 'spine',
      profile: { hp: 0.38, atk: 0.26, def: 0.20, spd: 0.16 },
      blocked: [[0, 0], [3, 3]],
      desc: '一条中轴加四对横肋。中轴最好用，横肋只够挂一件。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'spine', name: '中脊挂刺', desc: '主修蚀刻法每搭配 1 门 1 阶辅修蚀刻法，主修招式伤害 +14%（上限 +42%）。' },
    },
    crucible: {
      id: 'crucible', name: '十字枢', archetype: 'cross',
      profile: { hp: 0.34, atk: 0.26, def: 0.18, spd: 0.22 },
      blocked: [[0, 0], [3, 3]],
      desc: '四臂张开。四个方向都够得着，四角都是空的。',
      /* 相性：形状决定「怎么用」，不改面板（derive.js 一个字没动） */
      innate: { id: 'crucible', name: '四达并存', desc: '已贯通的横向与纵向同时存在时，分流系数由 0.65 提升到 1.0。' },
    },
  };

  /* ------------------------------ 主手 ------------------------------ */
  /* main.energy 为基准消耗；slot 特殊规则写在 rules 里 */
  const WEAPONS = {
    shortBlade: {
      id: 'shortBlade', name: '短刃', cells: DESIGN.weaponCells,
      main: {
        energy: 2, mult: 1.6, target: 'frontFoe', allowedSlots: [0],
        desc: '2 余裕，160% 单体。只有站在 1 号位才能出手，其余位置退回 100% 普通攻击。',
      },
      trait: { id: 'refund', name: '回手', desc: '每场战斗第一次普通攻击返还 1 点余裕。' },
      desc: '贴脸才狠。适合前排换位构筑。',
    },
    towerShield: {
      id: 'towerShield', name: '塔盾', cells: DESIGN.weaponCells,
      main: {
        energy: 2, mult: 1.0, target: 'frontFoe', skipTarget: true, slot0Reduce: 0.2,
        desc: '2 余裕，100% 盾击并跳过目标一次行动。站在 1 号位时自身减伤 20%，持续到下次行动。',
      },
      trait: { id: 'brace', name: '承伤', desc: '每场战斗第一次替身保护可挡一次贯穿。' },
      desc: '不打伤害，打节奏。',
    },
    longSpear: {
      id: 'longSpear', name: '长矛', cells: DESIGN.weaponCells,
      main: {
        energy: 2, mult: 1.2, target: 'frontFoe',
        slotTargets: { 0: 'frontFoe', 1: 'pierceFront2' },
        allowedSlots: [0, 1],
        desc: '2 余裕。1 号位 120% 正面单体；2 号位 120% 贯穿敌方前两位；3、4 号位不可用。',
      },
      trait: { id: 'refund', name: '回手', desc: '每场战斗第一次普通攻击返还 1 点余裕。' },
      desc: '站第二排也够得着。',
    },
    heavyCannon: {
      id: 'heavyCannon', name: '重炮', cells: DESIGN.weaponCells,
      main: {
        energy: 4, energyAtSlot3: 2, mult: 1.8, target: 'frontFoe',
        slot0SelfDamage: 0.1,
        desc: '4 余裕，180% 单体；站在 4 号位只要 2 余裕。1 号位开火自身损失当前生命上限 10%，不产生受击余裕。',
      },
      trait: { id: 'refund', name: '回手', desc: '每场战斗第一次普通攻击返还 1 点余裕。' },
      desc: '后排便宜，前排自伤。',
    },
    ritualStaff: {
      id: 'ritualStaff', name: '仪式杖', cells: DESIGN.weaponCells,
      main: {
        energy: 2, healMult: 1.7, fallbackMult: 1.2, target: 'lowestHpAlly',
        desc: '2 余裕，治疗生命比例最低的友军 = 170% 攻击；全员满血时改为 120% 法术单体。',
      },
      trait: { id: 'overflow', name: '溢流', desc: '每场战斗首次溢出治疗转为护盾，上限目标生命上限 10%。' },
      desc: '把人从死亡线拉回来。',
    },
  };

  const WEAPON_ORDER = ['shortBlade', 'towerShield', 'longSpear', 'heavyCannon', 'ritualStaff'];

  /* 「保护」行动已撤：护盾只由蚀刻法招式给，行动里不再有独立的护持。 */
  const GUARD = {
    energy: 0, reduce: DESIGN.guardReduce,
    desc: `不耗余裕，受到的下一次攻击减伤 ${Math.round(DESIGN.guardReduce * 100)}%（用掉即失效）。`,
  };

  /* ------------------------------ 纹路 ------------------------------ */
  /* cells 为占格；ports 相对格坐标，dir 为朝向；links 为内部有向连通（端口 id） */
  const TEMPLATES = {
    straight: {
      id: 'straight', name: '顺丝纹', legacyName: '直导管', load: 1, relicArt: 'veteran.relic.channel',
      cells: [[0, 0], [1, 0]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 0], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      boost: { regen: 0.10 },
      desc: '一缕亮丝横贯两格。1 负荷。同向覆盖压满时，共振余裕恢复 +0.10/s。',
    },
    elbow: {
      id: 'elbow', name: '曲折纹', legacyName: '弯管', load: 1, relicArt: 'veteran.relic.channel',
      cells: [[0, 0], [1, 0], [1, 1]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 1], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      boost: { regen: 0.04 },
      desc: '银线绕过方角，落在下一行。1 负荷。同向覆盖压满时，余裕恢复 +0.04/s。',
    },
    splitter: {
      id: 'splitter', name: '鹿角纹', legacyName: '棱镜分流', load: 2, relicArt: 'veteran.relic.splitter',
      /* 左上 (0,0) 是空的，不要按包围盒当占格 */
      cells: [[0, 1], [1, 1], [1, 0], [1, 2]],
      ports: [
        { id: 'in', cell: [0, 1], dir: 'W', role: 'in' },
        { id: 'outA', cell: [1, 0], dir: 'E', role: 'out' },
        { id: 'outB', cell: [1, 2], dir: 'E', role: 'out' },
      ],
      links: [['in', 'outA'], ['in', 'outB']],
      split: ['outA', 'outB'],
      boost: { regen: 0.06, skillCostCut: 1 },
      desc: '横生的短枝分为两角，脉动轮流传向两端。2 负荷。同向覆盖压满时，余裕恢复 +0.06/s，招式消耗 -1。',
    },
    capacitor: {
      id: 'capacitor', name: '同心纹', legacyName: '脉冲储能腔', load: 2, relicArt: 'veteran.relic.capacitor',
      cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 0], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      capacitor: true,
      boost: { regen: -0.20, skillMult: 0.25, shieldMult: 0.15 },
      desc: '层层圆纹在四格金属上蓄起脉动。2 负荷。同向覆盖压满时，招式伤害 +25%、护盾 +15%，余裕恢复 -0.20/s。',
    },
    threshold: {
      id: 'threshold', name: '闭鳞纹', legacyName: '阈值闸', load: 1, relicArt: 'veteran.relic.threshold',
      cells: [[0, 0], [1, 0]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 0], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      gate: { hpBelow: 0.5 },
      boost: { lowHpRegen: 0.50, shieldMult: 0.15 },
      desc: '相叠的鳞纹在生命低于 50% 时才张开。1 负荷。同向覆盖压满时，生命低于50%额外恢复余裕 +0.50/s、护盾 +15%。',
    },
    ember: {
      id: 'ember', name: '余烬纹', legacyName: '余烬导管', load: 2, relicArt: 'veteran.relic.channel',
      cells: [[0, 0], [1, 0]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 0], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      ember: true,
      boost: { attackMult: 0.10, ember: 1, dotMult: 0.10 },
      desc: '暗红细纹横过两格，末端留着余温。2 负荷。同向覆盖压满时，普通攻击伤害 +10%、命中附灼烧，灼烧伤害 +10%。',
    },
  };

  /* 每行先给金属格，再按入口、出口顺序给出边缘开口；同一家族沿用既有路由行为。 */
  function addRune(family, id, name, legacyName, motif, load, cells, inlet, outlets, boost, benefit) {
    const base = TEMPLATES[family];
    const ports = [inlet, ...outlets].map(([x, y, dir], i) => ({
      id: i === 0 ? 'in' : 'out' + i, role: i === 0 ? 'in' : 'out', cell: [x, y], dir,
    }));
    const outputs = ports.slice(1).map((p) => p.id);
    TEMPLATES[id] = {
      ...base, id, family, name, legacyName, load, cells, ports, boost,
      links: outputs.map((out) => ['in', out]),
      ...(base.split ? { split: outputs } : {}),
      desc: `${motif}${load} 负荷。同向覆盖压满时，${benefit}。`,
    };
  }

  addRune('straight', 'rivet', '粟点纹', '铆纹', '一粒粟金嵌在短纹正中。', 1, [[0, 0]], [0, 0, 'W'], [[0, 0, 'E']],
    { regen: 0.06 }, '余裕恢复 +0.06/s');
  addRune('straight', 'long', '牵丝纹', '牵丝长槽', '细丝连续穿过三格金属。', 1, [[0, 0], [1, 0], [2, 0]], [0, 0, 'W'], [[2, 0, 'E']],
    { regen: 0.18 }, '余裕恢复 +0.18/s');
  addRune('splitter', 'tee', '枝梢纹', '三通渠', '横纹中部垂下一梢，两梢轮流传递脉动。', 2, [[0, 0], [1, 0], [2, 0], [1, 1]], [0, 0, 'W'], [[2, 0, 'E'], [1, 1, 'S']],
    { regen: 0.12, max: 1 }, '余裕恢复 +0.12/s、上限 +1');
  addRune('splitter', 'cross', '十字星纹', '十字分水盘', '星芒交于一点，脉动依次传向三个末端。', 3, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], [0, 1, 'W'], [[1, 0, 'N'], [2, 1, 'E'], [1, 2, 'S']],
    { skillCostCut: 1, max: 3 }, '招式消耗 -1、余裕上限 +3');

  /* 折角纹从直导系挪到弯折系：它同一格给出「侧缘进、上缘出」，
     本来就是一次 90° 转折。留在直导系里等于让「堆转角」的流派白嫖攻速与闪避，
     A/B 两家永远分不开。 */
  addRune('elbow', 'jack', '折角纹', '单孔角接', '一格之内，细纹从侧缘折向上缘。', 1, [[0, 0]], [0, 0, 'W'], [[0, 0, 'N']],
    { max: 1 }, '余裕上限 +1');
  addRune('straight', 'rail', '长脊纹', '冷拉长轨', '一道脊纹直贯四格。', 2, [[0, 0], [1, 0], [2, 0], [3, 0]], [0, 0, 'W'], [[3, 0, 'E']],
    { regen: 0.26, max: 1, healMult: 0.18 }, '余裕恢复 +0.26/s、上限 +1、治疗 +18%');
  addRune('elbow', 'dogleg', '错节纹', '错台接头', '横纹在节处错开一格，再向前延伸。', 1, [[0, 0], [1, 0], [1, 1], [2, 1]], [0, 0, 'W'], [[2, 1, 'E']],
    { regen: 0.15 }, '余裕恢复 +0.15/s');
  addRune('elbow', 'hairpin', '回钩纹', '发夹弯', '长纹在末端折返，两端朝向同侧。', 2, [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1]], [0, 0, 'W'], [[1, 1, 'W']],
    { regen: 0.2, max: 2, healMult: 0.16 }, '余裕恢复 +0.20/s、上限 +2、治疗 +16%');
  addRune('elbow', 'kneejoint', '垂芒纹', '膝铰', '横纹末端垂下一枚尖芒。', 1, [[0, 0], [1, 0]], [0, 0, 'W'], [[1, 0, 'S']],
    { skillMult: 0.05 }, '招式伤害 +5%');
  addRune('elbow', 'crook', '鹤颈纹', '鹤颈接管', '长颈般的纵纹在末端侧转。', 2, [[0, 0], [0, 1], [0, 2], [1, 2]], [0, 0, 'N'], [[1, 2, 'E']],
    { skillMult: 0.12, max: 1, healMult: 0.20 }, '招式伤害 +12%、余裕上限 +1、治疗 +20%');
  addRune('splitter', 'clevis', '燕尾纹', '叉耳', '同一纹节生出上下两支，脉动交替流过。', 2, [[0, 0], [1, 0]], [0, 0, 'W'], [[1, 0, 'N'], [1, 0, 'S']],
    { regen: 0.09, max: 1 }, '余裕恢复 +0.09/s、上限 +1');
  addRune('splitter', 'spillway', '旁枝纹', '侧溢槽', '主纹向前延伸，侧枝向下，交替传递脉动。', 2, [[0, 0], [1, 0], [2, 0], [2, 1]], [0, 0, 'W'], [[2, 0, 'E'], [2, 1, 'S']],
    { attackMult: 0.08, regen: 0.06 }, '普通攻击伤害 +8%、余裕恢复 +0.06/s');
  addRune('splitter', 'wishbone', '双蕨纹', '双齿梳', '两片蕨芽从同一根脉向上伸展，轮流搏动。', 2, [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], [1, 1, 'S'], [[0, 0, 'N'], [2, 0, 'N']],
    { skillCostCut: 1, skillMult: 0.05 }, '招式消耗 -1、伤害 +5%');
  addRune('capacitor', 'bellowsCell', '叠浪纹', '风囊蓄室', '三格横纹层层叠起，蓄下经过的脉动。', 2, [[0, 0], [1, 0], [2, 0]], [0, 0, 'W'], [[2, 0, 'E']],
    { max: 3, skillMult: 0.12, healMult: 0.18 }, '余裕上限 +3、招式伤害 +12%、治疗 +18%');
  addRune('capacitor', 'coil', '螺旋纹', '蜗卷腔', '纹理在转角处卷成螺旋。', 2, [[0, 0], [1, 0], [1, 1]], [0, 0, 'N'], [[1, 1, 'S']],
    { max: 2, regen: 0.14 }, '余裕上限 +2、恢复 +0.14/s');
  addRune('capacitor', 'cistern', '层岩纹', '沉淀仓', '六格金属显出层岩般的沉积纹理。', 3, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], [0, 0, 'W'], [[2, 1, 'E']],
    { max: 5, skillMult: 0.28, regen: -0.12, shieldMult: 0.10 }, '余裕上限 +5、招式伤害 +28%、余裕恢复 -0.12/s、护盾 +10%');
  addRune('capacitor', 'ampoule', '水滴纹', '细颈胆', '下端舒展的横纹承住一滴脉光。', 2, [[1, 0], [0, 1], [1, 1], [2, 1]], [1, 0, 'N'], [[0, 1, 'W']],
    { skillCostCut: 1, max: 1, healMult: 0.18 }, '招式消耗 -1、余裕上限 +1、治疗 +18%');
  addRune('threshold', 'pinValve', '针芒纹', '针阀', '一线细芒贯穿单格，随低生命时的搏动亮起。', 1, [[0, 0]], [0, 0, 'N'], [[0, 0, 'S']],
    { lowHpRegen: 0.26 }, '生命低于50%时余裕恢复 +0.26/s');
  addRune('threshold', 'sluice', '折叶纹', '折叶闸', '叶脉沿折痕转向，低生命时舒展。', 2, [[0, 0], [1, 0], [1, 1]], [0, 0, 'W'], [[1, 1, 'S']],
    { lowHpRegen: 0.65, max: 1, shieldMult: 0.20 }, '生命低于50%时余裕恢复 +0.65/s、余裕上限 +1、护盾 +20%');
  addRune('threshold', 'reed', '芦叶纹', '簧片闸', '狭长叶纹挑起一端，低生命时显出亮色。', 1, [[0, 0], [1, 0], [2, 0]], [0, 0, 'W'], [[2, 0, 'N']],
    { lowHpRegen: 0.44, attackMult: 0.03 }, '生命低于50%时余裕恢复 +0.44/s、普通攻击伤害 +3%');
  addRune('ember', 'flint', '火星纹', '燧钉', '一格短纹转折处伏着一粒火星。', 2, [[0, 0]], [0, 0, 'W'], [[0, 0, 'S']],
    { attackMult: 0.04, ember: 1, dotMult: 0.08 }, '普通攻击伤害 +4%、命中附灼烧、灼烧伤害 +8%');
  addRune('ember', 'fuse', '游焰纹', '导火绳', '一线火色沿三格纹理游走。', 2, [[0, 0], [1, 0], [2, 0]], [0, 0, 'W'], [[2, 0, 'E']],
    { attackMult: 0.14, ember: 1, dotMult: 0.15 }, '普通攻击伤害 +14%、命中附灼烧、灼烧伤害 +15%');
  addRune('ember', 'brazier', '日轮纹', '三足火座', '日轮的四道光芒铺在五格金属上。', 3, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], [1, 2, 'S'], [[1, 0, 'N']],
    { attackMult: 0.18, skillMult: 0.08, ember: 1, dotMult: 0.12 }, '普通攻击伤害 +18%、招式伤害 +8%、命中附灼烧、灼烧伤害 +12%');
  addRune('ember', 'wickbend', '焰尾纹', '余焰回勾', '火纹侧伸，末端如焰尾向上挑起。', 2, [[0, 0], [0, 1], [1, 1], [2, 1]], [0, 0, 'W'], [[2, 1, 'N']],
    { attackMult: 0.07, regen: 0.1, ember: 1, dotMult: 0.10 }, '普通攻击伤害 +7%、余裕恢复 +0.10/s、命中附灼烧、灼烧伤害 +10%');

  const TEMPLATE_ORDER = Object.keys(TEMPLATES);

  /* ------------------------------ 底盘预设线路 ------------------------------ */
  /* 基础线：straight(0,1) + elbow(2,1) → clock→main，5 格 / load 2 */
  const PRESETS = {
    basic: {
      id: 'basic', name: '顺脉',
      /* templateId + 位置，装配时按需生成纹路实例 */
      layout: [
        { templateId: 'straight', x: 0, y: 1, rotation: 0, mirrorY: false },
        { templateId: 'elbow', x: 2, y: 1, rotation: 0, mirrorY: false },
      ],
      desc: '顺丝纹接上曲折纹，铺出一条通路。',
    },
    charge: {
      id: 'charge', name: '蓄脉',
      /* 用 capacitor 替换 (0,1) 的 straight，elbow 保持在 (2,1)。
         文档写“占格六、load3”，但 capacitor 模板为 4 格 / load2，
         与 elbow 组合后实际是 7 格 / load4；以模板表为准，已记录偏差。 */
      layout: [
        { templateId: 'capacitor', x: 0, y: 1, rotation: 0, mirrorY: false },
        { templateId: 'elbow', x: 2, y: 1, rotation: 0, mirrorY: false },
      ],
      desc: '以同心纹压住核心，曲折纹从旁引出。',
    },
  };

  /* 营火现场烙印用的 ember 模板放置位置：三底盘都合法 */
  const EMBER_FIXTURE = { templateId: 'ember', x: 0, y: 1, rotation: 0, mirrorY: false };
  /* 被替换下来的 straight 的停放位（不接通电也能提交，只要几何/负荷合法） */
  const STRAIGHT_PARK = {
    sturdy: { x: 0, y: 0 },
    agile: { x: 0, y: 2 },
    conduit: { x: 1, y: 0 },
  };

  /* ------------------------------ Gambit ------------------------------ */
  const CONDITIONS = [
    { id: 'always', name: '总是', needsValue: false },
    { id: 'selfHpBelow', name: '自身生命低于', needsValue: true },
    { id: 'allyHpBelow', name: '有队友生命低于', needsValue: true },
    { id: 'enemyCharging', name: '敌人正在引导', needsValue: false },
    { id: 'atSlot', name: '自身位于', needsValue: true },
  ];
  const THRESHOLDS = [25, 50, 75];
  const TARGETS = [
    { id: 'frontFoe', name: '正面敌人' },
    { id: 'lowestHpFoe', name: '最残敌人' },
    { id: 'lowestHpAlly', name: '最残队友' },
    { id: 'chargingFoe', name: '引导中的敌人' },
    { id: 'self', name: '自己' },
  ];
  const ACTIONS = [
    { id: 'main', name: '普通攻击' },
    { id: 'guard', name: '防御' },
  ];

  /* 默认只留一条攻击规则。防御是要玩家自己选的取舍：
     自动挂在「队友残血」上，会让全队一直举盾不还手。 */
  function defaultGambits() {
    return [
      {
        id: 'g1', enabled: true,
        conditions: [{ type: 'always' }],
        target: 'frontFoe', action: 'main',
      },
    ];
  }

  /* ------------------------------ 位置机制 ------------------------------ */
  const MODS = {
    shadowAdvance: {
      id: 'shadowAdvance', name: '影进',
      desc: '站在第三或第四位时，普通攻击造成伤害便插到最前。每回合至多一次。',
    },
    refractRetreat: {
      id: 'refractRetreat', name: '折光后撤',
      desc: '在第一位普通攻击造成伤害后与第二位互换，并留下可挡一次直击的残影，持续到本人下次出手。每回合至多一次。',
    },
    ironCover: {
      id: 'ironCover', name: '铁壁援护',
      desc: '一次敌方行动结束后，若紧邻前方友军存活且生命低于 30%，向前交换并转移其灼烧/流血。每回合至多一次。',
    },
  };

  /* ------------------------------ 敌人 ------------------------------ */
  /* 七标：基础 atk 整体 ×1.30。原来的 8~20 是「敌人几乎打不动人」时代的数，
     配上 3.8 的节点脉动，后半场敌人整场只挥两三下 —— 熔断保险丝从来没被点着过。
     上调之后单次脉冲（13~26）才够摸到「满配底盘 8% 完整度」的熔断线。 */
  const ENEMIES = {
    bone: {
      id: 'bone', name: '骸骨兵', enemyType: 'bone',
      hp: 69, atk: 13, def: 6, spd: 9, hits: 0.94,
      skills: [
        { id: 'slash', name: '锈刃', energy: 2, mult: 1.0, target: 'frontFoe' },
        { id: 'cleave', name: '横扫', energy: 3, mult: 0.75, target: 'allFoe', cd: 2 },
      ],
      desc: '最普通的游荡者。',
    },
    hound: {
      id: 'hound', name: '骨犬', enemyType: 'hound',
      hp: 56, atk: 16, def: 5, spd: 15, hits: 0.94,
      skills: [
        { id: 'bite', name: '撕咬', energy: 2, mult: 1.1, target: 'lowestHpFoe' },
        { id: 'howl', name: '嚎叫', energy: 2, mult: 0, target: 'allFoe', stress: 6, cd: 3 },
      ],
      desc: '快，专挑最残的咬。',
    },
    hulk: {
      id: 'hulk', name: '石傀', enemyType: 'hulk',
      hp: 106, atk: 14, def: 15, spd: 6, hits: 0.90,
      skills: [
        { id: 'slam', name: '抡砸', energy: 2, mult: 1.25, target: 'frontFoe' },
        { id: 'quake', name: '震地', energy: 3, mult: 0.7, target: 'allFoe', cd: 3 },
      ],
      desc: '慢、硬、会拆队列。',
    },
    shuffler: {
      id: 'shuffler', name: '扰位石傀', enemyType: 'shuffler',
      hp: 94, atk: 12, def: 12, spd: 7, hits: 0.92,
      skills: [
        { id: 'shove', name: '推挤', energy: 2, mult: 0.8, target: 'frontFoe' },
      ],
      disrupt: { everyActions: 3, effect: 'insertFrontLast' },
      desc: '每第三次行动把我方最后一名存活单位推到最前。',
    },
    wraith: {
      id: 'wraith', name: '幽魂', enemyType: 'wraith',
      hp: 62, atk: 17, def: 5, spd: 12, hits: 0.96,
      skills: [
        { id: 'drain', name: '汲取', energy: 2, mult: 1.0, target: 'frontFoe', lifesteal: 0.5 },
        { id: 'curse', name: '诅咒', energy: 3, mult: 0.6, target: 'allFoe', dot: { k: 'corrode', v: 4, hits: 2 }, cd: 3 },
      ],
      desc: '打它会回血。',
    },
    /* 亚种：同一副骨架，换一套打法。sprite 复用已有立绘，filter 让同形能分辨。 */
    boneBell: {
      id: 'boneBell', name: '鸣钟骨', enemyType: 'boneBell', sprite: 'bone',
      filter: 'hue-rotate(148deg) saturate(1.6) brightness(1.06)',
      hp: 75, atk: 10, def: 7, spd: 9, hits: 0.93,
      skills: [
        { id: 'toll', name: '敲钟', mult: 0.25, target: 'allFoe', blind: { v: 0.22, d: 2 }, stress: 3, cd: 3 },
        { id: 'chime', name: '碎铃', mult: 1.0, target: 'frontFoe' },
      ],
      desc: '钟声压住视线。它自己不打人，所以总能活到最后。',
    },
    houndLean: {
      id: 'houndLean', name: '瘦犬', enemyType: 'houndLean', sprite: 'hound',
      filter: 'sepia(0.55) hue-rotate(-12deg) brightness(0.9)',
      hp: 56, atk: 18, def: 5, spd: 17, hits: 0.95,
      skills: [
        { id: 'hamstring', name: '断筋', mult: 1.0, target: 'lowestHpFoe', dot: { k: 'bleed', v: 3, hits: 2 } },
        { id: 'leap', name: '扑背', mult: 1.15, target: 'backFoe' },
      ],
      desc: '绕过前排，专咬后排。',
    },
    hulkSlag: {
      id: 'hulkSlag', name: '炉渣傀', enemyType: 'hulkSlag', sprite: 'hulk',
      filter: 'sepia(0.6) hue-rotate(8deg) brightness(0.88)',
      hp: 100, atk: 13, def: 14, spd: 5, hits: 0.90,
      skills: [
        { id: 'crush', name: '压碎', mult: 1.3, pierce: 0.35, target: 'frontFoe' },
        { id: 'vent', name: '泄渣', mult: 0.5, target: 'allFoe', dot: { k: 'burn', v: 4, hits: 2 }, cd: 3 },
      ],
      onDeathBurst: { name: '崩壳', mult: 0.8, dot: { k: 'burn', v: 3, hits: 2 } },
      desc: '壳里全是热渣。别用一次爆发把它一起打死。',
    },
    wraithChoir: {
      id: 'wraithChoir', name: '唱喑', enemyType: 'wraithChoir', sprite: 'wraith',
      filter: 'hue-rotate(236deg) saturate(1.35) brightness(1.02)',
      hp: 81, atk: 12, def: 9, spd: 10, hits: 0.95,
      skills: [
        { id: 'dirge', name: '挽歌', mult: 0, healAllies: 0.16, cd: 4 },
        { id: 'wail', name: '悲鸣', mult: 0.55, target: 'allFoe', stress: 5, cd: 4 },
      ],
      desc: '它替别人续命。留着它，前面的仗永远不会结束。',
    },
    shufflerDragger: {
      id: 'shufflerDragger', name: '拖骸者', enemyType: 'shufflerDragger', sprite: 'shuffler',
      filter: 'sepia(0.4) hue-rotate(180deg) brightness(0.82)', elite: true,
      hp: 286, atk: 23, def: 18, spd: 13, hits: 0.93,
      skills: [
        { id: 'dragChain', name: '拖链', mult: 0.9, target: 'frontFoe', drainEnergy: 2, stripShield: true, pierce: 0.66 },
      ],
      disrupt: { everyActions: 2, effect: 'insertFrontLast' },
      desc: '不断把人从后排拖到最前，顺手抽走刚攒起来的余裕。',
      outerNodes: 2,
    },
    stoker: {
      id: 'stoker', name: '火工', enemyType: 'stoker', sprite: 'hulk',
      filter: 'sepia(0.75) saturate(1.7) hue-rotate(-16deg)', elite: true,
      hp: 308, atk: 25, def: 16, spd: 13, hits: 0.91,
      skills: [
        { id: 'blast', name: '鼓风', mult: 0.8, target: 'allFoe', telegraph: true, cd: 3, pierce: 0.66, dot: { k: 'burn', v: 5, hits: 2 } },
        { id: 'slagSpray', name: '泼渣', mult: 1.2, pierce: 0.66, target: 'frontFoe' },
      ],
      desc: '它先鼓风，再点火。中间那几秒是用来换位的。',
      outerNodes: 1,
    },
    gatekeeper: {
      id: 'gatekeeper', name: '守门人', enemyType: 'gatekeeper', boss: true,
      hp: 288, atk: 20, def: 26, spd: 10, hits: 0.94,
      skills: [
        { id: 'smash', name: '碎地', energy: 3, mult: 1.0, target: 'allFoe', cd: 3, telegraph: true, pierce: 0.30 },
        { id: 'guardBreak', name: '破阵', energy: 2, mult: 1.35, target: 'frontFoe', pierce: 0.30 },
      ],
      phaseAt: 0.5,
      phaseBuff: { name: '裂甲', atkMult: 1.25, spdAdd: 3 },
      phaseSkills: [{ id: 'gateClose', name: '合门', mult: 1.15, target: 'allFoe', telegraph: true, cd: 3 }],
      desc: '门后面的东西。大招会预告，第二阶段会关上门再砸一次。',
      outerNodes: 2,
      /* 七标 · 频次检验：**奖励高频直导（A），克制慢重炮（B）**。
         八标：5 层 / −90%。护膜只拦**够重**的脉冲（单发 >= minHit 20 点）：
         拦下时本体伤害 −90%，并且每次独立冲击只剥 1 层（单发再高也只剥 1 层，
         多段与 DOT 每跳各算一次）。B 的 60 点重炮被吃掉九成，A 的 10~16 点连刺原样穿过。
         小脉冲（A 的 10~16 点连刺）从膜缝里直接穿过去，不剥层、不减伤。
         为什么加 minHit 这一刀：4 层/回合 + 按次减免对「7.3 次/回合」与
         「6.7 次/回合」几乎是同一个数（实测两列相差不到 9%），
         真正把 A 和 B 分开的是**单发尺寸**（12 对 60）——
         所以护膜必须按尺寸筛，而不是按次数摊，否则这条对位是假咬合。 */
      membrane: { layers: 5, reduce: 0.90, minHit: 16, name: '相位护膜' },
    },
    memoryEater: {
      id: 'memoryEater', name: '噬忆者', enemyType: 'memoryEater', boss: true,
      hp: 259, atk: 24, def: 22, spd: 14, hits: 0.96,
      skills: [
        { id: 'devour', name: '吞忆', energy: 3, mult: 0.95, target: 'allFoe', stress: 8, cd: 3, telegraph: true, pierce: 0.40 },
        { id: 'reap', name: '收割', energy: 2, mult: 1.3, target: 'lowestHpFoe', pierce: 0.40 },
      ],
      phaseAt: 0.5,
      phaseBuff: { name: '饥饿', atkMult: 1.3, spdAdd: 2 },
      phaseSkills: [{ id: 'recall', name: '追忆', mult: 1.3, target: 'backFoe', lifesteal: 0.4, cd: 2 }],
      desc: '它记得你们每一个人。第二阶段开始专挑后排。',
      outerNodes: 2,
      /* 七标 · 稳态与压力检验：**奖励高温余烬（C），克制常规续航流**。
         八标：每次行动抽前排 2 人各 3 点余裕、全家 +10 压力。
         靠余裕循环维持招式的阵容会被一路抽到「枯竭停机」；
         C 流派的余烬把压力当燃料（每点压力 +0.5% 幅值），被抽反而变强。 */
      onAction: { drainEnergy: 5, drainTarget: 'front2', stressAll: 10, stripShield: true, name: '抽忆' },
    },
    furnaceHeart: {
      id: 'furnaceHeart', name: '炉心俑', enemyType: 'furnaceHeart', boss: true, sprite: 'hulk',
      hp: 259, atk: 29, def: 30, spd: 16, hits: 0.94,
      skills: [
        { id: 'furnacePulse', name: '炉脉', mult: 1.25, target: 'allFoe', dot: { k: 'burn', v: 5, hits: 2 }, cd: 2, pierce: 0.60 },
        /* 重铸：一局最多三次。8%+16% 每 4 秒是「时间站在它那边」，但没有上限时
           残局会被它拖到超时——这不是难，是打不动。改成 4%+10% / 6 秒 / 三次之后，
           它仍然是「越拖越难杀」的敌人，但残存一两人也收得掉。 */
        /* 重铸改成「按秒计的准备窗口」：0.72s（3 tick）里挨到 >=20 的脉冲就被打断，
           连带震碎刚结起来的护盾。高幅值蓄力的机制红利就在这里 —— 不是打得更疼，
           是让它打不出来。 */
        {
          id: 'reforge', name: '重铸', mult: 0, healSelf: 0.08, selfShield: 0.15, cd: 6, maxUses: 3,
          telegraph: true, castTime: 0.72, interruptAt: 20,
        },
      ],
      phaseAt: 0.55,
      phaseBuff: { name: '过载', atkMult: 1.28, spdAdd: 2 },
      phaseSkills: [{ id: 'overload', name: '过载喷发', mult: 1.5, target: 'allFoe', telegraph: true, cd: 4 }],
      desc: '烧了七层的炉子。它靠灼烧和自修把战斗拖长，时间站在它那边。',
      outerNodes: 2,
      /* 七标 · 破甲与打断检验：**奖励线圈重炮（B），克制高频刮痧（A）**。
         八标：阈值 18 / 衰减 55%。单发不到 18 点的脉冲在炉壁上再被砍掉一半多：A 的 10~16 点连刺掉到 5~9，
         对着 0.72s 的重铸窗口永远攒不出那一记打断（interruptAt 也是 20，同一条线）。
         单发 >= 20 点的高幅值重击不受衰减，并且**直接贯穿**重铸的读条 ——
         B 的储能放电一发就能把它按回去。
         thinAt 只是「典型薄脉冲」的量级注释，判定统一用 pierceAt。 */
      plating: { thinAt: 18, reduce: 0.72, pierceAt: 18, name: '炉壁重甲' },
    },
  };

  const ENEMY_ORDER = ['bone', 'hound', 'hulk', 'shuffler', 'wraith', 'boneBell', 'houndLean', 'hulkSlag', 'wraithChoir'];
  const ELITE_ORDER = ['shufflerDragger', 'stoker'];
  const BOSS_ORDER = ['gatekeeper', 'memoryEater', 'furnaceHeart'];

  /* ------------------------------ 层域与编成 ------------------------------ */
  /* 三个层域对应三种作战节奏：水道先教你「别只顾前排」，阶井教你「先拆结构」，
     底床同时考「续航」与「收尾」。signature 是这一域的招牌，编成里必定出现。 */
  const BIOMES = [
    {
      id: 'water', name: '余光水道', from: 1, to: 2,
      signature: 'hound', pool: ['hound', 'bone', 'houndLean', 'boneBell'],
      elites: ['shufflerDragger'],
      note: '快、碎、从背后咬。',
    },
    {
      id: 'spring', name: '硫泉阶井', from: 3, to: 4,
      signature: 'hulk', pool: ['hulk', 'shuffler', 'boneBell', 'houndLean'],
      elites: ['shufflerDragger'],
      note: '硬壳挡在前面，钟声压住命中。',
    },
    {
      id: 'furnace', name: '黑炉底床', from: 5, to: 7,
      signature: 'wraith', pool: ['wraith', 'hulkSlag', 'wraithChoir', 'houndLean'],
      elites: ['stoker', 'shufflerDragger'],
      note: '灼烧与续命，拖久了自己会输。',
    },
  ];

  function biome(floor) {
    return BIOMES[floor <= 2 ? 0 : floor <= 4 ? 1 : 2];
  }

  const CHAPTERS = [
    {name:'余光水道', region:1, signature:'hound', boss:'gatekeeper', events:['fogFork','wallKnock','hungerPot']},
    {name:'鸣钟渡口', region:2, signature:'boneBell', boss:'memoryEater', events:['boneChoir','bellSlack','mothLantern']},
    {name:'硫泉阶井', region:3, signature:'hulk', boss:'gatekeeper', events:['scrapPile','ledgerStall','hungerPot']},
    {name:'拖骸矿道', region:4, signature:'shuffler', boss:'furnaceHeart', events:['wallKnock','ledgerStall','paleSurgeon']},
    {name:'唱喑圣所', region:5, signature:'wraithChoir', boss:'memoryEater', events:['boneChoir','paleSurgeon','mothLantern']},
    {name:'炉渣深井', region:6, signature:'hulkSlag', boss:'gatekeeper', events:['deepWell','scrapPile','bellSlack']},
    {name:'黑炉核心', region:7, signature:'wraith', boss:'furnaceHeart', events:['deepWell','paleSurgeon','ledgerStall']},
  ];
  function chapterAt(floor) {
    const index = Math.floor((Math.max(1,Math.min(DESIGN.maxFloor,floor))-1)/7);
    return {...CHAPTERS[index], number:index+1, step:(Math.max(1,floor)-1)%7+1};
  }
  const rewardNodes = [1, 2, 3, 8, 15, 29, 43];
  function rewardTier(depth) { return Math.max(1,rewardNodes.filter(node => node <= depth).length); }
  function chapterLabel(floor) {
    const c = chapterAt(floor);
    return `第 ${c.number} 章 · ${c.name} · ${c.step}/7`;
  }
  function chapterEncounter(kind,index,floor,opts) {
    const c = chapterAt(floor), zone = biome(c.region);
    const roll = index+c.step-1+c.number-1;
    const encounter = encounterTemplate(kind,roll,c.region);
    if (kind === 'boss') {
      encounter.bossId = c.boss;
      encounter.minionIds = c.number < 7 ? [c.signature] : [c.signature, zone.pool.filter(id => id !== c.signature)[roll % (zone.pool.length-1)]];
    }
    if (kind === 'normal') {
      const others = zone.pool.filter(id => id !== c.signature);
      encounter.minionIds = [c.signature, others[roll%others.length], others[(roll+1)%others.length]];
    }
    /* 七标：允许指定关底首领（只给模拟器的「分首领胜率矩阵」用）。
       生产路径不带 opts，走的还是章节自身那一只。 */
    if (opts && opts.bossId && kind === 'boss') encounter.bossId = opts.bossId;
    return encounter;
  }

  /* 遭遇模板：敌人组合 + 层数缩放。只按 (kind, index, floor) 决定，可重放。 */
  function encounterTemplate(kind, index, floor = 1) {
    const zone = biome(floor);
    const pool = zone.pool;
    const at = (n) => pool[(index + n) % pool.length];

    if (kind === 'boss') {
      const bossId = BOSS_ORDER[index % BOSS_ORDER.length];
      return { kind: 'boss', bossId, minionIds: [at(1), floor >= 6 ? at(3) : 'bone'] };
    }
    if (kind === 'elite') {
      const eliteId = zone.elites[(index + floor) % zone.elites.length];
      const escorts = floor >= 5 ? 2 : 1;
      const minionIds = [eliteId];
      for (let i = 0; i < escorts; i += 1) minionIds.push(at(i + 1));
      return { kind: 'elite', bossId: null, minionIds, elite: true };
    }
    /* 普通：招牌 + 两员不同的随从，按 index 轮转，避免整层都是同一个物种 */
    const others = pool.filter((id) => id !== zone.signature);
    const minionIds = [zone.signature, others[index % others.length], others[(index + 1) % others.length]];
    return { kind: 'normal', bossId: null, minionIds };
  }

  /* ------------------------------ 节点 ------------------------------ */
  const NODE_TYPES = {
    battle: { id: 'battle', name: '残响战斗', risk: 'low', icon: 'sword', artId: 'node.battle', desc: '游荡的尸骸。' },
    elite: { id: 'elite', name: '精英徘徊者', risk: 'high', icon: 'star', artId: 'node.elite', desc: '比别的大一圈。' },
    chest: { id: 'chest', name: '无人看守的箱子', risk: 'low', icon: 'box', artId: 'node.chest', desc: '太安静了。' },
    event: { id: 'event', name: '不明声响', risk: 'medium', icon: 'question', artId: 'node.event', desc: '墙里有人在敲。' },
    camp: { id: 'camp', name: '废弃营火', risk: 'none', icon: 'flame', artId: 'node.camp', desc: '还有余温。' },
    merchant: { id: 'merchant', name: '游商', risk: 'low', icon: 'scale', artId: 'node.merchant', desc: '它确实在卖东西。' },
    boss: { id: 'boss', name: '回廊尽头', risk: 'deadly', icon: 'skull', artId: 'node.boss', desc: '门后面有东西。' },
  };

  /* ------------------------------ 蚀刻法谱 ------------------------------ */
  /* 蚀刻法是压在金属板面上的蚀刻法：自己占格、自带纹路要求与出入口。
     有蚀刻法才谈得上余裕路由；没有蚀刻法，板面只是一块带槽位的金属。
     cells/veins/entry/exits 与 src/veteran/manuscript.js 的判定口径一致。 */
  const MANUSCRIPTS = {
    /* 一阶：微蚀刻法，占地 2 格、负荷 1，任何板面都塞得下。只有攻势，没有守势 */
    spark: {
      id: 'spark', name: '星火', rarity: 1, load: 1,
      desc: '普通攻击间隔缩短15%，辅修也生效。',
      cells: [[0, 0], [1, 0]],
      veins: { '0,0': ['W'], '1,0': ['E'] },
      io: { clock: { cell: [0, 0], dir: 'W' }, main: { cell: [1, 0], dir: 'E' } },
      entry: [0, 0], exits: [[1, 0]],
      attack: { intervalScale: 0.85, mult: 1.0, extraHits: 0 },
      energy: { regen: 1.0, max: 16 },
      skills: [],
      tiers: [
        { at: 50, id: 't1', name: '一阶 · 起手', effect: { mainMult: 1.06 } },
        { at: 100, id: 't2', name: '二阶 · 顺手', effect: { mainMult: 1.14, startEnergy: 1 } },
      ],
    },

    /* 二阶：第一个无条件招式 */
    corridor5: {
      id: 'corridor5', name: '直贯五脉', rarity: 2, load: 2,
      desc: '一线穿刺，同时打击前两名敌人。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],
      veins: { '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['W'], '3,1': ['E'] },
      entry: [0, 0], exits: [[3, 1]],
      io: {
        clock: { cell: [0, 0], dir: 'W' },
        damage: { cell: [2, 0], dir: 'W' },
        main: { cell: [3, 1], dir: 'E' },
        support: { cell: [3, 0], dir: 'W' },
      },
      attack: { intervalScale: 1.0, mult: 1.05, extraHits: 0 },
      energy: { regen: 1.0, max: 20 },
      skills: [{
        id: 'pierce', name: '一线穿心', cost: 6, castTime: 0.6, cooldown: 4,
        cond: {}, target: 'frontFoe', effect: { mult: 1.8, pierce: 2 },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 初鸣', effect: { mainMult: 1.08 } },
        { at: 80, id: 't2', name: '二阶 · 共振', effect: { mainMult: 1.16, startEnergy: 1 } },
        { at: 100, id: 't3', name: '三阶 · 圆满', effect: { mainMult: 1.24, startEnergy: 1 } },
      ],
    },

    /* 三阶：招式带条件 */
    ember12: {
      id: 'ember12', name: '余烬十二脉', rarity: 3, load: 3,
      desc: '贯通后引燃敌人，灼烧持续施压。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'],
        '0,1': ['W'], '1,1': ['E'], '2,1': ['W'], '3,1': ['E'],
        '0,2': ['W'], '1,2': ['E'], '2,2': ['W'], '3,2': ['E'],
      },
      entry: [0, 0], exits: [[3, 2]],
      io: {
        clock: { cell: [0, 1], dir: 'W' },
        damage: { cell: [0, 2], dir: 'W' },
        main: { cell: [3, 0], dir: 'E' },
        support: { cell: [3, 2], dir: 'E' },
      },
      attack: { intervalScale: 1.0, mult: 1.0, extraHits: 0 },
      energy: { regen: 1.15, max: 22 },
      skills: [{
        id: 'emberBurst', name: '余烬回响', cost: 10, castTime: 0.7, cooldown: 6,
        cond: { routed: true }, target: 'frontFoe',
        effect: { mult: 2.0, dot: { hits: 3, dmgMult: 0.25 }, shield: 0.22 },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 初鸣', effect: { mainMult: 1.10 } },
        { at: 75, id: 't2', name: '二阶 · 共振', effect: { mainMult: 1.18, startEnergy: 1 } },
        { at: 100, id: 't3', name: '三阶 · 圆满', effect: { mainMult: 1.26, startEnergy: 1, supportMult: 1.2 } },
      ],
    },

    /* 四阶：改写余裕来源 */
    wide14: {
      id: 'wide14', name: '重铸阔卷', rarity: 4, load: 4,
      desc: '受击积攒余裕，重击附带余波与护盾。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'], '4,0': ['W'],
        '0,1': ['E'], '1,1': ['W'], '2,1': ['E'], '3,1': ['W'], '4,1': ['E'],
        '1,2': ['W'], '2,2': ['E'], '3,2': ['W'], '4,2': ['E'],
      },
      entry: [0, 0], exits: [[4, 2]],
      io: {
        clock: { cell: [0, 0], dir: 'W' },
        damage: { cell: [0, 1], dir: 'E' },
        main: { cell: [4, 0], dir: 'W' },
        support: { cell: [4, 1], dir: 'E' },
      },
      attack: { intervalScale: 1.1, mult: 1.15, extraHits: 0 },
      energy: { regen: 0.9, max: 26, onHit: 0.6 },
      skills: [{
        id: 'quake', name: '重铸震击', cost: 12, castTime: 0.8, cooldown: 7,
        cond: { foeHpBelow: 0.6 }, target: 'frontFoe', effect: { mult: 2.4, splash: 0.4, shield: 0.18 },
      }],
      tiers: [
        { at: 35, id: 't1', name: '一阶 · 余温', effect: { mainMult: 1.12 } },
        { at: 70, id: 't2', name: '二阶 · 灼脉', effect: { mainMult: 1.22, supportMult: 1.15 } },
        { at: 100, id: 't3', name: '三阶 · 圆满', effect: { mainMult: 1.34, startEnergy: 2, supportMult: 1.3 } },
      ],
    },

    /* 五阶：招式改写普通攻击 */
    flurry: {
      id: 'flurry', name: '连刺', rarity: 5, load: 3,
      desc: '招式后强化普通攻击，持续数次。',
      cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'],
        '0,1': ['E'], '1,1': ['W'], '2,1': ['E'],
      },
      entry: [0, 0], exits: [[2, 1]],
      io: {
        clock: { cell: [0, 0], dir: 'W' },
        damage: { cell: [0, 1], dir: 'E' },
        main: { cell: [2, 1], dir: 'E' },
        support: { cell: [2, 0], dir: 'W' },
      },
      attack: { intervalScale: 0.9, mult: 0.95, extraHits: 0 },
      energy: { regen: 1.2, max: 20 },
      skills: [{
        id: 'flurry', name: '连刺', cost: 9, castTime: 0.5, cooldown: 5,
        cond: { attackCount: 4 }, target: 'frontFoe',
        effect: { mult: 1.2, buffAttack: { mult: 1.6, hits: 6 } },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 起势', effect: { mainMult: 1.10 } },
        { at: 90, id: 't2', name: '二阶 · 疾风', effect: { mainMult: 1.2, startEnergy: 1 } },
      ],
    },

    /* 六阶：双招式 + 独特余裕 */
    twinflow: {
      id: 'twinflow', name: '双流', rarity: 6, load: 4,
      desc: '八格双线蚀刻法。两个招式共享冷却，余裕上限更高、回得更快。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'],
        '0,1': ['E'], '1,1': ['W'], '2,1': ['E'], '3,1': ['W'],
      },
      entry: [0, 0], exits: [[3, 1]],
      io: {
        clock: { cell: [0, 0], dir: 'W' },
        damage: { cell: [0, 1], dir: 'E' },
        main: { cell: [3, 0], dir: 'E' },
        support: { cell: [3, 1], dir: 'W' },
      },
      attack: { intervalScale: 0.9, mult: 1.15, extraHits: 0 },
      energy: { regen: 1.6, max: 28 },
      skills: [{
        id: 'flowA', name: '左流', cost: 10, castTime: 0.5, cooldown: 5,
        cond: {}, target: 'frontFoe', effect: { mult: 1.9 },
      }, {
        id: 'flowB', name: '右流', cost: 10, castTime: 0.5, cooldown: 5, sharedCooldown: true,
        cond: { energyAbove: 14, alliesHurt: 1 }, target: 'ally', effect: { heal: 1.9 },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 分流', effect: { mainMult: 1.12 } },
        { at: 80, id: 't2', name: '二阶 · 合流', effect: { mainMult: 1.22, startEnergy: 2 } },
      ],
    },

    /* 七阶：改写规则 */
    inverse: {
      id: 'inverse', name: '逆脉', rarity: 7, load: 5,
      desc: '八格逆流蚀刻法。普通攻击额外获得贯通增幅，招式贯穿三位并提供护盾。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'],
        '0,1': ['E'], '1,1': ['W'], '2,1': ['E'], '3,1': ['W'],
      },
      entry: [0, 0], exits: [[3, 1]],
      io: {
        clock: { cell: [0, 0], dir: 'W' },
        damage: { cell: [0, 1], dir: 'E' },
        main: { cell: [3, 0], dir: 'E' },
        support: { cell: [3, 1], dir: 'W' },
      },
      attack: { intervalScale: 0.8, mult: 1.3, extraHits: 0, routedBonus: 0.25 },
      energy: { regen: 1.7, max: 32, onAttack: 0.2 },
      skills: [{
        id: 'inverse', name: '逆脉', cost: 10, castTime: 0.8, cooldown: 6,
        cond: {}, target: 'frontFoe',
        effect: { mult: 2.8, pierce: 3, shield: 0.3 },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 逆流', effect: { mainMult: 1.15 } },
        { at: 75, id: 't2', name: '二阶 · 倒灌', effect: { mainMult: 1.28, startEnergy: 2 } },
        { at: 100, id: 't3', name: '三阶 · 无回', effect: { mainMult: 1.42, startEnergy: 2, supportMult: 1.35 } },
      ],
    },
  };
  const MANUSCRIPT_ORDER = ['spark', 'corridor5', 'ember12', 'wide14', 'flurry', 'twinflow', 'inverse'];
  /* 入门蚀刻法共享两格蚀刻法，差异来自打法，不附赠职业面板。 */
  MANUSCRIPTS.needle = {
    ...MANUSCRIPTS.spark, id: 'needle', name: '逐隙',
    desc: '每四次普通攻击追击虚弱敌人。',
    attack: { intervalScale: 1.1, mult: 0.9 }, 
    skills: [{ id: 'needle', name: '逐隙一击', cost: 5, castTime: 0.45, cooldown: 4,
      cond: { attackCount: 4 }, target: 'lowestHpFoe', effect: { mult: 1.65 } }],
  };
  MANUSCRIPTS.ward = {
    ...MANUSCRIPTS.spark, id: 'ward', name: '回息',
    desc: '同伴重伤时治疗最虚弱者。',
    attack: { intervalScale: 1.2, mult: 0.7 }, energy: { regen: 1.2, max: 16 }, 
    skills: [{ id: 'ward', name: '回息', cost: 5, castTime: 0.6, cooldown: 5,
      cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 1.2 } }],
    /* 治疗吃护持倍率而不是招式倍率，所以奶妈的档位要单独抬护持 */
    tiers: [
      { at: 50, id: 't1', name: '一阶 · 起手', effect: { mainMult: 1.06, supportMult: 1.12 } },
      { at: 100, id: 't2', name: '二阶 · 顺手', effect: { mainMult: 1.14, startEnergy: 1, supportMult: 1.22 } },
    ],
  };
  /* 沿用已验证的蚀刻法几何，组合现有战斗效果形成不同节奏。 */
  /* 蚀刻法以可以实际拼接的整件纹路为原型；入口在左侧，出口在末件右侧。 */
  function channelPattern(cells, entry, exit, out, inlet) {
    const veins = { [entry]: ['W'], [out]: ['E'], [inlet]: ['W'], [exit]: ['E'] };
    return { cells, veins, entry, exits: [exit], io: { clock: { cell: entry, dir: 'W' }, main: { cell: exit, dir: 'E' } } };
  }
  const CHANNELS = {
    rail: channelPattern([[0,0],[1,0],[2,0],[3,0]], [0,0], [3,0], [1,0], [2,0]),
    hook: channelPattern([[0,0],[1,0],[1,1],[2,1],[3,1]], [0,0], [3,1], [1,1], [2,1]),
    toe: channelPattern([[0,0],[1,0],[2,0],[3,0],[3,1]], [0,0], [3,1], [1,0], [2,0]),
    stairs: channelPattern([[0,0],[1,0],[1,1],[2,1],[3,1],[3,2]], [0,0], [3,2], [1,1], [2,1]),
    trough: channelPattern([[0,0],[1,0],[0,1],[1,1],[2,0],[3,0]], [0,0], [3,0], [1,0], [2,0]),
    cup: channelPattern([[0,0],[1,0],[2,0],[3,0],[2,1],[3,1]], [0,0], [3,0], [1,0], [2,0]),
    comb: channelPattern([[0,1],[1,1],[1,0],[1,2],[2,0],[3,0]], [0,1], [3,0], [1,0], [2,0]),
    spur: channelPattern([[0,1],[1,1],[1,0],[1,2],[2,2],[3,2]], [0,1], [3,2], [1,2], [2,2]),
    crown: channelPattern([[0,0],[1,0],[1,1],[2,1],[3,1],[3,0],[3,2]], [0,0], [3,0], [1,1], [2,1]),
  };
  const ETCHING_VARIANTS = [
    { id: 'ripple', name: '涟回', base: 'ward', unlockDepth: 3, rarity: 1,
      desc: '低耗快疗，适合持续承伤的队伍。', energy: { regen: 1.4, max: 16 },
      skills: [{ id: 'ripple', name: '回涟', cost: 3, castTime: 0.35, cooldown: 3, cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 0.8 } }] },
    { id: 'cinder', name: '引燃', base: 'corridor5', unlockDepth: 3, rarity: 2,
      desc: '缓慢叠起灼烧，拖长战斗换取收益。', 
      skills: [{ id: 'cinder', name: '火种', cost: 5, castTime: 0.5, cooldown: 4, cond: {}, target: 'frontFoe', effect: { mult: 1.1, dot: { dmgMult: 0.45, hits: 3 } } }] },
    { id: 'pursuit', name: '追亡', base: 'corridor5', unlockDepth: 4, rarity: 2,
      desc: '三次普通攻击后重击最虚弱的敌人。', 
      skills: [{ id: 'pursuit', name: '收锋', cost: 7, castTime: 0.7, cooldown: 4, cond: { attackCount: 3 }, target: 'lowestHpFoe', effect: { mult: 3.1 } }] },
    { id: 'bulwark', name: '铁壁', base: 'corridor5', unlockDepth: 3, rarity: 2,
      desc: '攻击同时护住自身，以输出换取生存。', attack: { intervalScale: 1.2, mult: 0.85 },
      skills: [{ id: 'bulwark', name: '合壁', cost: 5, castTime: 0.45, cooldown: 5, cond: {}, target: 'frontFoe', effect: { mult: 0.9, shield: 0.3 } }] },
    { id: 'torrent', name: '疾雨', base: 'flurry', unlockDepth: 4, rarity: 3,
      desc: '短促三连击，快速收束单体伤害。', 
      skills: [{ id: 'torrent', name: '骤雨', cost: 7, castTime: 0.3, cooldown: 4, cond: {}, target: 'frontFoe', effect: { mult: 0.85, hits: 3 } }] },
    { id: 'razor', name: '流血', base: 'corridor5', unlockDepth: 4, rarity: 3,
      desc: '两段穿刺，压低敌方前后两人的生命。', 
      skills: [{ id: 'razor', name: '双裂', cost: 9, castTime: 0.9, cooldown: 6, cond: {}, target: 'frontFoe', effect: { mult: 0.9, hits: 2, pierce: 2 } }] },
    { id: 'tide', name: '潮汐', base: 'flurry', unlockDepth: 5, rarity: 3,
      desc: '重疗同伴并护住自身，适合后阵久战。', attack: { intervalScale: 1.35, mult: 0.7 }, energy: { regen: 1.4, max: 24 },
      skills: [{ id: 'tide', name: '返潮', cost: 8, castTime: 0.8, cooldown: 6, cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 2.1, shield: 0.15 } }] },
    { id: 'pulse', name: '鸣脉', base: 'corridor5', unlockDepth: 4, rarity: 2,
      desc: '普通攻击积攒余裕，以高频招式持续施压。', energy: { regen: 0.7, max: 20, onAttack: 1.5 },
      skills: [{ id: 'pulse', name: '脉冲', cost: 5, castTime: 0.25, cooldown: 2.5, cond: {}, target: 'frontFoe', effect: { mult: 1.5 } }] },
    { id: 'sunder', name: '震裂', base: 'inverse', unlockDepth: 6, rarity: 4,
      desc: '重击前锋，余波扫过其余敌人。', energy: { regen: 1.2, max: 28 },
      skills: [{ id: 'sunder', name: '断层', cost: 10, castTime: 1.1, cooldown: 6, cond: {}, target: 'frontFoe', effect: { mult: 2.3, splash: 0.55 } }] },
    { id: 'bloodrush', name: '孤注', base: 'flurry', unlockDepth: 5, rarity: 3,
      desc: '攒满余裕后强化普通攻击，打一轮集中爆发。', attack: { intervalScale: 0.8, mult: 0.9 },
      skills: [{ id: 'bloodrush', name: '倾注', cost: 10, castTime: 0.5, cooldown: 7, cond: { energyAbove: 12 }, target: 'frontFoe', effect: { mult: 1.2, buffAttack: { mult: 2, hits: 8 } } }] },
    { id: 'sentinel', name: '守灯', base: 'twinflow', unlockDepth: 6, rarity: 4,
      desc: '同伴受伤时治疗，否则双击；两式共用冷却。', 
      skills: [
        { id: 'sentinelHeal', name: '续灯', cost: 6, castTime: 0.6, cooldown: 5, sharedCooldown: true, cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 1.7 } },
        { id: 'sentinelStrike', name: '挑灯', cost: 6, castTime: 0.6, cooldown: 5, sharedCooldown: true, cond: {}, target: 'lowestHpFoe', effect: { mult: 1, hits: 2 } },
      ] },
    { id: 'echo', name: '回响', base: 'inverse', unlockDepth: 7, rarity: 5,
      desc: '三线共振后强化普通攻击，兼顾群攻与持续输出。', 
      skills: [{ id: 'echo', name: '重响', cost: 12, castTime: 1, cooldown: 7, cond: {}, target: 'frontFoe', effect: { mult: 1.6, pierce: 3, buffAttack: { mult: 1.5, hits: 6 } } }] },
    { id: 'rivet', name: '扣钉', base: 'spark', unlockDepth: 3, rarity: 1,
      desc: '三次普通攻击后打入铆钉，自身获得薄盾。',
      skills: [{ id: 'rivet', name: '锁甲', cost: 3, castTime: 0.3, cooldown: 4, cond: { attackCount: 3 }, target: 'frontFoe', effect: { mult: 0.75, shield: 0.12 } }] },
    { id: 'wick', name: '灰芯', base: 'spark', unlockDepth: 3, rarity: 1,
      desc: '贯通后点燃生命比例最低的敌人。', 
      skills: [{ id: 'wick', name: '挑火', cost: 3, castTime: 0.35, cooldown: 4, cond: { routed: true }, target: 'lowestHpFoe', effect: { mult: 0.7, dot: { dmgMult: 0.35, hits: 3 } } }] },
    { id: 'suture', name: '焊缝', base: 'ward', unlockDepth: 4, rarity: 2,
      desc: '治疗重伤同伴，同时短暂强化自身普通攻击。',
      cells: [[0, 0], [1, 0], [1, 1]], veins: { '0,0': ['W'], '1,1': ['E'] },
      io: { clock: { cell: [0, 0], dir: 'W' }, main: { cell: [1, 1], dir: 'E' } }, exits: [[1, 1]],
      skills: [{ id: 'suture', name: '热焊', cost: 5, castTime: 0.65, cooldown: 5, cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 1, buffAttack: { mult: 1.4, hits: 6 } } }] },
    { id: 'shrapnel', name: '碎鳞', base: 'suture', unlockDepth: 4, rarity: 2,
      desc: '前敌半血后碎鳞崩开，余波打击其余敌人。', 
      skills: [{ id: 'shrapnel', name: '崩鳞', cost: 6, castTime: 0.4, cooldown: 4, cond: { foeHpBelow: 0.5 }, target: 'frontFoe', effect: { mult: 1.35, splash: 0.7 } }] },
    { id: 'bellows', name: '风箱', base: 'spark', unlockDepth: 5, rarity: 3, load: 2,
      desc: '受击补充余裕，蓄足后双击并强化普通攻击。', energy: { regen: 0.8, max: 18, onHit: 1 },
      cells: [[0, 0], [1, 0], [0, 1], [1, 1]], veins: { '0,0': ['W'], '1,0': ['E'] },
      skills: [{ id: 'bellows', name: '鼓炉', cost: 7, castTime: 0.5, cooldown: 5, cond: { energyAbove: 10 }, target: 'frontFoe', effect: { mult: 0.8, hits: 2, buffAttack: { mult: 1.4, hits: 6 } } }] },
    { id: 'quench', name: '淬壳', base: 'bellows', unlockDepth: 5, rarity: 3,
      desc: '自身受伤时耗用储备余裕，自疗并补盾。',
      skills: [{ id: 'quench', name: '冷淬', cost: 8, castTime: 0.6, cooldown: 6, cond: { energyAbove: 12 }, target: 'self', effect: { heal: 1.6, shield: 0.16 } }] },
    { id: 'awl', name: '锈锥', base: 'suture', unlockDepth: 6, rarity: 3, load: 2,
      desc: '四次普通攻击后穿过前两敌，并在前敌留下灼伤。', 
      skills: [{ id: 'awl', name: '灼穿', cost: 7, castTime: 0.55, cooldown: 5, cond: { attackCount: 4 }, target: 'frontFoe', effect: { mult: 1.2, pierce: 2, dot: { dmgMult: 0.3, hits: 3 } } }] },
    { id: 'crucible', name: '回炉', base: 'bellows', unlockDepth: 7, rarity: 4, load: 3,
      desc: '两名同伴重伤时优先急救，平时引导追击弱敌。', 
      skills: [
        { id: 'crucibleMend', name: '熔补', cost: 5, castTime: 0.45, cooldown: 4, cond: { alliesHurt: 2 }, target: 'ally', effect: { heal: 2.2 } },
        { id: 'cruciblePour', name: '浇铸', cost: 5, castTime: 0.55, cooldown: 5, cond: { energyAbove: 12 }, target: 'lowestHpFoe', effect: { mult: 1.6, splash: 0.35 } },
      ] },
    { id: 'tinThread', name: '锡丝', base: 'ward', rarity: 1, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 1,
      desc: '同伴稍有损伤便补缀，少量多次回血。', 
      skills: [{ id: 'tinThread', name: '牵丝', cost: 2, castTime: 0.35, cooldown: 3, cond: {}, target: 'ally', effect: { heal: 0.55 } }] },
    { id: 'fileTooth', name: '锉齿', base: 'spark', rarity: 2, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 2,
      desc: '两次普通攻击后双锉最虚弱的敌人。', 
      skills: [{ id: 'fileTooth', name: '对锉', cost: 4, castTime: 0.3, cooldown: 3.5, cond: { attackCount: 2 }, target: 'lowestHpFoe', effect: { mult: 0.85, hits: 2 } }] },
    { id: 'leadSeal', name: '铅封', base: 'suture', rarity: 2, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 3,
      desc: '同伴重伤时打击前敌，为自身封上一层厚盾。', 
      skills: [{ id: 'leadSeal', name: '封舱', cost: 4, castTime: 0.4, cooldown: 4, cond: { alliesHurt: 1 }, target: 'frontFoe', effect: { mult: 0.9, shield: 0.24 } }] },
    { id: 'tinderMesh', name: '火筛', base: 'bellows', rarity: 3, unlockDepth: 4, fieldSource: 'chest', fieldDepth: 4,
      desc: '余裕充足时抖出火屑，点燃前敌并溅伤其余敌人。', 
      skills: [{ id: 'tinderMesh', name: '落屑', cost: 7, castTime: 0.7, cooldown: 5, cond: { energyAbove: 10 }, target: 'frontFoe', effect: { mult: 1.2, splash: 0.45, dot: { hits: 3, dmgMult: 0.35 } } }] },
    { id: 'anneal', name: '退火', base: 'suture', rarity: 3, unlockDepth: 5, fieldSource: 'chest', fieldDepth: 5,
      desc: '两次普通攻击后可自疗，并将余热送回武器。', 
      skills: [{ id: 'anneal', name: '归热', cost: 6, castTime: 0.5, cooldown: 5, cond: { attackCount: 2 }, target: 'self', effect: { heal: 1.2, buffAttack: { mult: 1.55, hits: 6 } } }] },
    { id: 'silverTap', name: '银触', base: 'suture', rarity: 4, load: 2, unlockDepth: 6, fieldSource: 'chest', fieldDepth: 6,
      desc: '贯通后给伤者快速输血，并给施术者加盾。', 
      skills: [{ id: 'silverTap', name: '接脉', cost: 6, castTime: 0.45, cooldown: 4, cond: { routed: true }, target: 'ally', effect: { heal: 1.6, shield: 0.15 } }] },
    { id: 'slagHook', name: '渣钩', base: 'suture', rarity: 2, unlockDepth: 3, fieldSource: 'elite', fieldDepth: 3,
      desc: '钩住最弱的敌人，连续两击并留下灼伤。', 
      skills: [{ id: 'slagHook', name: '拖烬', cost: 6, castTime: 0.65, cooldown: 5, cond: {}, target: 'lowestHpFoe', effect: { mult: 0.8, hits: 2, dot: { hits: 2, dmgMult: 0.4 } } }] },
    { id: 'ironJaw', name: '铁颚', base: 'bellows', rarity: 3, unlockDepth: 4, fieldSource: 'elite', fieldDepth: 3,
      desc: '前敌跌破半血后连咬三次，每轮咬合为自身加盾。', 
      skills: [{ id: 'ironJaw', name: '咬合', cost: 7, castTime: 0.55, cooldown: 5, cond: { foeHpBelow: 0.5 }, target: 'frontFoe', effect: { mult: 0.75, hits: 3, shield: 0.16 } }] },
    { id: 'coreDrill', name: '钻芯', base: 'bellows', rarity: 3, unlockDepth: 4, fieldSource: 'elite', fieldDepth: 4,
      desc: '贯通后以短钻连续四击前敌。', 
      skills: [{ id: 'coreDrill', name: '旋钻', cost: 7, castTime: 0.65, cooldown: 5, cond: { routed: true }, target: 'frontFoe', effect: { mult: 0.7, hits: 4 } }] },
    { id: 'bronzeGong', name: '铜钲', base: 'flurry', rarity: 4, unlockDepth: 5, fieldSource: 'elite', fieldDepth: 5,
      desc: '两人重伤时击响铜钲，震伤全场并护住自身。', 
      skills: [{ id: 'bronzeGong', name: '震营', cost: 8, castTime: 0.6, cooldown: 6, cond: { alliesHurt: 2 }, target: 'frontFoe', effect: { mult: 1.45, splash: 0.75, shield: 0.2 } }] },
    { id: 'splitAnvil', name: '分砧', base: 'twinflow', rarity: 4, load: 3, unlockDepth: 6, fieldSource: 'elite', fieldDepth: 6,
      desc: '蓄足余裕后一锤贯穿前两敌，碎屑飞向后排。', 
      skills: [{ id: 'splitAnvil', name: '开砧', cost: 9, castTime: 0.8, cooldown: 6, cond: { energyAbove: 13 }, target: 'frontFoe', effect: { mult: 1.8, pierce: 2, splash: 0.65 } }] },
    { id: 'furnaceEye', name: '炉眼', base: 'inverse', rarity: 5, load: 4, unlockDepth: 7, fieldSource: 'elite', fieldDepth: 6,
      desc: '前敌虚弱时锁定全场最弱者，引燃目标并强化普通攻击。', 
      skills: [{ id: 'furnaceEye', name: '照灰', cost: 8, castTime: 0.55, cooldown: 6, cond: { foeHpBelow: 0.6 }, target: 'lowestHpFoe', effect: { mult: 1.65, dot: { hits: 3, dmgMult: 0.4 }, buffAttack: { mult: 1.55, hits: 8 } } }] },
    /* 撤离谱：水道至黑炉的工程器具。 */
    { id: 'chalkLine', name: '墨斗', base: 'spark', rarity: 1, load: 2, unlockDepth: 3,
      ...CHANNELS.rail, desc: '普通攻击两次后打直线，给前两名敌人各留一道浅痕。',
      skills: [{ id: 'chalkLine', name: '弹线', cost: 4, castTime: 0.35, cooldown: 4,
        cond: { attackCount: 2 }, target: 'frontFoe', effect: { mult: 1.05, pierce: 2 } }] },
    { id: 'sump', name: '集露', base: 'ward', rarity: 1, load: 2, unlockDepth: 3,
      ...CHANNELS.cup, desc: '余裕达到八点便能给轻伤者补血，并为自己留下薄盾。',
      skills: [{ id: 'sump', name: '承露', cost: 4, castTime: 0.45, cooldown: 5,
        cond: { energyAbove: 8 }, target: 'ally', effect: { heal: 0.95, shield: 0.1 } }] },
    { id: 'oarlock', name: '桨栓', base: 'spark', rarity: 1, load: 2, unlockDepth: 3,
      ...CHANNELS.hook, desc: '贯通后点打最弱一敌，回桨的余劲强化接下来的普通攻击。',
      skills: [{ id: 'oarlock', name: '回桨', cost: 4, castTime: 0.3, cooldown: 4,
        cond: { routed: true }, target: 'lowestHpFoe', effect: { mult: 1.15, buffAttack: { mult: 1.3, hits: 4 } } }] },
    { id: 'brineWrap', name: '盐裹', base: 'suture', rarity: 1, load: 1, unlockDepth: 3,
      desc: '同伴重伤时连击前敌，用盐壳稳住自己的身位。',
      skills: [{ id: 'brineWrap', name: '结壳', cost: 4, castTime: 0.45, cooldown: 4.5,
        cond: { alliesHurt: 1 }, target: 'frontFoe', effect: { mult: 0.65, hits: 2, shield: 0.14 } }] },
    { id: 'pikeHead', name: '芦矢', base: 'spark', rarity: 2, load: 2, unlockDepth: 4,
      ...CHANNELS.toe, desc: '三次普通攻击蓄成一箭，箭尖灼烧最虚弱的敌人。',
      skills: [{ id: 'pikeHead', name: '苇烙', cost: 5, castTime: 0.45, cooldown: 5,
        cond: { attackCount: 3 }, target: 'lowestHpFoe', effect: { mult: 1.6, dot: { hits: 2, dmgMult: 0.3 } } }] },
    { id: 'capstan', name: '绞盘', base: 'bellows', rarity: 2, load: 2, unlockDepth: 4,
      ...CHANNELS.trough, desc: '蓄足十点余裕连绞前锋三次，末段的碎屑扑向旁敌。',
      skills: [{ id: 'capstan', name: '绞缆', cost: 6, castTime: 0.7, cooldown: 6,
        cond: { energyAbove: 10 }, target: 'frontFoe', effect: { mult: 0.67, hits: 3, splash: 0.5 } }] },
    { id: 'dryDock', name: '旱坞', base: 'ward', rarity: 2, load: 2, unlockDepth: 4,
      ...CHANNELS.rail, desc: '两名同伴重伤时优先给最弱者集中补血，适合打持久战。',
      skills: [{ id: 'dryDock', name: '入坞', cost: 5, castTime: 0.65, cooldown: 4,
        cond: { alliesHurt: 2 }, target: 'ally', effect: { heal: 2.15 } }] },
    { id: 'rushMat', name: '蒲席', base: 'ward', rarity: 2, load: 1, unlockDepth: 4,
      desc: '两次普通攻击后借机自疗，同时垫一层吸收伤害的软甲。',
      skills: [{ id: 'rushMat', name: '覆席', cost: 4, castTime: 0.4, cooldown: 5,
        cond: { attackCount: 2 }, target: 'self', effect: { heal: 0.85, shield: 0.19 } }] },
    { id: 'furnaceTong', name: '钳口', base: 'bellows', rarity: 2, load: 2, unlockDepth: 4,
      ...CHANNELS.hook, desc: '敌方前锋生命低于六成时，钳住最弱者并取得余热强化。',
      skills: [{ id: 'furnaceTong', name: '扣喉', cost: 6, castTime: 0.55, cooldown: 5,
        cond: { foeHpBelow: 0.6 }, target: 'lowestHpFoe', effect: { mult: 1.25, hits: 2, buffAttack: { mult: 1.3, hits: 5 } } }] },
    { id: 'millStone', name: '辊花', base: 'bellows', rarity: 3, load: 2, unlockDepth: 5,
      ...CHANNELS.stairs, desc: '贯通且普通攻击两次后，滚花轮咬住前两敌，各打两击。',
      skills: [{ id: 'millStone', name: '滚齿', cost: 6, castTime: 0.55, cooldown: 5,
        cond: { routed: true, attackCount: 2 }, target: 'frontFoe', effect: { mult: 0.8, hits: 2, pierce: 2 } }] },
    { id: 'soundingLine', name: '测深', base: 'ward', rarity: 3, load: 2, unlockDepth: 5,
      ...CHANNELS.spur, desc: '两名同伴重伤时反击敌方前排；回收探锤以护住自身。',
      skills: [{ id: 'soundingLine', name: '沉锤', cost: 5, castTime: 0.45, cooldown: 5,
        cond: { alliesHurt: 2 }, target: 'frontFoe', effect: { mult: 1.15, pierce: 2, shield: 0.19 } }] },
    { id: 'copperWick', name: '垂烛', base: 'suture', rarity: 3, load: 2, unlockDepth: 5,
      ...CHANNELS.comb, desc: '贯通后施放长燃的微火，余焰掠过其余敌人。',
      skills: [{ id: 'copperWick', name: '滴蜡', cost: 5, castTime: 0.6, cooldown: 6,
        cond: { routed: true }, target: 'frontFoe', effect: { mult: 0.9, splash: 0.45, dot: { hits: 4, dmgMult: 0.32 } } }] },
    { id: 'glassBell', name: '琉钟', base: 'ward', rarity: 3, load: 2, unlockDepth: 5,
      ...CHANNELS.cup, desc: '前敌跌破半血时改以快疗托住伤者，便于并装追击招。',
      skills: [{ id: 'glassBell', name: '收音', cost: 4, castTime: 0.3, cooldown: 3.5,
        cond: { foeHpBelow: 0.5 }, target: 'ally', effect: { heal: 1.55 } }] },
    { id: 'quarrySaw', name: '锯岩', base: 'bellows', rarity: 4, load: 3, unlockDepth: 6,
      ...CHANNELS.stairs, desc: '蓄足十二点余裕后横切前两敌，借锯齿的震动强化普通攻击。',
      skills: [{ id: 'quarrySaw', name: '双锯', cost: 8, castTime: 0.65, cooldown: 6,
        cond: { energyAbove: 12 }, target: 'frontFoe', effect: { mult: 1.55, pierce: 2, buffAttack: { mult: 1.45, hits: 6 } } }] },
    { id: 'coalSeam', name: '煤层', base: 'spark', rarity: 4, load: 3, unlockDepth: 6,
      ...CHANNELS.trough, desc: '三次普通攻击后震裂敌阵，黑火留在前锋身上并为自己聚盾。',
      /* 2026-11-15：煤层拿到第三招（高压），7 点 + 四次普攻的双门槛让它几乎排不上队
         （实测 0.25 次/场）。降到 5 点 / 三次普攻，与同门的两个追打同价。 */
      skills: [{ id: 'coalSeam', name: '塌层', cost: 5, castTime: 0.75, cooldown: 5,
        cond: { attackCount: 3 }, target: 'frontFoe', effect: { mult: 1.35, splash: 0.6, dot: { hits: 2, dmgMult: 0.38 }, shield: 0.12 } }] },
    { id: 'lodestone', name: '磁极', base: 'twinflow', rarity: 5, load: 3, unlockDepth: 7,
      ...CHANNELS.crown, desc: '一路贯通且余裕达到十四点时穿透前三敌，自身获得磁壳。',
      skills: [{ id: 'lodestone', name: '连极', cost: 9, castTime: 0.8, cooldown: 7,
        cond: { routed: true, energyAbove: 14 }, target: 'frontFoe', effect: { mult: 1.85, pierce: 3, shield: 0.2 } }] },
    { id: 'turbine', name: '叶轮', base: 'twinflow', rarity: 5, load: 3, unlockDepth: 7,
      ...CHANNELS.spur, desc: '前敌不足六成生命且普通攻击两次后，叶轮追击最弱者四次。',
      skills: [{ id: 'turbine', name: '追旋', cost: 8, castTime: 0.55, cooldown: 6,
        cond: { foeHpBelow: 0.6, attackCount: 2 }, target: 'lowestHpFoe', effect: { mult: 0.74, hits: 4, splash: 0.48 } }] },
    /* 宝箱谱：弃置的随身器具，偏低耗、轻装与条件补招。 */
    { id: 'boneFlute', name: '骨笛', base: 'ward', rarity: 1, load: 1, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 1,
      desc: '余裕达到六点时吹响短音，治疗伤者并强化自身普通攻击。',
      skills: [{ id: 'boneFlute', name: '短调', cost: 3, castTime: 0.45, cooldown: 4,
        cond: { energyAbove: 6 }, target: 'ally', effect: { heal: 0.62, buffAttack: { mult: 1.25, hits: 4 } } }] },
    { id: 'awlPoint', name: '针眼', base: 'spark', rarity: 1, load: 1, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 1,
      desc: '普通攻击一次后便能对最弱者补一刺，花费低，适合副修。',
      skills: [{ id: 'awlPoint', name: '穿眼', cost: 2, castTime: 0.25, cooldown: 3,
        cond: { attackCount: 1 }, target: 'lowestHpFoe', effect: { mult: 0.85 } }] },
    { id: 'shutter', name: '百叶', base: 'suture', rarity: 1, load: 2, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 2,
      ...CHANNELS.toe, desc: '将三次普通攻击的余势打向前锋，碎片向旁敌散开。',
      skills: [{ id: 'shutter', name: '翻叶', cost: 4, castTime: 0.4, cooldown: 4,
        cond: { attackCount: 3 }, target: 'frontFoe', effect: { mult: 1.2, splash: 0.55 } }] },
    { id: 'marrowPin', name: '髓针', base: 'suture', rarity: 1, load: 1, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 2,
      desc: '贯通时为自己疗伤，再用余热护身。',
      skills: [{ id: 'marrowPin', name: '灌髓', cost: 3, castTime: 0.45, cooldown: 4.5,
        cond: { routed: true }, target: 'self', effect: { heal: 0.9, shield: 0.13 } }] },
    { id: 'tinChime', name: '悬铃', base: 'ward', rarity: 1, load: 2, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 3,
      ...CHANNELS.rail, desc: '同伴重伤时敲铃追打最弱敌，护盾留给施术者。',
      skills: [{ id: 'tinChime', name: '警铃', cost: 4, castTime: 0.35, cooldown: 4,
        cond: { alliesHurt: 1 }, target: 'lowestHpFoe', effect: { mult: 1.15, shield: 0.18 } }] },
    { id: 'beltBuckle', name: '革扣', base: 'spark', rarity: 1, load: 2, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 3,
      ...CHANNELS.cup, desc: '两次普通攻击后连击前锋并暂时强化普通攻击，可与计数招式并用。',
      skills: [{ id: 'beltBuckle', name: '束带', cost: 4, castTime: 0.4, cooldown: 5,
        cond: { attackCount: 2 }, target: 'frontFoe', effect: { mult: 0.75, hits: 2, buffAttack: { mult: 1.35, hits: 4 } } }] },
    { id: 'coilSpring', name: '簧片', base: 'bellows', rarity: 2, load: 2, unlockDepth: 4, fieldSource: 'chest', fieldDepth: 4,
      ...CHANNELS.hook, desc: '蓄足十点余裕后弹向最弱者，溅伤全场并附两回合灼烧。',
      skills: [{ id: 'coilSpring', name: '弹屑', cost: 5, castTime: 0.35, cooldown: 5,
        cond: { energyAbove: 10 }, target: 'lowestHpFoe', effect: { mult: 1.15, splash: 0.4, dot: { hits: 2, dmgMult: 0.26 } } }] },
    { id: 'fieldLamp', name: '巡烛', base: 'suture', rarity: 2, load: 2, unlockDepth: 4, fieldSource: 'chest', fieldDepth: 4,
      ...CHANNELS.comb, desc: '贯通时连打前锋两次，将火留在前锋身上。',
      skills: [{ id: 'fieldLamp', name: '巡照', cost: 5, castTime: 0.4, cooldown: 4.5,
        cond: { routed: true }, target: 'frontFoe', effect: { mult: 0.8, hits: 2, dot: { hits: 3, dmgMult: 0.28 } } }] },
    { id: 'waxTablet', name: '蜡版', base: 'ward', rarity: 3, load: 2, unlockDepth: 5, fieldSource: 'chest', fieldDepth: 5,
      ...CHANNELS.trough, desc: '蓄足十一点余裕且有人重伤时，厚敷伤者并护住自己。',
      skills: [{ id: 'waxTablet', name: '敷版', cost: 6, castTime: 0.55, cooldown: 5,
        cond: { energyAbove: 11, alliesHurt: 1 }, target: 'ally', effect: { heal: 1.8, shield: 0.17 } }] },
    { id: 'splitNeedle', name: '双耳', base: 'spark', rarity: 4, load: 3, unlockDepth: 6, fieldSource: 'chest', fieldDepth: 6,
      ...CHANNELS.crown, desc: '贯通后趁前敌虚弱连续打穿前两敌，兼顾后排。',
      skills: [{ id: 'splitNeedle', name: '扣耳', cost: 7, castTime: 0.55, cooldown: 5.5,
        cond: { routed: true, foeHpBelow: 0.6 }, target: 'frontFoe', effect: { mult: 1.05, hits: 2, pierce: 2 } }] },
    { id: 'surveyLens', name: '透镜', base: 'twinflow', rarity: 5, load: 3, unlockDepth: 7, fieldSource: 'chest', fieldDepth: 7,
      ...CHANNELS.stairs, desc: '普通攻击三次并积到十二点余裕后，聚光长燃最弱敌并强化普通攻击。',
      skills: [{ id: 'surveyLens', name: '聚白', cost: 7, castTime: 0.6, cooldown: 6,
        cond: { attackCount: 3, energyAbove: 12 }, target: 'lowestHpFoe', effect: { mult: 1.6, dot: { hits: 4, dmgMult: 0.38 }, buffAttack: { mult: 1.4, hits: 6 } } }] },
    /* 精英谱：从怪物构造取形，强调条件反击与持续附效。 */
    { id: 'houndClamp', name: '犬闸', base: 'spark', rarity: 1, load: 1, unlockDepth: 3, fieldSource: 'elite', fieldDepth: 3,
      desc: '前敌跌破六成生命时咬住该敌，为自己叠起硬盾。',
      skills: [{ id: 'houndClamp', name: '卡喉', cost: 4, castTime: 0.4, cooldown: 4.5,
        cond: { foeHpBelow: 0.6 }, target: 'frontFoe', effect: { mult: 1.35, shield: 0.21 } }] },
    { id: 'shellScale', name: '石鳞', base: 'bellows', rarity: 1, load: 2, unlockDepth: 3, fieldSource: 'elite', fieldDepth: 3,
      ...CHANNELS.toe, desc: '贯通后弹开石鳞，伤及旁敌并给自身上盾。',
      skills: [{ id: 'shellScale', name: '揭鳞', cost: 5, castTime: 0.55, cooldown: 5,
        cond: { routed: true }, target: 'frontFoe', effect: { mult: 1, splash: 0.5, shield: 0.17 } }] },
    { id: 'jointHammer', name: '节锤', base: 'bellows', rarity: 1, load: 2, unlockDepth: 3, fieldSource: 'elite', fieldDepth: 3,
      ...CHANNELS.trough, desc: '三次普通攻击后钉击前两敌，以锤风短时强化自己。',
      skills: [{ id: 'jointHammer', name: '打榫', cost: 5, castTime: 0.6, cooldown: 5,
        cond: { attackCount: 3 }, target: 'frontFoe', effect: { mult: 1.15, pierce: 2, buffAttack: { mult: 1.35, hits: 5 } } }] },
    { id: 'veilStitch', name: '雾绗', base: 'suture', rarity: 2, load: 2, unlockDepth: 4, fieldSource: 'elite', fieldDepth: 4,
      ...CHANNELS.cup, desc: '蓄足十点余裕后以冷雾自疗，同时罩盾并强化普通攻击。',
      skills: [{ id: 'veilStitch', name: '缝雾', cost: 6, castTime: 0.65, cooldown: 6,
        cond: { energyAbove: 10 }, target: 'self', effect: { heal: 1.05, shield: 0.14, buffAttack: { mult: 1.4, hits: 5 } } }] },
    { id: 'saltCradle', name: '盐龛', base: 'ward', rarity: 2, load: 2, unlockDepth: 4, fieldSource: 'elite', fieldDepth: 4,
      ...CHANNELS.comb, desc: '贯通且有人重伤时施以强力单疗，适合并装常规低耗招。',
      skills: [{ id: 'saltCradle', name: '沐盐', cost: 5, castTime: 0.5, cooldown: 4.5,
        cond: { routed: true, alliesHurt: 1 }, target: 'ally', effect: { heal: 2.05 } }] },
    { id: 'ribRake', name: '肋耙', base: 'spark', rarity: 2, load: 2, unlockDepth: 4, fieldSource: 'elite', fieldDepth: 4,
      ...CHANNELS.hook, desc: '同伴重伤时耙击前排两人，各受三段轻伤。',
      skills: [{ id: 'ribRake', name: '刮骨', cost: 6, castTime: 0.75, cooldown: 5.5,
        cond: { alliesHurt: 1 }, target: 'frontFoe', effect: { mult: 0.52, hits: 3, pierce: 2 } }] },
    { id: 'jawSpring', name: '颌簧', base: 'bellows', rarity: 3, load: 2, unlockDepth: 5, fieldSource: 'elite', fieldDepth: 5,
      ...CHANNELS.stairs, desc: '攒足十二点余裕且前敌重伤时打出合颌，溅伤旁敌并护身。',
      skills: [{ id: 'jawSpring', name: '合颌', cost: 7, castTime: 0.6, cooldown: 5.5,
        cond: { energyAbove: 12, foeHpBelow: 0.6 }, target: 'frontFoe', effect: { mult: 1.85, splash: 0.6, shield: 0.2 } }] },
    { id: 'slagLance', name: '渣枪', base: 'suture', rarity: 3, load: 2, unlockDepth: 5, fieldSource: 'elite', fieldDepth: 5,
      ...CHANNELS.spur, desc: '四次普通攻击后穿刺前三敌，前锋额外承受持续灼伤。',
      skills: [{ id: 'slagLance', name: '穿炉', cost: 7, castTime: 0.7, cooldown: 6,
        cond: { attackCount: 4 }, target: 'frontFoe', effect: { mult: 1.25, pierce: 3, dot: { hits: 3, dmgMult: 0.35 } } }] },
    { id: 'kilnMantle', name: '炉衣', base: 'twinflow', rarity: 3, load: 2, unlockDepth: 5, fieldSource: 'elite', fieldDepth: 5,
      ...CHANNELS.crown, desc: '两人重伤时以炽甲反击最弱敌，护身并强化接下来的普通攻击。',
      skills: [{ id: 'kilnMantle', name: '披炉', cost: 7, castTime: 0.45, cooldown: 6,
        cond: { alliesHurt: 2 }, target: 'lowestHpFoe', effect: { mult: 1.5, shield: 0.27, buffAttack: { mult: 1.5, hits: 6 } } }] },
    { id: 'mawValve', name: '渊阀', base: 'twinflow', rarity: 4, load: 3, unlockDepth: 6, fieldSource: 'elite', fieldDepth: 6,
      ...CHANNELS.trough, desc: '贯通且普通攻击三次后重击前锋，余波扫过旁敌并留下长燃。',
      skills: [{ id: 'mawValve', name: '泄压', cost: 8, castTime: 0.85, cooldown: 6.5,
        cond: { routed: true, attackCount: 3 }, target: 'frontFoe', effect: { mult: 1.9, splash: 0.65, dot: { hits: 4, dmgMult: 0.35 } } }] },
    { id: 'blackBloom', name: '铁昙', base: 'twinflow', rarity: 4, load: 3, unlockDepth: 6, fieldSource: 'elite', fieldDepth: 6,
      ...CHANNELS.spur, desc: '两人重伤且余裕充足时给最弱同伴续命，施术者同时得盾、强化普通攻击。',
      skills: [{ id: 'blackBloom', name: '夜放', cost: 8, castTime: 0.6, cooldown: 7,
        cond: { alliesHurt: 2, energyAbove: 13 }, target: 'ally', effect: { heal: 2.3, shield: 0.16, buffAttack: { mult: 1.45, hits: 6 } } }] },
  ];
  ETCHING_VARIANTS.forEach(({ base, ...spec }) => { MANUSCRIPTS[spec.id] = { ...MANUSCRIPTS[base], ...spec }; });
  // 阵形动作只属于这三门；同一蚀刻法几何的变体各有自己的招式。
  MANUSCRIPTS.spark.modId = 'refractRetreat';
  MANUSCRIPTS.needle.modId = 'shadowAdvance';
  MANUSCRIPTS.ward.modId = 'ironCover';
  Object.values(MANUSCRIPTS).forEach((m) => {
    m.unlockDepth = m.unlockDepth || Math.max(3, MANUSCRIPT_ORDER.indexOf(m.id) + 1);
  });
  MANUSCRIPTS.twinflow.skills.reverse();

  /* ========================== 蚀刻法骨架重塑（v4.0 六标） ==========================
     77 格的母板上，2~14 格的蚀刻法只占 3%~18% 面积 —— 板面大片空着，
     「压满大半块板才吃到高阶共鸣」这条设计根本没机会出现。
     这里按稀有度把 80 门重排成**镂空电路矩阵**：
       ① 一条 4~6 格的**主干走廊**：入口在头、出口在尾，折数决定这门的脉冲形状；
       ② 主干之外长一片**枝体**：整体只挂在出口格上（不许贴主干其它格），
          所以它不会替通路造出捷径 —— 入口到出口的距离由走廊决定；
       ③ 枝体生长时禁止「补满 2×2」，于是天然留下 1×2 / 2×2 的镶嵌槽。
     面积阶梯：R1 6~9 · R2 10~14 · R3 16~21 · R4 23~29 · R5 32~39 · R6/R7 44~54。 */
  const SKELETON_LADDER = {
    1: { sizes: [6, 9], load: 2 },
    2: { sizes: [10, 14], load: 3 },
    3: { sizes: [16, 21], load: [4, 5] },
    4: { sizes: [23, 29], load: [6, 7] },
    5: { sizes: [32, 39], load: [8, 9] },
    6: { sizes: [44, 54], load: [11, 12] },
    7: { sizes: [44, 54], load: [11, 12] },
  };

  /* 主干走廊：前三份直/一折，后面几份带回钩 —— 折数就是这门的「脉冲形状」 */
  const SKELETON_CORRIDORS = [
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]],
    [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
    [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]],
  ];
  const SK_ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const SK_NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function skHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function skRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const skKey = (c) => c.x + ',' + c.y;
  const skDirOf = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 1) return 'E';
    if (dx === -1) return 'W';
    if (dy === 1) return 'S';
    if (dy === -1) return 'N';
    return null;
  };
  const SK_OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };

  /**
   * 生成一块骨架：走廊 + 枝体。
   * @param {number} target 目标格数
   * @param {number} seed   同 id 恒定
   * @param {number} variant 走廊款式
   */
  function skeletalMatrix(target, seed, variant) {
    const rnd = skRng(seed);
    const corridor = SKELETON_CORRIDORS[variant % SKELETON_CORRIDORS.length]
      .map(([x, y]) => ({ x, y }));
    const cw = Math.max.apply(null, corridor.map((c) => c.x)) + 1;
    const ch = Math.max.apply(null, corridor.map((c) => c.y)) + 1;

    const connected = (set) => {
      const first = set.values().next().value;
      if (first == null) return false;
      const seen = new Set([first]);
      const q = [first];
      while (q.length) {
        const cur = q.shift();
        const [x, y] = cur.split(',').map(Number);
        for (const [dx, dy] of SK_ORTH) {
          const nk = (x + dx) + ',' + (y + dy);
          if (!set.has(nk) || seen.has(nk)) continue;
          seen.add(nk);
          q.push(nk);
        }
      }
      return seen.size === set.size;
    };

    /**
     * 在 w×h 的盒子里「长」出 target 格：从走廊出发 BFS 扩张。
     * 扩张天然连通，所以不需要事后修补；遇到「补满 2×2」的格子按 50% 概率跳过，
     * 于是骨架里自然散着 1×2 / 2×2 的镶嵌槽，而不是一块实心砖。
     * 盒子装不下就返回 null，交给外层换大一号的盒子。
     */
    const growIn = (w, h) => {
      const offY = Math.max(0, Math.floor((h - ch) / 2));
      const placed = corridor.map((c) => ({ x: c.x, y: c.y + offY }));
      if (placed.some((c) => c.x >= w || c.y >= h)) return null;
      const set = new Set(placed.map(skKey));
      const cells = placed.slice();
      const q = placed.slice();
      const r = skRng(seed ^ (w * 131 + h));
      let guard = 0;
      while (cells.length < target && q.length && guard++ < 20000) {
        const cur = q.shift();
        for (const [dx, dy] of SK_ORTH) {
          if (cells.length >= target) break;
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = nx + ',' + ny;
          if (set.has(k)) continue;
          let square = false;
          for (const [ax, ay] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const c1 = (nx + ax) + ',' + ny;
            const c2 = nx + ',' + (ny + ay);
            const c3 = (nx + ax) + ',' + (ny + ay);
            if (set.has(c1) && set.has(c2) && set.has(c3)) { square = true; break; }
          }
          if (square && r() < 0.5) continue;
          set.add(k);
          cells.push({ x: nx, y: ny });
          q.push({ x: nx, y: ny });
        }
      }
      if (cells.length < target) return null;
      return { alive: set, placed, w, h };
    };

    const boxes = [];
    for (let w = 3; w <= 11; w += 1) {
      for (let h = 2; h <= 7; h += 1) {
        if (w < cw || h < ch) continue;
        const area = w * h;
        if (area < target) continue;
        boxes.push({ w, h, slack: area - target });
      }
    }
    boxes.sort((a, b) => a.slack - b.slack || a.w * a.h - b.w * b.h);

    let carved = null;
    for (const b of boxes) {
      carved = growIn(b.w, b.h);
      if (carved) break;
    }
    if (!carved) return null;

    const list = [...carved.alive].map((k) => {
      const [x, y] = k.split(',').map(Number);
      return { x, y };
    });
    const minX = Math.min(...list.map((c) => c.x));
    const minY = Math.min(...list.map((c) => c.y));
    list.forEach((c) => { c.x -= minX; c.y -= minY; });
    const set = new Set(list.map(skKey));

    const corridorRel = carved.placed.map((c) => ({ x: c.x - minX, y: c.y - minY }));
    const entry = corridorRel[0];
    const exit = corridorRel[corridorRel.length - 1];

    const veins = {};
    list.forEach((c) => { veins[skKey(c)] = ['E']; });
    for (let i = 0; i < corridorRel.length; i += 1) {
      const from = corridorRel[i];
      const to = corridorRel[i + 1];
      const d = to ? skDirOf(from, to) : null;
      veins[skKey(from)] = [d || skDirOf(corridorRel[corridorRel.length - 2], from) || 'E'];
    }
    /* 入口刻线朝外：走廊从入口出发的方向反过来就是「外面」。
       写错这一步（朝了走廊内部）会让布线器在入口格只能往死路走，整块膜永远不通。 */
    veins[skKey(entry)] = [SK_OPP[skDirOf(corridorRel[0], corridorRel[1]) || 'E']];
    veins[skKey(exit)] = [skDirOf(corridorRel[corridorRel.length - 2], corridorRel[corridorRel.length - 1]) || 'E'];

    return {
      cells: list.map((c) => [c.x, c.y]),
      veins,
      entry: [entry.x, entry.y],
      exits: [[exit.x, exit.y]],
      io: {
        clock: { cell: [entry.x, entry.y], dir: veins[skKey(entry)][0] },
        main: { cell: [exit.x, exit.y], dir: veins[skKey(exit)][0] },
      },
      box: { w: carved.w, h: carved.h },
    };
  }

  /* 按稀有度重排 80 门：几何与负荷一起换，文字/招式/等级一概不动 */
  (function reshapeSkeletons() {
    const byRarity = {};
    Object.values(MANUSCRIPTS).forEach((m) => {
      const r = Math.min(7, Math.max(1, m.rarity || 1));
      (byRarity[r] ||= []).push(m);
    });
    Object.keys(byRarity).forEach((key) => {
      const r = Number(key);
      const ladder = SKELETON_LADDER[r];
      if (!ladder) return;
      const list = byRarity[key].sort((a, b) => (a.id < b.id ? -1 : 1));
      const [lo, hi] = ladder.sizes;
      list.forEach((m, i) => {
        /* 一档只有一门时（R6/R7），用稀有度自己在 6~7 之间的位置当进度：44 / 54 */
        const t = list.length > 1 ? i / (list.length - 1) : Math.min(1, Math.max(0, r - 6));
        const target = Math.round(lo + (hi - lo) * t);
        const loadRange = Array.isArray(ladder.load) ? ladder.load : [ladder.load, ladder.load];
        const load = Math.round(loadRange[0] + (loadRange[1] - loadRange[0]) * t);
        const seed = skHash(m.id);
        const shape = skeletalMatrix(target, seed, seed % SKELETON_CORRIDORS.length);
        m.cells = shape.cells;
        m.veins = shape.veins;
        m.entry = shape.entry;
        m.exits = shape.exits;
        m.io = shape.io;
        m.load = load;
        m.targetCells = target;
      });
    });
  })();


  /* ------------------------------ 四大构筑轴 ------------------------------ */
  /* 80 门功法按「它想让对手怎样」分成四轴。轴决定三件事，不重复写 80 遍：
     ① tags（流派标签，也是连携用的 tag）　② passive（被动，一条）　③ 第二/第三个招式长什么样。

       灼烧 burn     低耗铺火，重招引爆。剩余灼烧一次性倒出来 ×1.25
       腐蚀 poison   普攻命中就多跳一跳（快攻/多段流）；corrode 是它的重击面：削防 + 压垮
       流血 bleed    罚动作：对手一起手引导、一换位就被撕一次；对流血目标暴击更高
       护盾 ward     构盾 → 盾击；疗愈 → 给别的门减冷却。攻守循环的接口

     轴是**玩法意图**，不是阵营。一门功法可以被玩家当别的用，但它的第二招永远朝自己那一轴靠。
     世界观上说得通：功法是「沿固定路径反复共振」的方案，方向律决定它只能往一个方向刻深。 */
  /* 标签直接用**机制词**，不用抽象轴名（2026-11-15 统一）：
     玩家要记的是「这门打灼烧还是流血」，不是「灼烧还是流血」。
     轴名仍然留在代码里（burn/poison/corrode/bleed/ward），那是实现，不是台词。 */
  const ETCH_AXES = {
    burn:    { tag: '灼烧', dot: 'burn',    label: '灼烧 · 引爆' },
    poison:  { tag: '中毒', dot: 'poison',  label: '中毒 · 淬刃' },
    corrode: { tag: '腐蚀', dot: 'corrode', label: '腐蚀 · 破甲' },
    bleed:   { tag: '流血', dot: 'bleed',   label: '流血 · 追击' },
    ward:    { tag: '护盾', dot: null,      label: '护盾 · 疗愈' },
  };

  /* 逐门归属。名字和现有招式都保留，这里只回答一个问题：这门想怎么弄死对面。 */
  const AXIS_OF = {
    /* 灼烧 */
    spark: 'burn', wick: 'burn', cinder: 'burn', fieldLamp: 'burn', ember12: 'burn',
    copperWick: 'burn', tinderMesh: 'burn', coalSeam: 'burn', furnaceEye: 'burn',
    mawValve: 'burn', slagHook: 'burn', slagLance: 'burn', kilnMantle: 'burn',
    shutter: 'burn', coilSpring: 'burn', bellows: 'burn', anneal: 'burn', furnaceTong: 'burn',
    /* 中毒（快攻面） */
    awlPoint: 'poison', needle: 'poison', fileTooth: 'poison', torrent: 'poison',
    flurry: 'poison', turbine: 'poison', pulse: 'poison', capstan: 'poison',
    /* 腐蚀（重击面） */
    awl: 'corrode', coreDrill: 'corrode', millStone: 'corrode', surveyLens: 'corrode',
    lodestone: 'corrode', sunder: 'corrode', echo: 'corrode',
    /* 流血 */
    corridor5: 'bleed', razor: 'bleed', pursuit: 'bleed', houndClamp: 'bleed',
    ribRake: 'bleed', ironJaw: 'bleed', jawSpring: 'bleed', quarrySaw: 'bleed',
    splitNeedle: 'bleed', bloodrush: 'bleed', chalkLine: 'bleed', pikeHead: 'bleed',
    beltBuckle: 'bleed', jointHammer: 'bleed', oarlock: 'bleed', shrapnel: 'bleed',
    /* 护盾 */
    bulwark: 'ward', wide14: 'ward', quench: 'ward', leadSeal: 'ward', rivet: 'ward',
    shellScale: 'ward', splitAnvil: 'ward', bronzeGong: 'ward', sentinel: 'ward',
    crucible: 'ward', blackBloom: 'ward', ward: 'ward', ripple: 'ward', suture: 'ward',
    tide: 'ward', dryDock: 'ward', silverTap: 'ward', boneFlute: 'ward', brineWrap: 'ward',
    marrowPin: 'ward', sump: 'ward', tinChime: 'ward', tinThread: 'ward', rushMat: 'ward',
    saltCradle: 'ward', veilStitch: 'ward', glassBell: 'ward', waxTablet: 'ward',
    soundingLine: 'ward',
    /* 双流按「左攻右守」自带两条标签，不归单一轴 */
    twinflow: 'ward',
    inverse: 'corrode',
  };

  /** 被动：一门功法带一条，四门叠加。数值随阶位抬，但都是**加法**，不乘算。
      一律取三位小数——0.06 + 6×0.025 在浮点里会变成 0.21000000000000002，
      那个数会原样进界面和存档，看着像 bug。 */
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const AXIS_PASSIVE = {
    burn: (r) => ({ dotMult: r3(0.06 + r * 0.02) }),
    poison: (r) => ({ poisonOnBasic: r3(0.03 + r * 0.015) }),
    corrode: (r) => ({ dotMult: r3(0.05 + r * 0.015) }),
    bleed: (r) => ({ bleedCritBonus: r3(0.03 + r * 0.02) }),
    ward: (r) => ({ shieldGainMult: r3(0.06 + r * 0.025) }),
  };

  /* 第二/第三个招式。参数随阶位小幅上抬，但形状（触发条件 + 打什么）由轴固定：
     这样玩家看「这是灼烧的」就能猜到第二招要引爆，不用背 80 条。 */
  const AXIS_SKILLS = {
    burn: {
      combo: (r) => ({
        name: '复燃', cost: r >= 4 ? 6 : 4, castTime: 0.5, cooldown: r >= 4 ? 6 : 5,
        cond: { targetHasDot: 'burn' }, target: 'frontFoe',
        effect: { mult: r >= 4 ? 1.6 : 1.4, detonateDot: 'burn' },
      }),
      deep: () => ({
        name: '回炉引火', cost: 4, castTime: 0.65, cooldown: 5, cond: { minTier: 2 },
        target: 'frontFoe',
        effect: { mult: 1.7, detonateDot: 'all', dot: { k: 'burn', dmgMult: 0.3, hits: 3 } },
      }),
    },
    poison: {
      combo: (r) => ({
        name: '追淬', cost: 4, castTime: 0.45, cooldown: 4.5,
        cond: { targetHasDot: 'poison' }, target: 'lowestHpFoe',
        effect: {
          mult: 1.3 + (r >= 4 ? 0.15 : 0),
          bonusIfDot: { k: 'poison', mult: 1.25 },
          dot: { k: 'poison', dmgMult: 0.18, hits: 3 },
        },
      }),
      deep: () => ({
        name: '淬深', cost: 4, castTime: 0.5, cooldown: 4.5, cond: { minTier: 2 },
        target: 'frontFoe',
        effect: { mult: 1.45, hits: 2, dot: { k: 'poison', dmgMult: 0.2, hits: 4 } },
      }),
    },
    corrode: {
      combo: (r) => ({
        name: '剥锈', cost: 5, castTime: 0.55, cooldown: 5,
        cond: { targetHasDot: 'corrode' }, target: 'frontFoe',
        effect: {
          mult: 1.55 + (r >= 4 ? 0.2 : 0),
          bonusIfDot: { k: 'corrode', mult: 1.3 },
          dot: { k: 'corrode', dmgMult: 0.16, hits: 3 },
        },
      }),
      deep: () => ({
        name: '酸底', cost: 4, castTime: 0.6, cooldown: 5, cond: { minTier: 2 },
        target: 'frontFoe',
        effect: { mult: 1.5, splash: 0.45, dot: { k: 'corrode', dmgMult: 0.22, hits: 4 } },
      }),
    },
    bleed: {
      combo: (r) => ({
        name: '续裂', cost: 4, castTime: 0.45, cooldown: 4.5,
        cond: { targetHasDot: 'bleed' }, target: 'frontFoe',
        effect: {
          mult: 1.4 + (r >= 4 ? 0.2 : 0),
          bonusIfDot: { k: 'bleed', mult: 1.2 },
          dot: { k: 'bleed', dmgMult: 0.22, hits: 3 },
        },
      }),
      deep: () => ({
        name: '割喉', cost: 4, castTime: 0.6, cooldown: 5, cond: { minTier: 2 },
        target: 'lowestHpFoe',
        effect: { mult: 1.9, bonusIfDot: { k: 'bleed', mult: 1.35 }, dot: { k: 'bleed', dmgMult: 0.26, hits: 2 } },
      }),
    },
    ward: {
      /* 已经会打的门补「疗愈 + 冷却互馈」，已经会疗的门补「盾击」，攻守互换 */
      combo: (m) => ((m.skills || []).some((s) => s.effect && s.effect.heal)
        ? {
          name: '盾击', cost: 5, castTime: 0.5, cooldown: 5,
          cond: { selfHasShield: true }, target: 'frontFoe',
          effect: { mult: 1.15 + m.rarity * 0.06, shieldScale: 0.6 },
        }
        : {
          name: '续息', cost: 4, castTime: 0.5, cooldown: 5,
          cond: { alliesHurt: 1 }, target: 'ally',
          effect: { heal: 0.85, cdrOther: 1 },
        }),
      deep: () => ({
        name: '回锋', cost: 4, castTime: 0.55, cooldown: 5, cond: { minTier: 2 },
        target: 'frontFoe',
        effect: { mult: 1.4, shieldScale: 0.8, shield: 0.12 },
      }),
    },
  };

  (function wireAxes() {
    Object.values(MANUSCRIPTS).forEach((m) => {
      const axisKey = AXIS_OF[m.id];
      if (!axisKey) return;
      const axis = ETCH_AXES[axisKey];
      m.axis = axisKey;
      m.tags = [...new Set([axis.tag, ...(m.tags || [])])];
      m.passive = AXIS_PASSIVE[axisKey](m.rarity);

      /* ① 已有招式：打上 tag（连携判定用），并把异常类型改成自己那一轴 */
      (m.skills || []).forEach((sk) => {
        sk.tag = sk.tag || axis.tag;
        if (sk.effect && sk.effect.dot && !sk.effect.dot.k) sk.effect.dot.k = axis.dot || 'burn';
      });

      /* ② spark 是唯一没有招式的门：补一个低耗高频起手，让它成为火系的入门组件 */
      if (m.id === 'spark' && !(m.skills || []).length) {
        m.skills = [{
          id: 'spark-1', name: '迸火', cost: 3, castTime: 0.35, cooldown: 3,
          cond: { attackCount: 3 }, target: 'frontFoe',
          effect: { mult: 0.9, dot: { k: 'burn', hits: 2, dmgMult: 0.25 } },
          tag: axis.tag,
        }];
      }

      /* ③ 2–3 阶：补一个异常/连携追击招。条件永远是「目标身上已经有我这一轴的异常」 */
      if (m.rarity >= 2 && m.rarity <= 3) {
        const tpl = AXIS_SKILLS[axisKey].combo(m);
        m.skills.push({ id: `${m.id}-c2`, tag: axis.tag, ...tpl });
      }

      /* ④ 4–5 阶：第二招要两个条件同时满足——共鸣阶拼到位，**而且**刚刚放过同轴的招。
         「拼图 + 接续」两条都做到才给完整招式组，这是高阶门唯一的门槛设计。 */
      if (m.rarity >= 4 && m.rarity <= 5 && (m.skills || []).length < 2) {
        const tpl = AXIS_SKILLS[axisKey].deep(m);
        tpl.cond = { ...tpl.cond, afterTag: axis.tag };
        m.skills.push({ id: `${m.id}-c2`, tag: axis.tag, ...tpl });
      }

      /* ⑤ 带连携条件的门，被动里补一条「接续返还余裕」——不然接上了却付不起余裕 */
      if ((m.skills || []).some((sk) => sk.cond && sk.cond.afterTag)) m.passive.comboCdr = 1;
    });

    /* ⑤ 双流：左流挂流血、右流挂护盾，合流要求「刚放完左流」——一门之内也能连携 */
    const twin = MANUSCRIPTS.twinflow;
    twin.tags = ['灼烧', '流血', '护盾'];
    twin.skills.forEach((sk) => {
      if (sk.effect && sk.effect.heal) { sk.tag = '护盾'; }
      else { sk.tag = '流血'; sk.effect = { ...sk.effect, dot: { k: 'bleed', dmgMult: 0.24, hits: 3 } }; }
    });
    twin.skills.push({
      id: 'twinflow-c3', name: '合流', tag: '流血',
      cost: 12, castTime: 0.85, cooldown: 8,
      cond: { minTier: 2, afterTag: '流血' }, target: 'frontFoe',
      effect: { mult: 2.0, pierce: 2, detonateDot: 'all', shield: 0.15, stressDelta: -10 },
    });
    /* 合流也吃「接续返还余裕」：它的门槛同样是 afterTag */
    twin.passive.comboCdr = 1;

    /* ⑥ 高压流：灼烧与流血的 3–5 阶各补一门「压线重击」。
       这两轴本来就是「先把自己逼紧再打」的路子，但此前 142 个招式里只有 1 个 stressAbove，
       等于高压打法没有牌可打。八门新招共同的三条设计：
         · 门槛 50 或 70——50 是「已经吃到第一档红利」，70 是「快到悬崖」；
         · 倍率/贯穿都比同阶常规招高一档，但**每发都回压 6~12 点**，
           所以它不是让你一直压在 100，而是让你在 80–99 之间走钢丝；
         · 全部是第三招（slot 3），不挤掉原有的核心招与连携招。 */
    const PRESSURE_SKILLS = {
      /* 灼烧 */
      ember12: { name: '焚身', cost: 5, castTime: 0.55, cooldown: 5, stress: 60,
        effect: { mult: 1.9, bonusIfDot: { k: 'burn', mult: 1.3 }, stressDelta: -8 } },
      copperWick: { name: '滴穿', cost: 4, castTime: 0.5, cooldown: 4.5, stress: 50,
        effect: { mult: 1.6, pierce: 2, stressDelta: -6 } },
      tinderMesh: { name: '筛落', cost: 5, castTime: 0.6, cooldown: 5, stress: 50,
        effect: { mult: 1.5, splash: 0.5, dot: { k: 'burn', dmgMult: 0.24, hits: 2 }, stressDelta: -8 } },
      coalSeam: { name: '压层', cost: 5, castTime: 0.65, cooldown: 5, stress: 60,
        effect: { mult: 2.1, detonateDot: 'burn', stressDelta: -10 } },
      /* 流血 */
      razor: { name: '开膛', cost: 5, castTime: 0.55, cooldown: 5, stress: 50,
        effect: { mult: 1.8, bonusIfDot: { k: 'bleed', mult: 1.35 }, stressDelta: -8 } },
      bloodrush: { name: '再注', cost: 5, castTime: 0.6, cooldown: 5, stress: 60,
        effect: { mult: 2.0, dot: { k: 'bleed', dmgMult: 0.26, hits: 3 }, stressDelta: -12 } },
      ironJaw: { name: '咬死', cost: 4, castTime: 0.5, cooldown: 4.5, stress: 50,
        effect: { mult: 1.55, shieldScale: 0.5, stressDelta: -6 } },
      quarrySaw: { name: '锯回', cost: 5, castTime: 0.6, cooldown: 5, stress: 60,
        effect: { mult: 1.9, pierce: 3, stressDelta: -10 } },
    };
    Object.entries(PRESSURE_SKILLS).forEach(([id, spec]) => {
      const m = MANUSCRIPTS[id];
      if (!m) return;
      const axis = ETCH_AXES[m.axis];
      m.skills.push({
        id: `${id}-c3`, name: spec.name, tag: axis.tag,
        cost: spec.cost, castTime: spec.castTime, cooldown: spec.cooldown,
        cond: { stressAbove: spec.stress }, target: 'frontFoe', effect: spec.effect,
      });
      m.tags = [...new Set([...m.tags, '高压'])];
      /* 多一门招式就要多一份余裕供给，否则第三招只是把主招的份额抢走。
         实测：煤层三招 7/5/5、回裕 1.0，主招被她自己的追打挤到 0.22 次/场。
         规则：拿到第三招的门回裕 +0.25，不动主招价格（价格是这门功法的气质）。

         **必须先克隆再改**：变体（ETCHING_VARIANTS）是浅拷贝出来的，
         `coalSeam.energy` 和 `spark.energy` 是同一个对象，直接 `m.energy.regen = …`
         会顺手改掉 base 和所有同 base 的门（实测把 corridor5 的 1.0 也改成了 1.25）。 */
      m.energy = { ...m.energy, regen: r3(m.energy.regen + 0.25) };
    });

    /* ⑥ 逆脉：三招递进——挂腐蚀、高压反制、三阶引爆 */
    const inv = MANUSCRIPTS.inverse;
    const base = inv.skills[0];
    base.name = '逆冲';
    /* 三招同池之后，主招 10 点（最贵的一门）会在 6 点与 9 点的两个追打之间永远排不上队：
       实测高压队里场均 0.14 次，等于这门功法的招牌没出过手。压到 8 点。 */
    base.cost = 8;
    base.effect = { ...base.effect, dot: { k: 'corrode', dmgMult: 0.28, hits: 3 } };
    base.tag = '腐蚀';
    inv.skills.push({
      id: 'inverse-c2', name: '倒灌', tag: '护盾',
      cost: 6, castTime: 0.5, cooldown: 6,
      cond: { stressAbove: 50 }, target: 'frontFoe',
      effect: { mult: 1.2, shield: 0.22, stressDelta: -12 },
    });
    inv.skills.push({
      id: 'inverse-c3', name: '无回', tag: '腐蚀',
      cost: 9, castTime: 0.9, cooldown: 7,
      cond: { minTier: 3 }, target: 'frontFoe',
      effect: { mult: 2.6, pierce: 3, detonateDot: 'all' },
    });
  })();

  /* 共鸣阶名统一成「共鸣一阶 · 后缀」（2026-11-15）：
     80 门原来各写各的「一阶 · 起手 / 二阶 · 顺手」，玩家得自己换算这是第几阶。
     这里按数组顺序归一，后缀（风味）一律保留；重复跑也只会得到同一个结果。 */
  const TIER_CN = ['一', '二', '三', '四', '五'];
  Object.values(MANUSCRIPTS).forEach((m) => {
    (m.tiers || []).forEach((t, i) => {
      const suffix = String(t.name || '')
        .replace(/^共鸣/, '')
        .replace(/^[一二三四五]阶\s*·?\s*/, '')
        .trim();
      t.name = `共鸣${TIER_CN[i] || String(i + 1)}阶${suffix ? ` · ${suffix}` : ''}`;
    });
  });

  function manuscript(id) { return Object.hasOwn(MANUSCRIPTS, id) ? MANUSCRIPTS[id] : null; }

  /** 同深度优先发现新蚀刻法，全部发现后才重复。@param {object} st @param {number} depth @returns {object|null} */
  function manuscriptReward(st, depth) {
    const copies = new Map();
    for (const m of [...(st.manuscriptVault || []), ...st.roster.flatMap(V.State.manuscriptsOf)]) {
      copies.set(m.id, (copies.get(m.id) || 0) + 1);
    }
    const primary = MANUSCRIPTS[MANUSCRIPT_ORDER[Math.max(0, Math.min(6, depth - 1))]];
    const pool = Object.values(MANUSCRIPTS).filter((m) => !m.fieldSource && m.unlockDepth <= depth);
    if (!pool.length || (primary && !copies.has(primary.id))) return primary || null;
    /* 先补缺本；持有数相同，优先本层主线和最近开放的谱目。 */
    pool.sort((a, b) => (copies.get(a.id) || 0) - (copies.get(b.id) || 0)
      || Number(b === primary) - Number(a === primary) || b.unlockDepth - a.unlockDepth);
    return pool[0];
  }

  /* ------------------------------ 祝福 ------------------------------ */
  const BLESSINGS = {
    edge: { id: 'edge', name: '锐利', desc: '普通攻击伤害 +15%。', effect: { mainDmg: 0.15 } },
    guard: { id: 'guard', name: '厚重', desc: '全队受到的伤害 -10%。', effect: { dmgTaken: -0.10 } },
    flow: { id: 'flow', name: '起势', desc: '每场战斗开始时直接获得 2 余裕。', effect: { startEnergy: 2 } },
    scavenger: { id: 'scavenger', name: '拾荒', desc: '金币收获 +20%。', effect: { gold: 0.2 } },
    mend: { id: 'mend', name: '缝补', desc: '每层结束时全队恢复 12% 生命。', effect: { floorHeal: 0.12 } },
    pact: { id: 'pact', name: '禁忌契约', desc: '普通攻击伤害 +25%，压力获取 +25%。', effect: { mainDmg: 0.25, stress: 0.25 } },
  };
  const BLESSING_ORDER = ['edge', 'guard', 'flow', 'scavenger', 'mend', 'pact'];

  /* ------------------------------ 事件 ------------------------------ */
  /* 一条事件的骨架：一句现场 → 两个以上代价不同的选项 → 一句结果。
     选项字段：
       need   门槛，不满足时按钮禁用并说明原因
       effects 直接结算的收益/代价
       gamble 赌局：先掷一次，再按 win/lose 结算
       combat 进入战斗
       then   结算后紧接着另一条事件
     最后一条选项一律无门槛、无惩罚，自动模拟与保守玩家都靠它收尾。 */
  const EVENTS = {
    fogFork: {
      id: 'fogFork', title: '雾中的岔路', minFloor: 1,
      text: '雾里分出三条路。地上有血迹，也有拖痕。',
      choices: [
        {
          id: 'blood', label: '走血迹', hint: '迎战，赢了才有东西',
          combat: { kind: 'normal' },
          text: '血迹尽头不是尸体——那东西还站着。它抬起头，看见了你们。',
        },
        {
          id: 'tracks', label: '跟拖痕', hint: '拿到纹路，但有人受伤',
          effects: { loot: 1, damagePct: 0.08 },
          text: '拖痕尽头是一堆被扯开的纹路。有人被绊倒，膝盖见了血。',
        },
        {
          id: 'middle', label: '走中间', hint: '没有收获，也没有风险',
          text: '你们走了中间。什么也没有发生，这本身就是好消息。',
        },
      ],
    },
    wallKnock: {
      id: 'wallKnock', title: '墙里的敲击', minFloor: 1,
      text: '三下，停，三下。墙是实的，声音不是。',
      choices: [
        {
          id: 'break', label: '凿开墙', hint: '可能拿到纹路，也可能惊动东西',
          effects: { loot: 1, stress: 12 },
          text: '墙后面塞着一具旧尸，手里攥着还能用的纹路。',
        },
        {
          id: 'listen', label: '贴着听', hint: '压力降低，没有收获',
          effects: { stress: -10 },
          text: '你们听了一会儿。敲击停了。有人发现自己一直在屏住呼吸。',
        },
      ],
    },
    scrapPile: {
      id: 'scrapPile', title: '堆叠的残骸', minFloor: 1,
      text: '一整面墙都是拆到一半的东西。有几块还在发微光。',
      choices: [
        {
          id: 'dig', label: '翻找', hint: '拿到纹路',
          effects: { loot: 1, damagePct: 0.05 },
          text: '翻到一件还能用的。手指被划开一道口子。',
        },
        {
          id: 'leave', label: '不碰', hint: '什么也不发生',
          text: '你们绕开了。身后的光慢慢暗下去。',
        },
      ],
    },
    hungerPot: {
      id: 'hungerPot', title: '冷锅', minFloor: 2,
      text: '锅还在冒气，三只碗摆在石头边。碗底沉着几节指骨。',
      choices: [
        {
          id: 'share', label: '添一把料，重新分', hint: '消耗 1 份随身食材，全队回血、压压惊',
          need: { ingredient: 1 },
          effects: { consumeIngredient: 1, healPct: 0.18, stress: -6 },
          text: '你们把料丢进锅里，等它重新滚起来。没人去问上一桌是谁。',
        },
        {
          id: 'taste', label: '只喝汤', hint: '少量回复，压力上升',
          effects: { healPct: 0.07, stress: 8 },
          text: '汤是咸的，后味发甜。喝完之后，有人一直舔自己的牙。',
        },
        {
          id: 'leave', label: '不动别人的饭', hint: '什么也不发生',
          text: '你们从锅边绕过去。走出十几步，汤还在冒气。',
        },
      ],
    },
    mothLantern: {
      id: 'mothLantern', title: '灯蛾灯笼', minFloor: 2,
      text: '铁笼里挤满灯蛾，翅膀把光磨成粉。笼门是用布条缠上的。',
      choices: [
        {
          id: 'take', label: '连笼一起收走', hint: '得到 3 份食材，压力上升',
          effects: { ingredient: { pool: 'forage', n: 3 }, stress: 5 },
          text: '蛾粉落进你们的袖口，一直亮到走廊尽头。',
        },
        {
          id: 'rest', label: '就着光坐一会', hint: '全队回血、压力下降',
          effects: { healPct: 0.1, stress: -6 },
          text: '你们轮流把手伸到笼边烤着。光不热，但人慢慢安静下来。',
        },
        {
          id: 'open', label: '放它们走', hint: '不取东西，压力下降',
          effects: { stress: -8 },
          text: '布条一解开，光就散进雾里。回廊看起来宽了一点。',
        },
      ],
    },
    ledgerStall: {
      id: 'ledgerStall', title: '记账摊', minFloor: 2,
      text: '摊后没有人。账页自己翻，笔尖悬在纸上，等一个名字。',
      choices: [
        {
          id: 'sign', label: '签上名字', hint: '60 金币，换一门蚀刻法',
          need: { gold: 60, noFieldManuscript: true },
          effects: { gold: -60, manuscript: 'event' },
          then: 'ledgerPage',
          text: '笔尖落下去，纸面吸走了墨。柜台上多出一卷还没凉透的蚀刻法。',
        },
        {
          id: 'read', label: '翻几页', hint: '得到金币，压力上升',
          effects: { gold: 25, stress: 10 },
          text: '账上全是别人的欠款，每条后面都写着同一个日期。你们带走了一点零钱。',
        },
        {
          id: 'pass', label: '不碰别人的账', hint: '什么也不发生',
          text: '你们走开了。翻页声在身后停了半拍，又继续。',
        },
      ],
    },
    boneChoir: {
      id: 'boneChoir', title: '骨合唱', minFloor: 3,
      text: '十几具骸骨跪成一圈，唱一个很长的音。它们在念名字。',
      choices: [
        {
          id: 'join', label: '跟着哼', hint: '压力大降，本趟生命上限 -5%',
          effects: { stress: -18, maxHpPct: -0.05 },
          text: '你们跟着哼到那个音结束。有人觉得胸腔里空了一块，但心里轻了。',
        },
        {
          id: 'break', label: '打断它们', hint: '迎战，赢了才有东西',
          combat: { kind: 'normal' },
          text: '你们踩进圈里。唱声断了，所有头一起转过来。',
        },
        {
          id: 'cover', label: '捂住耳朵绕开', hint: '压力上升',
          effects: { stress: 6 },
          text: '那个音跟着你们走了很久，像有人贴着后颈在念。',
        },
      ],
    },
    bellSlack: {
      id: 'bellSlack', title: '停摆的钟', minFloor: 3,
      text: '钟停在最高处。钟舌上缠着布，布上有暗色的字。',
      choices: [
        {
          id: 'ring', label: '解开布条敲下去', hint: '一半机会得祝福，一半全队重伤',
          gamble: {
            chance: 0.5,
            win: { text: '钟声把回廊震松了一块，某种力量留在了你们身上。', effects: { blessing: 1 } },
            lose: { text: '钟声反弹回来。所有人耳朵里都是血，站了很久才听见彼此。', effects: { hurtPct: 0.18, stress: 16 } },
          },
        },
        {
          id: 'cut', label: '割下布条带走', hint: '得到金币，压力上升',
          effects: { gold: 40, stress: 6 },
          text: '布条上的字被你们折了起来。钟没有说话。',
        },
        {
          id: 'leave', label: '让它停着', hint: '什么也不发生',
          text: '你们从钟下面走过去。影子被钟口切成一截一截。',
        },
      ],
    },
    paleSurgeon: {
      id: 'paleSurgeon', title: '苍白手术师', minFloor: 4,
      text: '它把工具一件件摊开，手势比说话清楚：它可以拿出你们需要的东西，只要一点「材料」。',
      choices: [
        {
          id: 'deal', label: '交出一点生命', hint: '本趟全队生命上限 -15%，换一门蚀刻法',
          need: { noFieldManuscript: true },
          effects: { maxHpPct: -0.15, manuscript: 'event' },
          text: '它的刀很薄，几乎不疼。你们各自少了一点什么，柜台上的蚀刻法慢慢显出来。',
        },
        {
          id: 'ask', label: '问它用什么换', hint: '压力上升',
          effects: { stress: 8 },
          text: '它指了指你们每个人的胸口，然后把工具收了起来。',
        },
        {
          id: 'refuse', label: '拒绝', hint: '压力下降',
          effects: { stress: -5 },
          text: '你们退开。它没有追，只是把刀擦干净，等下一批客人。',
        },
      ],
    },
    /* 只由「记账摊」签名接出来的第二段；不进随机池，所以不在 EVENT_ORDER 里。 */
    ledgerPage: {
      id: 'ledgerPage', title: '账页背面', minFloor: 2,
      text: '名字下面多出一行小字：还差一笔。笔尖又转了回来。',
      choices: [
        {
          id: 'pay', label: '再付一笔', hint: '40 金币，换 1 件遗物',
          need: { gold: 40 },
          effects: { gold: -40, shards: 1 },
          text: '小字被划掉了。柜台上多了一枚温热的旧币。',
        },
        {
          id: 'erase', label: '把名字擦掉', hint: '六成机会无事，四成全队受伤',
          gamble: {
            chance: 0.6,
            win: { text: '墨迹被手指抹开，账页安静下来。', effects: { stress: -8 } },
            lose: { text: '纸面反咬了一口。指腹裂开，血滴在账上又被吸干。', effects: { hurtPct: 0.1, stress: 12 } },
          },
        },
        {
          id: 'close', label: '合上账本', hint: '什么也不发生',
          text: '你们把账合上。它在手里还是热的，像刚被人合过。',
        },
      ],
    },
    deepWell: {
      id: 'deepWell', title: '深井', minFloor: 5,
      text: '井壁上全是向上的抓痕，最深处的抓痕最新。',
      choices: [
        {
          id: 'descend', label: '下到井底', hint: '45% 得金币与祝福，否则全队重伤',
          gamble: {
            chance: 0.45,
            win: { text: '井底堆着没被拿走的东西，还有一块还热着的金属。', effects: { gold: 80, blessing: 1 } },
            lose: { text: '井壁开始合拢。你们爬上来的时候，少了半条命。', effects: { hurtPct: 0.26, stress: 18 } },
          },
        },
        {
          id: 'bucket', label: '放桶打水', hint: '得到食材，有人擦伤',
          effects: { ingredient: { pool: 'forage', n: 2 }, damagePct: 0.05 },
          text: '水是凉的，桶底沉着能下锅的东西。绳子磨破了手。',
        },
        {
          id: 'leave', label: '不下', hint: '什么也不发生',
          text: '你们把绳子收回来，井里安静得像在等。',
        },
      ],
    },
  };
  const EVENT_ORDER = ['fogFork', 'wallKnock', 'scrapPile', 'hungerPot', 'mothLantern', 'ledgerStall', 'boneChoir', 'bellSlack', 'paleSurgeon', 'deepWell'];

  /** 当前层可发生的事件池。层域决定难度，早期不给手术师与深井。 */
  function eventPool(floor) {
    return chapterAt(floor).events.filter((id) => {
      const ev = EVENTS[id];
      return ev && (ev.minFloor || 1) <= floor && floor <= (ev.maxFloor || DESIGN.maxFloor);
    });
  }

  /* ------------------------------ 招募外观 ------------------------------ */
  /* 每位来客自带一块专属生命金属（形态 + 独立 seed）。
     形态只有 14 种，但 seed 逐人不同，所以全营 21 块金属互不重复。 */
  /* 十四位传奇，一人一型：金属形态缩到 14 之后，传奇数量同步缩到 14。
     一型只有一个人，所以「每个人的生命金属都不同」是事实，不需要靠 seed 去撞。
     后八位沿用 wanderer0..7 的 id 与图集格序——立绘资源按这个顺序切的，别动。

     出身按《世界观总纲》三、七节落：两块大陆，各三个国家。
     **苍梧（东洲）三国都走功法，属东；奥伦（西洲）三国都走炼金术，属西。**
     所以「族属」不是玩家能选的阵营，是地理——他生在哪块大陆，就用那边的词叫同一块铁。
     六国各有各的做派，营地不是「东方人／西方人」两堆，是六堆混在一起：

       钧天   功法产业链制度化到极致（修行者=特殊公务员，宗门=教育部+研究院+企业）
               → 制式功法、统一教材、档案编号。**注意：发的不是铁，是蚀刻法。**
                 那块金属是娘胎里带的（总纲 §4.4：总量从生到死不变，外部补不了、也造不出），
                 所以谁也发不了、换不了、配不了。钧天能发的只有三样：
                 你练哪一门（统一教材）、怎么练（教学大纲）、认哪一版（拓版母本）；
                 再给你的铁建一份档案、发一个登记号——它值多少保费、能领多少例钱，全看这个号。
                 讽刺的是，这事跟大洋对岸的圣髑院一模一样：都在给一块天生长出来的铁编号，
                 一个叫「档案」，一个叫「登记册」。两边政府都没能造出一块铁，只造出了一套纸。
       琉光   西南高原，器物修行，矿脉新贵正在挑旧血统 → 矿业、采空、塌陷。
       朔方   北方草原，血脉觉醒不修功法，萨满=政治领袖，与诺德海姆有亲缘。
               → 「不修功法」在这里是字面意思：朔方人连那套发下来的东西都没有。
       格雷沙姆 奥伦霸主，符文阵列派，把炼金术当编程，自认「炼金术的罗马」。
               → 圣髑院就在这里：挂王室敕许的结社，管《圣铁登记册》，
                 实际是「国际炼金术标准委员会」的执行机构。罗马的合法性来自圣髑。
       沃尔芬 北方工业强国，材料共振派，企业即宗门，专利替代师承。
               → 炼金术在这里是专利：可买卖、可授权、可继承，就是不能白学。
       碎片地带 东南沿海+岛屿链，前殖民地小邦群，跨体系融合与灰色实验场。

     一句话把三层分清楚（改名时别搞混，见 backlog B4）：
     **金属天生（改不了）→ 功法/炼金术可发可传（发的是这个）→ 纹刻不出来（学得会，刻不出）。**

     origin 是他具体的来处（哪个衙门、哪条产线、哪座塔），立绘照这个定服饰和光。
     culture 由 home 推出来，不单独写——写了就会有人把「琉光的人」标成西边。 */
  const HOME_SIDE = {
    钧天: 'east', 琉光: 'east', 朔方: 'east',
    格雷沙姆: 'west', 沃尔芬: 'west', 碎片地带: 'west',
  };

  const SKIN_LIST = [
    /* 象笏（竖贯）：竖贯是他天生的形状，不是谁发的。总局发的是腰牌上的登记号，
       以及他练的那一门制式功法——他押的谱箱里装的就是全国统一的那一版。 */
    { id: 'blade', name: '铁鸦', portrait: 'portrait.blade', metal: 'agile', home: '钧天', origin: '修行管理总局 · 铁路押运组' },
    /* 悬针（盾）：北塔的守卫，帝国衰落了还在按旧规值夜。 */
    { id: 'warden', name: '磐石', portrait: 'portrait.warden', metal: 'aegis', home: '格雷沙姆', origin: '圣髑院 · 北塔' },
    /* 玄璜（半璧礼北方）：朔方的萨满学徒，血脉唤不醒，只唤出一把灰。 */
    { id: 'ranger', name: '灰烬', portrait: 'portrait.ranger', metal: 'arc', home: '朔方', origin: '萨满帐 · 唤血不成' },
    /* 鉴燧之齐（金锡各半）：给器物做频率检定的人，一辈子在照别人的纹。 */
    { id: 'warlock', name: '低语', portrait: 'portrait.warlock', metal: 'throat', home: '格雷沙姆', origin: '圣髑院 · 下厅检定台' },
    /* 并蒂（一茎两花）：碎片地带的作品，两套体系长在一块金属上。 */
    { id: 'cleric', name: '烛火', portrait: 'portrait.cleric', metal: 'twin', home: '碎片地带', origin: '双烛堂 · 东式器物接西式符文' },
    /* 轮牙（齿轮的牙）：被大厂专利卡死的小厂技师。 */
    { id: 'rogue', name: '暗巷', portrait: 'portrait.rogue', metal: 'ratchet', home: '沃尔芬', origin: '军工企业 · 外包车间' },
    ...['断齿', '冷炉', '旧钉', '褪色', '长夜', '哑钟', '霜线', '赤砾'].map((name, portraitCell) => ({
      id: 'wanderer' + portraitCell, name, portraitCell,
      /* 依次是：地不满东南 / 浑沌未凿 / 栉比 / 溯洄从之 / 凿户牖 / 四达之衢 / 九层之台 / 楚腰 */
      metal: ['corner', 'sturdy', 'spine', 'ripple', 'conduit', 'crucible', 'terrace', 'waist'][portraitCell],
      /* 依次是：琉光 钧天 沃尔芬 钧天 格雷沙姆 碎片地带 朔方 琉光
         —— 七东七西，六个国家都有，不按强弱分：琉光那个缺着角，格雷沙姆那个凿了窗。 */
      home: ['琉光', '钧天', '沃尔芬', '钧天', '格雷沙姆', '碎片地带', '朔方', '琉光'][portraitCell],
      /* 依次是：采空区 / 拓版铸坊 / 船厂铆接线 / 被大纲刷掉的旁支 /
         圣髑院地库 / 路口钟楼 / 极北针叶林 / 一条快采空的富脉 */
      origin: ['采空区 · 东南缘塌陷带', '拓版铸坊', '船厂 · 铆接流水线', '被教学大纲刷下的旁支',
        '圣髑院 · 地库方厅', '路口 · 一座不响的钟楼', '极北针叶林 · 垒台体修', '矿产新贵 · 只剩一条细脉'][portraitCell],
    })),
  ];

  /* culture 只在这里算一次：写在 home 上就够，写两遍迟早对不上 */
  const SKINS = SKIN_LIST.map((s) => ({ ...s, culture: HOME_SIDE[s.home] || 'east' }));

  const NAMES = ['铁鸦', '磐石', '灰烬', '低语', '烛火', '暗巷', '断齿', '冷炉', '旧钉', '褪色', '长夜', '哑钟'];

  /* ------------------------------ 查表工具 ------------------------------ */
  function body(id) { return BODIES[id] || BODIES.sturdy; }

  /** 底盘长成哪一相。这一相有两套正名，默认给东土《铁相录》那套。
      culture='west' 时返回圣髑院登记册上的形制名（塔盾、圣物匣），因为那人信那一套。
      同一块铁在营地里被两边的人用两种叫法喊，不是翻译问题，是学派问题。 */
  function bodyStyle(id, culture) {
    const arch = V.PlateGen && V.PlateGen.ARCHETYPES[body(id).archetype];
    if (!arch) return '';
    if (culture === 'west' && arch.west) return arch.west.zh;
    return arch.name;
  }

  /** 某位传奇用哪一套叫法。查不到就当东土，别让界面空着。 */
  function cultureOf(skinId) {
    const s = SKINS.find((x) => x.id === skinId);
    return (s && s.culture) || 'east';
  }

  /** 他生在哪一国（钧天/琉光/朔方/格雷沙姆/沃尔芬/碎片地带）。
      界面拿它写出身，立绘拿它定服饰——「东边的人」太粗，六国才是能画的单位。 */
  function homeOf(skinId) {
    const s = SKINS.find((x) => x.id === skinId);
    return (s && s.home) || '';
  }

  /** 出身一句话：国家 · 具体来处。查不到就留空，不编。 */
  function originOf(skinId) {
    const s = SKINS.find((x) => x.id === skinId);
    if (!s) return '';
    return s.origin ? `${s.home} · ${s.origin}` : s.home;
  }

  /** 相名的出处（哪本书、哪句话）。界面拿它做悬停提示——
      正名是从旧书里摘的词，不标出处，玩家只会觉得「这名字古里古怪」。 */
  function bodySource(id) {
    const arch = V.PlateGen && V.PlateGen.ARCHETYPES[body(id).archetype];
    return arch ? arch.source || '' : '';
  }

  /** 西方圣髑院《圣铁登记册》给同一相起的名字。两套名字并存不是冗余：
      东方问「它像什么」，西方问「它该归入哪一类」——两种文明的正名。 */
  function bodyWest(id) {
    const arch = V.PlateGen && V.PlateGen.ARCHETYPES[body(id).archetype];
    return (arch && arch.west) || { name: '', zh: '', form: '' };
  }
  function weapon(id) { return WEAPONS[id] || WEAPONS.shortBlade; }
  function template(id) { return TEMPLATES[id] || TEMPLATES.straight; }
  function enemy(id) { return ENEMIES[id] || ENEMIES.bone; }
  function nodeType(id) { return NODE_TYPES[id] || NODE_TYPES.battle; }
  function blessing(id) { return BLESSINGS[id] || null; }
  function event(id) { return EVENTS[id] || EVENTS.fogFork; }

  /* 瘢痕按来源纹路保留正负两面，只在所在金属格被填充时激活。 */
  const SCAR_EFFECTS = {
    straight: { atk: 1, def: -1 },
    elbow: { def: 1, atk: -1 },
    splitter: { atk: 2, maxHp: -4 },
    capacitor: { maxHp: 4, atk: -1 },
    threshold: { def: 2, maxHp: -4 },
    ember: { atk: 2, def: -1 },
  };

  for (const tpl of Object.values(TEMPLATES)) {
    if (tpl.family) SCAR_EFFECTS[tpl.id] = SCAR_EFFECTS[tpl.family];
  }

  V.Data = {
    SCAR_EFFECTS,
    DESIGN, CHAPTERS, rewardNodes, rewardTier, chapterAt, chapterLabel, chapterEncounter, BODIES, WEAPONS, WEAPON_ORDER, GUARD,
    TEMPLATES, TEMPLATE_ORDER, PRESETS, EMBER_FIXTURE, STRAIGHT_PARK,
    CONDITIONS, THRESHOLDS, TARGETS, ACTIONS, defaultGambits,
    MODS, ENEMIES, ENEMY_ORDER, ELITE_ORDER, BOSS_ORDER, BIOMES, biome, encounterTemplate,
    MANUSCRIPTS, MANUSCRIPT_ORDER, manuscript, manuscriptReward,
    NODE_TYPES, BLESSINGS, BLESSING_ORDER, EVENTS, EVENT_ORDER, eventPool,
    SKINS, NAMES,
    body, bodyStyle, bodySource, bodyWest, cultureOf, homeOf, originOf, HOME_SIDE,
    weapon, template, enemy, nodeType, blessing, event,
  };
})(globalThis.Ashen ||= {});
