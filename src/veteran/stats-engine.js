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

  /**
   * 招式的条件与效果，统一成一套极简短语（2026-11-15）：
   *   条件 → 方括号短语，和清单脚本 scripts/etching-inventory.cjs 同一套写法；
   *   效果 → 动词在前，伤害 180% / 灼烧 25%×3 / 回压 8 / 降冷 1s。
   * 两处必须同源，否则玩家在悬浮窗看到的和底表对不上。
   */
  const COND_TAG = {
    routed: () => '[贯通]',
    alliesHurt: () => '[队友受伤]',
    foeHpBelow: (v) => `[敌人生命 <${plainPct(v)}]`,
    attackCount: (v) => `[普攻 ×${v}]`,
    energyAbove: (v) => `[余裕 ≥${v}]`,
    selfHasShield: () => '[自身有盾]',
    stressAbove: (v) => `[高压 ≥${v}]`,
    minTier: (v) => `[共鸣${TierText(v).replace('阶', '')}阶]`,
  };

  /* 条件的固定显示顺序：先门槛（贯通/共鸣阶）、再连携、再目标状态、最后自身状态。
     顺序固定下来，同一个招式在悬浮窗与清单里的读法才一致。 */
  const COND_ORDER = ['routed', 'minTier', 'afterTag', 'targetHasDot', 'stressAbove',
    'attackCount', 'alliesHurt', 'energyAbove', 'selfHasShield', 'foeHpBelow'];
  const condRank = (k) => {
    const i = COND_ORDER.indexOf(k);
    return i < 0 ? COND_ORDER.length : i;
  };

  function conditionText(cond = {}) {
    const parts = [];
    Object.keys(cond).sort((a, b) => condRank(a) - condRank(b)).forEach((k) => {
      const v = cond[k];
      if (k === 'targetHasDot') { parts.push(`[目标·${DOT_TEXT[v] || '异常'}]`); return; }
      if (k === 'afterTag') { parts.push(`[连携·${v}]`); return; }
      if (k === 'routed' && v === false) { parts.push('[未贯通]'); return; }
      const fn = COND_TAG[k];
      if (fn && v) parts.push(fn(v));
    });
    return parts.length ? parts.join(' ') : '余裕足够时';
  }

  const DOT_TEXT = { burn: '灼烧', poison: '中毒', bleed: '流血', corrode: '腐蚀', all: '异常', any: '任意异常' };
  function TierText(n) { return ['一', '二', '三', '四'][n - 1] ? `${['一', '二', '三', '四'][n - 1]}阶` : `${n} 阶`; }

  /** 标签与悬停解释使用相同数值，长文案只在需要时展示。 */
  function skillEffectFacts(effect, target) {
    const parts = [];
    const add = (label, hint) => parts.push({label, hint});
    const recipient = target === 'self' ? '自己' : target === 'ally' ? '己方生命比例最低的角色'
      : target === 'lowestHpFoe' ? '生命比例最低的敌人' : '敌方最前排目标';
    if (effect.heal) {
      const value = plainPct(effect.heal);
      add(`治疗 ${value}`, `为${recipient}回复生命，基础治疗量按施术者自身幅值的 ${value} 计算。`);
    } else {
      const value = plainPct(effect.mult || 1.4);
      const foes = effect.pierce ? `敌方最前面的 ${effect.pierce} 名存活敌人` : recipient;
      add(`伤害 ${value}`, `攻击${foes}。每段基础伤害按施术者自身幅值的 ${value} 计算，再结算增益、暴击和防御。`);
    }
    if (effect.hits) add(`×${effect.hits} 段`, `对每个目标最多连续攻击 ${effect.hits} 次，每段单独结算。`);
    if (effect.pierce) add(`贯穿 ${effect.pierce}`, `依次打向敌方最前面的 ${effect.pierce} 名存活敌人。`);
    if (effect.splash) add(`溅射 ${plainPct(effect.splash)}`, `其余敌人也会受到余波攻击，基础伤害取本招式的 ${plainPct(effect.splash)}。`);
    if (effect.shield) add(`护盾 ${plainPct(effect.shield)}`, `给自己增加护盾，基础护盾值是自身生命上限的 ${plainPct(effect.shield)}，实际获得量受护盾增益和缓冲上限影响。`);
    if (effect.shieldScale) add(`盾击 ×${num(effect.shieldScale)}`, `用自己当前护盾值的 ${plainPct(effect.shieldScale)} 计算一段额外伤害。`);
    if (effect.buffAttack) {
      const hits = effect.buffAttack.hits || 4;
      const mult = effect.buffAttack.mult || 1.5;
      add(`强攻 ${hits} 次 ${signed(mult)}`, `强化自身输出，最多持续 ${hits} 次普通攻击，独立生效时伤害乘以 ${num(mult)}。`);
    }
    if (effect.dot) {
      const status = DOT_TEXT[effect.dot.k] || '持续伤害';
      const hits = effect.dot.hits || 2;
      const value = plainPct(effect.dot.dmgMult || 0.2);
      add(`${status} ${value}×${hits}`, `使目标受到${status}，最多结算 ${hits} 次，每次基础伤害按施术者自身幅值的 ${value} 计算。`);
    }
    if (effect.detonateDot) {
      const status = effect.detonateDot === 'all' ? '全异常' : DOT_TEXT[effect.detonateDot] || '异常';
      add(`引爆${status}`, `立即结算目标身上${status === '全异常' ? '全部可引爆异常' : status}的剩余伤害。`);
    }
    if (effect.bonusIfDot) {
      const status = DOT_TEXT[effect.bonusIfDot.k] || '异常';
      const mult = num(effect.bonusIfDot.mult);
      add(`对${status}再 ×${mult}`, `目标处于${status}状态时，这招的伤害倍率再乘以 ${mult}。`);
    }
    if (effect.cdrOther) add(`降冷 ${effect.cdrOther}s`, `自己的其他招式的剩余冷却缩短 ${effect.cdrOther} 秒。`);
    if (effect.stressDelta) {
      const value = Math.abs(effect.stressDelta);
      const cooling = effect.stressDelta < 0;
      add(`${cooling ? '回压' : '增压'} ${value}`, `自己的压力${cooling ? '降低' : '增加'} ${value} 点。`);
    }
    return parts;
  }

  function skillEffectText(effect = {}) {
    return skillEffectFacts(effect).map(e => e.label).join(' · ');
  }

  function skillTooltip(skill) {
    const conditions = {
      routed: v => v ? '这门蚀刻法已经贯通' : '这门蚀刻法尚未贯通',
      minTier: v => `这门蚀刻法达到共鸣${TierText(v)}`,
      afterTag: v => `自己在 ${D().DESIGN.comboWindow ?? 5} 秒内，或存活队友在 ${D().DESIGN.comboWindowAlly ?? 3.5} 秒内，施放过带「${v}」标签的招式`,
      targetHasDot: v => `招式目标处于${DOT_TEXT[v] || '异常'}状态`,
      stressAbove: v => `自己的压力至少为 ${v}`,
      attackCount: v => `累计普攻至少 ${v} 次，每次出手记一次`,
      alliesHurt: v => `己方至少有 ${Number(v)} 名存活角色的生命低于各自上限的 60%`,
      energyAbove: v => `当前余裕至少为 ${v}`,
      selfHasShield: () => '自己当前有护盾',
      foeHpBelow: v => `敌方最前排的生命低于自身上限的 ${plainPct(v)}`,
    };
    const cond = skill.cond || {};
    const notes = COND_ORDER.filter(k => cond[k] != null && (k === 'routed' || cond[k] !== false)).map(k => conditions[k](cond[k]));
    notes.push('余裕足够且冷却结束时，招式可自动施放。');
    return { condition: notes.join('\n'), effects: skillEffectFacts(skill.effect || {}, skill.target) };
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

  /** 共鸣增幅：共鸣阶 × 贯通，和 circuit.manuscriptState 同顺序，供界面和结算共用。
      负荷不再参与乘算（2026-11-15 删除负荷价），所以这里也不能再显示「负荷 ×1.09」——
      界面算的和结算算的必须是同一套，否则玩家会看着一个不存在的加成调板面。 */
  function resonance(ms) {
    if (!ms || !ms.cov) return { pct: 0, parts: [] };
    const tierMult = (ms.cov.tier && ms.cov.tier.effect && ms.cov.tier.effect.mainMult) || 1;
    const routeMult = ms.rt && ms.rt.ok ? (V.Circuit && V.Circuit.ROUTE_MULT) || 1.15 : 1;
    const total = Math.round(Math.round(tierMult * routeMult * 100) / 100 * 100) / 100;
    const parts = [
      ms.cov.tier ? `${ms.cov.tier.name} ×${num(tierMult)}` : '未达共鸣阶',
      ms.rt && ms.rt.ok ? `贯通 ×${num(routeMult)}` : '未贯通',
    ];
    return { pct: Math.round((total - 1) * 100), parts, total };
  }

  V.Stats = { num, signed, pct, plainPct, shorten, runeFacts, manuscriptFacts, conditionText, skillEffectText, skillTooltip, tierEffectText, resonance };
})(globalThis.Ashen ||= {});
