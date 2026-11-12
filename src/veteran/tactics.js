'use strict';
/* 有限行为指令：条件 + 目标 + 动作，按顺序取第一条合法项，绝不 eval。
   只做“能不能出手、打谁、花多少能量”的解释，不写伤害。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;

  const CONDITION_IDS = ['always', 'selfHpBelow', 'allyHpBelow', 'enemyCharging', 'atSlot'];
  const TARGET_IDS = ['frontFoe', 'lowestHpFoe', 'lowestHpAlly', 'chargingFoe', 'self'];
  const ACTION_IDS = ['main', 'support', 'guard'];
  const HP_THRESHOLDS = [25, 50, 75];

  /** Gambit 结构校验：槽位、未知条件、AND 上限、未知目标/动作。 */
  function validate(rules, logicSlots) {
    const errors = [];
    if (!Array.isArray(rules)) return { ok: false, errors: ['规则必须是一个列表'] };
    const cap = logicSlots || D().DESIGN.logicSlots;
    if (rules.length > cap) errors.push(`规则 ${rules.length} 条，超过 ${cap} 个槽位`);

    rules.forEach((r, i) => {
      const tag = `第 ${i + 1} 条`;
      if (!r || typeof r !== 'object') { errors.push(`${tag} 不是对象`); return; }
      if (!Array.isArray(r.conditions) || !r.conditions.length) {
        errors.push(`${tag} 缺少条件`);
      } else {
        if (r.conditions.length > 2) errors.push(`${tag} 最多只能 AND 两个条件`);
        r.conditions.forEach((c) => {
          if (!c || !CONDITION_IDS.includes(c.type)) errors.push(`${tag} 有未知条件：${c && c.type}`);
          const meta = D().CONDITIONS.find((x) => x.id === (c && c.type));
          if (meta && meta.needsValue) {
            const ok = c.type === 'atSlot'
              ? [1, 2, 3, 4].includes(c.value)
              : HP_THRESHOLDS.includes(c.value);
            if (!ok) errors.push(`${tag} 的条件 ${c.type} 阈值非法：${c.value}`);
          }
        });
      }
      if (!TARGET_IDS.includes(r.target)) errors.push(`${tag} 有未知目标：${r.target}`);
      if (!ACTION_IDS.includes(r.action)) errors.push(`${tag} 有未知动作：${r.action}`);
    });

    return { ok: errors.length === 0, errors };
  }

  function hpPctOf(u) {
    if (!u || !u.maxHp) return 1;
    return Math.max(0, Math.min(1, u.hp / u.maxHp));
  }

  function conditionHolds(cond, ctx) {
    const self = ctx.self;
    switch (cond.type) {
      case 'always': return true;
      case 'selfHpBelow': return hpPctOf(self) * 100 < cond.value;
      case 'allyHpBelow': {
        const mates = (ctx.allies || []).filter((a) => a.id !== self.id && a.alive !== false);
        return mates.some((a) => hpPctOf(a) * 100 < cond.value);
      }
      case 'enemyCharging': return (ctx.enemies || []).some((e) => e.alive !== false && e.charging);
      case 'atSlot': return (self.slot + 1) === cond.value;
      default: return false;
    }
  }

  /** 目标解析：返回 targetId 或 null（无合法目标）。 */
  function resolveTarget(target, ctx) {
    const foes = (ctx.enemies || []).filter((e) => e.alive !== false);
    const mates = (ctx.allies || []).filter((a) => a.alive !== false);
    const self = ctx.self;

    const frontFoe = () => (foes.length ? foes.slice().sort((a, b) => a.slot - b.slot)[0] : null);
    const lowestHpFoe = () => (foes.length
      ? foes.slice().sort((a, b) => hpPctOf(a) - hpPctOf(b) || a.slot - b.slot)[0] : null);
    const lowestHpAlly = () => (mates.length
      ? mates.slice().sort((a, b) => hpPctOf(a) - hpPctOf(b) || a.slot - b.slot)[0] : null);

    switch (target) {
      case 'frontFoe': { const t = frontFoe(); return t ? t.id : null; }
      case 'lowestHpFoe': { const t = lowestHpFoe(); return t ? t.id : null; }
      case 'lowestHpAlly': { const t = lowestHpAlly(); return t ? t.id : null; }
      case 'chargingFoe': {
        const t = foes.filter((e) => e.charging).sort((a, b) => a.slot - b.slot)[0];
        return t ? t.id : null;
      }
      case 'self': return self.id;
      default: return null;
    }
  }

  /** 主手在当前位置的能量消耗（重炮在 4 号位更便宜）。 */
  function mainCost(weaponId, slot) {
    if (!weaponId) return 0;
    const w = D().weapon(weaponId);
    const m = w.main;
    if (m.energyAtSlot3 != null && slot === 3) return m.energyAtSlot3;
    return m.energy;
  }

  function mainAllowed(weaponId, slot) {
    if (!weaponId) return true;
    const m = D().weapon(weaponId).main;
    if (!m.allowedSlots) return true;
    return m.allowedSlots.includes(slot);
  }

  const ACTION_LABEL = { main: '主手', support: '保护', guard: '防御', basic: '基础攻击' };

  /**
   * evaluate(context, rules) -> {action, targetIds, outputId, cost, reasons, ruleId}
   * context: {self, allies, enemies, energy:{main,support}, weaponId}
   */
  function evaluate(context, rules) {
    const ctx = context || {};
    const list = (rules || []).filter((r) => r && r.enabled !== false);
    const reasons = [];

    for (const r of list) {
      const conds = (r.conditions || []).filter((c) => c && c.type !== 'always');
      const condOk = conds.every((c) => conditionHolds(c, ctx));
      if (!condOk) {
        reasons.push({ ruleId: r.id, ok: false, reason: '条件不满足' });
        continue;
      }

      const targetId = resolveTarget(r.target, ctx);
      if (!targetId) {
        reasons.push({ ruleId: r.id, ok: false, reason: '没有合法目标' });
        continue;
      }

      if (r.action === 'guard') {
        reasons.push({ ruleId: r.id, ok: true, reason: '防御不耗能量' });
        return { action: 'guard', targetIds: [ctx.self.id], outputId: null, cost: 0, reasons, ruleId: r.id };
      }

      if (r.action === 'support') {
        const need = D().SUPPORT.energy;
        const have = (ctx.energy && ctx.energy.support) || 0;
        if (have < need) {
          reasons.push({ ruleId: r.id, ok: false, reason: `保护需要 ${need} 能量，当前 ${have}` });
          continue;
        }
        reasons.push({ ruleId: r.id, ok: true, reason: '保护可用' });
        return { action: 'support', targetIds: [targetId], outputId: 'support', cost: need, reasons, ruleId: r.id };
      }

      /* main */
      const slot = ctx.self.slot;
      if (!mainAllowed(ctx.weaponId, slot)) {
        reasons.push({ ruleId: r.id, ok: false, reason: `主手在 ${slot + 1} 号位不可用` });
        continue;
      }
      const need = mainCost(ctx.weaponId, slot);
      const have = (ctx.energy && ctx.energy.main) || 0;
      if (have < need) {
        reasons.push({ ruleId: r.id, ok: false, reason: `主手需要 ${need} 能量，当前 ${have}` });
        continue;
      }
      reasons.push({ ruleId: r.id, ok: true, reason: '主手可用' });
      return { action: 'main', targetIds: [targetId], outputId: 'main', cost: need, reasons, ruleId: r.id };
    }

    /* 全部不可用：基础攻击兜底 */
    const fallbackTarget = resolveTarget('frontFoe', ctx);
    reasons.push({ ruleId: null, ok: true, reason: '所有规则不可用，退回基础攻击' });
    return {
      action: 'basic', targetIds: fallbackTarget ? [fallbackTarget] : [],
      outputId: null, cost: 0, reasons, ruleId: null,
    };
  }

  /** 给 UI 用的可读解释，不产出 HTML。 */
  function explain(result) {
    if (!result) return '';
    const label = ACTION_LABEL[result.action] || result.action;
    const failed = (result.reasons || []).filter((r) => !r.ok);
    if (!failed.length) return `${label}：${result.reasons[0] ? result.reasons[0].reason : ''}`;
    return `${label}（跳过：${failed.map((f) => f.reason).join('；')}）`;
  }

  V.Tactics = {
    validate, evaluate, explain, resolveTarget, conditionHolds,
    mainCost, mainAllowed, hpPctOf,
    CONDITION_IDS, TARGET_IDS, ACTION_IDS, HP_THRESHOLDS, ACTION_LABEL,
    defaultRules: D().defaultGambits,
  };
})(globalThis.Ashen ||= {});
