'use strict';
/* 老兵回路版静态数据。只放纯数据与纯查表，不读 DOM / 时钟 / Math.random。
   设计基线：docs/superpowers/specs/2026-11-11-veteran-circuit-design.md */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  /* ------------------------------ 全局参数 ------------------------------ */
  const DESIGN = {
    gridSize: 4,
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
    guardReduce: 0.20,
    maxFloor: 7,
    blessingFloors: [2, 4, 6],
    logicSlots: 2,
    logicSlotsMax: 3,
    logicUnlockExtracts: 2,
    attuneRuns: 3,
    fieldInscribe: { maxHpMult: 0.8, stress: 40 },
    emergency: { stress: 10, keepRatio: 0.5 },
    defeat: { stress: 20 },
    recruitCost: { min: 55, max: 80 },
    scaling: { hpPerFloor: 0.20, atkPerFloor: 0.12, defPerFloor: 0.10, minionHpMult: 0.72, bossMinionHpMult: 0.40 },
    floorRecovery: 0.12,
  };

  /* ------------------------------ 底盘 ------------------------------ */
  /* blocked 为 4x4 内的屏蔽格，坐标 x 向右、y 向下，0-3 */
  const BODIES = {
    sturdy: {
      id: 'sturdy', name: '厚铸躯壳',
      hp: 160, atk: 28, def: 18, spd: 8,
      loadCap: 8, blocked: [[2, 3], [3, 3]],
      /* 板面：由 seed 生成的异形金属，格数与形状解耦 */
      plate: { archetype: 'full', target: 28, loadCap: 16 },
      desc: '厚甲慢步。能扛住贯穿，但上手慢。',
    },
    agile: {
      id: 'agile', name: '轻量骨架',
      hp: 120, atk: 28, def: 8, spd: 14,
      loadCap: 6, blocked: [[0, 0], [2, 3]],
      plate: { archetype: 'bar', target: 22, loadCap: 13 },
      desc: '出手快、皮薄。能量周转快，容错低。',
    },
    conduit: {
      id: 'conduit', name: '导流腔体',
      hp: 140, atk: 28, def: 12, spd: 10,
      loadCap: 7, blocked: [[0, 0], [3, 3]],
      plate: { archetype: 'square', target: 28, loadCap: 15 },
      desc: '居中。屏蔽格偏角，两条基础线路都能过。',
    },
  };

  /* ------------------------------ 主手 ------------------------------ */
  /* main.energy 为基准消耗；slot 特殊规则写在 rules 里 */
  const WEAPONS = {
    shortBlade: {
      id: 'shortBlade', name: '短刃', cells: DESIGN.weaponCells,
      main: {
        energy: 2, mult: 1.6, target: 'frontFoe', allowedSlots: [0],
        desc: '2 能量，160% 单体。只有站在 1 号位才能出手，其余位置退回 100% 基础攻击。',
      },
      trait: { id: 'refund', name: '回手', desc: '每场战斗第一次主手输出返还 1 点能量。' },
      desc: '贴脸才狠。适合前排换位构筑。',
    },
    towerShield: {
      id: 'towerShield', name: '塔盾', cells: DESIGN.weaponCells,
      main: {
        energy: 2, mult: 1.0, target: 'frontFoe', skipTarget: true, slot0Reduce: 0.2,
        desc: '2 能量，100% 盾击并跳过目标一次行动。站在 1 号位时自身减伤 20%，持续到下次行动。',
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
        desc: '2 能量。1 号位 120% 正面单体；2 号位 120% 贯穿敌方前两位；3、4 号位不可用。',
      },
      trait: { id: 'refund', name: '回手', desc: '每场战斗第一次主手输出返还 1 点能量。' },
      desc: '站第二排也够得着。',
    },
    heavyCannon: {
      id: 'heavyCannon', name: '重炮', cells: DESIGN.weaponCells,
      main: {
        energy: 4, energyAtSlot3: 2, mult: 1.8, target: 'frontFoe',
        slot0SelfDamage: 0.1,
        desc: '4 能量，180% 单体；站在 4 号位只要 2 能量。1 号位开火自身损失当前最大生命 10%，不产生受击能量。',
      },
      trait: { id: 'refund', name: '回手', desc: '每场战斗第一次主手输出返还 1 点能量。' },
      desc: '后排便宜，前排自伤。',
    },
    ritualStaff: {
      id: 'ritualStaff', name: '仪式杖', cells: DESIGN.weaponCells,
      main: {
        energy: 2, healMult: 1.7, fallbackMult: 1.2, target: 'lowestHpAlly',
        desc: '2 能量，治疗生命比例最低的友军 = 170% 攻击；全员满血时改为 120% 法术单体。',
      },
      trait: { id: 'overflow', name: '溢流', desc: '每场战斗首次溢出治疗转为护盾，上限目标最大生命 10%。' },
      desc: '把人从死亡线拉回来。',
    },
  };

  const WEAPON_ORDER = ['shortBlade', 'towerShield', 'longSpear', 'heavyCannon', 'ritualStaff'];

  /* 共用 support 输出 */
  const SUPPORT = {
    energy: 2, shieldPct: DESIGN.supportShieldPct, shieldCapPct: DESIGN.supportShieldCapPct,
    desc: '2 能量，给目标护盾 = 其最大生命 12%，总盾不超过 30%。',
  };
  const GUARD = {
    energy: 0, reduce: DESIGN.guardReduce,
    desc: '不耗能量，下一次受击减伤 20%，到下次自身行动失效。',
  };

  /* ------------------------------ 回路构件 ------------------------------ */
  /* cells 为占格；ports 相对格坐标，dir 为朝向；links 为内部有向连通（端口 id） */
  const TEMPLATES = {
    straight: {
      id: 'straight', name: '直导管', load: 1, relicArt: 'veteran.relic.channel',
      cells: [[0, 0], [1, 0]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 0], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      desc: '1 负荷，直通。',
    },
    elbow: {
      id: 'elbow', name: '弯管', load: 1, relicArt: 'veteran.relic.channel',
      cells: [[0, 0], [1, 0], [1, 1]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 1], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      desc: '1 负荷，转向。',
    },
    splitter: {
      id: 'splitter', name: '棱镜分流', load: 2, relicArt: 'veteran.relic.splitter',
      /* 左上 (0,0) 是空的，不要按包围盒当占格 */
      cells: [[0, 1], [1, 1], [1, 0], [1, 2]],
      ports: [
        { id: 'in', cell: [0, 1], dir: 'W', role: 'in' },
        { id: 'outA', cell: [1, 0], dir: 'E', role: 'out' },
        { id: 'outB', cell: [1, 2], dir: 'E', role: 'out' },
      ],
      links: [['in', 'outA'], ['in', 'outB']],
      split: ['outA', 'outB'],
      desc: '2 负荷。输入轮流分给两个出口，2 单位分成 1+1，绝不复制。',
    },
    capacitor: {
      id: 'capacitor', name: '脉冲储能腔', load: 2, relicArt: 'veteran.relic.capacitor',
      cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 0], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      capacitor: true,
      desc: '2 负荷。积满 4 单位后一次性发出 4 单位（带 surge）。',
    },
    threshold: {
      id: 'threshold', name: '阈值闸', load: 1, relicArt: 'veteran.relic.threshold',
      cells: [[0, 0], [1, 0]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 0], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      gate: { hpBelow: 0.5 },
      desc: '1 负荷。生命低于 50% 才导通；未满足时本次能量消散。',
    },
    ember: {
      id: 'ember', name: '余烬导管', load: 2, relicArt: 'veteran.relic.channel',
      cells: [[0, 0], [1, 0]],
      ports: [
        { id: 'in', cell: [0, 0], dir: 'W', role: 'in' },
        { id: 'out', cell: [1, 0], dir: 'E', role: 'out' },
      ],
      links: [['in', 'out']],
      ember: true,
      desc: '2 负荷。流经的能量附 ember，主手命中附 2 回合灼烧。',
    },
  };

  const TEMPLATE_ORDER = ['straight', 'elbow', 'splitter', 'capacitor', 'threshold', 'ember'];

  /* 输入极与输出极：位于网格外侧，按格与朝向匹配 */
  const TERMINALS = {
    clock: { id: 'clock', cell: [0, 1], dir: 'W', role: 'in', kind: 'input', name: '时钟' },
    damage: { id: 'damage', cell: [0, 3], dir: 'W', role: 'in', kind: 'input', name: '受击' },
    main: { id: 'main', cell: [3, 2], dir: 'E', role: 'out', kind: 'output', name: '主手' },
    support: { id: 'support', cell: [3, 0], dir: 'E', role: 'out', kind: 'output', name: '保护' },
  };

  /* ------------------------------ 底盘预设线路 ------------------------------ */
  /* 基础线：straight(0,1) + elbow(2,1) → clock→main，5 格 / load 2 */
  const PRESETS = {
    basic: {
      id: 'basic', name: '基础直供',
      /* templateId + 位置，装配时按需生成构件实例 */
      layout: [
        { templateId: 'straight', x: 0, y: 1, rotation: 0, mirrorY: false },
        { templateId: 'elbow', x: 2, y: 1, rotation: 0, mirrorY: false },
      ],
      desc: 'clock → 主手。最省负荷，蓄能慢。',
    },
    charge: {
      id: 'charge', name: '蓄能回路',
      /* 用 capacitor 替换 (0,1) 的 straight，elbow 保持在 (2,1)。
         文档写“占格六、load3”，但 capacitor 模板为 4 格 / load2，
         与 elbow 组合后实际是 7 格 / load4；以模板表为准，已记录偏差。 */
      layout: [
        { templateId: 'capacitor', x: 0, y: 1, rotation: 0, mirrorY: false },
        { templateId: 'elbow', x: 2, y: 1, rotation: 0, mirrorY: false },
      ],
      desc: 'capacitor 蓄满 4 后一次打出双倍，节奏更慢。',
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
    { id: 'enemyCharging', name: '敌人正在蓄力', needsValue: false },
    { id: 'atSlot', name: '自身位于', needsValue: true },
  ];
  const THRESHOLDS = [25, 50, 75];
  const TARGETS = [
    { id: 'frontFoe', name: '正面敌人' },
    { id: 'lowestHpFoe', name: '最残敌人' },
    { id: 'lowestHpAlly', name: '最残队友' },
    { id: 'chargingFoe', name: '蓄力中的敌人' },
    { id: 'self', name: '自己' },
  ];
  const ACTIONS = [
    { id: 'main', name: '主手' },
    { id: 'support', name: '保护' },
    { id: 'guard', name: '防御' },
  ];

  /* 默认两条规则：队友残血先保护，否则主手 */
  function defaultGambits() {
    return [
      {
        id: 'g1', enabled: true,
        conditions: [{ type: 'allyHpBelow', value: 50 }],
        target: 'lowestHpAlly', action: 'support',
      },
      {
        id: 'g2', enabled: true,
        conditions: [{ type: 'always' }],
        target: 'frontFoe', action: 'main',
      },
    ];
  }

  /* ------------------------------ 位置机制 ------------------------------ */
  const MODS = {
    shadowAdvance: {
      id: 'shadowAdvance', name: '影进',
      desc: '位于 3/4 号位并完成一次主手伤害行动后前插到 1 号位，每全局回合至多一次。',
    },
    refractRetreat: {
      id: 'refractRetreat', name: '折光后撤',
      desc: '1 号位完成主手行动后与 2 号位交换，并获得一次直射拦截残影（不挡 AOE / DOT / 贯穿）。',
    },
    ironCover: {
      id: 'ironCover', name: '铁壁援护',
      desc: '一次敌方行动结束后，若紧邻前方友军存活且生命低于 30%，向前交换并转移其灼烧/流血。每回合至多一次。',
    },
  };

  /* ------------------------------ 敌人 ------------------------------ */
  const ENEMIES = {
    bone: {
      id: 'bone', name: '骸骨兵', enemyType: 'bone',
      hp: 285, atk: 22, def: 6, spd: 9, hits: 0.94,
      skills: [
        { id: 'slash', name: '锈刃', energy: 2, mult: 1.0, target: 'frontFoe' },
        { id: 'cleave', name: '横扫', energy: 3, mult: 0.75, target: 'allFoe', cd: 2 },
      ],
      desc: '最普通的游荡者。',
    },
    hound: {
      id: 'hound', name: '骨犬', enemyType: 'hound',
      hp: 230, atk: 26, def: 4, spd: 15, hits: 0.94,
      skills: [
        { id: 'bite', name: '撕咬', energy: 2, mult: 1.1, target: 'lowestHpFoe' },
        { id: 'howl', name: '嚎叫', energy: 2, mult: 0, target: 'allFoe', stress: 6, cd: 3 },
      ],
      desc: '快，专挑最残的咬。',
    },
    hulk: {
      id: 'hulk', name: '石傀', enemyType: 'hulk',
      hp: 470, atk: 32, def: 14, spd: 6, hits: 0.90,
      skills: [
        { id: 'slam', name: '抡砸', energy: 2, mult: 1.25, target: 'frontFoe' },
        { id: 'quake', name: '震地', energy: 3, mult: 0.7, target: 'allFoe', cd: 3 },
      ],
      desc: '慢、硬、会拆队列。',
    },
    shuffler: {
      id: 'shuffler', name: '扰位石傀', enemyType: 'shuffler',
      hp: 430, atk: 24, def: 12, spd: 7, hits: 0.92,
      skills: [
        { id: 'shove', name: '推挤', energy: 2, mult: 0.8, target: 'frontFoe' },
      ],
      disrupt: { everyActions: 3, effect: 'insertFrontLast' },
      desc: '每第三次行动把我方最后一名存活单位推到最前。',
    },
    wraith: {
      id: 'wraith', name: '幽魂', enemyType: 'wraith',
      hp: 260, atk: 28, def: 6, spd: 12, hits: 0.96,
      skills: [
        { id: 'drain', name: '汲取', energy: 2, mult: 1.0, target: 'frontFoe', lifesteal: 0.5 },
        { id: 'curse', name: '诅咒', energy: 3, mult: 0.6, target: 'allFoe', dot: { k: 'burn', v: 4, d: 2 }, cd: 3 },
      ],
      desc: '打它会回血。',
    },
    gatekeeper: {
      id: 'gatekeeper', name: '守门人', enemyType: 'gatekeeper', boss: true,
      hp: 285, atk: 30, def: 18, spd: 8, hits: 0.94,
      skills: [
        { id: 'smash', name: '碎地', energy: 3, mult: 1.0, target: 'allFoe', cd: 3, telegraph: true },
        { id: 'guardBreak', name: '破阵', energy: 2, mult: 1.35, target: 'frontFoe', pierce: 0.5 },
      ],
      phaseAt: 0.5,
      phaseBuff: { name: '裂甲', atkMult: 1.25, spdAdd: 3 },
      desc: '门后面的东西。大招会预告。',
    },
    memoryEater: {
      id: 'memoryEater', name: '噬忆者', enemyType: 'memoryEater', boss: true,
      hp: 268, atk: 32, def: 14, spd: 11, hits: 0.96,
      skills: [
        { id: 'devour', name: '吞忆', energy: 3, mult: 0.95, target: 'allFoe', stress: 8, cd: 3, telegraph: true },
        { id: 'reap', name: '收割', energy: 2, mult: 1.3, target: 'lowestHpFoe' },
      ],
      phaseAt: 0.5,
      phaseBuff: { name: '饥饿', atkMult: 1.3, spdAdd: 2 },
      desc: '它记得你们每一个人。',
    },
  };

  const ENEMY_ORDER = ['bone', 'hound', 'hulk', 'shuffler', 'wraith'];
  const BOSS_ORDER = ['gatekeeper', 'memoryEater'];

  /* 遭遇模板：敌人组合 + 层数缩放 */
  function encounterTemplate(kind, index) {
    if (kind === 'boss') {
      const bossId = BOSS_ORDER[index % BOSS_ORDER.length];
      return { kind: 'boss', bossId, minionIds: ['bone', 'bone'] };
    }
    if (kind === 'elite') {
      return { kind: 'elite', bossId: null, minionIds: ['shuffler', 'bone', 'hound'], elite: true };
    }
    return { kind: 'normal', bossId: null, minionIds: ['bone', 'bone', 'hound'] };
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

  /* ------------------------------ 功法谱 ------------------------------ */
  /* 功法是压在生命金属上的「管道」：自己占格、自带纹路要求与出入口。
     有功法才谈得上能量路由；没有功法，板面只是一块带槽位的金属。
     cells/veins/entry/exits 与 src/veteran/manuscript.js 的判定口径一致。 */
  const MANUSCRIPTS = {
    /* 一阶：微功法，占地 2 格、负荷 1，任何板面都塞得下。只有攻势，没有守势 */
    spark: {
      id: 'spark', name: '星火', rarity: 1, load: 1,
      desc: '最短的一门功课：平A 快一点，只喂得出一条攻势。',
      cells: [[0, 0], [1, 0]],
      veins: { '0,0': ['W'], '1,0': ['E'] },
      io: { clock: { cell: [0, 0], dir: 'W' }, main: { cell: [1, 0], dir: 'E' } },
      entry: [0, 0], exits: [[1, 0]],
      attack: { intervalScale: 0.85, mult: 1.0, extraHits: 0 },
      energy: { regen: 1.0, max: 16 },
      positions: [0, 1],
      skills: [],
      tiers: [
        { at: 50, id: 't1', name: '一阶 · 起手', effect: { mainMult: 1.06 } },
        { at: 100, id: 't2', name: '二阶 · 顺手', effect: { mainMult: 1.14, startEnergy: 1 } },
      ],
    },

    /* 二阶：第一个无条件技能 */
    corridor5: {
      id: 'corridor5', name: '直贯五脉', rarity: 2, load: 2,
      desc: '窄型五格拓片。招式不挑时机，攒够能量就能放。',
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
      positions: [0, 1, 2],
      skills: [{
        id: 'pierce', name: '一线穿心', cost: 8, castTime: 0.6, cooldown: 5,
        cond: {}, target: 'frontFoe', effect: { mult: 1.8, pierce: 2 },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 初鸣', effect: { mainMult: 1.08 } },
        { at: 80, id: 't2', name: '二阶 · 共振', effect: { mainMult: 1.16, startEnergy: 1 } },
        { at: 100, id: 't3', name: '三阶 · 贯通', effect: { mainMult: 1.24, startEnergy: 1 } },
      ],
    },

    /* 三阶：技能带条件 */
    ember12: {
      id: 'ember12', name: '余烬十二脉', rarity: 3, load: 3,
      desc: '4×3 古老回流拓片。招式要等纹路贯通才出手。',
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
      positions: [0, 1, 2, 3],
      skills: [{
        id: 'emberBurst', name: '余烬回响', cost: 10, castTime: 0.7, cooldown: 6,
        cond: { routed: true }, target: 'frontFoe', effect: { mult: 2.0, dot: { turns: 3, dmgMult: 0.25 } },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 初鸣', effect: { mainMult: 1.10 } },
        { at: 75, id: 't2', name: '二阶 · 共振', effect: { mainMult: 1.18, startEnergy: 1 } },
        { at: 100, id: 't3', name: '三阶 · 圆满', effect: { mainMult: 1.26, startEnergy: 1, supportMult: 1.2 } },
      ],
    },

    /* 四阶：改写能量来源 */
    wide14: {
      id: 'wide14', name: '重铸阔卷', rarity: 4, load: 4,
      desc: '5×3 重型拓片。挨打也在回气，越被围越凶。',
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
      positions: [0, 1],
      skills: [{
        id: 'quake', name: '重铸震击', cost: 12, castTime: 0.8, cooldown: 7,
        cond: { foeHpBelow: 0.6 }, target: 'frontFoe', effect: { mult: 2.4, splash: 0.4 },
      }],
      tiers: [
        { at: 35, id: 't1', name: '一阶 · 余温', effect: { mainMult: 1.12 } },
        { at: 70, id: 't2', name: '二阶 · 灼脉', effect: { mainMult: 1.22, supportMult: 1.15 } },
        { at: 100, id: 't3', name: '三阶 · 圆满', effect: { mainMult: 1.34, startEnergy: 2, supportMult: 1.3 } },
      ],
    },

    /* 五阶：技能改写平A */
    flurry: {
      id: 'flurry', name: '连刺', rarity: 5, load: 3,
      desc: '六格密集拓片。放完招式后一段时间，平A 多打一下。',
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
      positions: [1, 2, 3],
      skills: [{
        id: 'flurry', name: '连刺', cost: 9, castTime: 0.5, cooldown: 5,
        cond: { attackCount: 4 }, target: 'frontFoe',
        effect: { mult: 1.2, buffAttack: { mult: 1.6, seconds: 3 } },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 起势', effect: { mainMult: 1.10 } },
        { at: 90, id: 't2', name: '二阶 · 疾风', effect: { mainMult: 1.2, startEnergy: 1 } },
      ],
    },

    /* 六阶：双技能 + 独特能量 */
    twinflow: {
      id: 'twinflow', name: '双流', rarity: 6, load: 4,
      desc: '八格双线拓片。两个招式共享冷却，能量上限更高、回得更快。',
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
      attack: { intervalScale: 0.95, mult: 1.05, extraHits: 0 },
      energy: { regen: 1.5, max: 28 },
      positions: [0, 1, 2, 3],
      skills: [{
        id: 'flowA', name: '左流', cost: 10, castTime: 0.5, cooldown: 5,
        cond: {}, target: 'frontFoe', effect: { mult: 1.9 },
      }, {
        id: 'flowB', name: '右流', cost: 10, castTime: 0.5, cooldown: 5, sharedCooldown: true,
        cond: { energyAbove: 14 }, target: 'lowestHpFoe', effect: { mult: 2.2 },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 分流', effect: { mainMult: 1.12 } },
        { at: 80, id: 't2', name: '二阶 · 合流', effect: { mainMult: 1.22, startEnergy: 2 } },
      ],
    },

    /* 七阶：改写规则 */
    inverse: {
      id: 'inverse', name: '逆脉', rarity: 7, load: 5,
      desc: '十格逆流拓片。平A 也吃贯通加成，护盾溢出转伤害。',
      cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1]],
      veins: {
        '0,0': ['W'], '1,0': ['E'], '2,0': ['W'], '3,0': ['E'], '4,0': ['W'],
        '0,1': ['E'], '1,1': ['W'], '2,1': ['E'], '3,1': ['W'], '4,1': ['E'],
      },
      entry: [0, 0], exits: [[4, 1]],
      io: {
        clock: { cell: [0, 0], dir: 'W' },
        damage: { cell: [0, 1], dir: 'E' },
        main: { cell: [4, 0], dir: 'W' },
        support: { cell: [4, 1], dir: 'E' },
      },
      attack: { intervalScale: 0.85, mult: 1.1, extraHits: 0, routedBonus: 0.2 },
      energy: { regen: 1.3, max: 30, onAttack: 0.15 },
      positions: [0, 1, 2, 3],
      skills: [{
        id: 'inverse', name: '逆脉', cost: 14, castTime: 0.9, cooldown: 8,
        cond: { routed: true }, target: 'frontFoe',
        effect: { mult: 2.6, pierce: 3, shieldToDamage: true },
      }],
      tiers: [
        { at: 40, id: 't1', name: '一阶 · 逆流', effect: { mainMult: 1.15 } },
        { at: 75, id: 't2', name: '二阶 · 倒灌', effect: { mainMult: 1.28, startEnergy: 2 } },
        { at: 100, id: 't3', name: '三阶 · 无回', effect: { mainMult: 1.42, startEnergy: 2, supportMult: 1.35 } },
      ],
    },
  };
  const MANUSCRIPT_ORDER = ['spark', 'corridor5', 'ember12', 'wide14', 'flurry', 'twinflow', 'inverse'];
  function manuscript(id) { return MANUSCRIPTS[id] || null; }

  /* ------------------------------ 祝福 ------------------------------ */
  const BLESSINGS = {
    edge: { id: 'edge', name: '锐利', desc: '主手伤害 +15%。', effect: { mainDmg: 0.15 } },
    guard: { id: 'guard', name: '厚重', desc: '全队受到的伤害 -10%。', effect: { dmgTaken: -0.10 } },
    flow: { id: 'flow', name: '导通', desc: '每场战斗开始时主手输出直接获得 2 能量。', effect: { startEnergy: 2 } },
    scavenger: { id: 'scavenger', name: '拾荒', desc: '金币收获 +20%。', effect: { gold: 0.2 } },
    mend: { id: 'mend', name: '缝补', desc: '每层结束时全队恢复 12% 生命。', effect: { floorHeal: 0.12 } },
    pact: { id: 'pact', name: '禁忌契约', desc: '主手伤害 +25%，压力获取 +25%。', effect: { mainDmg: 0.25, stress: 0.25 } },
  };
  const BLESSING_ORDER = ['edge', 'guard', 'flow', 'scavenger', 'mend', 'pact'];

  /* ------------------------------ 事件 ------------------------------ */
  const EVENTS = {
    fogFork: {
      id: 'fogFork', title: '雾中的岔路',
      text: '雾里分出三条路。地上有血迹，也有拖痕。',
      choices: [
        {
          id: 'blood', label: '走血迹', hint: '迎战，赢了才有东西',
          combat: { kind: 'normal' },
          text: '血迹尽头不是尸体——那东西还站着。它抬起头，看见了你们。',
        },
        {
          id: 'tracks', label: '跟拖痕', hint: '拿到构件，但有人受伤',
          loot: 1, damagePct: 0.08,
          text: '拖痕尽头是一堆被扯开的构件。有人被绊倒，膝盖见了血。',
        },
        {
          id: 'middle', label: '走中间', hint: '没有收获，也没有风险',
          text: '你们走了中间。什么也没有发生，这本身就是好消息。',
        },
      ],
    },
    wallKnock: {
      id: 'wallKnock', title: '墙里的敲击',
      text: '三下，停，三下。墙是实的，声音不是。',
      choices: [
        {
          id: 'break', label: '凿开墙', hint: '可能拿到构件，也可能惊动东西',
          loot: 1, stress: 12,
          text: '墙后面塞着一具旧尸，手里攥着还能用的构件。',
        },
        {
          id: 'listen', label: '贴着听', hint: '压力降低，没有收获',
          stress: -10,
          text: '你们听了一会儿。敲击停了。有人发现自己一直在屏住呼吸。',
        },
      ],
    },
    scrapPile: {
      id: 'scrapPile', title: '堆叠的残骸',
      text: '一整面墙都是拆到一半的东西。有几块还在发微光。',
      choices: [
        {
          id: 'dig', label: '翻找', hint: '拿到构件',
          loot: 1, damagePct: 0.05,
          text: '翻到一件还能用的。手指被划开一道口子。',
        },
        {
          id: 'leave', label: '不碰', hint: '什么也不发生',
          text: '你们绕开了。身后的光慢慢暗下去。',
        },
      ],
    },
  };
  const EVENT_ORDER = ['fogFork', 'wallKnock', 'scrapPile'];

  /* ------------------------------ 招募外观 ------------------------------ */
  const SKINS = [
    { id: 'blade', name: '铁鸦', portrait: 'portrait.blade' },
    { id: 'warden', name: '磐石', portrait: 'portrait.warden' },
    { id: 'ranger', name: '灰烬', portrait: 'portrait.ranger' },
    { id: 'warlock', name: '低语', portrait: 'portrait.warlock' },
    { id: 'cleric', name: '烛火', portrait: 'portrait.cleric' },
    { id: 'rogue', name: '暗巷', portrait: 'portrait.rogue' },
  ];

  const NAMES = ['铁鸦', '磐石', '灰烬', '低语', '烛火', '暗巷', '断齿', '冷炉', '旧钉', '褪色', '长夜', '哑钟'];

  /* ------------------------------ 查表工具 ------------------------------ */
  function body(id) { return BODIES[id] || BODIES.sturdy; }
  function weapon(id) { return WEAPONS[id] || WEAPONS.shortBlade; }
  function template(id) { return TEMPLATES[id] || TEMPLATES.straight; }
  function enemy(id) { return ENEMIES[id] || ENEMIES.bone; }
  function nodeType(id) { return NODE_TYPES[id] || NODE_TYPES.battle; }
  function blessing(id) { return BLESSINGS[id] || null; }
  function event(id) { return EVENTS[id] || EVENTS.fogFork; }

  V.Data = {
    DESIGN, BODIES, WEAPONS, WEAPON_ORDER, SUPPORT, GUARD,
    TEMPLATES, TEMPLATE_ORDER, TERMINALS, PRESETS, EMBER_FIXTURE, STRAIGHT_PARK,
    CONDITIONS, THRESHOLDS, TARGETS, ACTIONS, defaultGambits,
    MODS, ENEMIES, ENEMY_ORDER, BOSS_ORDER, encounterTemplate,
    MANUSCRIPTS, MANUSCRIPT_ORDER, manuscript,
    NODE_TYPES, BLESSINGS, BLESSING_ORDER, EVENTS, EVENT_ORDER,
    SKINS, NAMES,
    body, weapon, template, enemy, nodeType, blessing, event,
  };
})(globalThis.Ashen ||= {});
