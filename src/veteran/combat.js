'use strict';
/* 蚀刻法战斗：固定时间轴、自然恢复的共振余裕、蚀刻法招式与战中换位、
   共鸣与纹路增益、首领预告和半血阶段。
   纯数据推进，不读 DOM / 时钟 / Math.random；不提交任何长期收益。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;
  const ST = () => V.State;

  const TICK_LIMIT = 4200;

  /* ------------------------------ 小工具 ------------------------------ */
  function rngValue(b) {
    const r = A.Random.next(b.rngState >>> 0);
    b.rngState = r.state >>> 0;
    return r.value;
  }
  function rngChance(b, p) { return rngValue(b) < p; }

  function log(b, entry) {
    b.logSeq = (b.logSeq || 0) + 1;
    b.logs.push(Object.assign({ seq: b.logSeq }, entry));
    if (b.logs.length > 240) b.logs.shift();
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function hpPct(u) { return u.maxHp ? clamp(u.hp / u.maxHp, 0, 1) : 1; }

  function alive(units) { return units.filter((u) => u.alive !== false && u.hp > 0); }
  function byId(units, id) { return units.find((u) => u.id === id) || null; }
  function frontOf(units) { return alive(units).sort((a, b) => a.slot - b.slot)[0] || null; }

  /* 压力是双向的：越紧绷，回裕越慢，但打出去的伤害越高。
     50 起换一档，80 起换第二档；玩家可以选择把压力顶上去换爆发。 */
  function pressureRegenMultiplier(stress) {
    return stress >= 80 ? 0.65 : stress >= 50 ? 0.85 : 1;
  }

  /** 压力带来的最终伤害乘算：50 起 +10%，80 起 +25%。 */
  function pressureDamageMultiplier(stress) {
    return stress >= 80 ? 1.25 : stress >= 50 ? 1.10 : 1;
  }

  function energyRegen(u) {
    const base = u.regen ?? D().DESIGN.energyBase.regen;
    const bonus = hpPct(u) < 0.5 ? (u.lowHpRegen || 0) : 0;
    return (base + bonus) * (u.side === 'ally' ? pressureRegenMultiplier(u.stress) : 1);
  }

  function addStress(b, u, amount) {
    const mod = (b && b.bless && b.bless.stress) || 0;
    const gain = amount > 0 && mod ? Math.round(amount * (1 + mod)) : amount;
    const before = pressureRegenMultiplier(u.stress);
    const dmgBefore = pressureDamageMultiplier(u.stress);
    u.stress = Math.min(100, (u.stress || 0) + gain);
    const after = pressureRegenMultiplier(u.stress);
    const dmgAfter = pressureDamageMultiplier(u.stress);
    if (after < before) log(b, { type: 'stress', targetId: u.id,
      text: `${u.name}压力升至${u.stress}，自然回裕降至${Math.round(after * 100)}%，伤害提升 ${Math.round((dmgAfter - 1) * 100)}%` });
  }

  /** 眩光：把命中率按层数扣掉，命中判定统一走这里。 */
  function blindOf(u) {
    return (u.buffs || []).filter((x) => x.k === 'blind').reduce((sum, x) => sum + (x.v || 0), 0);
  }

  function hitChance(actor, target) {
    return clamp((actor.hits || 0.94) - (target.dodge || 0) - blindOf(target), 0.05, 1);
  }

  /* ------------------------------ 遭遇生成 ------------------------------ */

  /**
   * generateEncounter(st, kind) -> {state, enemyBlueprint, combatRngStart}
   * 只在 Encounter.open 第一次调用；重试绝不能再调。
   */
  function generateEncounter(st, kind) {
    const next = ST().clone(st);
    const floor = (next.run && next.run.floor) || 1;
    const index = (next.stats && next.stats.runs) || 0;
    const tpl = D().chapterEncounter(kind, index, floor);

    const sc = D().DESIGN.scaling;
    /* 七个节点逐步升压，章末首领使用自身基准，随从使用独立倍率。 */
    const difficulty = (floor - 1) / 6;
    const scaleHp = 1 + difficulty * sc.hpPerFloor;
    const scaleAtk = 1 + difficulty * sc.atkPerFloor;

    const units = [];
    let slot = 0;

    const push = (typeId, opts) => {
      const meta = D().enemy(typeId);
      const hpMult = opts.boss
        ? (opts.hpMult || 1)
        : ((tpl.bossId ? sc.bossMinionHpMult : sc.minionHpMult) * (opts.hpMult || 1));
      const hp = Math.round(meta.hp * scaleHp * hpMult * (D().DESIGN.enemyHpScale || 1));
      const atk = Math.round(meta.atk * scaleAtk * (opts.atkMult || 1));
      units.push({
        enemyType: meta.id,
        name: opts.name || meta.name,
        slot: slot++,
        hp, maxHp: hp,
        atk,
        def: Math.round(meta.def * (1 + difficulty * 0.12)),
        spd: meta.spd,
        hits: meta.hits,
        isBoss: !!opts.boss,
        isElite: !!(opts.elite || meta.elite),
        sprite: meta.sprite || null,
        filter: meta.filter || null,
        skills: (meta.skills || []).map((s) => ({ ...s })),
        disrupt: meta.disrupt || null,
        phaseAt: meta.phaseAt || null,
        phaseBuff: meta.phaseBuff || null,
        phaseSkills: (meta.phaseSkills || []).map((s) => ({ ...s })),
        onDeathBurst: meta.onDeathBurst || null,
        desc: meta.desc || '',
      });
    };

    /* 精英本体比随从更厚：它要撑住一整轮集火，随从才有存在感 */
    if (tpl.bossId) push(tpl.bossId, { boss: true, hpMult: 1, atkMult: 1 });
    (tpl.minionIds || []).forEach((id) => {
      const isEliteBody = !!(tpl.elite && D().enemy(id).elite);
      push(id, isEliteBody
        ? { elite: true, hpMult: 0.95, atkMult: 1.0 }
        : { hpMult: tpl.elite ? 0.85 : 1, atkMult: 1 });
    });

    /* 推进一次 RNG：遭遇的初始种子固定，重试不会变 */
    const r = A.Random.next(next.rngState >>> 0);
    next.rngState = r.state >>> 0;

    const enemyBlueprint = {
      id: 'bp_' + kind + '_' + floor,
      kind,
      floor,
      units,
      seedTag: Math.floor(r.value * 1e6),
    };

    return {
      state: next,
      enemyBlueprint,
      combatRngStart: (r.state ^ 0x9E3779B9) >>> 0,
    };
  }

  /* ------------------------------ 建战斗 ------------------------------ */

  function buildAlly(st, partyEntry, unit) {
    const stats = V.Roster.stats(st, unit);
    const placements = (st.run.fieldLayouts && st.run.fieldLayouts[unit.id]) || unit.board.placements;
    const cc = V.Circuit.compile(st, unit.id, placements);
    /* 超载：每超 1 点负荷，开局压力 +8、自然回裕 -0.08/s */
    const overload = (cc.ok && cc.value.overload) || 0;
    /* 蚀刻法状态：覆盖率决定的共鸣阶 + 贯通。没有蚀刻法时是空效果，不影响老存档 */
    const equipped = ST().manuscriptsOf(unit);
    const ms = V.Circuit.manuscriptState(st, unit.id, placements);
    const extraMs = equipped.slice(1)
      .map((spec) => V.Circuit.manuscriptState(st, unit.id, placements, spec.id))
      .filter((state) => state.ok);
    /* 合修的纹路增益减半计入余裕账：装第二门要立刻看得到数字变化 */
    const extraBoost = extraMs.reduce((acc, state) => {
      const bo = (state.effects && state.effects.boost) || {};
      acc.max += bo.max || 0;
      acc.regen += bo.regen || 0;
      acc.skillCostCut += bo.skillCostCut || 0;
      return acc;
    }, { max: 0, regen: 0, skillCostCut: 0 });
    const SUB_SHARE = 0.5;
    const skillList = (ms.spec?.skills || []).concat(extraMs.flatMap((state, index) =>
      /* 合修的招式冷却比主修短 1 秒：主修先手，合修跟上 */
      state.spec.skills.map((sk) => ({ ...sk, group: index + 1, cooldown: Math.max(1, (sk.cooldown || 4) - 1) }))));

    const maxHp = stats.maxHp;
    const hp = partyEntry.hp == null ? maxHp : clamp(partyEntry.hp, 1, maxHp);

    return {
      id: 'a_' + unit.id,
      sourceUnitId: unit.id,
      ms,
      extraMs,
      /* 时间轴与余裕：参数全部来自蚀刻法，没有蚀刻法就用基准值 */
      atkTimer: 0,
      dotTimer: 0,
      energy: (ms && ms.effects && ms.effects.startEnergy) || 0,
      energyMax: ((ms && ms.spec && ms.spec.energy && ms.spec.energy.max) || D().DESIGN.energyBase.max)
        + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.max) || 0)
        + Math.round(extraBoost.max * SUB_SHARE),
      regen: ((ms && ms.spec && ms.spec.energy && ms.spec.energy.regen) || D().DESIGN.energyBase.regen)
        + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.regen) || 0)
        + extraBoost.regen * SUB_SHARE - overload * 0.08,
      lowHpRegen: (ms && ms.effects && ms.effects.boost && ms.effects.boost.lowHpRegen) || 0,
      skillCostCut: ((ms && ms.effects && ms.effects.boost && ms.effects.boost.skillCostCut) || 0)
        + Math.round(extraBoost.skillCostCut * SUB_SHARE),
      skillMult: (1 + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.skillMult) || 0)) * ((ms && ms.effects.mainMult) || 1),
      /* 三条流派轴：治疗只吃护持倍率，灼烧吃独立倍率，护盾吃独立倍率 */
      healMult: (ms && ms.effects && ms.effects.boost && ms.effects.boost.healMult) || 0,
      dotMult: (ms && ms.effects && ms.effects.boost && ms.effects.boost.dotMult) || 0,
      shieldMult: (ms && ms.effects && ms.effects.boost && ms.effects.boost.shieldMult) || 0,
      supportMult: (ms && ms.effects.supportMult) || 1,
      emberAttack: !!(ms && ms.effects.boost && ms.effects.boost.ember),
      onHitEnergy: (ms && ms.spec && ms.spec.energy && ms.spec.energy.onHit) || 0,
      onAttackEnergy: (ms && ms.spec && ms.spec.energy && ms.spec.energy.onAttack) || 0,
      attackInterval: D().DESIGN.autoAttack.interval
        * ((ms && ms.spec && ms.spec.attack && ms.spec.attack.intervalScale) || 1),
      attackMult: D().DESIGN.autoAttack.mult
        * ((ms && ms.spec && ms.spec.attack && ms.spec.attack.mult) || 1)
        * (1 + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.attackMult) || 0))
        * ((ms && ms.effects.mainMult) || 1),
      routedAtkBonus: (ms && ms.spec && ms.spec.attack && ms.spec.attack.routedBonus) || 0,
      skillList,
      cds: {},
      atkSinceSkill: 0,
      pendingSkill: null,
      side: 'ally',
      slot: partyEntry.slot,
      skinId: unit.skinId,
      enemyType: null,
      name: unit.name,
      /* 武器已移除：位移与调谐效果改由蚀刻法提供 */
      modId: (unit.manuscript && unit.manuscript.modId) || null,
      traitId: (unit.manuscript && unit.manuscript.traitId) || null,
      bodyPreset: unit.bodyPreset,
      maxHp, hp,
      atk: stats.atk,
      def: stats.def,
      spd: stats.spd,
      hits: D().DESIGN.baseHit,
      crit: D().DESIGN.baseCrit,
      dodge: D().DESIGN.baseDodge,
      alive: hp > 0,
      gauge: 0,
      casting: null,
      castTimer: 0,
      shield: 0,
      buffs: [],
      stress: Math.min(100, (partyEntry.stress || 0) + overload * 8),
      affliction: unit.affliction || null,
      circuit: cc.ok ? cc.value : null,
      circuitErrors: cc.ok ? [] : cc.errors,
      pendingDamagePulse: 0,
      movementUsedRound: -1,
      coverUsedRound: -1,
      actionCount: 0,
      refundUsed: false,
      overflowUsed: false,
      braceUsed: false,
      gambits: (unit.gambits || []).slice(),
      logicSlots: unit.logicSlots || 2,
      stats: { damage: 0, healing: 0, taken: 0, kills: 0, actions: 0 },
    };
  }

  function buildEnemy(bpUnit) {
    return {
      id: 'e_' + bpUnit.enemyType + '_' + bpUnit.slot,
      sourceUnitId: null,
      side: 'enemy',
      slot: bpUnit.slot,
      skinId: null,
      enemyType: bpUnit.enemyType,
      name: bpUnit.name,
      maxHp: bpUnit.maxHp,
      hp: bpUnit.hp,
      atk: bpUnit.atk,
      def: bpUnit.def,
      spd: bpUnit.spd,
      hits: bpUnit.hits || 0.94,
      crit: 0.05,
      dodge: 0.03,
      alive: true,
      gauge: 0,
      atkTimer: 0,
      dotTimer: 0,
      shield: 0,
      buffs: [],
      stress: 0,
      affliction: null,
      skills: bpUnit.skills || [],
      cds: {},
      isBoss: !!bpUnit.isBoss,
      isElite: !!bpUnit.isElite,
      sprite: bpUnit.sprite || null,
      filter: bpUnit.filter || null,
      onDeathBurst: bpUnit.onDeathBurst || null,
      phaseSkills: (bpUnit.phaseSkills || []).slice(),
      disrupt: bpUnit.disrupt || null,
      phaseAt: bpUnit.phaseAt,
      phaseBuff: bpUnit.phaseBuff,
      bossPhase: bpUnit.isBoss ? 1 : 0,
      charging: null,
      intent: null,
      actionCount: 0,
      stats: { damage: 0, healing: 0, taken: 0, kills: 0, actions: 0 },
    };
  }

  /** create(st, enemyBlueprint, rngStart)：把 run.battle 建起来。 */
  function create(st, enemyBlueprint, rngStart) {
    if (!st.run) return ST().fail(st, 'no_run', '还没有远征');
    const next = ST().clone(st);
    const party = (next.run.party || []).slice().sort((a, b) => a.slot - b.slot);
    if (!party.length) return ST().fail(st, 'empty_party', '队伍是空的');

    next.run.stage = 'battle';
    const allies = party.map((p) => {
      const unit = next.roster.find((u) => u.id === p.uid);
      return buildAlly(next, p, unit);
    });
    const enemies = enemyBlueprint.units.map(buildEnemy);

    /* 开局余裕：祝福「导通」直充 2 点；蚀刻法的起手余裕已在 buildAlly 里算好 */
    const blessEnergy = (next.run.blessings || []).some((id) => id === 'flow') ? 2 : 0;
    if (blessEnergy) {
      allies.forEach((a) => {
        a.energy = Math.min(a.energyMax == null ? 20 : a.energyMax, (a.energy || 0) + blessEnergy);
      });
    }

    /* 祝福数值在这里一次性折成三个系数，战斗内不再回查数据表 */
    const bless = { mainDmg: 0, dmgTaken: 0, stress: 0 };
    (next.run.blessings || []).forEach((id) => {
      const e = (D().BLESSINGS[id] && D().BLESSINGS[id].effect) || {};
      bless.mainDmg += e.mainDmg || 0;
      bless.dmgTaken += e.dmgTaken || 0;
      bless.stress += e.stress || 0;
    });

    next.run.battle = {
      id: 'btl_' + (next.run.encounter ? next.run.encounter.id : 'x'),
      kind: enemyBlueprint.kind,
      floor: enemyBlueprint.floor,
      enemyBlueprintId: enemyBlueprint.id,
      allies, enemies,
      tick: 0,
      round: 0,
      over: false,
      win: null,
      outcome: null,
      rngState: (rngStart >>> 0),
      tactic: 'balance',
      bless,
      logSeq: 0,
      logs: [],
      stats: { damage: 0, healing: 0, taken: 0, kills: 0, rounds: 0 },
    };

    log(next.run.battle, { type: 'note', text: `遭遇开始：${enemies.map((e) => e.name).join('、')}` });
    const problems = allies.filter((a) => !a.circuit);
    if (problems.length) {
      problems.forEach((a) => a.circuitErrors.forEach((m) => {
        log(next.run.battle, { type: 'note', text: `${a.name} 回路未编译：${m}` });
      }));
    }

    return ST().ok(next, [{ type: 'battleStart', meta: { kind: enemyBlueprint.kind } }]);
  }

  /* ------------------------------ 伤害 ------------------------------ */

  function shieldCap(u) { return Math.round(u.maxHp * D().DESIGN.supportShieldCapPct); }

  function addShield(u, amount) {
    const cap = shieldCap(u);
    const before = u.shield;
    u.shield = Math.min(cap, u.shield + amount);
    return u.shield - before;
  }

  function mitigation(def) { return def / (def + 50); }

  /**
   * 施加伤害。opts: {pierce, noPulse, isDot, element}
   * 返回 {dealt, absorbed, died}
   */
  function applyDamage(b, src, tgt, amount, opts) {
    /* 敌人伤害按新时间轴缩放：不然我方普通攻击归一化后必然一边倒 */
    if (src && src.side === 'enemy') {
      amount *= (D().DESIGN.enemyDamageScale == null ? 1 : D().DESIGN.enemyDamageScale);
    }
    const o = opts || {};
    /* 祝福：主手增伤与全队减伤，DOT 不吃减伤（否则灼烧会被两次削弱） */
    const bless = (b && b.bless) || null;
    if (bless) {
      if (src && src.side === 'ally') amount *= 1 + bless.mainDmg;
      if (tgt.side === 'ally' && !o.isDot) amount *= 1 + bless.dmgTaken;
    }
    /* 压力换伤害：我方出手越紧绷打得越狠，DOT 不重复吃这一层 */
    if (src && src.side === 'ally' && !o.isDot) amount *= pressureDamageMultiplier(src.stress);
    let dmg = Math.max(1, Math.round(amount));

    if (!o.pierce) {
      const guard = (tgt.buffs || []).some((x) => x.k === 'guard');
      if (guard) dmg = Math.round(dmg * (1 - D().GUARD.reduce));
      const dr = (tgt.buffs || []).filter((x) => x.k === 'dmgReduce').reduce((a, x) => a + x.v, 0);
      if (dr) dmg = Math.round(dmg * (1 - clamp(dr, 0, 0.6)));
    }
    if (o.pierce) dmg = Math.round(dmg);

    /* 残影只挡直射，不挡 AOE / DOT / 贯穿 */
    if (!o.isDot && !o.aoe && !o.pierce && tgt.refract > 0) {
      tgt.refract -= 1;
      log(b, { type: 'blocked', targetId: tgt.id, text: `${tgt.name} 的残影挡下一次直射` });
      return { dealt: 0, absorbed: dmg, died: false };
    }

    let absorbed = 0;
    if (tgt.shield > 0) {
      absorbed = Math.min(tgt.shield, dmg);
      tgt.shield -= absorbed;
      dmg -= absorbed;
    }

    const beforeHp = tgt.hp;
    tgt.hp = Math.max(0, tgt.hp - dmg);
    const actual = beforeHp - tgt.hp;
    if (actual > 0 && tgt.onHitEnergy && !o.isDot && !o.selfInflicted) {
      tgt.energy = Math.min(tgt.energyMax, (tgt.energy || 0) + tgt.onHitEnergy);
    }
    tgt.stats.taken += actual;
    if (src) src.stats.damage += actual;
    if (b.stats) {
      /* damage 只统计我方打出去的；taken 只统计我方承受的，两者不重叠 */
      if (tgt.side === 'enemy') b.stats.damage += actual;
      if (tgt.side === 'ally') b.stats.taken += actual;
    }

    /* 真实 HP 伤害才记录受击脉冲；护盾全挡、自伤、DOT 都不刷 */
    if (actual > 0 && !o.isDot && !o.selfInflicted && tgt.side === 'ally' && tgt.pendingDamagePulse === 0) {
      tgt.pendingDamagePulse = D().DESIGN.energyPulse;
    }

    if (tgt.hp <= 0 && tgt.alive !== false) {
      tgt.alive = false;
      if (src) {
        src.stats.kills += 1;
        if (b.stats) b.stats.kills += 1;
      }
      log(b, { type: 'death', actorId: src ? src.id : null, targetId: tgt.id, text: `${tgt.name} 倒下了` });
      if (tgt.side === 'enemy') {
        deathBurst(b, tgt);
        checkBossPhase(b, tgt);
      }
      return { dealt: actual, absorbed, died: true };
    }

    if (tgt.side === 'enemy') checkBossPhase(b, tgt);
    return { dealt: actual, absorbed, died: false };
  }

  function healUnit(b, src, tgt, amount) {
    const before = tgt.hp;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + Math.round(amount));
    const healed = tgt.hp - before;
    if (src) src.stats.healing += healed;
    if (b.stats) b.stats.healing += healed;
    const overheal = Math.round(amount) - healed;
    if (healed > 0) {
      log(b, { type: 'heal', actorId: src ? src.id : null, targetId: tgt.id, amount: healed, text: `${tgt.name} 恢复 ${healed}` });
    }
    return { healed, overheal };
  }

  /** 死亡崩裂：倒下时把壳里的东西泼出来，一次性打击全队。 */
  function deathBurst(b, dead) {
    const burst = dead.onDeathBurst;
    if (!burst || b.burstActive) return;
    b.burstActive = true;
    alive(b.allies).slice().forEach((t) => {
      const dmg = dead.atk * (burst.mult || 0.8) * (1 - mitigation(t.def));
      const r = applyDamage(b, dead, t, dmg, { aoe: true });
      log(b, {
        type: 'hit', actorId: dead.id, targetId: t.id, amount: r.dealt,
        text: `${dead.name} 的${burst.name || '崩裂'}溅到 ${t.name} -${r.dealt}`,
      });
      if (burst.dot && t.alive !== false && r.dealt > 0) t.buffs.push({ ...burst.dot });
    });
    b.burstActive = false;
  }

  /** 首领半血阶段：只触发一次。第二阶段可以追加招式。 */
  function checkBossPhase(b, boss) {
    if (!boss || !boss.isBoss || boss.bossPhase !== 1) return;
    if (!boss.phaseAt) return;
    if (hpPct(boss) > boss.phaseAt) return;
    boss.bossPhase = 2;
    if (boss.phaseBuff) {
      if (boss.phaseBuff.atkMult) boss.atk = Math.round(boss.atk * boss.phaseBuff.atkMult);
      if (boss.phaseBuff.spdAdd) boss.spd += boss.phaseBuff.spdAdd;
      log(b, { type: 'phase', actorId: boss.id, text: `${boss.name} 进入第二阶段：${boss.phaseBuff.name}` });
    }
    (boss.phaseSkills || []).forEach((sk) => {
      if (!boss.skills.some((s) => s.id === sk.id)) boss.skills.push({ ...sk });
      log(b, { type: 'phase', actorId: boss.id, text: `${boss.name} 起手招式：${sk.name}` });
    });
    const allies = b.allies.filter((u) => u.alive !== false);
    allies.forEach((u) => addStress(b, u, 6));
  }

  /* ------------------------------ 行动条 ------------------------------ */

  function effSpd(u) {
    const slow = (u.buffs || []).filter((x) => x.k === 'slow').reduce((a, x) => a + x.v, 0);
    return Math.max(1, u.spd - slow);
  }

  /* 持续伤害按「目标自己出手的次数」结算，不再按回合。
     中毒 / 灼烧 / 流血在出手前跳，腐蚀在出手后跳；每跳之前先判死，死了就不再往下结算。 */
  const DOT_KINDS = { poison: 'pre', burn: 'pre', bleed: 'pre', corrode: 'post' };
  const DOT_LABEL = { poison: '中毒', burn: '灼烧', bleed: '流血', corrode: '腐蚀' };

  function isDot(x) { return !!DOT_KINDS[x && x.k]; }
  function dotPhase(x) { return (x && x.on) || DOT_KINDS[x && x.k] || 'pre'; }

  /** 一个单位「自己一动」的间隔：基础 0.5s，受速度与【弧火】缩时影响。 */
  function pulseInterval(u) {
    const spark = u.extraMs?.find((s) => s.spec.id === 'spark');
    return (u.attackInterval ?? D().DESIGN.autoAttack.interval) * (spark?.spec.attack.intervalScale ?? 1);
  }

  /** 结算指定时机的持续伤害：返回目标是否还活着（死了就不用继续出手）。 */
  function resolveDots(b, actor, phase) {
    const list = (actor.buffs || []).filter((x) => isDot(x) && dotPhase(x) === phase);
    for (const dot of list) {
      if (actor.alive === false || actor.hp <= 0) break;
      applyDamage(b, null, actor, dot.v, { isDot: true, pierce: true });
      dot.hits = Math.max(0, (dot.hits || 1) - 1);
      log(b, {
        type: 'dot', actorId: actor.id, targetId: actor.id, amount: dot.v, kind: dot.k,
        text: `${actor.name} 的${DOT_LABEL[dot.k] || '持续伤害'}发作 ${dot.v}${dot.hits > 0 ? `（还剩 ${dot.hits} 次）` : ''}`,
      });
    }
    actor.buffs = (actor.buffs || []).filter((x) => !isDot(x) || (x.hits || 0) > 0);
    return actor.alive !== false && actor.hp > 0;
  }

  function tickBuffs(b) {
    const all = [...b.allies, ...b.enemies];
    all.forEach((u) => {
      if (u.alive === false) return;
      u.buffs = (u.buffs || []).filter((x) => {
        /* 按次数的强化与持续伤害都不随回合流逝，各自由出手/受击推动 */
        if (x.k === 'atkUp' || isDot(x)) return true;
        if (x.seconds != null) return x.seconds > 0;
        x.d = (x.d || 1) - 1;
        return x.d > 0;
      });
    });
  }

  /* ------------------------------ 余裕 ------------------------------ */

  /* ------------------------------ 目标 ------------------------------ */

  function targetsFor(b, actor, targetId) {
    const foes = actor.side === 'ally' ? b.enemies : b.allies;
    const t = byId(foes, targetId);
    return t && t.alive !== false ? [t] : [];
  }

  /* ------------------------------ 单次行动 ------------------------------ */

  function beginAction(b, u) {
    u.actionCount += 1;
    if (b.stats) b.stats.actions = (b.stats.actions || 0) + 1;
    u.stats.actions += 1;
    if (u.refract) u.refract = 0;
    /* 自身行动开始：清 guard */
    u.buffs = (u.buffs || []).filter((x) => x.k !== 'guard');
    return true;
  }

  function doBasicAttack(b, actor, targetId, opts) {
    const o = opts || {};
    const targets = targetsFor(b, actor, targetId);
    if (!targets.length) return { dealtDamage: false, hits: 0 };
    const tgt = targets[0];
    if (!rngChance(b, clamp(actor.hits - tgt.dodge, 0.05, 1))) {
      log(b, { type: 'miss', actorId: actor.id, targetId: tgt.id, text: `${actor.name} 落空` });
      return { dealtDamage: false, hits: 0 };
    }
    const crit = rngChance(b, actor.crit);
    const atkBonus = (actor.buffs || []).filter((x) => x.k === 'atkUp').reduce((sum, x) => sum + x.v, 0);
    const raw = actor.atk * (o.mult || 1) * (1 + (o.dmgBonus || 0)) * (1 + atkBonus);
    const dmg = raw * (1 - mitigation(tgt.def)) * (crit ? 1.75 : 1);
    const res = applyDamage(b, actor, tgt, dmg, { aoe: !!o.aoe });
    log(b, {
      type: crit ? 'crit' : 'hit', actorId: actor.id, targetId: tgt.id, amount: res.dealt,
      text: `${actor.name} ${o.label || '攻击'} ${tgt.name}${crit ? '（暴击）' : ''} -${res.dealt}`,
    });
    if (o.ember && res.dealt > 0) {
      tgt.buffs.push({ k: 'burn', v: Math.max(2, Math.round(actor.atk * 0.18 * (1 + (actor.dotMult || 0)))), hits: 2 });
      log(b, { type: 'ember', actorId: actor.id, targetId: tgt.id, text: `${tgt.name} 被余烬点燃` });
    }
    return { dealtDamage: res.dealt > 0, hits: 1 };
  }

  /** 消耗输出余裕，返回 {tokens, surge} 或 null。 */
  /** 主手动作。返回 {dealtDamage, action} */
  /* ------------------------------ 时间轴 ------------------------------ */

  /** 指令求值：目标 + 动作一起返回。动作不再只是界面上的一项。 */
  function gambitPlan(b, actor) {
    let targetId = null;
    let action = 'main';
    try {
      const ctx = {
        self: { id: actor.id, slot: actor.slot, hp: actor.hp, maxHp: actor.maxHp, alive: actor.alive },
        allies: b.allies.map((u) => ({ id: u.id, slot: u.slot, hp: u.hp, maxHp: u.maxHp, alive: u.alive !== false })),
        enemies: b.enemies.map((u) => ({
          id: u.id, slot: u.slot, hp: u.hp, maxHp: u.maxHp,
          alive: u.alive !== false, charging: !!u.charging,
        })),
        energy: { main: Math.floor(actor.energy || 0) },
      };
      const d = V.Tactics.evaluate(ctx, actor.gambits);
      if (d) {
        targetId = d.targetIds && d.targetIds[0];
        action = d.action || 'main';
      }
    } catch (e) { /* 指令异常不影响战斗，退回默认目标 */ }

    if (b.tactic === 'focus') return { targetId: pickTarget(b, actor, 'lowestHpFoe')?.id || null, action: 'main' };
    if (b.tactic === 'safe') return { targetId: alive(b.enemies).find((u) => u.charging)?.id || frontOf(b.enemies)?.id || null, action: 'main' };

    if (action === 'guard') return { targetId: actor.id, action };
    const foe = byId(b.enemies, targetId) ? targetId : frontOf(b.enemies)?.id || null;
    return { targetId: foe, action: 'main' };
  }

  /** 兼容旧调用：只要目标。 */
  function gambitTarget(b, actor) {
    return gambitPlan(b, actor).targetId;
  }

  function pickTarget(b, actor, kind) {
    const foes = alive(actor.side === 'ally' ? b.enemies : b.allies);
    if (!foes.length) return null;
    if (kind === 'lowestHpFoe') return foes.slice().sort((x, y) => hpPct(x) - hpPct(y) || x.slot - y.slot)[0];
    if (kind === 'self') return actor;
    if (kind === 'ally') {
      const mates = alive(b.allies).slice().sort((x, y) => hpPct(x) - hpPct(y) || x.slot - y.slot);
      return mates[0] || actor;
    }
    return frontOf(actor.side === 'ally' ? b.enemies : b.allies);
  }

  /** 条件判定：只做有限几种，便于 UI 解释 */
  function condOk(b, actor, cond, ms, attackCount) {
    if (!cond) return true;
    if (cond.routed || cond.routed === false) {
      const routed = !!(ms && ms.routed);
      if (routed !== !!cond.routed) return false;
    }
    if (cond.foeHpBelow != null) {
      const t = frontOf(b.enemies);
      if (!t || hpPct(t) >= cond.foeHpBelow) return false;
    }
    if (cond.alliesHurt != null && alive(b.allies).filter((u) => hpPct(u) < 0.6).length < cond.alliesHurt) return false;
    if (cond.energyAbove != null && (actor.energy || 0) < cond.energyAbove) return false;
    if (cond.attackCount != null && attackCount < cond.attackCount) return false;
    return true;
  }

  function cooldownKey(sk) { return sk.group ? sk.group + ':' + sk.id : sk.id; }

  function skillCost(actor, sk) {
    const cut = sk.group ? actor.extraMs[sk.group - 1].effects.boost.skillCostCut : actor.skillCostCut;
    return Math.max(1, (sk.cost || 0) - (cut || 0));
  }

  function readySkill(b, actor) {
    const count = 1 + (actor.extraMs || []).length;
    for (let offset = 0; offset < count; offset++) {
      const group = ((actor.nextGroup || 0) + offset) % count;
      const ms = group ? actor.extraMs[group - 1] : actor.ms;
      const attacks = group ? ms.atkSinceSkill : actor.atkSinceSkill;
      for (const sk of actor.skillList || []) {
        if ((sk.group || 0) !== group || actor.cds?.[cooldownKey(sk)] > 0) continue;
        if ((actor.energy || 0) < skillCost(actor, sk) || !condOk(b, actor, sk.cond, ms, attacks || 0)) continue;
        const target = pickTarget(b, actor, sk.target);
        if (target && !(sk.effect?.heal && target.hp >= target.maxHp)) return sk;
      }
    }
    return null;
  }

  function startCast(b, actor, sk) {
    actor.stats.skills = (actor.stats.skills || 0) + 1;
    actor.casting = sk.id;
    actor.castTimer = sk.castTime || 0.6;
    actor.cds = actor.cds || {};
    const siblings = actor.skillList.filter((s) => s.group === sk.group);
    for (const s of siblings.some((s) => s.sharedCooldown) ? siblings : [sk]) {
      actor.cds[cooldownKey(s)] = sk.cooldown || 4;
    }
    actor.energy = Math.max(0, (actor.energy || 0) - skillCost(actor, sk));
    if (sk.group) actor.extraMs[sk.group - 1].atkSinceSkill = 0;
    else actor.atkSinceSkill = 0;
    if (actor.extraMs?.length) actor.nextGroup = ((sk.group || 0) + 1) % (actor.extraMs.length + 1);
    actor.pendingSkill = sk;
    log(b, {
      type: 'cast', actorId: actor.id,
      text: `${actor.name} 起手「${sk.name}」`,
    });
  }

  function finishCast(b, actor) {
    const sk = actor.pendingSkill;
    actor.pendingSkill = null;
    actor.casting = null;
    if (!sk) return;
    const tgt = pickTarget(b, actor, sk.target);
    if (!tgt) return;
    const eff = sk.effect || {};
    const source = sk.group ? actor.extraMs[sk.group - 1].effects : null;
    const skillMult = source ? (1 + source.boost.skillMult) * source.mainMult : (actor.skillMult || 1);
    const supportMult = source ? source.supportMult : (actor.supportMult || 1);
    const healMult = source ? (source.boost.healMult || 0) : (actor.healMult || 0);
    const dotMult = source ? (source.boost.dotMult || 0) : (actor.dotMult || 0);
    const shieldMult = source ? (source.boost.shieldMult || 0) : (actor.shieldMult || 0);
    const label = `「${sk.name}」`;
    if (eff.heal) {
      const amount = actor.atk * eff.heal * supportMult * (1 + healMult) * (1 + (b.healBonus || 0));
      healUnit(b, actor, tgt, amount);
    } else {
      const foes = alive(actor.side === 'ally' ? b.enemies : b.allies).sort((a, c) => a.slot - c.slot);
      const targets = eff.pierce ? foes.slice(0, eff.pierce) : [tgt];
      targets.forEach((target) => {
        for (let i = 0; i < (eff.hits || 1) && target.alive !== false; i++) {
          doBasicAttack(b, actor, target.id, { mult: (eff.mult || 1.4) * skillMult, label });
        }
      });
      if (eff.splash) foes.filter((u) => !targets.includes(u)).forEach((target) => {
        doBasicAttack(b, actor, target.id, { mult: (eff.mult || 1.4) * skillMult * eff.splash, label: label + '余波', aoe: true });
      });
    }
    if (eff.shield) {
      const gained = addShield(actor, Math.round(actor.maxHp * eff.shield * (1 + shieldMult)));
      log(b, { type: 'shield', actorId: actor.id, targetId: actor.id, amount: gained, text: `${actor.name} 获得 ${gained} 护盾` });
    }
    if (eff.dot && tgt.alive !== false) {
      tgt.buffs.push({ k: 'burn', v: Math.max(2, Math.round(actor.atk * (eff.dot.dmgMult || 0.2) * (1 + dotMult))), hits: eff.dot.hits || 2 });
    }
    if (eff.buffAttack && actor.alive !== false) {
      actor.buffs = actor.buffs.filter((x) => x.k !== 'atkUp');
      /* 打几次就消耗几次：不再挂秒表，玩家能数得清还剩几下 */
      actor.buffs.push({ k: 'atkUp', v: (eff.buffAttack.mult || 1.5) - 1, hits: eff.buffAttack.hits || 4 });
    }
  }

  /** 强化按「次」消耗：只被普通攻击扣，招式与防御不占次数。 */
  function consumeAtkUp(actor) {
    const buff = (actor.buffs || []).find((x) => x.k === 'atkUp');
    if (!buff) return;
    buff.hits = (buff.hits || 0) - 1;
    if (buff.hits <= 0) actor.buffs = actor.buffs.filter((x) => x !== buff);
  }

  /** 普通攻击：不耗余裕、按间隔自动打出 */
  function doAutoAttack(b, actor, targetIdIn) {
    const bonus = (actor.routedAtkBonus && actor.ms && actor.ms.routed) ? actor.routedAtkBonus : 0;
    const targetId = targetIdIn || gambitTarget(b, actor);
    const res = doBasicAttack(b, actor, targetId, {
      mult: (actor.attackMult || D().DESIGN.autoAttack.mult) * (1 + bonus),
      ember: actor.emberAttack,
      label: '普通攻击',
    });
    actor.atkSinceSkill = (actor.atkSinceSkill || 0) + 1;
    for (const ms of actor.extraMs || []) ms.atkSinceSkill = (ms.atkSinceSkill || 0) + 1;
    if (actor.onAttackEnergy) {
      actor.energy = Math.min(actor.energyMax || 20, (actor.energy || 0) + actor.onAttackEnergy);
    }
    consumeAtkUp(actor);
    return res;
  }

  /* ------------------------------ 我方行动 ------------------------------ */

  function allyTurn(b, actor) {
    /* 招式优先：护盾与治疗都来自蚀刻法招式，指令里的防御是没有招式可放时的选择 */
    const sk = readySkill(b, actor);
    if (sk) {
      startCast(b, actor, sk);
      return { res: { dealtDamage: false, action: 'cast' }, action: 'cast' };
    }

    const plan = gambitPlan(b, actor);

    if (plan.action === 'guard') {
      actor.buffs = (actor.buffs || []).filter((x) => x.k !== 'guard');
      actor.buffs.push({ k: 'guard', d: 1 });
      actor.lastAction = 'guard';
      log(b, { type: 'guard', actorId: actor.id, text: `${actor.name} 举盾防守` });
      return { res: { dealtDamage: false, action: 'guard' }, action: 'guard' };
    }

    const res = doAutoAttack(b, actor, plan.targetId);
    actor.lastAction = 'attack';
    return { res: { dealtDamage: res.dealtDamage, action: 'attack' }, action: 'attack' };
  }

  /* ------------------------------ 敌方行动 ------------------------------ */

  function pickEnemySkill(b, e) {
    const ready = (e.skills || []).filter((s) => (e.cds[s.id] || 0) <= 0);
    if (!ready.length) return null;
    /* 优先大招（预告），其次按定义顺序 */
    const tele = ready.find((s) => s.telegraph);
    if (tele && e.bossPhase >= 1) return tele;
    return ready[0];
  }

  /** 技能的附加效果：先剥盾、抽余裕、上眩光，再算伤害。 */
  function enemySkillStrike(b, e, sk, list) {
    list.filter((t) => t && t.alive !== false).forEach((tgt) => {
      if (sk.blind) {
        tgt.buffs.push({ k: 'blind', v: sk.blind.v, d: sk.blind.d });
        log(b, { type: 'blind', actorId: e.id, targetId: tgt.id, text: `${tgt.name} 被${sk.name}晃了眼，命中下降` });
      }
      if (sk.stripShield && tgt.shield > 0) {
        const lost = tgt.shield;
        tgt.shield = 0;
        log(b, { type: 'strip', actorId: e.id, targetId: tgt.id, text: `${e.name} 的${sk.name}剥掉 ${tgt.name} ${lost} 点护盾` });
      }
      if (sk.drainEnergy) {
        const before = Math.floor(tgt.energy || 0);
        tgt.energy = Math.max(0, (tgt.energy || 0) - sk.drainEnergy);
        if (before > 0) log(b, { type: 'drain', actorId: e.id, targetId: tgt.id, text: `${e.name} 抽走 ${tgt.name} ${Math.round(before - tgt.energy)} 点余裕` });
      }
      if (!(sk.mult > 0)) return;
      if (!rngChance(b, hitChance(e, tgt))) {
        log(b, { type: 'miss', actorId: e.id, targetId: tgt.id, text: `${e.name} 的${sk.name}落空` });
        return;
      }
      const dmg = e.atk * sk.mult * (1 - mitigation(tgt.def));
      const r = applyDamage(b, e, tgt, dmg, { aoe: list.length > 1, pierce: !!sk.pierce });
      log(b, { type: 'hit', actorId: e.id, targetId: tgt.id, amount: r.dealt, text: `${e.name} 的${sk.name}命中 ${tgt.name} -${r.dealt}` });
      if (sk.lifesteal && r.dealt > 0) healUnit(b, e, e, r.dealt * sk.lifesteal);
      if (sk.dot && tgt.alive !== false) tgt.buffs.push({ ...sk.dot });
    });
    if (sk.stress) list.forEach((t) => t && t.alive !== false && addStress(b, t, sk.stress));
  }

  /** 不造成伤害的招式：治疗同族、自修、护住自己。 */
  function enemySkillSupport(b, e, sk) {
    if (sk.healAllies) {
      const hurt = alive(b.enemies).filter((t) => t.hp < t.maxHp);
      hurt.forEach((t) => healUnit(b, e, t, e.atk * sk.healAllies));
      log(b, { type: 'support', actorId: e.id, text: `${e.name} 的${sk.name}替同族续了一口气` });
    }
    if (sk.healSelf) healUnit(b, e, e, e.maxHp * sk.healSelf);
    if (sk.selfShield) {
      const got = addShield(e, e.maxHp * sk.selfShield);
      if (got > 0) log(b, { type: 'shield', actorId: e.id, text: `${e.name} 结起 ${got} 点硬壳` });
    }
  }

  function enemyTurn(b, e) {
    /* actionCount 由 beginAction 统一递增；这里不能再加一次，否则扰位节奏会翻倍 */

    /* 扰位石傀：每第 N 次行动把我方最后一名存活单位推到最前 */
    if (e.disrupt && e.actionCount % e.disrupt.everyActions === 0) {
      const mates = alive(b.allies).sort((a, c) => a.slot - c.slot);
      const last = mates[mates.length - 1];
      if (last) {
        const r = V.Positions.insertFront(b.allies, last.id);
        if (r.ok && r.event) {
          b.allies = r.units;
          log(b, {
            type: 'disrupt', actorId: e.id, targetId: last.id,
            text: `${e.name} 把 ${last.name} 推到最前`,
          });
          e.actionCount = 0;
        } else if (!r.ok) {
          log(b, { type: 'blocked', actorId: e.id, text: `${e.name} 推不动：${r.reason}` });
        }
      }
    }

    const foesOf = (sk) => {
      const foes = alive(b.allies).sort((a, c) => a.slot - c.slot);
      if (sk.target === 'allFoe') return foes;
      if (sk.target === 'lowestHpFoe') return foes.slice().sort((a, c) => hpPct(a) - hpPct(c)).slice(0, 1);
      if (sk.target === 'backFoe') return foes.slice(-1);
      return foes.slice(0, 1);
    };

    /* 预告中的技能：这次真的打出去 */
    if (e.charging) {
      const sk = e.charging;
      e.charging = null;
      e.intent = null;
      enemySkillSupport(b, e, sk);
      enemySkillStrike(b, e, sk, foesOf(sk));
      e.cds[sk.id] = (sk.cd || 0) + 1;
      return 'main';
    }

    const sk = pickEnemySkill(b, e);
    if (!sk) {
      const tgt = frontOf(b.allies);
      if (tgt) {
        if (!rngChance(b, hitChance(e, tgt))) {
          log(b, { type: 'miss', actorId: e.id, targetId: tgt.id, text: `${e.name} 落空` });
          return 'basic';
        }
        const dmg = e.atk * 1.0 * (1 - mitigation(tgt.def));
        const r = applyDamage(b, e, tgt, dmg, {});
        log(b, { type: 'hit', actorId: e.id, targetId: tgt.id, amount: r.dealt, text: `${e.name} 撕咬 ${tgt.name} -${r.dealt}` });
      }
      return 'basic';
    }

    /* 预告型大招：这次只宣告 */
    if (sk.telegraph) {
      e.charging = sk;
      e.intent = { skillId: sk.id, name: sk.name, target: sk.target };
      log(b, { type: 'telegraph', actorId: e.id, text: `${e.name} 正在蓄力：${sk.name}` });
      return 'telegraph';
    }

    e.cds[sk.id] = (sk.cd || 0) + 1;
    enemySkillSupport(b, e, sk);

    const list = foesOf(sk);
    if (!list.length) return 'basic';
    enemySkillStrike(b, e, sk, list);

    /* 纯辅助招式：没有伤害、没有压力时算一次增益出手 */
    if (!(sk.mult > 0) && !sk.stress) {
      log(b, { type: 'support', actorId: e.id, text: `${e.name} 的${sk.name}没有落在任何人身上` });
      return 'buff';
    }
    return 'main';
  }

  /* ------------------------------ 主循环 ------------------------------ */

  function endCheck(b) {
    if (b.over) return true;
    if (!alive(b.allies).length) {
      b.over = true; b.win = false; b.outcome = 'loss';
      log(b, { type: 'defeat', text: '小队失去战斗能力' });
      return true;
    }
    if (!alive(b.enemies).length) {
      b.over = true; b.win = true; b.outcome = 'win';
      log(b, { type: 'victory', text: '战斗胜利' });
      return true;
    }
    return false;
  }

  /** 一步 = 一个 tick。 */
  function step(st) {
    if (!st.run || !st.run.battle) return ST().fail(st, 'no_battle', '没有进行中的战斗');
    if (st.run.battle.over) return ST().fail(st, 'battle_over', '战斗已经结束');

    const next = ST().clone(st);
    const b = next.run.battle;
    const events = [];

    b.tick += 1;
    if (b.tick > TICK_LIMIT) {
      b.over = true;
      b.win = false;
      b.outcome = 'timeout';
      log(b, { type: 'defeat', text: '拖得太久，回廊合上了' });
      return ST().ok(next, [{ type: 'timeout' }]);
    }

    /* 回合边界：6 tick 一回合 */
    if (b.tick % D().DESIGN.ticksPerRound === 0) {
      b.round += 1;
      b.stats.rounds = b.round;
      tickBuffs(b);
      if (endCheck(b)) return ST().ok(next, [{ type: 'round', meta: { round: b.round } }, { type: 'over' }]);
    }

    /* ---- 时间推进：冷却按秒走，余裕自然恢复，施法到点结算 ---- */
    const dt = D().DESIGN.stepSeconds;
    const baseSpd = D().DESIGN.baseSpeed || 10;

    [...b.allies, ...b.enemies].forEach((u) => {
      if (u.alive === false) return;
      u.buffs = (u.buffs || []).filter((x) => {
        if (x.seconds == null) return true;
        x.seconds -= dt;
        return x.seconds > 0;
      });
      Object.keys(u.cds || {}).forEach((k) => {
        if (u.cds[k] > 0) u.cds[k] = Math.max(0, u.cds[k] - dt);
      });
      const emax = u.energyMax == null ? D().DESIGN.energyBase.max : u.energyMax;
      u.energy = Math.min(emax, (u.energy || 0) + energyRegen(u) * dt);

      const ratio = dt * ((effSpd(u) || baseSpd) / baseSpd);
      if (u.casting) {
        u.castTimer -= dt;
        if (u.castTimer <= 0) finishCast(b, u);
      } else {
        u.atkTimer = (u.atkTimer || 0) + ratio;
      }
      /* 持续伤害挂在「自己一动」的节拍上：施法、蓄力都不暂停 */
      u.dotTimer = (u.dotTimer || 0) + ratio;
    });

    /* ---- 到点：出手节拍 / 持续伤害节拍 ---- */
    const due = [];
    [...b.allies, ...b.enemies].forEach((u) => {
      if (u.alive === false) return;
      const iv = pulseInterval(u);
      const dotDue = u.dotTimer >= iv;
      if (dotDue) u.dotTimer -= iv;
      /* 施法期间不出手，但节拍照走 */
      const actDue = !u.casting && u.atkTimer >= iv;
      if (actDue) u.atkTimer -= iv;
      if (actDue || dotDue) due.push({ u, act: actDue });
    });

    /* 稳定排序：先到者先，其次我方先，再按 slot，再按 ID */
    due.sort((x, y) => (y.u.atkTimer - x.u.atkTimer)
      || (x.u.side === y.u.side ? 0 : x.u.side === 'ally' ? -1 : 1)
      || (x.u.slot - y.u.slot)
      || String(x.u.id).localeCompare(String(y.u.id)));

    for (const pending of due) {
      if (b.over) break;

      /* 前一个行动可能替换过 allies / enemies 数组，必须按 ID 重新取引用，
         否则 gauge 扣减与 buff 会写到过期对象上。 */
      const list = pending.u.side === 'ally' ? b.allies : b.enemies;
      const actor = list.find((x) => x.id === pending.u.id);
      if (!actor) continue;
      if (actor.alive === false) continue;

      /* 出手前：中毒 / 灼烧 / 流血先跳；死在毒上，这一拍到此为止 */
      if (!resolveDots(b, actor, 'pre')) {
        if (endCheck(b)) break;
        continue;
      }

      if (pending.act) {
        beginAction(b, actor);

        let rootAction;
        if (actor.side === 'ally') {
          const r = allyTurn(b, actor);
          /* 起手技能没有立即伤害，但换位/援护仍按一次出手结算 */
          rootAction = {
            actorId: actor.id, side: 'ally',
            action: r.action === 'cast' ? 'attack' : r.action,
            dealtDamage: !!r.res.dealtDamage,
          };
        } else {
          const action = enemyTurn(b, actor);
          rootAction = { actorId: actor.id, side: 'enemy', action, dealtDamage: action === 'main' || action === 'basic' };
        }

        /* 出手后：腐蚀等「行动之后才发作」的伤害在这里结算，同样先判死 */
        resolveDots(b, actor, 'post');

        /* 根行动 → 伤害/死亡 → 主动换位 → 援护 */
        const pos = V.Positions.resolveAfterAction(b, rootAction);
        b.allies = pos.battle.allies;
        b.enemies = pos.battle.enemies;
        for (const ev of pos.events) {
          events.push(ev);
          if (ev.type === 'move') {
            const moved = byId(b.allies, ev.actorId);
            log(b, { ...ev, text: `${moved.name} · ${V.Positions.describe(ev)}（${ev.meta.from + 1}→${ev.meta.to + 1}位）` });
          }
        }
      } else {
        /* 这一拍没有出手（施法/蓄力中），腐蚀在拍末照样发作 */
        resolveDots(b, actor, 'post');
      }

      if (endCheck(b)) break;
    }

    /* 这一 tick 可能没有人到 60（例如全体刚被清空），仍要收口 */
    if (!b.over) endCheck(b);

    events.push({ type: 'tick', meta: { tick: b.tick, round: b.round } });
    if (b.over) events.push({ type: 'over', meta: { outcome: b.outcome } });
    return ST().ok(next, events);
  }

  /* ------------------------------ 报告与待确认 ------------------------------ */

  function unitReport(u) {
    const resonances = [u.ms, ...(u.extraMs || [])].filter((s) => s?.ok)
      .map((s) => ({ name: s.spec.name, pct: s.pct, routed: s.routed }));
    return {
      id: u.id,
      sourceUnitId: u.sourceUnitId,
      name: u.name,
      side: u.side,
      slot: u.slot,
      enemyType: u.enemyType,
      skinId: u.skinId,
      hp: u.hp,
      maxHp: u.maxHp,
      shield: u.shield,
      alive: u.alive !== false,
      stress: u.stress || 0,
      gauge: u.gauge || 0,
      buffs: (u.buffs || []).map((x) => ({ k: x.k, v: x.v, d: x.d })),
      charging: !!u.charging,
      intent: u.charging ? { name: u.charging.name, target: u.charging.target } : u.intent || null,
      isBoss: !!u.isBoss,
      bossPhase: u.bossPhase || 0,
      resonance: resonances[0] || null,
      resonances,
      stats: u.stats,
    };
  }

  /** 只读报告：绝不提交奖励。 */
  function report(st) {
    const b = st.run && st.run.battle;
    if (!b) return null;
    return {
      id: b.id,
      kind: b.kind,
      tick: b.tick,
      round: b.round,
      over: b.over,
      win: b.win,
      outcome: b.outcome,
      allies: b.allies.map(unitReport),
      enemies: b.enemies.map(unitReport),
      logSeq: b.logSeq,
      logs: b.logs.slice(),
      stats: b.stats,
    };
  }

  /** 结算成 PendingResult（rewardSpec 未分配 ID），只写 encounter.pendingResult。 */
  function prepareResult(st) {
    const b = st.run && st.run.battle;
    if (!b) return { ok: false, error: { code: 'no_battle', message: '没有战斗' } };
    if (!b.over) return { ok: false, error: { code: 'not_over', message: '战斗还没结束' } };

    const enc = st.run.encounter;
    const outcome = b.outcome || (b.win ? 'win' : 'loss');
    const floor = b.floor || st.run.floor;

    const partyDelta = b.allies.map((a) => ({
      uid: a.sourceUnitId,
      hp: Math.max(1, a.hp),
      stress: a.stress || 0,
      affliction: a.affliction || null,
      died: a.alive === false,
    }));

    const rewardSpec = { gold: 0, shards: 0, drops: [] };
    if (outcome === 'win') {
      const baseGold = { normal: 22, elite: 38, boss: 70 }[b.kind] || 22;
      let gold = Math.round((baseGold + D().chapterAt(floor).number * 5));
      if ((st.run.blessings || []).includes('scavenger')) gold = Math.round(gold * 1.2);
      rewardSpec.gold = gold;
      rewardSpec.shards = b.kind === 'boss' ? 6 : b.kind === 'elite' ? 3 : 1;

      const drops = b.kind === 'boss' ? 3 : b.kind === 'elite' ? 2 : 1;
      const r = A.Random.next(b.rngState >>> 0);
      for (let i = 0; i < drops; i++) {
        const pick = A.Random.next((r.state + i * 7919) >>> 0);
        const idx = Math.floor(pick.value * D().TEMPLATE_ORDER.length);
        rewardSpec.drops.push({ kind: 'circuit', templateId: D().TEMPLATE_ORDER[idx] });
      }
    }

    const pending = {
      outcome,
      battleId: b.id,
      report: report({ run: { battle: b } }),
      runDelta: { party: partyDelta },
      rewardSpec,
      at: b.tick,
      encounterId: enc ? enc.id : null,
    };
    if (enc) enc.pendingResult = pending;
    return { ok: true, pendingResult: pending };
  }

  /** 集合/集火的战术偏好：只影响目标选择提示，不改伤害。 */
  function setTactic(st, tactic) {
    if (!st.run || !st.run.battle) return ST().fail(st, 'no_battle', '没有战斗');
    if (!['balance', 'focus', 'safe'].includes(tactic)) return ST().fail(st, 'bad_tactic', '未知战术');
    const next = ST().clone(st);
    next.run.battle.tactic = tactic;
    return ST().ok(next, [{ type: 'tactic', meta: { tactic } }]);
  }

  V.Combat = {
    generateEncounter, create, step, report, prepareResult, setTactic,
    TICK_LIMIT, pressureRegenMultiplier, pressureDamageMultiplier, energyRegen,
    _internal: {
      applyDamage, healUnit, checkBossPhase, buildAlly, buildEnemy,
      mitigation, addShield, rngValue, log,
    },
  };
})(globalThis.Ashen ||= {});
