'use strict';
/* 术语唯一来源。
   tooltip、图鉴术语页、窄栏短标签、禁用词校验都从这里取；要加词或改词只改这个文件，
   别在 ui.js 里另写一份（曾经就是散落在 ui.js 里、还有一半根本没人引用）。 */
(function (A) {
  const V = (A.Veteran ||= {});

  /* ------------------------------ 词条 ------------------------------ */
  /* id 稳定（测试与工具按 id 取），label 是显示名。
     desc 里照常写全称——「窄栏缩成短标签」是渲染时的事，不是词条的事。 */
  const ENTRIES = [
    {
      id: 'stress',
      label: '压力',
      desc: '传奇在远征中积累的紧张程度，范围 0–100。敌方招式、现场烙印或撤退会增加，休整、进食和安抚可以降低。压力是双向的：50 起自然回裕降到 85%、出手伤害 +10%；80 起回裕降到 65%、伤害 +25%。',
    },
    {
      id: 'energy',
      label: '余裕',
      desc: '释放蚀刻法招式所用的战斗资源。每位传奇单独积攒，随时间恢复；该传奇装配的各门招式共用这份余裕，释放时扣除。',
    },
    {
      id: 'manuscripts',
      label: '主修 / 合修',
      desc: '装配顺序里的第一门是主修，决定普通攻击的节奏、倍率和基础余裕恢复。后面的门是合修：只提供它自己的招式，招式冷却比主修短 1 秒；它身上的纹路增益减半计入余裕上限与恢复。',
    },
    {
      id: 'coverage',
      label: '覆盖 / 共鸣阶 / 贯通',
      desc: '蚀刻法的格子落在对得上的金属格上就是覆盖；覆盖跨过门槛（如 40%/75%/100%）就上一档共鸣阶；蚀刻法自身的入口沿纹路接到出口，额外获得贯通加成。',
    },
    {
      id: 'resonance',
      label: '共鸣增幅',
      desc: '共鸣阶的乘算与贯通乘算相乘后的总加成，作用在普通攻击和全部招式伤害上，不改变招式消耗与冷却。',
    },
    {
      id: 'dot',
      label: '持续伤害',
      desc: '中毒、灼烧、流血在受伤者自己出手之前结算，腐蚀在出手之后结算。每结算一次算一跳，跳完次数就消失；每跳之前先判死，被毒死的人当次出手直接取消。',
    },
    {
      id: 'brand',
      label: '营火烙印',
      desc: '把本趟找到的一件纹路装进传奇的金属板面，立刻用于后续战斗。每人每趟一次，本趟生命上限降低 20%，压力增加 40。若落点上有未留痕的格子，其中一格会留下瘢痕。',
    },
    {
      id: 'scar',
      label: '瘢痕',
      desc: '烙印留在格底的记录。填上纹路或蚀刻法时触发这一格的正负属性，腾空后属性休眠。指向板上的裂纹标记可查看来源和效果。',
    },
    {
      id: 'load',
      label: '负荷',
      desc: '装上一件纹路或一门蚀刻法占用的承载量。物品的形状决定占哪些格，负荷决定这块金属板面还承受得了多少；超出的部分照样能装，但每超 1 点开局压力 +8、自然回裕 -0.08/s。越重的蚀刻法共鸣乘算也越高（每点负荷 +3%）。',
    },
  ];

  const BY_ID = {};
  for (const e of ENTRIES) BY_ID[e.id] = e;

  /* ------------------------------ 窄栏短标签 ------------------------------ */
  /* 只在宽度受限的容器里用，且一个容器只允许一套词，不能和全称同屏混用。
     表里只放「四字以上、在窄栏必然换行」的词——想加词先量宽度，别图省事。
     规则见 docs/backlog.md A3。 */
  const SHORT = [['普通攻击', '普攻']];

  /* ------------------------------ 禁用词 ------------------------------ */
  /* 2026-11-13 关键词统一时定的（docs/backlog.md A 段）。
     用正则是因为要绕开合法长词：金属板 禁用，但 金属板面 合法，所以写 (?!面)。 */
  const BANNED = [
    { re: /平A|平攻|基础攻击/, fix: '普通攻击', why: '统一叫普通攻击' },
    { re: /能量/, fix: '余裕', why: '战斗资源改叫余裕' },
    { re: /最大生命/, fix: '生命上限', why: '统一叫生命上限' },
    { re: /生命金属|金属板(?!面)/, fix: '金属板面', why: '统一叫金属板面' },
    { re: /台阶/, fix: '共鸣阶', why: '台阶已改名为共鸣阶' },
    { re: /功法|刻印/, fix: '蚀刻法', why: '统一叫蚀刻法' },
    { re: /构件/, fix: '纹路', why: '统一叫纹路' },
    { re: /主手|副手/, fix: '普通攻击', why: '主手/副手机制已删除' },
  ];

  /** 按 id 取解释，取不到给空串（宁可空着，也不要悄悄吐个 undefined 上屏）。 */
  function text(id) {
    const e = BY_ID[id];
    return e ? e.desc : '';
  }

  /** 按 id 取显示名。 */
  function label(id) {
    const e = BY_ID[id];
    return e ? e.label : '';
  }

  /** 把长术语换成窄栏可用的短标签；风味句、名称、日志不经过这里。 */
  function shorten(s) {
    let out = String(s == null ? '' : s);
    for (const [full, brief] of SHORT) out = out.split(full).join(brief);
    return out;
  }

  /** 扫描一段面向玩家的文本，返回命中的禁用词 [{word, fix, why}]。 */
  function audit(s) {
    const str = String(s == null ? '' : s);
    const hits = [];
    for (const rule of BANNED) {
      const m = str.match(rule.re);
      if (m) hits.push({ word: m[0], fix: rule.fix, why: rule.why });
    }
    return hits;
  }

  /** 递归扫描一棵数据树里所有字符串，返回 [{path, text, word, fix}]（测试与工具用）。 */
  function auditTree(root, rootPath = '') {
    const seen = new WeakSet();
    const out = [];
    const walk = (node, at) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      for (const [key, value] of Object.entries(node)) {
        const path = at ? `${at}.${key}` : key;
        if (typeof value === 'string') {
          for (const hit of audit(value)) out.push({ path, text: value, ...hit });
        } else {
          walk(value, path);
        }
      }
    };
    walk(root, rootPath);
    return out;
  }

  V.Terms = { ENTRIES, BY_ID, SHORT, BANNED, text, label, shorten, audit, auditTree };
})(globalThis.Ashen ||= {});
