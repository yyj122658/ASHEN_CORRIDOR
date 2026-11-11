'use strict';
/* 静态数据表：职业、技能、羁绊、品质、敌人、首领、祝福、特色装备、难度、事件。
   这里只放不可变数据与声明式规则，不含任何执行逻辑与 DOM 引用。 */
(function (A) {
  'use strict';

  const ELEMENTS = {
    fire:    { name: '火', color: '#D87843' },
    ice:     { name: '冰', color: '#7FBBC8' },
    thunder: { name: '雷', color: '#D9AD65' },
    shadow:  { name: '暗', color: '#AD8AC7' },
    holy:    { name: '圣', color: '#E5DBCA' },
  };

  /* ---------- 职业 ---------- */
  const CLASSES = {
    blade: {
      key: 'blade', name: '剑士', role: '前排', element: 'fire',
      hp: 158, atk: 34, def: 14, spd: 11, crit: 0.10, acc: 0.92, eva: 0.04,
      skills: ['cleave', 'heavySlash'],
      passiveId: 'bladeEdge',
      color: '#C4683F', accent: '#E9A063',
      lore: '把恐惧一起砍碎的人。',
    },
    warden: {
      key: 'warden', name: '盾卫', role: '前排', element: 'ice',
      hp: 215, atk: 22, def: 26, spd: 8, crit: 0.05, acc: 0.90, eva: 0.03,
      skills: ['shieldBash', 'aegis'],
      passiveId: 'wardenWall',
      color: '#5A83B8', accent: '#9CC0E4',
      lore: '站在最前面，是因为后面的人更怕。',
    },
    ranger: {
      key: 'ranger', name: '游侠', role: '后排', element: 'thunder',
      hp: 118, atk: 38, def: 8, spd: 14, crit: 0.20, acc: 0.95, eva: 0.08,
      skills: ['pierceShot', 'arrowRain'],
      passiveId: 'rangerMark',
      color: '#B39A45', accent: '#E6D48A',
      lore: '箭矢从不问理由。',
    },
    warlock: {
      key: 'warlock', name: '术士', role: '后排', element: 'shadow',
      hp: 108, atk: 42, def: 7, spd: 10, crit: 0.12, acc: 0.93, eva: 0.05,
      skills: ['shadowBolt', 'oblivion'],
      passiveId: 'warlockHex',
      color: '#8A5CC0', accent: '#C49AEC',
      lore: '他在听回廊深处的声音。',
    },
    cleric: {
      key: 'cleric', name: '牧师', role: '后排', element: 'holy',
      hp: 132, atk: 27, def: 11, spd: 9, crit: 0.06, acc: 0.94, eva: 0.04,
      skills: ['mend', 'holySmite'],
      passiveId: 'clericGrace',
      color: '#C8BC8A', accent: '#F2EACB',
      lore: '祈祷不一定被听见，但手是暖的。',
    },
    rogue: {
      key: 'rogue', name: '刺客', role: '中排', element: 'shadow',
      hp: 122, atk: 35, def: 9, spd: 16, crit: 0.25, acc: 0.90, eva: 0.16,
      skills: ['backstab', 'shadowFlurry'],
      passiveId: 'rogueFirstStrike',
      color: '#63727F', accent: '#A9BACC',
      lore: '你听见的那声呼吸，不是你的。',
    },
  };

  /* ---------- 技能 ---------- */
  /* type: phys | magic | heal | buff
     target: frontFoe randomFoe lowestHpFoe allFoe allAlly lowestHpAlly self highestAtkFoe */
  const SKILLS = {
    cleave:       { id: 'cleave', name: '横扫', cd: 3, type: 'phys', mult: 0.72, target: 'allFoe', desc: '对全体敌人造成 72% 攻击伤害' },
    heavySlash:   { id: 'heavySlash', name: '裂地斩', cd: 2, type: 'phys', mult: 1.50, target: 'frontFoe', desc: '对前排敌人造成 150% 攻击伤害' },

    shieldBash:   { id: 'shieldBash', name: '盾击', cd: 3, type: 'phys', mult: 0.95, target: 'frontFoe', stun: 1, desc: '95% 伤害并眩晕 1 次行动' },
    aegis:        { id: 'aegis', name: '庇护', cd: 4, type: 'buff', target: 'allAlly', buff: { k: 'dmgReduce', v: 0.35, d: 3, stackKey: 'aegis' }, desc: '全队减伤 35%，持续 3 回合' },

    pierceShot:   { id: 'pierceShot', name: '穿甲箭', cd: 2, type: 'phys', mult: 1.35, target: 'lowestHpFoe', pierce: 0.6, desc: '对残血敌人造成 135% 伤害，无视 60% 防御' },
    arrowRain:    { id: 'arrowRain', name: '箭雨', cd: 4, type: 'phys', mult: 0.76, target: 'allFoe', desc: '对全体敌人造成 76% 攻击伤害' },

    shadowBolt:   { id: 'shadowBolt', name: '暗影箭', cd: 1, type: 'magic', mult: 1.28, target: 'randomFoe', desc: '对随机敌人造成 128% 法术伤害' },
    oblivion:     { id: 'oblivion', name: '湮灭', cd: 4, type: 'magic', mult: 1.02, target: 'allFoe', desc: '对全体敌人造成 102% 法术伤害' },

    mend:         { id: 'mend', name: '愈合之光', cd: 2, type: 'heal', mult: 2.00, target: 'lowestHpAlly', desc: '治疗血量最低的队友' },
    holySmite:    { id: 'holySmite', name: '圣裁', cd: 3, type: 'magic', mult: 1.12, target: 'frontFoe', desc: '对前排造成 112% 法术伤害' },

    backstab:     { id: 'backstab', name: '背刺', cd: 2, type: 'phys', mult: 1.42, target: 'lowestHpFoe', critBonus: 0.35, ignoreFront: true, desc: '对残血敌人造成 172% 伤害，暴击率 +35%' },
    shadowFlurry: { id: 'shadowFlurry', name: '影袭', cd: 3, type: 'phys', mult: 0.52, hits: 3, target: 'randomFoe', desc: '随机敌人 3 连击，每段 52% 伤害' },

    /* 敌人技能 */
    eStrike:      { id: 'eStrike', name: '撕咬', cd: 0, type: 'phys', mult: 1.00, target: 'randomFoe', basic: true, desc: '' },
    eHeavy:       { id: 'eHeavy', name: '重砸', cd: 2, type: 'phys', mult: 1.30, target: 'frontFoe', desc: '' },
    eHowl:        { id: 'eHowl', name: '尖啸', cd: 3, type: 'buff', target: 'allFoe', stress: 12, desc: '' },
    eDrain:       { id: 'eDrain', name: '汲取', cd: 2, type: 'magic', mult: 1.05, target: 'randomFoe', drain: 0.5, desc: '' },
    eCurse:       { id: 'eCurse', name: '诅咒', cd: 3, type: 'magic', mult: 0.70, target: 'allFoe', desc: '' },

    /* 首领机制技能 */
    eBossSmash:   { id: 'eBossSmash', name: '碎地', cd: 0, type: 'phys', mult: 1.30, target: 'allFoe', mechanic: true, desc: '' },
    eBossRoar:    { id: 'eBossRoar', name: '深渊咆哮', cd: 0, type: 'buff', target: 'allFoe', stress: 24, mechanic: true, desc: '' },
  };

  /* ---------- 职业被动 ---------- */
  const PASSIVES = {
    bladeEdge:       { id: 'bladeEdge', job: 'blade', name: '斩残', desc: '对生命低于 50% 的目标伤害 +10%' },
    wardenWall:      { id: 'wardenWall', job: 'warden', name: '铁壁', desc: '处于前排时受到伤害 -10%' },
    rangerMark:      { id: 'rangerMark', job: 'ranger', name: '三息', desc: '每第 3 次伤害行动命中 +10%（仅该次）' },
    warlockHex:      { id: 'warlockHex', job: 'warlock', name: '蚀骨', desc: '对带负面状态的目标法术伤害 +10%' },
    clericGrace:     { id: 'clericGrace', job: 'cleric', name: '怜悯', desc: '治疗生命低于 50% 的目标时治疗量 +15%' },
    rogueFirstStrike:{ id: 'rogueFirstStrike', job: 'rogue', name: '初击', desc: '每场战斗首次伤害行动暴击率 +15%' },
  };

  /* ---------- 羁绊 ---------- */
  const JOB_SYNERGY = {
    blade:   { id: 'blade', name: '剑势', tiers: [
      { n: 2, desc: '全队攻击 +12%', f: (s) => { s.atkMult += 0.12; } },
      { n: 4, desc: '全队攻击 +26%，暴击 +10%', f: (s) => { s.atkMult += 0.14; s.crit += 0.10; } },
    ] },
    warden:  { id: 'warden', name: '壁垒', tiers: [
      { n: 2, desc: '全队减伤 +10%', f: (s) => { s.dmgReduce += 0.10; } },
      { n: 4, desc: '全队减伤 +24%', f: (s) => { s.dmgReduce += 0.14; } },
    ] },
    ranger:  { id: 'ranger', name: '鹰眼', tiers: [
      { n: 2, desc: '全队暴击 +15%', f: (s) => { s.crit += 0.15; } },
      { n: 4, desc: '全队暴击 +30%，速度 +10%', f: (s) => { s.crit += 0.15; s.spdMult += 0.10; } },
    ] },
    warlock: { id: 'warlock', name: '禁忌', tiers: [
      { n: 2, desc: '全队法术伤害 +20%', f: (s) => { s.magicMult += 0.20; } },
      { n: 4, desc: '全队法术伤害 +45%', f: (s) => { s.magicMult += 0.25; } },
    ] },
    cleric:  { id: 'cleric', name: '祝祷', tiers: [
      { n: 2, desc: '治疗量 +25%，战斗结束回复 20% 生命', f: (s) => { s.healMult += 0.25; s.postHeal += 0.20; } },
      { n: 4, desc: '治疗量 +55%，战斗结束回复 40% 生命', f: (s) => { s.healMult += 0.30; s.postHeal += 0.20; } },
    ] },
    rogue:   { id: 'rogue', name: '暗步', tiers: [
      { n: 2, desc: '全队速度 +12%，闪避 +8%', f: (s) => { s.spdMult += 0.12; s.eva += 0.08; } },
      { n: 4, desc: '全队速度 +25%，闪避 +16%', f: (s) => { s.spdMult += 0.13; s.eva += 0.08; } },
    ] },
  };

  const ELEM_SYNERGY = {
    fire:    { id: 'fire', name: '灼烧', tiers: [
      { n: 2, desc: '攻击附带灼烧（3 回合，每回合 10% 攻击力）', f: (s) => { s.burn = Math.max(s.burn, 0.10); } },
      { n: 4, desc: '灼烧翻倍，攻击 +10%', f: (s) => { s.burn = 0.22; s.atkMult += 0.10; } },
    ] },
    ice:     { id: 'ice', name: '霜缚', tiers: [
      { n: 2, desc: '攻击有 25% 概率使目标减速 30%', f: (s) => { s.slow = Math.max(s.slow, 0.25); } },
      { n: 4, desc: '减速概率 45%，减速 45%', f: (s) => { s.slow = 0.45; s.slowPow = 0.45; } },
    ] },
    thunder: { id: 'thunder', name: '雷击', tiers: [
      { n: 2, desc: '暴击伤害 +30%', f: (s) => { s.critDmg += 0.30; } },
      { n: 4, desc: '暴击伤害 +70%', f: (s) => { s.critDmg += 0.40; } },
    ] },
    shadow:  { id: 'shadow', name: '噬魂', tiers: [
      { n: 2, desc: '击杀敌人后攻击 +10%（本场可叠加）', f: (s) => { s.killBonus += 0.10; } },
      { n: 4, desc: '击杀加成 +22%', f: (s) => { s.killBonus += 0.12; } },
    ] },
    holy:    { id: 'holy', name: '圣辉', tiers: [
      { n: 2, desc: '每 3 回合回复 5% 最大生命', f: (s) => { s.regen = Math.max(s.regen, 0.05); s.regenEvery = 3; } },
      { n: 4, desc: '每 2 回合回复 8% 最大生命', f: (s) => { s.regen = 0.08; s.regenEvery = 2; } },
    ] },
  };

  /* ---------- 祝福（本局有效） ---------- */
  const BLESSINGS = {
    ember:     { id: 'ember', name: '余烬', desc: '全队攻击 +10%', color: '#D87843' },
    stone:     { id: 'stone', name: '磐石', desc: '全队最大生命 +15%', color: '#B0A597' },
    spring:    { id: 'spring', name: '清泉', desc: '治疗量 +20%', color: '#8DB69B' },
    feather:   { id: 'feather', name: '轻羽', desc: '全队速度 +10%', color: '#7FBBC8' },
    scavenger: { id: 'scavenger', name: '拾荒', desc: '后续金币获得 +20%', color: '#D9AD65' },
    pact:      { id: 'pact', name: '禁忌契约', desc: '全队攻击 +20%，但后续压力获得 +25%', color: '#AD8AC7' },
  };
  const BLESSING_IDS = Object.keys(BLESSINGS);

  /* ---------- 品质与装备 ---------- */
  const QUALITY = [
    { name: '粗糙', color: '#8A8A8A', mult: 0.65 },
    { name: '普通', color: '#B0A597', mult: 1.00 },
    { name: '精良', color: '#8DB69B', mult: 1.35 },
    { name: '稀有', color: '#7FBBC8', mult: 1.80 },
    { name: '史诗', color: '#AD8AC7', mult: 2.40 },
    { name: '传说', color: '#D9AD65', mult: 3.20 },
  ];

  const SLOT_NAME = { weapon: '武器', armor: '护甲', trinket: '饰品' };

  const ITEM_BASE = {
    weapon:  ['锈蚀短刃', '裂口长剑', '守墓人斧', '碎骨锤', '灰烬法杖', '猎手短弓', '葬仪匕首', '断誓巨剑'],
    armor:   ['破布外衣', '铁片胸甲', '皮革护具', '守夜人斗篷', '殉道者长袍', '锈钉锁甲'],
    trinket: ['骨制护符', '锈铁指环', '阴影碎片', '祷告烛台', '赌徒骰子', '血瓶', '熄灭的灯芯'],
  };

  const PREFIX = {
    atk:  ['锋利的', '嗜血的', '暴怒的'],
    hp:   ['厚重的', '坚韧的'],
    def:  ['坚固的', '石铸的'],
    spd:  ['迅捷的', '轻盈的'],
    crit: ['致命的', '精准的'],
    eva:  ['缥缈的', '滑溜的'],
  };

  /* ---------- 特色装备词条（每件至多一个，按 traitId 去重） ---------- */
  const TRAITS = {
    emberBlade: { id: 'emberBlade', name: '余烬刃', desc: '对处于灼烧状态的目标伤害 +15%', color: '#D87843' },
    nightSeal:  { id: 'nightSeal', name: '守夜印', desc: '战斗开始时获得 12% 最大生命护盾', color: '#7FBBC8' },
    echoLamp:   { id: 'echoLamp', name: '回响灯', desc: '溢出治疗的 50% 转为护盾（单目标上限 30% 最大生命）', color: '#8DB69B' },
    huntCharm:  { id: 'huntCharm', name: '追猎符', desc: '每次击杀速度 +10%，最多 3 层', color: '#D9AD65' },
  };
  const TRAIT_IDS = Object.keys(TRAITS);

  /* ---------- 难度 ---------- */
  const DIFFICULTIES = {
    normal:    { id: 'normal', name: '常规', desc: '标准回廊。', hpMult: 1.00, atkMult: 1.00, goldMult: 1.00, order: 0 },
    deep:      { id: 'deep', name: '深入', desc: '敌人生命 +25%，攻击 +12%，金币 +20%。', hpMult: 1.25, atkMult: 1.12, goldMult: 1.20, order: 1 },
    nightmare: { id: 'nightmare', name: '梦魇', desc: '敌人生命 +55%，攻击 +25%，金币 +45%。', hpMult: 1.55, atkMult: 1.25, goldMult: 1.45, order: 2 },
  };

  /* ---------- 敌人 ---------- */
  const ENEMY_TYPES = [
    { key: 'bone',    name: '骸骨兵', element: 'shadow',  hp: 1.00, atk: 1.00, def: 1.0, spd: 9,  skills: ['eStrike'], color: '#B8B0A0', accent: '#E8E0D0', shape: 'human' },
    { key: 'ghoul',   name: '腐尸',   element: 'shadow',  hp: 1.25, atk: 0.95, def: 0.8, spd: 7,  skills: ['eStrike', 'eHeavy'], color: '#7A8A5A', accent: '#B0C080', shape: 'beast' },
    { key: 'cultist', name: '邪教徒', element: 'shadow',  hp: 0.85, atk: 1.05, def: 0.9, spd: 10, skills: ['eDrain', 'eCurse'], color: '#8A4A6A', accent: '#D08AA8', shape: 'human' },
    { key: 'hound',   name: '影犬',   element: 'ice',     hp: 0.75, atk: 1.15, def: 0.7, spd: 15, skills: ['eStrike'], color: '#4A5A7A', accent: '#8AA0C8', shape: 'beast' },
    { key: 'golem',   name: '石傀',   element: 'thunder', hp: 1.55, atk: 0.90, def: 1.6, spd: 5,  skills: ['eHeavy'], color: '#6A6A72', accent: '#A0A0B0', shape: 'hulk' },
    { key: 'wraith',  name: '怨灵',   element: 'ice',     hp: 0.80, atk: 1.20, def: 0.6, spd: 12, skills: ['eCurse', 'eDrain'], color: '#5A7A8A', accent: '#A0D0E0', shape: 'ghost' },
  ];

  const BOSS_TYPES = [
    {
      key: 'boss1', name: '回廊守门人', element: 'fire',
      hp: 2.65, atk: 1.22, def: 1.15, spd: 9,
      skills: ['eHeavy', 'eStrike'],
      color: '#A03A2A', accent: '#F08050', shape: 'hulk', boss: true,
      artId: 'enemy.gatekeeper',
      mechanic: {
        id: 'gatekeeper',
        every: 3,                      // 每第 3 次自身行动
        skill: 'eBossSmash',
        telegraphSkill: 'eBossSmash',
        telegraphText: '守门人举起双臂，地面在裂开。',
        phaseAt: 0.5,
        phaseBuff: { k: 'atk', v: 0.15 },
        phaseText: '铁锈从裂缝里涌出，它的动作变快了。',
      },
    },
    {
      key: 'boss2', name: '噬忆者', element: 'shadow',
      hp: 2.50, atk: 1.28, def: 1.05, spd: 12,
      skills: ['eCurse', 'eDrain'],
      color: '#6A3A8A', accent: '#C080F0', shape: 'ghost', boss: true,
      artId: 'enemy.memoryEater',
      mechanic: {
        id: 'memoryEater',
        every: 3,
        skill: 'eBossRoar',
        telegraphSkill: 'eBossRoar',
        telegraphText: '它张开嘴，吸走你们刚刚想起的东西。',
        phaseAt: 0.5,
        phaseDrainBonus: 0.20,
        phaseText: '它的面具碎了一半，露出下面的东西。',
      },
    },
  ];

  /* ---------- 名字与精神状态 ---------- */
  const GIVEN_NAMES = ['铁鸦', '灰烬', '寒霜', '荆棘', '暗刃', '晨星', '腐骨', '碎镜', '长夜', '赤砂', '低语', '锈钟', '幽篁', '断誓', '潮汐', '残烛', '孤灯', '褐土', '夜莺', '锉刀'];

  const AFFLICTIONS = [
    { k: 'paranoid', name: '偏执', desc: '命中 -12%' },
    { k: 'fear',     name: '恐惧', desc: '速度 -20%' },
    { k: 'despair',  name: '绝望', desc: '受到的治疗 -30%' },
    { k: 'selfish',  name: '自私', desc: '造成伤害 -15%' },
  ];
  const VIRTUES = [
    { k: 'stalwart', name: '坚毅', desc: '伤害 +20%，减伤 +10%' },
    { k: 'focused',  name: '专注', desc: '命中 +15%，暴击 +10%' },
  ];

  /* ---------- 祭坛永久升级 ---------- */
  const ALTAR_UPGRADES = [
    { k: 'bag', name: '缝合背包', desc: '背包容量 +2', base: 3, inc: 2, max: 5 },
    { k: 'atk', name: '磨刀石',   desc: '全队攻击 +5%', base: 4, inc: 3, max: 5 },
    { k: 'hp',  name: '缝合术',   desc: '全队生命 +5%', base: 4, inc: 3, max: 5 },
    { k: 'rec', name: '黑市线人', desc: '招募时出现 2 星的概率提升', base: 3, inc: 3, max: 4 },
  ];

  /* ---------- 成就 ---------- */
  const ACHIEVEMENTS = [
    { id: 'firstExtract', name: '第一次回来', desc: '完成一次成功撤离' },
    { id: 'firstClear',   name: '回廊尽头',   desc: '击败回廊尽头首领并撤离' },
    { id: 'firstStar3',   name: '三星',       desc: '培养出一名 3 星角色' },
  ];

  /* ---------- 节点类型 ---------- */
  const NODE_TYPES = {
    battle:   { id: 'battle',   name: '残响战斗', artId: 'node.battle',   icon: 'sword' },
    elite:    { id: 'elite',    name: '精英徘徊者', artId: 'node.elite',   icon: 'star' },
    chest:    { id: 'chest',    name: '无人看守的箱子', artId: 'node.chest', icon: 'chest' },
    event:    { id: 'event',    name: '不明声响', artId: 'node.event',      icon: 'question' },
    camp:     { id: 'camp',     name: '废弃营火', artId: 'node.camp',       icon: 'campfire' },
    merchant: { id: 'merchant', name: '游商', artId: 'node.merchant',       icon: 'scales' },
    boss:     { id: 'boss',     name: '回廊尽头', artId: 'node.boss',       icon: 'skull' },
  };

  /* ---------- 事件池（声明式，可序列化） ----------
     outcomes 按 weight 抽取；effects 由 expedtion 解释执行。 */
  const EVENTS = {
    'wall-knock': {
      id: 'wall-knock',
      title: '墙里的敲击',
      text: '三下，停，三下。你把耳朵贴上去，墙是热的。里面有个声音说："放我出去，我给你东西。"',
      choices: [
        {
          id: 'break', label: '砸开墙', hint: '可能得到宝物，也可能放出来不该放的',
          outcomes: [
            { weight: 55, text: '墙塌了。里面是一具抱着箱子的干尸。你拿走了 {loot}。', effects: [{ t: 'loot', count: 1, ilvlBonus: 1, bias: 2 }] },
            { weight: 45, text: '墙塌了。里面什么都没有——除了声音，它钻进了你们的耳朵里。', effects: [{ t: 'stress', amount: 12 }] },
          ],
        },
        { id: 'leave', label: '离开', hint: '什么也不会发生', outcomes: [{ weight: 1, text: '你走开了。敲击声跟着你走了很久。', effects: [] }] },
      ],
    },
    'dying-man': {
      id: 'dying-man',
      title: '垂死的人',
      text: '一个拾荒者靠在墙角，肠子流了一地。他抓着你的袖子："水……"',
      choices: [
        {
          id: 'water', label: '给他水', hint: '压力 -10，可能得到情报',
          outcomes: [
            { weight: 60, text: '他喝完了，笑了一下，然后死了。手里攥着 {gold} 金币。', effects: [{ t: 'stress', amount: -10 }, { t: 'gold', min: 20, max: 40 }] },
            { weight: 40, text: '他喝完了，什么也没说。你们继续走，脚步轻了一点。', effects: [{ t: 'stress', amount: -10 }] },
          ],
        },
        {
          id: 'rob', label: '拿走他的东西', hint: '获得战利品，全队压力 +8',
          outcomes: [{ weight: 1, text: '他还在喘。你把他的手掰开了。得到 {loot}。', effects: [{ t: 'loot', count: 1, bias: 1 }, { t: 'stress', amount: 8 }] }],
        },
      ],
    },
    'mirror': {
      id: 'mirror',
      title: '镜子',
      text: '一面裂了的落地镜，立在走廊正中。镜子里的人比你们晚半秒才动。',
      choices: [
        {
          id: 'smash', label: '砸碎它', hint: '压力 -15，但会受伤',
          outcomes: [{ weight: 1, text: '碎片飞了一地。有人在尖叫，也可能是你们自己。有人被划伤了。', effects: [{ t: 'stress', amount: -15 }, { t: 'damagePct', pct: 0.10, targets: 'random' }] }],
        },
        { id: 'leave', label: '不看了，快走', hint: '什么都没发生……大概', outcomes: [{ weight: 1, text: '你们加快脚步。镜子里的人还在原地，慢慢转过头来。', effects: [{ t: 'stress', amount: 6 }] }] },
      ],
    },
    'altar': {
      id: 'altar',
      title: '祭坛',
      text: '一座矮石台，上面刻着不认识的字。中间有个凹槽，形状像一只手。',
      choices: [
        {
          id: 'blood', label: '割破手掌，把手放进去', hint: '献祭生命，换一件强力装备',
          outcomes: [{ weight: 1, text: '石头吸走了血。凹槽里浮出 {loot}。', effects: [{ t: 'damagePct', pct: 0.25, targets: 'random' }, { t: 'loot', count: 1, ilvlBonus: 2, bias: 2.5 }] }],
        },
        { id: 'coins', label: '拿走石台下的硬币', hint: '小钱，但安全', outcomes: [{ weight: 1, text: '你摸到一把旧硬币，{gold} 金。', effects: [{ t: 'gold', min: 25, max: 45 }] }] },
        { id: 'pass', label: '绕过去', hint: '', outcomes: [{ weight: 1, text: '你们绕过石台。它没有反应。', effects: [] }] },
      ],
    },
    'fog-fork': {
      id: 'fog-fork',
      title: '雾中的岔路',
      text: '雾里伸出三条岔路。左边的地上有血迹，右边有脚印，中间什么都没有。',
      choices: [
        {
          id: 'blood', label: '走血迹', hint: '迎战，赢了才有战利品',
          outcomes: [{
            weight: 1,
            text: '血迹尽头不是尸体——那东西还站着，正在啃食什么。它抬起头，看见了你们。',
            effects: [{ t: 'combat', kind: 'normal' }],
          }],
        },
        {
          id: 'tracks', label: '走脚印', hint: '可能遇到人',
          outcomes: [
            { weight: 50, text: '脚印通向一个被丢弃的包袱。{gold} 金。', effects: [{ t: 'gold', min: 30, max: 50 }] },
            { weight: 50, text: '脚印在半路消失了。你们在原地站了很久，直到听见自己的心跳。', effects: [{ t: 'stress', amount: 10 }] },
          ],
        },
        {
          id: 'middle', label: '走中间', hint: '最坏也最好的路',
          outcomes: [
            { weight: 45, text: '雾散了。地上躺着 {loot}，像在等你。', effects: [{ t: 'loot', count: 1, ilvlBonus: 1, bias: 2.2 }] },
            { weight: 55, text: '你们在雾里走了很久，最后回到了原点。谁也没说话。', effects: [{ t: 'stress', amount: 14 }] },
          ],
        },
      ],
    },
  };

  const VEIL_TEXT = {
    start: '你们走进了回廊。身后的门，关上了。',
    emptyExtract: '你们空着手回来了。门在身后合上，什么也没带走。',
    wipe: '回廊把你们吃了，又吐出了几件衣服。',
  };

  A.Data = {
    ELEMENTS, CLASSES, SKILLS, PASSIVES,
    JOB_SYNERGY, ELEM_SYNERGY,
    BLESSINGS, BLESSING_IDS,
    QUALITY, SLOT_NAME, ITEM_BASE, PREFIX,
    TRAITS, TRAIT_IDS,
    DIFFICULTIES,
    ENEMY_TYPES, BOSS_TYPES,
    GIVEN_NAMES, AFFLICTIONS, VIRTUES,
    ALTAR_UPGRADES, ACHIEVEMENTS, NODE_TYPES, EVENTS, VEIL_TEXT,
  };
})(globalThis.Ashen ||= {});
