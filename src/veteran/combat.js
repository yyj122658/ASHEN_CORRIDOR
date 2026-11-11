'use strict';
/* 老兵回路战斗：行动条（60 阈值 / 6 tick 一回合）、clock 与 damage 脉冲、
   能量路由、有限指令、五种主手规则、surge、首领预告与半血阶段。
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

  /* ------------------------------ 遭遇生成 ------------------------------ */

  /**
   * generateEncounter(st, kind) -> {state, enemyBlueprint, combatRngStart}
   * 只在 Encounter.open 第一次调用；重试绝不能再调。
   */
  function generateEncounter(st, kind) {
    const next = ST().clone(st);
    const floor = (next.run && next.run.floor) || 1;
    const index = (next.stats && next.stats.runs) || 0;
    const tpl = D().encounterTemplate(kind, index);

    const sc = D().DESIGN.scaling;
    /* 首领按自身基准（只在第 7 层出现），小怪按层数缩放但乘 minionHpMult */
    const isBossFloor = floor >= D().DESIGN.maxFloor;
    const scaleHp = 1 + (floor - 1) * sc.hpPerFloor * (tpl.bossId ? (isBossFloor ? 1 : 1) : 1);
    const scaleAtk = 1 + (floor - 1) * sc.atkPerFloor;

    const units = [];
    let slot = 0;

    const push = (typeId, opts) => {
      const meta = D().enemy(typeId);
      const hpMult = opts.boss
        ? (opts.hpMult || 1)
        : ((tpl.bossId ? sc.bossMinionHpMult : sc.minionHpMult) * (opts.hpMult || 1));
      const hp = Math.round(meta.hp * scaleHp * hpMult);
      const atk = Math.round(meta.atk * scaleAtk * (opts.atkMult || 1));
      units.push({
        enemyType: meta.id,
        name: opts.name || meta.name,
        slot: slot++,
        hp, maxHp: hp,
        atk,
        def: Math.round(meta.def * (1 + (floor - 1) * 0.12)),
        spd: meta.spd,
        hits: meta.hits,
        isBoss: !!opts.boss,
        skills: (meta.skills || []).map((s) => ({ ...s })),
        disrupt: meta.disrupt || null,
        phaseAt: meta.phaseAt || null,
        phaseBuff: meta.phaseBuff || null,
      });
    };

    const eliteMult = tpl.elite ? 0.85 : 1;
    if (tpl.bossId) push(tpl.bossId, { boss: true, hpMult: 1, atkMult: 1 });
    (tpl.minionIds || []).forEach((id) => push(id, { hpMult: eliteMult, atkMult: tpl.elite ? 1.0 : 1 }));

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
    const body = D().body(unit.bodyPreset);
    const weapon = st.itemsById[unit.weaponId];
    const weaponId = weapon ? weapon.templateId : 'shortBlade';
    const placements = (st.run.fieldLayouts && st.run.fieldLayouts[unit.id]) || unit.board.placements;
    const cc = V.Circuit.compile(st, unit.id, placements);
    /* 功法状态：覆盖率台阶 + 贯通。没有功法时是空效果，不影响老存档 */
    const ms = V.Circuit.manuscriptState
      ? V.Circuit.manuscriptState(st, unit.id, placements)
      : null;

    const maxHpMod = (st.run.maxHpModifiers && st.run.maxHpModifiers[unit.id]) || 1;
    const maxHp = Math.round(body.hp * maxHpMod);
    const hp = partyEntry.hp == null ? maxHp : clamp(partyEntry.hp, 1, maxHp);

    return {
      id: 'a_' + unit.id,
      sourceUnitId: unit.id,
      ms,
      side: 'ally',
      slot: partyEntry.slot,
      skinId: unit.skinId,
      enemyType: null,
      name: unit.name,
      weaponId,
      modId: weapon ? weapon.modId : null,
      traitId: (weapon && weapon.attunements && weapon.attunements[unit.id]
        && weapon.attunements[unit.id].traitId) || null,
      bodyPreset: unit.bodyPreset,
      maxHp, hp,
      atk: body.atk,
      def: body.def,
      spd: body.spd,
      hits: D().DESIGN.baseHit,
      crit: D().DESIGN.baseCrit,
      dodge: D().DESIGN.baseDodge,
      alive: hp > 0,
      gauge: 0,
      skipActions: 0,
      shield: 0,
      buffs: [],
      stress: partyEntry.stress || 0,
      affliction: unit.affliction || null,
      circuit: cc.ok ? cc.value : null,
      circuitErrors: cc.ok ? [] : cc.errors,
      runtime: V.Circuit.emptyRuntime(),
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
      lastBlockReason: '',
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
      skipActions: 0,
      shield: 0,
      buffs: [],
      stress: 0,
      affliction: null,
      skills: bpUnit.skills || [],
      cds: {},
      isBoss: !!bpUnit.isBoss,
      isElite: false,
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

    /* 开局直充：祝福给全场 2 点，功法台阶再按人加成 */
    const blessEnergy = (next.run.blessings || []).some((id) => id === 'flow') ? 2 : 0;
    allies.forEach((a) => {
      const msEnergy = (a.ms && a.ms.effects && a.ms.effects.startEnergy) || 0;
      const total = blessEnergy + msEnergy;
      if (total > 0) a.runtime.outputs.main = V.Circuit.pulse(total);
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
    const o = opts || {};
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
      if (tgt.side === 'enemy') checkBossPhase(b, tgt);
      return { dealt: actual, absorbed, died: true };
    }

    if (tgt.side === 'enemy') checkBossPhase(b, tgt);
    return { dealt: actual, absorbed, died: false };
  }

  function healUnit(b, src, tgt, amount) {
    const before = tgt.hp;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + Math.round(amount));
    const healed = tgt.hp - before;
    tgt.stats.healing += healed;
    if (b.stats) b.stats.healing += healed;
    const overheal = Math.round(amount) - healed;
    if (healed > 0) {
      log(b, { type: 'heal', actorId: src ? src.id : null, targetId: tgt.id, amount: healed, text: `${tgt.name} 恢复 ${healed}` });
    }
    return { healed, overheal };
  }

  /** 首领半血阶段：只触发一次。 */
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
    const allies = b.allies.filter((u) => u.alive !== false);
    allies.forEach((u) => { u.stress = Math.min(100, u.stress + 6); });
  }

  /* ------------------------------ 行动条 ------------------------------ */

  function effSpd(u) {
    const slow = (u.buffs || []).filter((x) => x.k === 'slow').reduce((a, x) => a + x.v, 0);
    return Math.max(1, u.spd - slow);
  }

  function tickBuffs(b) {
    const all = [...b.allies, ...b.enemies];
    all.forEach((u) => {
      if (u.alive === false) return;
      /* DOT */
      (u.buffs || []).filter((x) => x.k === 'burn' || x.k === 'bleed').forEach((x) => {
        applyDamage(b, null, u, x.v, { isDot: true, pierce: true });
      });
      if (u.hp <= 0) return;
      u.buffs = (u.buffs || []).filter((x) => {
        x.d = (x.d || 1) - 1;
        return x.d > 0;
      });
    });
  }

  /* ------------------------------ 能量 ------------------------------ */

  function routeEnergy(b, u, extraInputs) {
    if (!u.circuit) return;
    const inputs = { clock: V.Circuit.pulse(D().DESIGN.energyPulse) };
    if (u.pendingDamagePulse > 0) {
      inputs.damage = V.Circuit.pulse(u.pendingDamagePulse);
      u.pendingDamagePulse = 0;
    }
    if (extraInputs) Object.assign(inputs, extraInputs);

    const r = V.Circuit.route(u.circuit, u.runtime, inputs, { hpPct: hpPct(u) });
    u.runtime = r.runtime;
    r.events.forEach((ev) => {
      if (ev.type === 'capacitorSurge') {
        log(b, { type: 'surge', actorId: u.id, text: `${u.name} 的储能腔放出 4 单位脉冲` });
      } else if (ev.type === 'gateBlocked') {
        log(b, { type: 'blocked', actorId: u.id, text: `${u.name} 的阈值闸未满足，能量消散` });
      } else if (ev.type === 'energyOverflow') {
        log(b, { type: 'blocked', actorId: u.id, text: `${u.name} 的输出储存溢出，${ev.amount} 单位消散` });
      }
    });
  }

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
    /* 自身行动开始：清 guard、扣 skip */
    u.buffs = (u.buffs || []).filter((x) => x.k !== 'guard');
    if (u.skipActions > 0) {
      u.skipActions -= 1;
      log(b, { type: 'skip', actorId: u.id, text: `${u.name} 被压住，跳过一次行动` });
      return false;
    }
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
    const raw = actor.atk * (o.mult || 1) * (1 + (o.dmgBonus || 0));
    const dmg = raw * (1 - mitigation(tgt.def)) * (crit ? 1.75 : 1);
    const res = applyDamage(b, actor, tgt, dmg, { aoe: !!o.aoe });
    log(b, {
      type: crit ? 'crit' : 'hit', actorId: actor.id, targetId: tgt.id, amount: res.dealt,
      text: `${actor.name} ${o.label || '攻击'} ${tgt.name}${crit ? '（暴击）' : ''} -${res.dealt}`,
    });
    if (o.ember && res.dealt > 0) {
      tgt.buffs.push({ k: 'burn', v: Math.max(2, Math.round(actor.atk * 0.18)), d: 2 });
      log(b, { type: 'ember', actorId: actor.id, targetId: tgt.id, text: `${tgt.name} 被余烬点燃` });
    }
    if (o.stun && tgt.alive !== false) {
      tgt.skipActions = (tgt.skipActions || 0) + o.stun;
      log(b, { type: 'skip', actorId: actor.id, targetId: tgt.id, text: `${tgt.name} 的行动被压住` });
    }
    return { dealtDamage: res.dealt > 0, hits: 1 };
  }

  /** 消耗输出能量，返回 {tokens, surge} 或 null。 */
  function spend(u, outputId, cost) {
    const got = V.Circuit.consumeOutput(u.runtime, outputId, cost);
    if (!got) return null;
    u.runtime = got.runtime;
    const surge = got.used.filter((t) => t.tags.includes('surge')).length >= D().DESIGN.surgeSize;
    const ember = got.used.some((t) => t.tags.includes('ember'));
    return { tokens: got.used, surge: !!surge, ember };
  }

  /** 主手动作。返回 {dealtDamage, action} */
  function doMain(b, actor, targetId) {
    const w = D().weapon(actor.weaponId);
    const m = w.main;
    const cost = V.Tactics.mainCost(actor.weaponId, actor.slot);
    const spent = spend(actor, 'main', cost);
    if (!spent) {
      /* 理论上 evaluate 已挡；保险起见退回基础攻击 */
      const r = doBasicAttack(b, actor, targetId, { label: '基础攻击' });
      return { dealtDamage: r.dealtDamage, action: 'basic' };
    }

    let mult = m.mult || 1;
    /* 功法：覆盖率台阶与贯通给乘算。这是唯一的功法数值入口 */
    if (actor.ms && actor.ms.effects && actor.ms.effects.mainMult) {
      mult *= actor.ms.effects.mainMult;
    }
    let stress = 0;
    if (spent.surge) {
      mult *= D().DESIGN.surgeMult;
      stress += D().DESIGN.surgeStress;
      log(b, { type: 'surge', actorId: actor.id, text: `${actor.name} 打出 surge，倍率翻倍` });
    }

    const dmgBonus = (b.dmgBonus || 0);
    let dealt = false;

    if (m.healMult) {
      const mates = alive(b.allies).sort((a, c) => hpPct(a) - hpPct(c) || a.slot - c.slot);
      const worst = mates[0];
      if (worst && hpPct(worst) < 0.999) {
        const amount = actor.atk * m.healMult * mult * (1 + (b.healBonus || 0));
        const r = healUnit(b, actor, worst, amount);
        if (r.overheal > 0 && !actor.overflowUsed) {
          actor.overflowUsed = true;
          const gained = addShield(worst, Math.min(r.overheal, Math.round(worst.maxHp * 0.1)));
          if (gained) log(b, { type: 'shield', actorId: actor.id, targetId: worst.id, amount: gained, text: `溢出治疗转为 ${gained} 护盾` });
        }
        dealt = false;
      } else {
        const tgt = targetsFor(b, actor, targetId)[0] || frontOf(b.enemies);
        if (tgt) {
          const r = doBasicAttack(b, actor, tgt.id, {
            mult: m.fallbackMult * mult, label: '法术', dmgBonus, ember: spent.ember,
          });
          dealt = r.dealtDamage;
        }
      }
    } else if (m.slotTargets) {
      const mode = m.slotTargets[actor.slot] || 'frontFoe';
      if (mode === 'pierceFront2') {
        const foes = alive(b.enemies).sort((a, c) => a.slot - c.slot).slice(0, 2);
        let any = false;
        foes.forEach((tgt) => {
          if (!rngChance(b, clamp(actor.hits - tgt.dodge, 0.05, 1))) {
            log(b, { type: 'miss', actorId: actor.id, targetId: tgt.id, text: `${actor.name} 的贯穿被闪开` });
            return;
          }
          const crit = rngChance(b, actor.crit);
          const dmg = actor.atk * m.mult * mult * (1 + dmgBonus) * (1 - mitigation(tgt.def)) * (crit ? 1.75 : 1);
          const res = applyDamage(b, actor, tgt, dmg, {});
          any = any || res.dealt > 0;
          log(b, {
            type: crit ? 'crit' : 'hit', actorId: actor.id, targetId: tgt.id, amount: res.dealt,
            text: `${actor.name} 贯穿 ${tgt.name}${crit ? '（暴击）' : ''} -${res.dealt}`,
          });
        });
        dealt = any;
      } else {
        const tgt = targetsFor(b, actor, targetId)[0];
        if (tgt) {
          const r = doBasicAttack(b, actor, tgt.id, {
            mult: m.mult * mult, label: '突刺', dmgBonus, ember: spent.ember,
          });
          dealt = r.dealtDamage;
        }
      }
    } else {
      const tgt = targetsFor(b, actor, targetId)[0];
      if (tgt) {
        if (m.skipTarget) {
          const r = doBasicAttack(b, actor, tgt.id, {
            mult: m.mult * mult, label: '盾击', dmgBonus, stun: 1, ember: spent.ember,
          });
          dealt = r.dealtDamage;
        } else {
          const r = doBasicAttack(b, actor, tgt.id, {
            mult: m.mult * mult, label: w.name, dmgBonus, ember: spent.ember,
          });
          dealt = r.dealtDamage;
        }
      }
    }

    /* 重炮在 1 号位自伤：不产生受击脉冲 */
    if (m.slot0SelfDamage && actor.slot === 0) {
      const self = Math.max(1, Math.round(actor.maxHp * m.slot0SelfDamage));
      applyDamage(b, null, actor, self, { selfInflicted: true, pierce: true });
      log(b, { type: 'hit', actorId: actor.id, targetId: actor.id, amount: self, text: `${actor.name} 被后坐力撕开 ${self}` });
    }

    /* 塔盾 1 号位：自身减伤到下次行动 */
    if (m.slot0Reduce && actor.slot === 0) {
      actor.buffs = (actor.buffs || []).filter((x) => x.k !== 'dmgReduce');
      actor.buffs.push({ k: 'dmgReduce', v: m.slot0Reduce, d: 1, stackKey: 'shieldStance' });
      log(b, { type: 'guard', actorId: actor.id, text: `${actor.name} 举盾，减伤至下次行动` });
    }

    /* 调谐：首次主手输出返还 1 能量 */
    const trait = actor.traitId;
    if (trait === 'refund' && !actor.refundUsed) {
      actor.refundUsed = true;
      actor.runtime = V.Circuit.refund(actor.runtime, 'main', ['refund']);
      log(b, { type: 'energy', actorId: actor.id, text: `${actor.name} 回手，返还 1 点能量` });
    }

    if (stress) {
      actor.stress = Math.min(100, actor.stress + stress);
      log(b, { type: 'stress', actorId: actor.id, amount: stress, text: `${actor.name} 压力 +${stress}` });
    }

    return { dealtDamage: dealt, action: 'main' };
  }

  function doSupport(b, actor, targetId) {
    const cost = D().SUPPORT.energy;
    const spent = spend(actor, 'support', cost);
    if (!spent) return { dealtDamage: false, action: 'basic' };
    const tgt = byId(b.allies, targetId) || byId(b.enemies, targetId);
    if (!tgt || tgt.alive === false) return { dealtDamage: false, action: 'support' };
    let pct = D().SUPPORT.shieldPct;
    if (actor.ms && actor.ms.effects && actor.ms.effects.supportMult) {
      pct *= actor.ms.effects.supportMult;
    }
    if (spent.surge) {
      pct *= D().DESIGN.surgeMult;
      actor.stress = Math.min(100, actor.stress + D().DESIGN.surgeStress);
    }
    const amount = Math.round(tgt.maxHp * pct);
    const gained = addShield(tgt, amount);
    log(b, {
      type: 'shield', actorId: actor.id, targetId: tgt.id, amount: gained,
      text: `${actor.name} 给 ${tgt.name} ${gained} 护盾`,
    });
    return { dealtDamage: false, action: 'support' };
  }

  function doGuard(b, actor) {
    actor.buffs = (actor.buffs || []).filter((x) => x.k !== 'guard');
    actor.buffs.push({ k: 'guard', v: D().GUARD.reduce, d: 1 });
    log(b, { type: 'guard', actorId: actor.id, text: `${actor.name} 防御，下次受击减伤 20%` });
    return { dealtDamage: false, action: 'guard' };
  }

  /* ------------------------------ 我方行动 ------------------------------ */

  function allyTurn(b, actor) {
    routeEnergy(b, actor);

    const ctx = {
      self: { id: actor.id, slot: actor.slot, hp: actor.hp, maxHp: actor.maxHp, alive: actor.alive },
      allies: b.allies.map((u) => ({ id: u.id, slot: u.slot, hp: u.hp, maxHp: u.maxHp, alive: u.alive !== false })),
      enemies: b.enemies.map((u) => ({
        id: u.id, slot: u.slot, hp: u.hp, maxHp: u.maxHp,
        alive: u.alive !== false, charging: !!u.charging,
      })),
      energy: {
        main: V.Circuit.outputTokens(actor.runtime, 'main').length,
        support: V.Circuit.outputTokens(actor.runtime, 'support').length,
      },
      weaponId: actor.weaponId,
    };

    const decision = V.Tactics.evaluate(ctx, actor.gambits);
    /* 只在“所有指令都不可用、退回基础攻击”时解释原因；
       正常出手不需要把 skip 理由挂在角色头上。 */
    actor.lastBlockReason = decision.action === 'basic' ? V.Tactics.explain(decision) : '';

    const targetId = decision.targetIds[0] || null;
    let res = { dealtDamage: false, action: decision.action };

    if (decision.action === 'main') res = doMain(b, actor, targetId);
    else if (decision.action === 'support') res = doSupport(b, actor, targetId);
    else if (decision.action === 'guard') res = doGuard(b, actor);
    else res = doBasicAttack(b, actor, targetId, { label: '基础攻击' });

    return { res, action: res.action };
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

  function enemyTurn(b, e) {
    e.actionCount += 1;

    /* 扰位石傀：每第三次行动把我方最后一名存活单位推到最前 */
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

    /* 预告中的技能：这次真的打出去 */
    if (e.charging) {
      const sk = e.charging;
      e.charging = null;
      e.intent = null;
      const foes = alive(b.allies).sort((a, c) => a.slot - c.slot);
      if (sk.target === 'allFoe') {
        foes.forEach((tgt) => {
          if (!rngChance(b, clamp(e.hits - tgt.dodge, 0.05, 1))) return;
          const dmg = e.atk * sk.mult * (1 - mitigation(tgt.def));
          const r = applyDamage(b, e, tgt, dmg, { aoe: true });
          log(b, { type: 'hit', actorId: e.id, targetId: tgt.id, amount: r.dealt, text: `${e.name} 的${sk.name}命中 ${tgt.name} -${r.dealt}` });
          if (sk.stress && tgt.alive !== false) {
            tgt.stress = Math.min(100, tgt.stress + sk.stress);
          }
        });
      } else {
        const tgt = foes[0];
        if (tgt) {
          if (!rngChance(b, clamp(e.hits - tgt.dodge, 0.05, 1))) {
            log(b, { type: 'miss', actorId: e.id, targetId: tgt.id, text: `${e.name} 的${sk.name}被闪开` });
          } else {
            const dmg = e.atk * sk.mult * (1 - mitigation(tgt.def));
            const r = applyDamage(b, e, tgt, dmg, { pierce: !!sk.pierce });
            log(b, { type: 'hit', actorId: e.id, targetId: tgt.id, amount: r.dealt, text: `${e.name} 的${sk.name}命中 ${tgt.name} -${r.dealt}` });
          }
        }
      }
      e.cds[sk.id] = (sk.cd || 0) + 1;
      return 'main';
    }

    const sk = pickEnemySkill(b, e);
    if (!sk) {
      const tgt = frontOf(b.allies);
      if (tgt) {
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

    const foes = alive(b.allies).sort((a, c) => a.slot - c.slot);
    if (sk.target === 'allFoe') {
      foes.forEach((tgt) => {
        if (!rngChance(b, clamp(e.hits - tgt.dodge, 0.05, 1))) return;
        const dmg = e.atk * sk.mult * (1 - mitigation(tgt.def));
        const r = applyDamage(b, e, tgt, dmg, { aoe: true });
        log(b, { type: 'hit', actorId: e.id, targetId: tgt.id, amount: r.dealt, text: `${e.name} 的${sk.name}命中 ${tgt.name} -${r.dealt}` });
      });
      if (sk.stress) foes.forEach((t) => { t.stress = Math.min(100, t.stress + sk.stress); });
      return 'main';
    }

    const tgt = sk.target === 'lowestHpFoe'
      ? foes.slice().sort((a, c) => hpPct(a) - hpPct(c))[0]
      : foes[0];
    if (!tgt) return 'basic';

    if (sk.mult <= 0) {
      const stress = sk.stress || 6;
      foes.forEach((t) => { t.stress = Math.min(100, t.stress + stress); });
      log(b, { type: 'stress', actorId: e.id, text: `${e.name} 的${sk.name}让全队压力 +${stress}` });
      return 'buff';
    }

    if (!rngChance(b, clamp(e.hits - tgt.dodge, 0.05, 1))) {
      log(b, { type: 'miss', actorId: e.id, targetId: tgt.id, text: `${e.name} 落空` });
      return 'main';
    }
    const dmg = e.atk * sk.mult * (1 - mitigation(tgt.def));
    const r = applyDamage(b, e, tgt, dmg, { pierce: !!sk.pierce });
    log(b, { type: 'hit', actorId: e.id, targetId: tgt.id, amount: r.dealt, text: `${e.name} 的${sk.name}命中 ${tgt.name} -${r.dealt}` });
    if (sk.lifesteal && r.dealt > 0) {
      healUnit(b, e, e, r.dealt * sk.lifesteal);
    }
    if (sk.dot && tgt.alive !== false) {
      tgt.buffs.push({ k: sk.dot.k, v: sk.dot.v, d: sk.dot.d });
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

    /* 冷却 */
    [...b.allies, ...b.enemies].forEach((u) => {
      Object.keys(u.cds || {}).forEach((k) => {
        if (u.cds[k] > 0) u.cds[k] -= 1;
      });
    });

    /* 行动条推进 */
    const actors = [];
    [...b.allies, ...b.enemies].forEach((u) => {
      if (u.alive === false) return;
      u.gauge = (u.gauge || 0) + effSpd(u);
      if (u.gauge >= D().DESIGN.gaugeThreshold) actors.push(u);
    });

    /* 稳定排序：gauge 高者先，其次我方先，再按 slot，再按 ID */
    actors.sort((x, y) => (y.gauge - x.gauge)
      || (x.side === y.side ? 0 : x.side === 'ally' ? -1 : 1)
      || (x.slot - y.slot)
      || String(x.id).localeCompare(String(y.id)));

    for (const pending of actors) {
      if (b.over) break;

      /* 前一个行动可能替换过 allies / enemies 数组，必须按 ID 重新取引用，
         否则 gauge 扣减与 buff 会写到过期对象上。 */
      const list = pending.side === 'ally' ? b.allies : b.enemies;
      const actor = list.find((x) => x.id === pending.id);
      if (!actor) continue;
      if (actor.alive === false) continue;

      /* 眩晕：跳过的行动不产生 clock，也不消耗待处理 damage */
      if (actor.skipActions > 0) {
        actor.skipActions -= 1;
        actor.gauge = Math.max(0, actor.gauge - D().DESIGN.gaugeThreshold);
        log(b, { type: 'skip', actorId: actor.id, text: `${actor.name} 被压住，跳过一次行动` });
        continue;
      }

      actor.gauge = Math.max(0, actor.gauge - D().DESIGN.gaugeThreshold);
      if (!beginAction(b, actor)) continue;

      let rootAction;
      if (actor.side === 'ally') {
        const r = allyTurn(b, actor);
        rootAction = { actorId: actor.id, side: 'ally', action: r.action, dealtDamage: r.res.dealtDamage };
      } else {
        const action = enemyTurn(b, actor);
        rootAction = { actorId: actor.id, side: 'enemy', action, dealtDamage: action === 'main' || action === 'basic' };
      }

      /* 根行动 → 伤害/死亡 → 主动换位 → 援护 */
      const pos = V.Positions.resolveAfterAction(b, rootAction);
      b.allies = pos.battle.allies;
      b.enemies = pos.battle.enemies;
      pos.events.forEach((ev) => events.push(ev));

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
      energy: u.runtime ? {
        main: V.Circuit.outputTokens(u.runtime, 'main').length,
        support: V.Circuit.outputTokens(u.runtime, 'support').length,
      } : null,
      charges: u.runtime ? {
        mainTags: V.Circuit.outputTokens(u.runtime, 'main').flatMap((t) => t.tags),
        supportTags: V.Circuit.outputTokens(u.runtime, 'support').flatMap((t) => t.tags),
      } : null,
      buffs: (u.buffs || []).map((x) => ({ k: x.k, v: x.v, d: x.d })),
      charging: !!u.charging,
      intent: u.charging ? { name: u.charging.name, target: u.charging.target } : u.intent || null,
      isBoss: !!u.isBoss,
      bossPhase: u.bossPhase || 0,
      lastBlockReason: u.lastBlockReason || '',
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
      let gold = Math.round((baseGold + floor * 5));
      if ((st.run.blessings || []).includes('scavenger')) gold = Math.round(gold * 1.2);
      rewardSpec.gold = gold;
      rewardSpec.shards = b.kind === 'boss' ? 6 : b.kind === 'elite' ? 3 : 1;

      const drops = b.kind === 'boss' ? 3 : b.kind === 'elite' ? 2 : 1;
      const r = A.Random.next(b.rngState >>> 0);
      for (let i = 0; i < drops; i++) {
        const pick = A.Random.next((r.state + i * 7919) >>> 0);
        const isWeapon = (i === 0 && pick.value < 0.25);
        if (isWeapon) {
          const idx = Math.floor(pick.value * 100) % D().WEAPON_ORDER.length;
          rewardSpec.drops.push({ kind: 'weapon', templateId: D().WEAPON_ORDER[idx] });
        } else {
          const idx = Math.floor((pick.value * 1000) % D().TEMPLATE_ORDER.length);
          rewardSpec.drops.push({ kind: 'circuit', templateId: D().TEMPLATE_ORDER[idx] });
        }
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
    TICK_LIMIT,
    _internal: {
      applyDamage, healUnit, checkBossPhase, routeEnergy, buildAlly, buildEnemy,
      mitigation, addShield, rngValue, log,
    },
  };
})(globalThis.Ashen ||= {});
