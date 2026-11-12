'use strict';
/* 老兵回路版静态数据。只放纯数据与纯查表，不读 DOM / 时钟 / Math.random。
   设计基线：docs/superpowers/specs/2026-11-11-veteran-circuit-design.md */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  /* ------------------------------ 全局参数 ------------------------------ */
  const DESIGN = {
    /* 金属形态只影响装配条件，不再附赠职业面板。 */
    metalBase: { hp: 140, atk: 28, def: 12, spd: 10 },
    gridSize: 4,
    /* 时间轴：一步 0.24s，战斗按秒推进 */
    stepSeconds: 0.24,
    autoAttack: { interval: 0.5, mult: 0.55 },
    energyBase: { regen: 1.0, max: 20 },
    energyPerHit: 0,
    baseSpeed: 10,
    /* 蚀刻法稀有度直接抬角色面板：这是除乘算之外唯一的成长维度 */
    rarityStat: { atk: 0.06, hp: 0.07, def: 0.04 },
    /* 敌人仍走旧的行动逻辑，伤害按平A 的新量级统一缩放，避免一边倒 */
    enemyDamageScale: 0.13,
    /* 我方平A 归一化后，敌人血池要相应拉长，否则一场只有 10 秒 */
    enemyHpScale: 2.6,
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
    maxFloor: 49,
    blessingFloors: [2, 4, 6, 14, 21, 28, 35, 42],
    logicSlots: 2,
    logicSlotsMax: 3,
    logicUnlockExtracts: 2,
    attuneRuns: 3,
    fieldInscribe: { maxHpMult: 0.8, stress: 40 },
    emergency: { stress: 10, keepRatio: 0.5 },
    defeat: { stress: 20 },
    recruitCost: { min: 55, max: 80 },
    scaling: { hpPerFloor: 0.15, atkPerFloor: 0.09, defPerFloor: 0.06, minionHpMult: 0.72, bossMinionHpMult: 0.40 },
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
    /* 余裕现在只喂招式，所以护持不再与招式抢能量：改为 4 秒冷却，用自己的行动换盾 */
    energy: 0, cooldown: 4, shieldPct: DESIGN.supportShieldPct, shieldCapPct: DESIGN.supportShieldCapPct,
    desc: '不耗余裕，4 秒一次，给一名同伴护盾 = 其最大生命 12%，总盾不超过 30%。',
  };
  const GUARD = {
    energy: 0, reduce: DESIGN.guardReduce,
    desc: '不耗能量，下一次受击减伤 20%，到下次自身行动失效。',
  };

  /* ------------------------------ 回路纹路 ------------------------------ */
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
      desc: '暗红细纹横过两格，末端留着余温。2 负荷。同向覆盖压满时，平攻伤害 +10%、命中附灼烧，灼烧伤害 +10%。',
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

  addRune('straight', 'jack', '折角纹', '单孔角接', '一格之内，细纹从侧缘折向上缘。', 1, [[0, 0]], [0, 0, 'W'], [[0, 0, 'N']],
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
    { attackMult: 0.08, regen: 0.06 }, '平攻伤害 +8%、余裕恢复 +0.06/s');
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
    { lowHpRegen: 0.44, attackMult: 0.03 }, '生命低于50%时余裕恢复 +0.44/s、平攻伤害 +3%');
  addRune('ember', 'flint', '火星纹', '燧钉', '一格短纹转折处伏着一粒火星。', 2, [[0, 0]], [0, 0, 'W'], [[0, 0, 'S']],
    { attackMult: 0.04, ember: 1, dotMult: 0.08 }, '平攻伤害 +4%、命中附灼烧、灼烧伤害 +8%');
  addRune('ember', 'fuse', '游焰纹', '导火绳', '一线火色沿三格纹理游走。', 2, [[0, 0], [1, 0], [2, 0]], [0, 0, 'W'], [[2, 0, 'E']],
    { attackMult: 0.14, ember: 1, dotMult: 0.15 }, '平攻伤害 +14%、命中附灼烧、灼烧伤害 +15%');
  addRune('ember', 'brazier', '日轮纹', '三足火座', '日轮的四道光芒铺在五格金属上。', 3, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], [1, 2, 'S'], [[1, 0, 'N']],
    { attackMult: 0.18, skillMult: 0.08, ember: 1, dotMult: 0.12 }, '平攻伤害 +18%、招式伤害 +8%、命中附灼烧、灼烧伤害 +12%');
  addRune('ember', 'wickbend', '焰尾纹', '余焰回勾', '火纹侧伸，末端如焰尾向上挑起。', 2, [[0, 0], [0, 1], [1, 1], [2, 1]], [0, 0, 'W'], [[2, 1, 'N']],
    { attackMult: 0.07, regen: 0.1, ember: 1, dotMult: 0.10 }, '平攻伤害 +7%、余裕恢复 +0.10/s、命中附灼烧、灼烧伤害 +10%');

  const TEMPLATE_ORDER = Object.keys(TEMPLATES);

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
      id: 'basic', name: '顺脉',
      /* templateId + 位置，装配时按需生成纹路实例 */
      layout: [
        { templateId: 'straight', x: 0, y: 1, rotation: 0, mirrorY: false },
        { templateId: 'elbow', x: 2, y: 1, rotation: 0, mirrorY: false },
      ],
      desc: '让顺丝纹接上曲折纹，将脉动引向主手。',
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
      desc: '同心纹蓄满 4 份脉动后一次释放，再由曲折纹引向主手。',
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

  /* 默认只留一条攻击规则。护持与防御是要玩家自己选的取舍：
     自动把它们挂在「队友残血」上，会让全队一直举盾不还手。 */
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
      desc: '站在第三或第四位时，平攻造成伤害便插到最前。每回合至多一次。',
    },
    refractRetreat: {
      id: 'refractRetreat', name: '折光后撤',
      desc: '在第一位平攻造成伤害后与第二位互换，并留下可挡一次直击的残影，持续到本人下次出手。每回合至多一次。',
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
    /* 亚种：同一副骨架，换一套打法。sprite 复用已有立绘，filter 让同形能分辨。 */
    boneBell: {
      id: 'boneBell', name: '鸣钟骨', enemyType: 'boneBell', sprite: 'bone',
      filter: 'hue-rotate(148deg) saturate(1.6) brightness(1.06)',
      hp: 255, atk: 19, def: 7, spd: 9, hits: 0.93,
      skills: [
        { id: 'toll', name: '敲钟', mult: 0.25, target: 'allFoe', blind: { v: 0.22, d: 2 }, stress: 3, cd: 3 },
        { id: 'chime', name: '碎铃', mult: 1.0, target: 'frontFoe' },
      ],
      desc: '钟声压住视线。它自己不打人，所以总能活到最后。',
    },
    houndLean: {
      id: 'houndLean', name: '瘦犬', enemyType: 'houndLean', sprite: 'hound',
      filter: 'sepia(0.55) hue-rotate(-12deg) brightness(0.9)',
      hp: 200, atk: 25, def: 3, spd: 17, hits: 0.95,
      skills: [
        { id: 'hamstring', name: '断筋', mult: 1.0, target: 'lowestHpFoe', dot: { k: 'bleed', v: 3, d: 2 } },
        { id: 'leap', name: '扑背', mult: 1.15, target: 'backFoe' },
      ],
      desc: '绕过前排，专咬后排。',
    },
    hulkSlag: {
      id: 'hulkSlag', name: '炉渣傀', enemyType: 'hulkSlag', sprite: 'hulk',
      filter: 'sepia(0.6) hue-rotate(8deg) brightness(0.88)',
      hp: 415, atk: 28, def: 15, spd: 5, hits: 0.90,
      skills: [
        { id: 'crush', name: '压碎', mult: 1.3, pierce: 0.35, target: 'frontFoe' },
        { id: 'vent', name: '泄渣', mult: 0.5, target: 'allFoe', dot: { k: 'burn', v: 4, d: 2 }, cd: 3 },
      ],
      onDeathBurst: { name: '崩壳', mult: 0.8, dot: { k: 'burn', v: 3, d: 2 } },
      desc: '壳里全是热渣。别用一次爆发把它一起打死。',
    },
    wraithChoir: {
      id: 'wraithChoir', name: '唱喑', enemyType: 'wraithChoir', sprite: 'wraith',
      filter: 'hue-rotate(236deg) saturate(1.35) brightness(1.02)',
      hp: 310, atk: 21, def: 9, spd: 10, hits: 0.95,
      skills: [
        { id: 'dirge', name: '挽歌', mult: 0, healAllies: 0.16, cd: 4 },
        { id: 'wail', name: '悲鸣', mult: 0.55, target: 'allFoe', stress: 5, cd: 4 },
      ],
      desc: '它替别人续命。留着它，前面的仗永远不会结束。',
    },
    shufflerDragger: {
      id: 'shufflerDragger', name: '拖骸者', enemyType: 'shufflerDragger', sprite: 'shuffler',
      filter: 'sepia(0.4) hue-rotate(180deg) brightness(0.82)', elite: true,
      hp: 560, atk: 26, def: 16, spd: 9, hits: 0.93,
      skills: [
        { id: 'dragChain', name: '拖链', mult: 0.9, target: 'frontFoe', drainEnergy: 2, stripShield: true },
      ],
      disrupt: { everyActions: 2, effect: 'insertFrontLast' },
      desc: '不断把人从后排拖到最前，顺手抽走刚攒起来的余裕。',
    },
    stoker: {
      id: 'stoker', name: '火工', enemyType: 'stoker', sprite: 'hulk',
      filter: 'sepia(0.75) saturate(1.7) hue-rotate(-16deg)', elite: true,
      hp: 520, atk: 30, def: 12, spd: 8, hits: 0.91,
      skills: [
        { id: 'blast', name: '鼓风', mult: 0.8, target: 'allFoe', telegraph: true, cd: 3, dot: { k: 'burn', v: 5, d: 2 } },
        { id: 'slagSpray', name: '泼渣', mult: 1.2, pierce: 0.4, target: 'frontFoe' },
      ],
      desc: '它先鼓风，再点火。中间那几秒是用来换位的。',
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
      phaseSkills: [{ id: 'gateClose', name: '合门', mult: 1.15, target: 'allFoe', telegraph: true, cd: 3 }],
      desc: '门后面的东西。大招会预告，第二阶段会关上门再砸一次。',
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
      phaseSkills: [{ id: 'recall', name: '追忆', mult: 1.3, target: 'backFoe', lifesteal: 0.4, cd: 2 }],
      desc: '它记得你们每一个人。第二阶段开始专挑后排。',
    },
    furnaceHeart: {
      id: 'furnaceHeart', name: '炉心俑', enemyType: 'furnaceHeart', boss: true, sprite: 'hulk',
      hp: 300, atk: 27, def: 18, spd: 7, hits: 0.94,
      skills: [
        { id: 'furnacePulse', name: '炉脉', mult: 0.55, target: 'allFoe', dot: { k: 'burn', v: 5, d: 2 }, cd: 2 },
        { id: 'reforge', name: '重铸', mult: 0, healSelf: 0.08, selfShield: 0.16, cd: 4 },
      ],
      phaseAt: 0.55,
      phaseBuff: { name: '过载', atkMult: 1.28, spdAdd: 2 },
      phaseSkills: [{ id: 'overload', name: '过载喷发', mult: 1.5, target: 'allFoe', telegraph: true, cd: 4 }],
      desc: '烧了七层的炉子。它靠灼烧和自修把战斗拖长，时间站在它那边。',
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
  function chapterEncounter(kind,index,floor) {
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
  /* 蚀刻法是压在生命金属上的拓片：自己占格、自带纹路要求与出入口。
     有蚀刻法才谈得上能量路由；没有蚀刻法，板面只是一块带槽位的金属。
     cells/veins/entry/exits 与 src/veteran/manuscript.js 的判定口径一致。 */
  const MANUSCRIPTS = {
    /* 一阶：微蚀刻法，占地 2 格、负荷 1，任何板面都塞得下。只有攻势，没有守势 */
    spark: {
      id: 'spark', name: '星火', rarity: 1, load: 1,
      desc: '平攻间隔缩短15%，合修也生效。',
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

    /* 二阶：第一个无条件技能 */
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

    /* 三阶：技能带条件 */
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
        effect: { mult: 2.0, dot: { turns: 3, dmgMult: 0.25 }, shield: 0.22 },
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

    /* 五阶：技能改写平A */
    flurry: {
      id: 'flurry', name: '连刺', rarity: 5, load: 3,
      desc: '招式后强化平攻，持续3秒。',
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
      desc: '八格逆流拓片。平攻额外获得贯通增幅，招式贯穿三位并提供护盾。',
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
  /* 入门练法共享两格拓片，差异来自打法，不附赠职业面板。 */
  MANUSCRIPTS.needle = {
    ...MANUSCRIPTS.spark, id: 'needle', name: '逐隙',
    desc: '每四次平攻追击虚弱敌人。',
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
  /* 沿用已验证的拓片几何，组合现有战斗效果形成不同节奏。 */
  /* 拓片以可以实际拼接的整件纹路为原型；入口在左侧，出口在末件右侧。 */
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
      skills: [{ id: 'cinder', name: '火种', cost: 5, castTime: 0.5, cooldown: 4, cond: {}, target: 'frontFoe', effect: { mult: 1.1, dot: { dmgMult: 0.45, turns: 3 } } }] },
    { id: 'pursuit', name: '追亡', base: 'corridor5', unlockDepth: 4, rarity: 2,
      desc: '三次平攻后重击最虚弱的敌人。', 
      skills: [{ id: 'pursuit', name: '收锋', cost: 7, castTime: 0.7, cooldown: 4, cond: { attackCount: 3 }, target: 'lowestHpFoe', effect: { mult: 3.1 } }] },
    { id: 'bulwark', name: '铁壁', base: 'corridor5', unlockDepth: 3, rarity: 2,
      desc: '攻击同时护住自身，以输出换取生存。', attack: { intervalScale: 1.2, mult: 0.85 },
      skills: [{ id: 'bulwark', name: '合壁', cost: 5, castTime: 0.45, cooldown: 5, cond: {}, target: 'frontFoe', effect: { mult: 0.9, shield: 0.3 } }] },
    { id: 'torrent', name: '疾雨', base: 'flurry', unlockDepth: 4, rarity: 3,
      desc: '短促三连击，快速收束单体伤害。', 
      skills: [{ id: 'torrent', name: '骤雨', cost: 7, castTime: 0.3, cooldown: 4, cond: {}, target: 'frontFoe', effect: { mult: 0.85, hits: 3 } }] },
    { id: 'razor', name: '裂锋', base: 'corridor5', unlockDepth: 4, rarity: 3,
      desc: '两段穿刺，压低敌方前后两人的生命。', 
      skills: [{ id: 'razor', name: '双裂', cost: 9, castTime: 0.9, cooldown: 6, cond: {}, target: 'frontFoe', effect: { mult: 0.9, hits: 2, pierce: 2 } }] },
    { id: 'tide', name: '潮汐', base: 'flurry', unlockDepth: 5, rarity: 3,
      desc: '重疗同伴并护住自身，适合后阵久战。', attack: { intervalScale: 1.35, mult: 0.7 }, energy: { regen: 1.4, max: 24 },
      skills: [{ id: 'tide', name: '返潮', cost: 8, castTime: 0.8, cooldown: 6, cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 2.1, shield: 0.15 } }] },
    { id: 'pulse', name: '鸣脉', base: 'corridor5', unlockDepth: 4, rarity: 2,
      desc: '平攻积攒余裕，以高频招式持续施压。', energy: { regen: 0.7, max: 20, onAttack: 1.5 },
      skills: [{ id: 'pulse', name: '脉冲', cost: 5, castTime: 0.25, cooldown: 2.5, cond: {}, target: 'frontFoe', effect: { mult: 1.5 } }] },
    { id: 'sunder', name: '震裂', base: 'inverse', unlockDepth: 6, rarity: 4,
      desc: '重击前锋，余波扫过其余敌人。', energy: { regen: 1.2, max: 28 },
      skills: [{ id: 'sunder', name: '断层', cost: 10, castTime: 1.1, cooldown: 6, cond: {}, target: 'frontFoe', effect: { mult: 2.3, splash: 0.55 } }] },
    { id: 'bloodrush', name: '孤注', base: 'flurry', unlockDepth: 5, rarity: 3,
      desc: '攒满余裕后强化平攻，打一轮集中爆发。', attack: { intervalScale: 0.8, mult: 0.9 },
      skills: [{ id: 'bloodrush', name: '倾注', cost: 10, castTime: 0.5, cooldown: 7, cond: { energyAbove: 12 }, target: 'frontFoe', effect: { mult: 1.2, buffAttack: { mult: 2, seconds: 4 } } }] },
    { id: 'sentinel', name: '守灯', base: 'twinflow', unlockDepth: 6, rarity: 4,
      desc: '同伴受伤时治疗，否则双击；两式共用冷却。', 
      skills: [
        { id: 'sentinelHeal', name: '续灯', cost: 6, castTime: 0.6, cooldown: 5, sharedCooldown: true, cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 1.7 } },
        { id: 'sentinelStrike', name: '挑灯', cost: 6, castTime: 0.6, cooldown: 5, sharedCooldown: true, cond: {}, target: 'lowestHpFoe', effect: { mult: 1, hits: 2 } },
      ] },
    { id: 'echo', name: '回响', base: 'inverse', unlockDepth: 7, rarity: 5,
      desc: '三线共振后强化平攻，兼顾群攻与持续输出。', 
      skills: [{ id: 'echo', name: '重响', cost: 12, castTime: 1, cooldown: 7, cond: {}, target: 'frontFoe', effect: { mult: 1.6, pierce: 3, buffAttack: { mult: 1.5, seconds: 3 } } }] },
    { id: 'rivet', name: '扣钉', base: 'spark', unlockDepth: 3, rarity: 1,
      desc: '三次平攻后打入铆钉，自身获得薄盾。',
      skills: [{ id: 'rivet', name: '锁甲', cost: 3, castTime: 0.3, cooldown: 4, cond: { attackCount: 3 }, target: 'frontFoe', effect: { mult: 0.75, shield: 0.12 } }] },
    { id: 'wick', name: '灰芯', base: 'spark', unlockDepth: 3, rarity: 1,
      desc: '贯通后点燃生命比例最低的敌人。', 
      skills: [{ id: 'wick', name: '挑火', cost: 3, castTime: 0.35, cooldown: 4, cond: { routed: true }, target: 'lowestHpFoe', effect: { mult: 0.7, dot: { dmgMult: 0.35, turns: 3 } } }] },
    { id: 'suture', name: '焊缝', base: 'ward', unlockDepth: 4, rarity: 2,
      desc: '治疗重伤同伴，同时短暂强化自身平攻。',
      cells: [[0, 0], [1, 0], [1, 1]], veins: { '0,0': ['W'], '1,1': ['E'] },
      io: { clock: { cell: [0, 0], dir: 'W' }, main: { cell: [1, 1], dir: 'E' } }, exits: [[1, 1]],
      skills: [{ id: 'suture', name: '热焊', cost: 5, castTime: 0.65, cooldown: 5, cond: { alliesHurt: 1 }, target: 'ally', effect: { heal: 1, buffAttack: { mult: 1.4, seconds: 3 } } }] },
    { id: 'shrapnel', name: '碎鳞', base: 'suture', unlockDepth: 4, rarity: 2,
      desc: '前敌半血后碎鳞崩开，余波打击其余敌人。', 
      skills: [{ id: 'shrapnel', name: '崩鳞', cost: 6, castTime: 0.4, cooldown: 4, cond: { foeHpBelow: 0.5 }, target: 'frontFoe', effect: { mult: 1.35, splash: 0.7 } }] },
    { id: 'bellows', name: '风箱', base: 'spark', unlockDepth: 5, rarity: 3, load: 2,
      desc: '受击补充余裕，蓄足后双击并强化平攻。', energy: { regen: 0.8, max: 18, onHit: 1 },
      cells: [[0, 0], [1, 0], [0, 1], [1, 1]], veins: { '0,0': ['W'], '1,0': ['E'] },
      skills: [{ id: 'bellows', name: '鼓炉', cost: 7, castTime: 0.5, cooldown: 5, cond: { energyAbove: 10 }, target: 'frontFoe', effect: { mult: 0.8, hits: 2, buffAttack: { mult: 1.4, seconds: 3 } } }] },
    { id: 'quench', name: '淬壳', base: 'bellows', unlockDepth: 5, rarity: 3,
      desc: '自身受伤时耗用储备余裕，自疗并补盾。',
      skills: [{ id: 'quench', name: '冷淬', cost: 8, castTime: 0.6, cooldown: 6, cond: { energyAbove: 12 }, target: 'self', effect: { heal: 1.6, shield: 0.16 } }] },
    { id: 'awl', name: '锈锥', base: 'suture', unlockDepth: 6, rarity: 3, load: 2,
      desc: '四次平攻后穿过前两敌，并在前敌留下灼伤。', 
      skills: [{ id: 'awl', name: '灼穿', cost: 7, castTime: 0.55, cooldown: 5, cond: { attackCount: 4 }, target: 'frontFoe', effect: { mult: 1.2, pierce: 2, dot: { dmgMult: 0.3, turns: 3 } } }] },
    { id: 'crucible', name: '回炉', base: 'bellows', unlockDepth: 7, rarity: 4, load: 3,
      desc: '两名同伴重伤时优先急救，平时蓄力追击弱敌。', 
      skills: [
        { id: 'crucibleMend', name: '熔补', cost: 5, castTime: 0.45, cooldown: 4, cond: { alliesHurt: 2 }, target: 'ally', effect: { heal: 2.2 } },
        { id: 'cruciblePour', name: '浇铸', cost: 5, castTime: 0.55, cooldown: 5, cond: { energyAbove: 12 }, target: 'lowestHpFoe', effect: { mult: 1.6, splash: 0.35 } },
      ] },
    { id: 'tinThread', name: '锡丝', base: 'ward', rarity: 1, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 1,
      desc: '同伴稍有损伤便补缀，少量多次回血。', 
      skills: [{ id: 'tinThread', name: '牵丝', cost: 2, castTime: 0.35, cooldown: 3, cond: {}, target: 'ally', effect: { heal: 0.55 } }] },
    { id: 'fileTooth', name: '锉齿', base: 'spark', rarity: 2, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 2,
      desc: '两次平攻后双锉最虚弱的敌人。', 
      skills: [{ id: 'fileTooth', name: '对锉', cost: 4, castTime: 0.3, cooldown: 3.5, cond: { attackCount: 2 }, target: 'lowestHpFoe', effect: { mult: 0.85, hits: 2 } }] },
    { id: 'leadSeal', name: '铅封', base: 'suture', rarity: 2, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 3,
      desc: '同伴重伤时打击前敌，为自身封上一层厚盾。', 
      skills: [{ id: 'leadSeal', name: '封舱', cost: 4, castTime: 0.4, cooldown: 4, cond: { alliesHurt: 1 }, target: 'frontFoe', effect: { mult: 0.9, shield: 0.24 } }] },
    { id: 'tinderMesh', name: '火筛', base: 'bellows', rarity: 3, unlockDepth: 4, fieldSource: 'chest', fieldDepth: 4,
      desc: '余裕充足时抖出火屑，点燃前敌并溅伤其余敌人。', 
      skills: [{ id: 'tinderMesh', name: '落屑', cost: 7, castTime: 0.7, cooldown: 5, cond: { energyAbove: 10 }, target: 'frontFoe', effect: { mult: 1.2, splash: 0.45, dot: { turns: 3, dmgMult: 0.35 } } }] },
    { id: 'anneal', name: '退火', base: 'suture', rarity: 3, unlockDepth: 5, fieldSource: 'chest', fieldDepth: 5,
      desc: '两次平攻后可自疗，并将余热送回武器。', 
      skills: [{ id: 'anneal', name: '归热', cost: 6, castTime: 0.5, cooldown: 5, cond: { attackCount: 2 }, target: 'self', effect: { heal: 1.2, buffAttack: { mult: 1.55, seconds: 3 } } }] },
    { id: 'silverTap', name: '银触', base: 'suture', rarity: 4, load: 2, unlockDepth: 6, fieldSource: 'chest', fieldDepth: 6,
      desc: '贯通后给伤者快速输血，并给施术者加盾。', 
      skills: [{ id: 'silverTap', name: '接脉', cost: 6, castTime: 0.45, cooldown: 4, cond: { routed: true }, target: 'ally', effect: { heal: 1.6, shield: 0.15 } }] },
    { id: 'slagHook', name: '渣钩', base: 'suture', rarity: 2, unlockDepth: 3, fieldSource: 'elite', fieldDepth: 3,
      desc: '钩住最弱的敌人，连续两击并留下灼伤。', 
      skills: [{ id: 'slagHook', name: '拖烬', cost: 6, castTime: 0.65, cooldown: 5, cond: {}, target: 'lowestHpFoe', effect: { mult: 0.8, hits: 2, dot: { turns: 2, dmgMult: 0.4 } } }] },
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
      desc: '前敌虚弱时锁定全场最弱者，引燃目标并强化平攻。', 
      skills: [{ id: 'furnaceEye', name: '照灰', cost: 8, castTime: 0.55, cooldown: 6, cond: { foeHpBelow: 0.6 }, target: 'lowestHpFoe', effect: { mult: 1.65, dot: { turns: 3, dmgMult: 0.4 }, buffAttack: { mult: 1.55, seconds: 4 } } }] },
    /* 撤离谱：水道至黑炉的工程器具。 */
    { id: 'chalkLine', name: '墨斗', base: 'spark', rarity: 1, load: 2, unlockDepth: 3,
      ...CHANNELS.rail, desc: '平攻两次后打直线，给前两名敌人各留一道浅痕。',
      skills: [{ id: 'chalkLine', name: '弹线', cost: 4, castTime: 0.35, cooldown: 4,
        cond: { attackCount: 2 }, target: 'frontFoe', effect: { mult: 1.05, pierce: 2 } }] },
    { id: 'sump', name: '集露', base: 'ward', rarity: 1, load: 2, unlockDepth: 3,
      ...CHANNELS.cup, desc: '余裕达到八点便能给轻伤者补血，并为自己留下薄盾。',
      skills: [{ id: 'sump', name: '承露', cost: 4, castTime: 0.45, cooldown: 5,
        cond: { energyAbove: 8 }, target: 'ally', effect: { heal: 0.95, shield: 0.1 } }] },
    { id: 'oarlock', name: '桨栓', base: 'spark', rarity: 1, load: 2, unlockDepth: 3,
      ...CHANNELS.hook, desc: '贯通后点打最弱一敌，回桨的余劲强化接下来的平攻。',
      skills: [{ id: 'oarlock', name: '回桨', cost: 4, castTime: 0.3, cooldown: 4,
        cond: { routed: true }, target: 'lowestHpFoe', effect: { mult: 1.15, buffAttack: { mult: 1.3, seconds: 2 } } }] },
    { id: 'brineWrap', name: '盐裹', base: 'suture', rarity: 1, load: 1, unlockDepth: 3,
      desc: '同伴重伤时连击前敌，用盐壳稳住自己的身位。',
      skills: [{ id: 'brineWrap', name: '结壳', cost: 4, castTime: 0.45, cooldown: 4.5,
        cond: { alliesHurt: 1 }, target: 'frontFoe', effect: { mult: 0.65, hits: 2, shield: 0.14 } }] },
    { id: 'pikeHead', name: '芦矢', base: 'spark', rarity: 2, load: 2, unlockDepth: 4,
      ...CHANNELS.toe, desc: '三次平攻蓄成一箭，箭尖灼烧最虚弱的敌人。',
      skills: [{ id: 'pikeHead', name: '苇烙', cost: 5, castTime: 0.45, cooldown: 5,
        cond: { attackCount: 3 }, target: 'lowestHpFoe', effect: { mult: 1.6, dot: { turns: 2, dmgMult: 0.3 } } }] },
    { id: 'capstan', name: '绞盘', base: 'bellows', rarity: 2, load: 2, unlockDepth: 4,
      ...CHANNELS.trough, desc: '蓄足十点余裕连绞前锋三次，末段的碎屑扑向旁敌。',
      skills: [{ id: 'capstan', name: '绞缆', cost: 6, castTime: 0.7, cooldown: 6,
        cond: { energyAbove: 10 }, target: 'frontFoe', effect: { mult: 0.67, hits: 3, splash: 0.5 } }] },
    { id: 'dryDock', name: '旱坞', base: 'ward', rarity: 2, load: 2, unlockDepth: 4,
      ...CHANNELS.rail, desc: '两名同伴重伤时优先给最弱者集中补血，适合打持久战。',
      skills: [{ id: 'dryDock', name: '入坞', cost: 5, castTime: 0.65, cooldown: 4,
        cond: { alliesHurt: 2 }, target: 'ally', effect: { heal: 2.15 } }] },
    { id: 'rushMat', name: '蒲席', base: 'ward', rarity: 2, load: 1, unlockDepth: 4,
      desc: '两次平攻后借机自疗，同时垫一层吸收伤害的软甲。',
      skills: [{ id: 'rushMat', name: '覆席', cost: 4, castTime: 0.4, cooldown: 5,
        cond: { attackCount: 2 }, target: 'self', effect: { heal: 0.85, shield: 0.19 } }] },
    { id: 'furnaceTong', name: '钳口', base: 'bellows', rarity: 2, load: 2, unlockDepth: 4,
      ...CHANNELS.hook, desc: '敌方前锋生命低于六成时，钳住最弱者并取得余热强化。',
      skills: [{ id: 'furnaceTong', name: '扣喉', cost: 6, castTime: 0.55, cooldown: 5,
        cond: { foeHpBelow: 0.6 }, target: 'lowestHpFoe', effect: { mult: 1.25, hits: 2, buffAttack: { mult: 1.3, seconds: 2.5 } } }] },
    { id: 'millStone', name: '辊花', base: 'bellows', rarity: 3, load: 2, unlockDepth: 5,
      ...CHANNELS.stairs, desc: '贯通且平攻两次后，滚花轮咬住前两敌，各打两击。',
      skills: [{ id: 'millStone', name: '滚齿', cost: 6, castTime: 0.55, cooldown: 5,
        cond: { routed: true, attackCount: 2 }, target: 'frontFoe', effect: { mult: 0.8, hits: 2, pierce: 2 } }] },
    { id: 'soundingLine', name: '测深', base: 'ward', rarity: 3, load: 2, unlockDepth: 5,
      ...CHANNELS.spur, desc: '两名同伴重伤时反击敌方前排；回收探锤以护住自身。',
      skills: [{ id: 'soundingLine', name: '沉锤', cost: 5, castTime: 0.45, cooldown: 5,
        cond: { alliesHurt: 2 }, target: 'frontFoe', effect: { mult: 1.15, pierce: 2, shield: 0.19 } }] },
    { id: 'copperWick', name: '垂烛', base: 'suture', rarity: 3, load: 2, unlockDepth: 5,
      ...CHANNELS.comb, desc: '贯通后施放长燃的微火，余焰掠过其余敌人。',
      skills: [{ id: 'copperWick', name: '滴蜡', cost: 5, castTime: 0.6, cooldown: 6,
        cond: { routed: true }, target: 'frontFoe', effect: { mult: 0.9, splash: 0.45, dot: { turns: 4, dmgMult: 0.32 } } }] },
    { id: 'glassBell', name: '琉钟', base: 'ward', rarity: 3, load: 2, unlockDepth: 5,
      ...CHANNELS.cup, desc: '前敌跌破半血时改以快疗托住伤者，便于并装追击招。',
      skills: [{ id: 'glassBell', name: '收音', cost: 4, castTime: 0.3, cooldown: 3.5,
        cond: { foeHpBelow: 0.5 }, target: 'ally', effect: { heal: 1.55 } }] },
    { id: 'quarrySaw', name: '锯岩', base: 'bellows', rarity: 4, load: 3, unlockDepth: 6,
      ...CHANNELS.stairs, desc: '蓄足十二点余裕后横切前两敌，借锯齿的震动强化平攻。',
      skills: [{ id: 'quarrySaw', name: '双锯', cost: 8, castTime: 0.65, cooldown: 6,
        cond: { energyAbove: 12 }, target: 'frontFoe', effect: { mult: 1.55, pierce: 2, buffAttack: { mult: 1.45, seconds: 3 } } }] },
    { id: 'coalSeam', name: '煤层', base: 'spark', rarity: 4, load: 3, unlockDepth: 6,
      ...CHANNELS.trough, desc: '四次平攻后震裂敌阵，黑火留在前锋身上并为自己聚盾。',
      skills: [{ id: 'coalSeam', name: '塌层', cost: 7, castTime: 0.75, cooldown: 6,
        cond: { attackCount: 4 }, target: 'frontFoe', effect: { mult: 1.35, splash: 0.6, dot: { turns: 2, dmgMult: 0.38 }, shield: 0.12 } }] },
    { id: 'lodestone', name: '磁极', base: 'twinflow', rarity: 5, load: 3, unlockDepth: 7,
      ...CHANNELS.crown, desc: '一路贯通且余裕达到十四点时穿透前三敌，自身获得磁壳。',
      skills: [{ id: 'lodestone', name: '连极', cost: 9, castTime: 0.8, cooldown: 7,
        cond: { routed: true, energyAbove: 14 }, target: 'frontFoe', effect: { mult: 1.85, pierce: 3, shield: 0.2 } }] },
    { id: 'turbine', name: '叶轮', base: 'twinflow', rarity: 5, load: 3, unlockDepth: 7,
      ...CHANNELS.spur, desc: '前敌不足六成生命且平攻两次后，叶轮追击最弱者四次。',
      skills: [{ id: 'turbine', name: '追旋', cost: 8, castTime: 0.55, cooldown: 6,
        cond: { foeHpBelow: 0.6, attackCount: 2 }, target: 'lowestHpFoe', effect: { mult: 0.74, hits: 4, splash: 0.48 } }] },
    /* 宝箱谱：弃置的随身器具，偏低耗、轻装与条件补招。 */
    { id: 'boneFlute', name: '骨笛', base: 'ward', rarity: 1, load: 1, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 1,
      desc: '余裕达到六点时吹响短音，治疗伤者并强化自身平攻。',
      skills: [{ id: 'boneFlute', name: '短调', cost: 3, castTime: 0.45, cooldown: 4,
        cond: { energyAbove: 6 }, target: 'ally', effect: { heal: 0.62, buffAttack: { mult: 1.25, seconds: 2 } } }] },
    { id: 'awlPoint', name: '针眼', base: 'spark', rarity: 1, load: 1, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 1,
      desc: '平攻一次后便能对最弱者补一刺，花费低，适合副修。',
      skills: [{ id: 'awlPoint', name: '穿眼', cost: 2, castTime: 0.25, cooldown: 3,
        cond: { attackCount: 1 }, target: 'lowestHpFoe', effect: { mult: 0.85 } }] },
    { id: 'shutter', name: '百叶', base: 'suture', rarity: 1, load: 2, unlockDepth: 3, fieldSource: 'chest', fieldDepth: 2,
      ...CHANNELS.toe, desc: '将三次平攻的余势打向前锋，碎片向旁敌散开。',
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
      ...CHANNELS.cup, desc: '两次平攻后连击前锋并暂时强化平攻，可与计数招式并用。',
      skills: [{ id: 'beltBuckle', name: '束带', cost: 4, castTime: 0.4, cooldown: 5,
        cond: { attackCount: 2 }, target: 'frontFoe', effect: { mult: 0.75, hits: 2, buffAttack: { mult: 1.35, seconds: 2 } } }] },
    { id: 'coilSpring', name: '簧片', base: 'bellows', rarity: 2, load: 2, unlockDepth: 4, fieldSource: 'chest', fieldDepth: 4,
      ...CHANNELS.hook, desc: '蓄足十点余裕后弹向最弱者，溅伤全场并附两回合灼烧。',
      skills: [{ id: 'coilSpring', name: '弹屑', cost: 5, castTime: 0.35, cooldown: 5,
        cond: { energyAbove: 10 }, target: 'lowestHpFoe', effect: { mult: 1.15, splash: 0.4, dot: { turns: 2, dmgMult: 0.26 } } }] },
    { id: 'fieldLamp', name: '巡烛', base: 'suture', rarity: 2, load: 2, unlockDepth: 4, fieldSource: 'chest', fieldDepth: 4,
      ...CHANNELS.comb, desc: '贯通时连打前锋两次，将火留在前锋身上。',
      skills: [{ id: 'fieldLamp', name: '巡照', cost: 5, castTime: 0.4, cooldown: 4.5,
        cond: { routed: true }, target: 'frontFoe', effect: { mult: 0.8, hits: 2, dot: { turns: 3, dmgMult: 0.28 } } }] },
    { id: 'waxTablet', name: '蜡版', base: 'ward', rarity: 3, load: 2, unlockDepth: 5, fieldSource: 'chest', fieldDepth: 5,
      ...CHANNELS.trough, desc: '蓄足十一点余裕且有人重伤时，厚敷伤者并护住自己。',
      skills: [{ id: 'waxTablet', name: '敷版', cost: 6, castTime: 0.55, cooldown: 5,
        cond: { energyAbove: 11, alliesHurt: 1 }, target: 'ally', effect: { heal: 1.8, shield: 0.17 } }] },
    { id: 'splitNeedle', name: '双耳', base: 'spark', rarity: 4, load: 3, unlockDepth: 6, fieldSource: 'chest', fieldDepth: 6,
      ...CHANNELS.crown, desc: '贯通后趁前敌虚弱连续打穿前两敌，兼顾后排。',
      skills: [{ id: 'splitNeedle', name: '扣耳', cost: 7, castTime: 0.55, cooldown: 5.5,
        cond: { routed: true, foeHpBelow: 0.6 }, target: 'frontFoe', effect: { mult: 1.05, hits: 2, pierce: 2 } }] },
    { id: 'surveyLens', name: '透镜', base: 'twinflow', rarity: 5, load: 3, unlockDepth: 7, fieldSource: 'chest', fieldDepth: 7,
      ...CHANNELS.stairs, desc: '平攻三次并积到十二点余裕后，聚光长燃最弱敌并强化平攻。',
      skills: [{ id: 'surveyLens', name: '聚白', cost: 7, castTime: 0.6, cooldown: 6,
        cond: { attackCount: 3, energyAbove: 12 }, target: 'lowestHpFoe', effect: { mult: 1.6, dot: { turns: 4, dmgMult: 0.38 }, buffAttack: { mult: 1.4, seconds: 3 } } }] },
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
      ...CHANNELS.trough, desc: '三次平攻后钉击前两敌，以锤风短时强化自己。',
      skills: [{ id: 'jointHammer', name: '打榫', cost: 5, castTime: 0.6, cooldown: 5,
        cond: { attackCount: 3 }, target: 'frontFoe', effect: { mult: 1.15, pierce: 2, buffAttack: { mult: 1.35, seconds: 2.5 } } }] },
    { id: 'veilStitch', name: '雾绗', base: 'suture', rarity: 2, load: 2, unlockDepth: 4, fieldSource: 'elite', fieldDepth: 4,
      ...CHANNELS.cup, desc: '蓄足十点余裕后以冷雾自疗，同时罩盾并强化平攻。',
      skills: [{ id: 'veilStitch', name: '缝雾', cost: 6, castTime: 0.65, cooldown: 6,
        cond: { energyAbove: 10 }, target: 'self', effect: { heal: 1.05, shield: 0.14, buffAttack: { mult: 1.4, seconds: 2.5 } } }] },
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
      ...CHANNELS.spur, desc: '四次平攻后穿刺前三敌，前锋额外承受持续灼伤。',
      skills: [{ id: 'slagLance', name: '穿炉', cost: 7, castTime: 0.7, cooldown: 6,
        cond: { attackCount: 4 }, target: 'frontFoe', effect: { mult: 1.25, pierce: 3, dot: { turns: 3, dmgMult: 0.35 } } }] },
    { id: 'kilnMantle', name: '炉衣', base: 'twinflow', rarity: 3, load: 2, unlockDepth: 5, fieldSource: 'elite', fieldDepth: 5,
      ...CHANNELS.crown, desc: '两人重伤时以炽甲反击最弱敌，护身并强化接下来的平攻。',
      skills: [{ id: 'kilnMantle', name: '披炉', cost: 7, castTime: 0.45, cooldown: 6,
        cond: { alliesHurt: 2 }, target: 'lowestHpFoe', effect: { mult: 1.5, shield: 0.27, buffAttack: { mult: 1.5, seconds: 3 } } }] },
    { id: 'mawValve', name: '渊阀', base: 'twinflow', rarity: 4, load: 3, unlockDepth: 6, fieldSource: 'elite', fieldDepth: 6,
      ...CHANNELS.trough, desc: '贯通且平攻三次后重击前锋，余波扫过旁敌并留下长燃。',
      skills: [{ id: 'mawValve', name: '泄压', cost: 8, castTime: 0.85, cooldown: 6.5,
        cond: { routed: true, attackCount: 3 }, target: 'frontFoe', effect: { mult: 1.9, splash: 0.65, dot: { turns: 4, dmgMult: 0.35 } } }] },
    { id: 'blackBloom', name: '铁昙', base: 'twinflow', rarity: 4, load: 3, unlockDepth: 6, fieldSource: 'elite', fieldDepth: 6,
      ...CHANNELS.spur, desc: '两人重伤且余裕充足时给最弱同伴续命，施术者同时得盾、强化平攻。',
      skills: [{ id: 'blackBloom', name: '夜放', cost: 8, castTime: 0.6, cooldown: 7,
        cond: { alliesHurt: 2, energyAbove: 13 }, target: 'ally', effect: { heal: 2.3, shield: 0.16, buffAttack: { mult: 1.45, seconds: 3 } } }] },
  ];
  ETCHING_VARIANTS.forEach(({ base, ...spec }) => { MANUSCRIPTS[spec.id] = { ...MANUSCRIPTS[base], ...spec }; });
  // 阵形动作只属于这三门；同一拓片几何的变体各有自己的招式。
  MANUSCRIPTS.spark.modId = 'refractRetreat';
  MANUSCRIPTS.needle.modId = 'shadowAdvance';
  MANUSCRIPTS.ward.modId = 'ironCover';
  Object.values(MANUSCRIPTS).forEach((m) => {
    m.unlockDepth = m.unlockDepth || Math.max(3, MANUSCRIPT_ORDER.indexOf(m.id) + 1);
  });
  MANUSCRIPTS.twinflow.skills.reverse();
  function manuscript(id) { return Object.hasOwn(MANUSCRIPTS, id) ? MANUSCRIPTS[id] : null; }

  /** 同深度优先发现新练法，全部发现后才重复。@param {object} st @param {number} depth @returns {object|null} */
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
    edge: { id: 'edge', name: '锐利', desc: '主手伤害 +15%。', effect: { mainDmg: 0.15 } },
    guard: { id: 'guard', name: '厚重', desc: '全队受到的伤害 -10%。', effect: { dmgTaken: -0.10 } },
    flow: { id: 'flow', name: '导通', desc: '每场战斗开始时主手输出直接获得 2 能量。', effect: { startEnergy: 2 } },
    scavenger: { id: 'scavenger', name: '拾荒', desc: '金币收获 +20%。', effect: { gold: 0.2 } },
    mend: { id: 'mend', name: '缝补', desc: '每层结束时全队恢复 12% 生命。', effect: { floorHeal: 0.12 } },
    pact: { id: 'pact', name: '禁忌契约', desc: '主手伤害 +25%，压力获取 +25%。', effect: { mainDmg: 0.25, stress: 0.25 } },
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
          id: 'sign', label: '签上名字', hint: '60 金币，换一门战利谱',
          need: { gold: 60, noFieldManuscript: true },
          effects: { gold: -60, manuscript: 'event' },
          then: 'ledgerPage',
          text: '笔尖落下去，纸面吸走了墨。柜台上多出一卷还没凉透的拓片。',
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
          id: 'deal', label: '交出一点生命', hint: '本趟全队生命上限 -15%，换一门战利谱',
          need: { noFieldManuscript: true },
          effects: { maxHpPct: -0.15, manuscript: 'event' },
          text: '它的刀很薄，几乎不疼。你们各自少了一点什么，柜台上的拓片慢慢显出来。',
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
  const SKINS = [
    { id: 'blade', name: '铁鸦', portrait: 'portrait.blade' },
    { id: 'warden', name: '磐石', portrait: 'portrait.warden' },
    { id: 'ranger', name: '灰烬', portrait: 'portrait.ranger' },
    { id: 'warlock', name: '低语', portrait: 'portrait.warlock' },
    { id: 'cleric', name: '烛火', portrait: 'portrait.cleric' },
    { id: 'rogue', name: '暗巷', portrait: 'portrait.rogue' },
    ...['断齿', '冷炉', '旧钉', '褪色', '长夜', '哑钟', '霜线', '赤砾', '雾灯', '缄书', '乌隼', '苔衣', '铅月', '余烬', '白棘'].map((name, portraitCell) => ({
      id: 'wanderer' + portraitCell, name, portraitCell,
    })),
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
    DESIGN, CHAPTERS, rewardNodes, rewardTier, chapterAt, chapterLabel, chapterEncounter, BODIES, WEAPONS, WEAPON_ORDER, SUPPORT, GUARD,
    TEMPLATES, TEMPLATE_ORDER, TERMINALS, PRESETS, EMBER_FIXTURE, STRAIGHT_PARK,
    CONDITIONS, THRESHOLDS, TARGETS, ACTIONS, defaultGambits,
    MODS, ENEMIES, ENEMY_ORDER, ELITE_ORDER, BOSS_ORDER, BIOMES, biome, encounterTemplate,
    MANUSCRIPTS, MANUSCRIPT_ORDER, manuscript, manuscriptReward,
    NODE_TYPES, BLESSINGS, BLESSING_ORDER, EVENTS, EVENT_ORDER, eventPool,
    SKINS, NAMES,
    body, weapon, template, enemy, nodeType, blessing, event,
  };
})(globalThis.Ashen ||= {});
