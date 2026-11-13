'use strict';
/* 数值文案引擎：把机制数据翻译成「可以排版的数值事实」，不产出 HTML。
   - 上游只读 data.js / flavor.js，不依赖 ui、不依赖 DOM
   - 输出统一是 { label, value, tone } 结构，渲染（等宽小字、颜色、分栏）由调用方决定
   - 任何面向玩家的数字都从这里来，改一处就全站同步，不会再和机制数据脱节 */
(function (A) {
  const V = (A.Veteran ||= {});
  const D = () => V.Data;
  const F = () => V.Flavor;

  /* 0.06 → "+0.06/s"；整数 → "+1"；负号用全角减号，保持排版统一 */
  function num(v) {
    const n = Math.round(v * 100) / 100;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
  function signed(v, suffix = '') {
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v))}${suffix}`;
  }
  function pct(v) {
    return signed(Math.round(v * 100), '%');
  }
  function plainPct(v) {
    return `${Math.round(v * 100)}%`;
  }

  /* ---------------- 窄栏短标签 ---------------- */

  /* 词表在 terms.js（与词条、禁用词同源）；这里只转发，不在引擎里再抄一份。
     引擎只决定「哪里用窄版」，不决定「窄版长什么样」。 */
  const shorten = (text) => (V.Terms ? V.Terms.shorten(text) : String(text == null ? '' : text));

  /* ---------------- 纹路 ---------------- */

  /** 纹路增益字段 → 一句数值事实。顺序固定，避免界面上下跳动。 */
  const BOOST_RULES = [
    ['attackMult', (v) => ({ label: '普通攻击伤害', value: pct(v) })],
    ['skillMult', (v) => ({ label: '招式伤害', value: pct(v) })],
    ['regen', (v) => ({ label: '余裕恢复', value: signed(v, '/s') })],
    ['max', (v) => ({ label: '余裕上限', value: signed(v) })],
    ['skillCostCut', (v) => ({ label: '招式消耗', value: signed(-v) })],
    ['healMult', (v) => ({ label: '治疗', value: pct(v) })],
    ['shieldMult', (v) => ({ label: '护盾', value: pct(v) })],
    ['dotMult', (v) => ({ label: '灼烧伤害', value: pct(v) })],
    ['lowHpRegen', (v) => ({ label: '生命低于 50% 时余裕恢复', value: signed(v, '/s') })],
    ['ember', () => ({ label: '命中', value: '附灼烧' })],
  ];

  /** 纹路的全部数值事实。@param {object} tpl @returns {{flavor:string, size:object[], effects:object[]}} */
  function runeFacts(tpl) {
    if (!tpl) return { flavor: '', size: [], effects: [] };
    const boost = tpl.boost || {};
    const effects = BOOST_RULES
      .filter(([key]) => typeof boost[key] === 'number' || (key === 'ember' && boost[key]))
      .map(([key, format]) => {
        const fact = format(boost[key]);
        const worse = (key === 'regen' || key === 'max' || key === 'skillCostCut') ? boost[key] < 0 : false;
        return { ...fact, tone: worse ? 'cost' : 'gain' };
      });
    return {
      flavor: F() ? F().rune(tpl) : tpl.desc || '',
      size: [
        { label: '占格', value: `${tpl.cells ? tpl.cells.length : 0} 格` },
        { label: '负荷', value: num(tpl.load) },
      ],
      effects,
    };
  }

  /* ---------------- 蚀刻法 ---------------- */

  /** 招式触发条件译为玩家能判断的时机。 */
  function conditionText(cond = {}) {
    const parts = [
      cond.routed ? '纹路贯通' : '',
      cond.alliesHurt ? '同伴生命低于 60%' : '',
      cond.foeHpBelow ? `敌方生命低于 ${plainPct(cond.foeHpBelow)}` : '',
      cond.attackCount ? `普通攻击 ${cond.attackCount} 次后` : '',
      cond.energyAbove ? `余裕高于 ${cond.energyAbove}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : '余裕足够时';
  }

  /** 招式效果一行的数值部分。 */
  function skillEffectText(effect = {}) {
    const parts = [];
    if (effect.heal) parts.push(`治疗 ${plainPct(effect.heal)} 攻击`);
    else parts.push(`${plainPct(effect.mult || 1.4)} 攻击`);
    if (effect.hits) parts.push(`${effect.hits} 段`);
    if (effect.pierce) parts.push(`贯穿前 ${effect.pierce} 位`);
    if (effect.splash) parts.push('溅射');
    if (effect.shield) parts.push(`护盾 ${plainPct(effect.shield)} 生命上限`);
    if (effect.buffAttack) parts.push(`接下来 ${effect.buffAttack.hits || 4} 次普通攻击伤害 ×${num(effect.buffAttack.mult || 1.5)}`);
    if (effect.dot) parts.push(`附灼烧 ${effect.dot.hits || 2} 次`);
    return parts.join(' · ');
  }

  /** 一门蚀刻法的全部数值事实。
   * @param {object} spec
   * @param {{compact?:boolean}} [opts] compact：窄栏版，长术语换短标签，数字与结构不变 */
  function manuscriptFacts(spec, opts) {
    if (!spec) return { flavor: '', size: [], main: [], skills: [], tiers: [] };
    const design = D() ? D().DESIGN : null;
    const baseInterval = (design && design.autoAttack.interval) || 0.5;
    const interval = baseInterval * ((spec.attack && spec.attack.intervalScale) || 1);
    const energy = spec.energy || {};
    const main = [
      { label: '普通攻击间隔', value: `${interval.toFixed(2)}s` },
      { label: '余裕恢复', value: signed(energy.regen == null ? 1 : energy.regen, '/s') },
    ];
    if (energy.max != null) main.push({ label: '余裕上限', value: num(energy.max) });

    const skills = (spec.skills || []).map((sk) => ({
      name: sk.name,
      condition: conditionText(sk.cond),
      effect: skillEffectText(sk.effect || {}),
      cost: `${sk.cost} 余裕`,
      cooldown: `冷却 ${sk.cooldown == null ? 4 : sk.cooldown}s`,
    }));

    const tiers = (spec.tiers || []).map((t) => ({
      at: plainPct(t.at / 100),
      name: t.name || '',
      effects: tierEffectText(t.effect || {}),
    }));

    const facts = {
      flavor: F() ? F().etching(spec) : spec.desc || '',
      size: [
        { label: '占格', value: `${spec.cells ? spec.cells.length : 0} 格` },
        { label: '负荷', value: num(spec.load) },
      ],
      main,
      skills,
      tiers,
    };
    return opts && opts.compact ? compactFacts(facts) : facts;
  }

  /** 窄栏版：只缩标签与短句，风味句和蚀刻法/招式名称一律不动。 */
  function compactFacts(facts) {
    return {
      ...facts,
      main: facts.main.map((f) => ({ ...f, label: shorten(f.label) })),
      skills: facts.skills.map((s) => ({
        ...s,
        condition: shorten(s.condition),
        effect: shorten(s.effect),
      })),
      tiers: facts.tiers.map((t) => ({ ...t, effects: shorten(t.effects) })),
    };
  }

  /** 共鸣阶效果（共鸣乘算、起手余裕、护盾倍率）。 */
  function tierEffectText(effect = {}) {
    const parts = [];
    if (effect.mainMult) parts.push(`普通攻击与招式 ×${num(effect.mainMult)}`);
    if (effect.supportMult) parts.push(`护盾与治疗 ×${num(effect.supportMult)}`);
    if (effect.startEnergy) parts.push(`起手余裕 +${effect.startEnergy}`);
    return parts.join(' · ');
  }

  /** 共鸣增幅：共鸣阶 × 贯通 × 负荷价，和 circuit.manuscriptState 同顺序，供界面和结算共用。 */
  function resonance(ms) {
    if (!ms || !ms.cov) return { pct: 0, parts: [] };
    const tierMult = (ms.cov.tier && ms.cov.tier.effect && ms.cov.tier.effect.mainMult) || 1;
    const routeMult = ms.rt && ms.rt.ok ? (V.Circuit && V.Circuit.ROUTE_MULT) || 1.15 : 1;
    const loadBonus = ms.cov.tier ? 1 + 0.03 * Math.max(0, (Number(ms.spec && ms.spec.load) || 1) - 1) : 1;
    const total = Math.round(Math.round(tierMult * routeMult * 100) / 100 * loadBonus * 100) / 100;
    const parts = [
      ms.cov.tier ? `${ms.cov.tier.name} ×${num(tierMult)}` : '未达共鸣阶',
      ms.rt && ms.rt.ok ? `贯通 ×${num(routeMult)}` : '未贯通',
    ];
    if (loadBonus > 1) parts.push(`负荷 ×${num(loadBonus)}`);
    return { pct: Math.round((total - 1) * 100), parts, total };
  }

  V.Stats = { num, signed, pct, plainPct, shorten, runeFacts, manuscriptFacts, conditionText, skillEffectText, tierEffectText, resonance };
})(globalThis.Ashen ||= {});
