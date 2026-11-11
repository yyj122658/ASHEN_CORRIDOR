'use strict';
/* 确定性战斗：单步逻辑 tick、技能评分、目标选择、伤害、被动、
   特色装备、首领机制与统计。逻辑层不依赖 DOM 与时钟。 */
(function (A) {
  'use strict';

  const S = () => A.State;
  const D = () => A.Data;

  const GAUGE_MAX = 60;
  const TICKS_PER_ROUND = 6;
  const TICK_LIMIT = 4000;

  /* ---------- 单位 ---------- */

  function makeCombatUnit(st, src, side, slot) {
    return {
      id: side + '_' + src.id,
      sourceUnitId: src.sourceUnitId || src.id || null,
      side, slot,
      name: src.name,
      cls: src.cls || null,
      hp: src.hp, maxHp: src.maxHp,
      atk: src.atk, def: src.def, spd: src.spd,
      crit: src.crit, acc: src.acc, eva: src.eva,
      critDmg: src.critDmg || 0,
      magicMult: src.magicMult || 0,
      physMult: src.physMult || 0,
      healMult: src.healMult || 0,
      healingReceivedMult: src.healingReceivedMult == null ? 1 : src.healingReceivedMult,
      dmgReduce: src.dmgReduce || 0,
      burn: src.burn || 0,
      slow: src.slow || 0,
      slowPow: src.slowPow == null ? 0.30 : src.slowPow,
      killBonus: src.killBonus || 0,
      regen: src.regen || 0,
      regenEvery: src.regenEvery || 3,
      postHeal: src.postHeal || 0,
      gauge: src.gauge || 0,
      cds: src.cds || {},
      buffs: src.buffs || [],
      alive: src.alive !== false,
      shield: src.shield || 0,
      actionCount: src.actionCount || 0,
      damageActions: src.damageActions || 0,
      firstStrikeUsed: src.firstStrikeUsed || false,
      skipActions: src.skipActions || 0,
      kills: src.kills || 0,
      skills: src.skills || [],
      passiveId: src.passiveId || null,
      traitIds: src.traitIds || [],
      bossPhase: src.bossPhase || 0,
      phaseTriggered: src.phaseTriggered || false,
      intent: src.intent || null,
      color: src.color || '#888',
      accent: src.accent || '#ccc',
      shape: src.shape || 'human',
      isBoss: !!src.isBoss,
      isElite: !!src.isElite,
      // 稳定保留敌人模板 key，供逐帧动画匹配；旧存档缺失时为 null（降级绘制）
      enemyType: src.enemyType || null,
      mechanic: src.mechanic || null,
      huntStacks: src.huntStacks || 0,
    };
  }

  function allyUnitFromState(st, partyEntry) {
    const u = st.roster.find((x) => x.id === partyEntry.uid);
    if (!u) return null;
    const stats = A.Roster.calcStats(st, u.id, A.Expedition.partyIds(st));
    const traits = A.Equipment.traitIdsOfUnit(st, u.id);
    return makeCombatUnit(st, {
      id: u.id,
      sourceUnitId: u.id,
      name: u.name,
      cls: u.cls,
      hp: partyEntry.hp,
      maxHp: stats.maxHp,
      atk: stats.atk, def: stats.def, spd: stats.spd,
      crit: stats.crit, acc: stats.acc, eva: stats.eva,
      critDmg: stats.critDmg,
      magicMult: stats.magicMult,
      physMult: stats.physMult,
      healMult: stats.healMult,
      healingReceivedMult: stats.healingReceivedMult,
      dmgReduce: stats.dmgReduce,
      burn: stats.burn, slow: stats.slow, slowPow: stats.slowPow,
      killBonus: stats.killBonus,
      regen: stats.regen, regenEvery: stats.regenEvery,
      postHeal: stats.postHeal,
      skills: D().CLASSES[u.cls].skills.slice(),
      passiveId: D().CLASSES[u.cls].passiveId,
      traitIds: traits,
      color: D().CLASSES[u.cls].color,
      accent: D().CLASSES[u.cls].accent,
    }, 'ally', partyEntry.slot);
  }

  function enemyUnit(st, tpl, floor, diff, opts) {
    const baseHp = 260, baseAtk = 23, baseDef = 10;
    const scaleHp = 1 + (floor - 1) * 0.26;
    const scaleAtk = 1 + (floor - 1) * 0.17;
    const multi = opts.multi || 1;

    const hp = Math.round(baseHp * tpl.hp * scaleHp * multi * diff.hpMult);
    const atk = Math.round(baseAtk * tpl.atk * scaleAtk * (opts.elite ? 1.25 : 1) * diff.atkMult);
    const def = Math.round(baseDef * tpl.def * (1 + (floor - 1) * 0.25));

    return makeCombatUnit(st, {
      id: opts.id,
      name: (opts.elite ? '精英·' : '') + tpl.name,
      hp, maxHp: hp, atk, def,
      spd: tpl.spd,
      crit: 0.06 + floor * 0.008,
      acc: 0.90,
      eva: 0.04,
      skills: tpl.skills.slice(),
      color: tpl.color, accent: tpl.accent, shape: tpl.shape,
      isElite: !!opts.elite,
      isBoss: !!tpl.boss,
      enemyType: tpl.key,
      mechanic: tpl.mechanic || null,
      bossPhase: tpl.boss ? 1 : 0,
    }, 'enemy', opts.slot);
  }

  function makeEncounter(st, kind) {
    const f = st.run.floor;
    const diff = D().DIFFICULTIES[st.run.difficulty] || D().DIFFICULTIES.normal;
    const out = [];
    let rng = st.run.rngState;

    if (kind === 'boss') {
      const idx = (st.runs + f) % D().BOSS_TYPES.length;
      const tpl = D().BOSS_TYPES[idx];
      out.push(enemyUnit(st, tpl, f, diff, { id: 'e_boss', slot: 0 }));
      const pick = A.Random.pick(rng, D().ENEMY_TYPES);
      rng = pick.state;
      out.push(enemyUnit(st, pick.value, f, diff, { id: 'e_1', slot: 1, multi: 0.6 }));
    } else if (kind === 'elite') {
      for (let i = 0; i < 2; i++) {
        const pick = A.Random.pick(rng, D().ENEMY_TYPES);
        rng = pick.state;
        out.push(enemyUnit(st, pick.value, f, diff, {
          id: 'e_' + i, slot: i, multi: i === 0 ? 1.75 : 0.9, elite: i === 0,
        }));
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const pick = A.Random.pick(rng, D().ENEMY_TYPES);
        rng = pick.state;
        out.push(enemyUnit(st, pick.value, f, diff, { id: 'e_' + i, slot: i }));
      }
    }
    st.run.rngState = rng;
    return out;
  }

  /* ---------- 创建 ---------- */

  function create(state, kind) {
    const st = S().clone(state);
    if (!st.run) return S().fail(state, 'NO_RUN', '不在远征中');
    if (st.run.battle) return S().fail(state, 'IN_BATTLE', '战斗已存在');

    const allies = [];
    for (const p of st.run.party) {
      const cu = allyUnitFromState(st, p);
      if (cu) allies.push(cu);
    }
    if (!allies.length) return S().fail(state, 'NO_ALLIES', '没有可参战角色');

    const enemies = makeEncounter(st, kind);

    // 守夜印：开战护盾（同名 trait 只触发一次）
    allies.forEach((u) => {
      if (u.traitIds.includes('nightSeal')) {
        u.shield = Math.round(u.maxHp * 0.12);
      }
    });

    st.run.battle = {
      id: S().takeId(st, 'b'),
      kind,
      tick: 0,
      round: 0,
      over: false,
      win: false,
      allies,
      enemies,
      logs: [],
      logSeq: 0,
      rewardApplied: false,
      tactic: 'balance',
      stats: initStats([...allies, ...enemies]),
    };
    st.run.stage = 'battle';

    return S().ok(st, [{ type: 'battleStart', meta: { kind } }]);
  }

  function initStats(units) {
    const per = {};
    units.forEach((u) => {
      per[u.id] = { damage: 0, healing: 0, shieldAbsorb: 0, damageTaken: 0, kills: 0, dot: 0 };
    });
    return { per };
  }

  /* ---------- 查询 ---------- */

  function foesOf(b, u) { return u.side === 'ally' ? b.enemies : b.allies; }
  function matesOf(b, u) { return u.side === 'ally' ? b.allies : b.enemies; }
  function aliveOf(arr) { return arr.filter((x) => x.alive); }

  function effSpd(u) {
    let v = u.spd;
    u.buffs.forEach((bb) => { if (bb.k === 'spd') v *= (1 + bb.v); });
    v *= 1 + 0.10 * (u.huntStacks || 0);
    return Math.max(2, v);
  }

  function effAtk(u) {
    let v = u.atk * (1 + (u.killBonus || 0) * u.kills);
    u.buffs.forEach((bb) => { if (bb.k === 'atk') v *= (1 + bb.v); });
    return v;
  }

  function effReduce(u) {
    let v = u.dmgReduce || 0;
    u.buffs.forEach((bb) => { if (bb.k === 'dmgReduce') v += bb.v; });
    // 盾卫被动：在前排时减伤 +10%
    if (u.passiveId === 'wardenWall' && u.slot <= 1) v += 0.10;
    return Math.min(0.80, Math.max(0, v));
  }

  /* ---------- 目标选择 ---------- */

  function frontLine(foes) {
    return foes.filter((f) => f.slot <= 1);
  }

  function targets(b, actor, skill) {
    const foes = aliveOf(foesOf(b, actor));
    const mates = aliveOf(matesOf(b, actor));
    const t = skill.target;

    if (t === 'self') return [actor];
    if (t === 'allFoe') return foes.slice();
    if (t === 'allAlly') return mates.slice();

    if (t === 'frontFoe') {
      const front = frontLine(foes);
      if (front.length) return [front.reduce((a, x) => (a.slot <= x.slot ? a : x))];
      return foes.length ? [foes[0]] : [];
    }
    if (t === 'lowestHpFoe') {
      if (!foes.length) return [];
      return [foes.reduce((a, x) => (a.hp / a.maxHp <= x.hp / x.maxHp ? a : x))];
    }
    if (t === 'highestAtkFoe') {
      if (!foes.length) return [];
      return [foes.reduce((a, x) => (a.atk >= x.atk ? a : x))];
    }
    if (t === 'lowestHpAlly') {
      if (!mates.length) return [];
      return [mates.reduce((a, x) => (a.hp / a.maxHp <= x.hp / x.maxHp ? a : x))];
    }
    if (t === 'randomFoe') {
      if (!foes.length) return [];
      const front = frontLine(foes);
      const back = foes.filter((f) => f.slot > 1);
      const pool = [];
      front.forEach((f) => { pool.push(f, f, f); });
      back.forEach((f) => { pool.push(f); });
      const pick = A.Random.pick(currentRng(b), pool);
      b.__rng = pick.state;
      return [pick.value];
    }
    return foes.length ? [foes[0]] : [];
  }

  // RNG 暂存在 battle 上，step 结束时写回 run.rngState
  function currentRng(b) { return b.__rng == null ? 1 : b.__rng; }

  /* ---------- 技能评分 ---------- */

  function usableSkills(actor) {
    return (actor.skills || [])
      .map((id) => D().SKILLS[id])
      .filter(Boolean)
      .filter((sk) => (actor.cds[sk.id] || 0) <= 0);
  }

  function scoreSkill(b, actor, sk, tactic) {
    const foes = aliveOf(foesOf(b, actor));
    const mates = aliveOf(matesOf(b, actor));

    if (sk.mechanic) return -1;
    // 普攻只作兜底：有 CD 技能可用时永远不优先
    if (sk.basic) return 5;

    if (sk.type === 'heal') {
      const hurt = mates.filter((m) => m.hp < m.maxHp);
      if (!hurt.length) return -1;
      const lowest = Math.min(...hurt.map((m) => m.hp / m.maxHp));
      if (lowest >= 0.98) return -1;
      let score = 60 + (1 - lowest) * 120;
      if (tactic === 'focus' && lowest > 0.35) score *= 0.15;
      if (tactic === 'safe') score *= 1.6;
      return score;
    }

    if (sk.type === 'buff') {
      const key = sk.buff ? sk.buff.stackKey : null;
      if (key) {
        const covered = mates.every((m) => m.buffs.some((bb) => bb.stackKey === key && bb.d > 1));
        if (covered) return -1; // 不重复覆盖仍有效的同源增益
      }
      let score = tactic === 'safe' ? 90 : 45;
      if (tactic === 'focus') score *= 0.6;
      return score;
    }

    // 攻击类
    let score = 70;
    if (sk.target === 'allFoe') {
      score = foes.length >= 3 ? 95 : foes.length === 2 ? 55 : 18;
    } else if (sk.target === 'lowestHpFoe') {
      score = tactic === 'focus' ? 100 : 75;
    } else if (sk.target === 'randomFoe') {
      score = tactic === 'focus' ? 70 : 80;
    } else if (sk.target === 'frontFoe') {
      score = tactic === 'focus' ? 85 : 72;
    }
    if (sk.critBonus) score += 8;
    if (tactic === 'safe') score *= 0.85;
    return score;
  }

  function chooseSkill(b, actor) {
    const usable = usableSkills(actor);
    if (!usable.length) return '_basic';
    let best = null, bestScore = -1;
    for (const sk of usable) {
      const sc = scoreSkill(b, actor, sk, b.tactic);
      if (sc > bestScore) { bestScore = sc; best = sk; }
    }
    return best ? best.id : '_basic';
  }

  const BASIC = { id: '_basic', name: '攻击', cd: 0, type: 'phys', mult: 1.0, target: 'frontFoe' };

  /* ---------- 伤害 ---------- */

  function addLog(b, ev) {
    b.logSeq = (b.logSeq || 0) + 1;
    ev.seq = b.logSeq;
    b.logs.push(ev);
    if (b.logs.length > 200) b.logs.shift();
  }

  function damageOnce(b, src, tgt, sk, opts) {
    opts = opts || {};
    const stats = b.stats.per;

    // 命中
    let acc = src.acc;
    // 游侠被动：每第 3 次伤害行动命中 +10%（整次行动）
    if (src.passiveId === 'rangerMark' && opts.isDamageAction && src.damageActions % 3 === 0) acc += 0.10;
    const hitChance = Math.max(0.35, Math.min(0.99, acc - tgt.eva));

    const roll = A.Random.next(currentRng(b));
    b.__rng = roll.state;
    if (roll.value > hitChance) {
      addLog(b, { type: 'miss', actorId: src.id, targetId: tgt.id });
      return { hit: false, dmg: 0 };
    }

    let base = effAtk(src) * (sk.mult || 1);
    if (sk.type === 'magic') base *= 1 + (src.magicMult || 0);
    else base *= 1 + (src.physMult || 0);

    // 被动：剑士对残血目标 +10%
    if (src.passiveId === 'bladeEdge' && tgt.hp / tgt.maxHp < 0.5) base *= 1.10;
    // 被动：术士对带负面状态目标法伤 +10%
    if (src.passiveId === 'warlockHex' && sk.type === 'magic' && tgt.buffs.some((bb) => bb.k === 'burn' || (bb.v != null && bb.v < 0))) {
      base *= 1.10;
    }
    // 特色装备：余烬刃对灼烧目标 +15%
    if (src.traitIds.includes('emberBlade') && tgt.buffs.some((bb) => bb.k === 'burn')) base *= 1.15;

    const defv = Math.max(0, tgt.def * (1 - (sk.pierce || 0)));
    const mit = defv / (defv + 50);
    let dmg = base * (1 - mit) * (1 - effReduce(tgt));

    let critChance = src.crit + (sk.critBonus || 0);
    // 被动：刺客首次伤害行动暴击 +15%
    if (src.passiveId === 'rogueFirstStrike' && opts.isFirstStrike) critChance += 0.15;

    const critRoll = A.Random.next(currentRng(b));
    b.__rng = critRoll.state;
    const crit = critRoll.value < Math.min(0.9, critChance);
    if (crit) dmg *= 1.75 + (src.critDmg || 0);

    const varRoll = A.Random.range(currentRng(b), 0.92, 1.08);
    b.__rng = varRoll.state;
    dmg *= varRoll.value;
    dmg = Math.max(1, Math.round(dmg));

    // 护盾吸收
    let absorbed = 0;
    if (tgt.shield > 0) {
      absorbed = Math.min(tgt.shield, dmg);
      tgt.shield -= absorbed;
      dmg -= absorbed;
    }

    tgt.hp = Math.max(0, tgt.hp - dmg);
    if (stats[src.id]) stats[src.id].damage += dmg;
    if (stats[tgt.id]) { stats[tgt.id].damageTaken += dmg + absorbed; stats[tgt.id].shieldAbsorb += absorbed; }

    addLog(b, { type: crit ? 'crit' : 'hit', actorId: src.id, targetId: tgt.id, amount: dmg, meta: { crit, absorbed } });

    // 附加：灼烧
    if (src.burn && src.side === 'ally') {
      applyBuff(tgt, { k: 'burn', v: effAtk(src) * src.burn, d: 4, stackKey: 'burn', sourceId: src.id });
    }
    // 附加：减速
    if (src.slow) {
      const sr = A.Random.next(currentRng(b));
      b.__rng = sr.state;
      if (sr.value < src.slow) {
        applyBuff(tgt, { k: 'spd', v: -src.slowPow, d: 3, stackKey: 'slow', sourceId: src.id });
      }
    }
    // 附加：眩晕
    if (sk.stun) {
      tgt.skipActions = (tgt.skipActions || 0) + sk.stun;
      addLog(b, { type: 'stun', targetId: tgt.id, amount: sk.stun });
    }
    // 吸血
    if (sk.drain) {
      let drain = sk.drain;
      if (src.mechanic && src.mechanic.phaseDrainBonus && tgt.bossPhase === 2) drain *= 1 + src.mechanic.phaseDrainBonus;
      const heal = Math.round(dmg * drain);
      if (heal > 0) healUnit(b, src, src, heal, { silent: true });
    }
    if (sk.stress) {
      addLog(b, { type: 'stress', actorId: src.id, amount: sk.stress });
    }

    if (tgt.hp <= 0) killUnit(b, src, tgt);

    return { hit: true, dmg, crit, absorbed };
  }

  function killUnit(b, src, tgt) {
    if (!tgt.alive) return;
    tgt.alive = false;
    tgt.hp = 0;
    addLog(b, { type: 'death', actorId: src ? src.id : null, targetId: tgt.id });
    if (src && src.side !== tgt.side) {
      if (b.stats.per[src.id]) b.stats.per[src.id].kills += 1;
      src.kills = (src.kills || 0) + 1;
    }
    // 追猎符：击杀后速度 +10%，最多 3 层
    if (src && src.traitIds.includes('huntCharm')) {
      src.huntStacks = Math.min(3, (src.huntStacks || 0) + 1);
    }
  }

  /* ---------- 治疗与护盾 ---------- */

  function healUnit(b, src, tgt, rawAmount, opts) {
    opts = opts || {};
    let amount = rawAmount;
    // 牧师被动：治疗残血目标 +15%
    if (src && src.passiveId === 'clericGrace' && tgt.hp / tgt.maxHp < 0.5) amount *= 1.15;
    amount = Math.round(amount * (tgt.healingReceivedMult == null ? 1 : tgt.healingReceivedMult));

    const before = tgt.hp;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + amount);
    const real = tgt.hp - before;
    const overflow = amount - real;

    if (!opts.silent && b.stats.per[tgt.id]) {
      // 有效治疗不含溢出
      b.stats.per[src && b.stats.per[src.id] ? src.id : tgt.id].healing += real;
    }
    addLog(b, { type: 'heal', actorId: src ? src.id : null, targetId: tgt.id, amount: real, meta: { overflow } });

    // 回响灯：溢出治疗 50% 转护盾，单目标上限 30% 最大生命
    if (src && src.traitIds.includes('echoLamp') && overflow > 0) {
      const cap = Math.round(tgt.maxHp * 0.30);
      const add = Math.round(overflow * 0.5);
      tgt.shield = Math.min(cap, tgt.shield + add);
    }

    return { healed: real, overflow };
  }

  function applyBuff(target, buff) {
    const idx = buff.stackKey ? target.buffs.findIndex((bb) => bb.stackKey === buff.stackKey) : -1;
    if (idx >= 0) {
      const old = target.buffs[idx];
      if (buff.d >= old.d) target.buffs[idx] = Object.assign({}, buff);
    } else {
      target.buffs.push(Object.assign({}, buff));
    }
  }

  /* ---------- 回合结算 ---------- */

  function resolveRound(b, events) {
    const all = [...b.allies, ...b.enemies].filter((u) => u.alive);

    // 先 DOT，再递减，再移除到期
    all.forEach((u) => {
      const burns = u.buffs.filter((bb) => bb.k === 'burn');
      burns.forEach((bb) => {
        const d = Math.max(1, Math.round(bb.v));
        let dmg = d;
        if (u.shield > 0) {
          const ab = Math.min(u.shield, dmg);
          u.shield -= ab; dmg -= ab;
          if (b.stats.per[u.id]) b.stats.per[u.id].shieldAbsorb += ab;
        }
        u.hp = Math.max(0, u.hp - dmg);
        if (b.stats.per[u.id]) { b.stats.per[u.id].damageTaken += d; b.stats.per[u.id].dot += d; }
        addLog(b, { type: 'dot', targetId: u.id, amount: dmg });
        if (u.hp <= 0) killUnit(b, null, u);
      });

      u.buffs = u.buffs.filter((bb) => {
        bb.d -= 1;
        return bb.d > 0;
      });
    });

    // 周期回复
    all.forEach((u) => {
      if (!u.alive) return;
      if (u.regen > 0 && u.regenEvery < 90 && b.round % u.regenEvery === 0) {
        const h = Math.round(u.maxHp * u.regen);
        u.hp = Math.min(u.maxHp, u.hp + h);
        addLog(b, { type: 'regen', targetId: u.id, amount: h });
      }
    });
  }

  function checkEnd(b) {
    if (b.over) return true;
    const alliesDead = b.allies.every((u) => !u.alive);
    const enemiesDead = b.enemies.every((u) => !u.alive);
    if (alliesDead && enemiesDead) { finish(b, false); return true; } // 同时全灭 → 失败
    if (alliesDead) { finish(b, false); return true; }
    if (enemiesDead) { finish(b, true); return true; }
    return false;
  }

  function finish(b, win) {
    b.over = true;
    b.win = !!win;
    addLog(b, { type: win ? 'victory' : 'defeat' });
  }

  /* ---------- 首领 ---------- */

  function bossBeforeAction(b, actor) {
    const mech = actor.mechanic;
    if (!mech) return null;
    actor.actionCount += 1;
    const isSpecial = actor.actionCount % mech.every === 0;
    if (isSpecial) {
      actor.intent = null;
      return mech.skill;
    }
    // 下一次是特殊行动 → 预告
    if ((actor.actionCount + 1) % mech.every === 0) {
      actor.intent = mech.telegraphSkill;
    }
    return null;
  }

  function checkBossPhase(b, u) {
    if (!u.mechanic || u.phaseTriggered) return;
    const ratio = u.hp / u.maxHp;
    if (ratio <= u.mechanic.phaseAt) {
      u.phaseTriggered = true;
      u.bossPhase = 2;
      if (u.mechanic.phaseBuff) {
        applyBuff(u, Object.assign({ stackKey: 'phase' }, u.mechanic.phaseBuff, { d: 99 }));
      }
      addLog(b, { type: 'bossPhase', targetId: u.id, meta: { text: u.mechanic.phaseText } });
    }
  }

  /* ---------- 行动 ---------- */

  function performAction(st, b, actor) {
    // 眩晕：跳过一次自身行动，但仍推进 CD
    if (actor.skipActions > 0) {
      actor.skipActions -= 1;
      tickCooldowns(actor);
      addLog(b, { type: 'skip', actorId: actor.id });
      return;
    }

    const specialSkillId = bossBeforeAction(b, actor);
    let skillId = specialSkillId || chooseSkill(b, actor);
    let skill = D().SKILLS[skillId] || BASIC;

    // 没有可用目标时退回普攻
    let tgts = targets(b, actor, skill);
    if (!tgts.length && skill.id !== '_basic') {
      skill = BASIC;
      skillId = '_basic';
      tgts = targets(b, actor, skill);
    }
    if (!tgts.length) { tickCooldowns(actor); return; }

    const isDamageAction = skill.type === 'phys' || skill.type === 'magic';
    if (isDamageAction) {
      actor.damageActions = (actor.damageActions || 0) + 1;
    }
    const isFirstStrike = actor.passiveId === 'rogueFirstStrike' && !actor.firstStrikeUsed && isDamageAction;
    if (isFirstStrike) actor.firstStrikeUsed = true;

    addLog(b, { type: 'act', actorId: actor.id, meta: { skill: skill.name, skillId: skill.id } });

    if (skill.type === 'buff') {
      const mates = aliveOf(matesOf(b, actor));
      if (skill.buff) {
        (skill.target === 'allAlly' ? mates : [actor]).forEach((m) => {
          applyBuff(m, { k: skill.buff.k, v: skill.buff.v, d: skill.buff.d + 1, stackKey: skill.buff.stackKey, sourceId: actor.id });
        });
      }
      if (skill.stress) {
        const targets = aliveOf(matesOf(b, actor));
        const per = Math.max(1, Math.round(skill.stress / Math.max(1, targets.length)));
        if (st.run) {
          st.run.party.forEach((p) => {
            const mult = st.run.blessings.includes('pact') ? 1.25 : 1;
            p.stress = Math.min(100, p.stress + Math.round(per * mult));
          });
        }
        addLog(b, { type: 'stress', actorId: actor.id, amount: skill.stress });
      }
      tickCooldowns(actor);
      if (skill.cd > 0) actor.cds[skillId] = skill.cd;
      return;
    }

    if (skill.type === 'heal') {
      tgts.forEach((t) => {
        const raw = effAtk(actor) * (skill.mult || 1) * (1 + (actor.healMult || 0));
        healUnit(b, actor, t, raw);
      });
      tickCooldowns(actor);
      if (skill.cd > 0) actor.cds[skillId] = skill.cd;
      return;
    }

    // 伤害技能
    const hits = skill.hits || 1;
    for (let h = 0; h < hits; h++) {
      let list = tgts;
      if (skill.hits && skill.target === 'randomFoe') {
        list = targets(b, actor, skill); // 每段重新选目标
      }
      for (const t of list) {
        if (!t.alive) continue;
        damageOnce(b, actor, t, skill, { isDamageAction, isFirstStrike });
        checkBossPhase(b, t);
        if (!actor.alive) break;
      }
      if (!tgts.some((t) => t.alive)) break;
    }

    tickCooldowns(actor);
    if (skill.cd > 0) actor.cds[skillId] = skill.cd;
  }

  function tickCooldowns(actor) {
    for (const k in actor.cds) {
      if (actor.cds[k] > 0) actor.cds[k] -= 1;
    }
  }

  /* ---------- step ---------- */

  function step(state) {
    const st = S().clone(state);
    if (!st.run || !st.run.battle) return S().fail(state, 'NO_BATTLE', '当前没有战斗');
    const b = st.run.battle;
    if (b.over) return S().fail(state, 'OVER', '战斗已结束');

    b.__rng = st.run.rngState;
    const events = [];

    b.tick += 1;

    if (b.tick % TICKS_PER_ROUND === 0) {
      b.round += 1;
      resolveRound(b, events);
      if (checkEnd(b)) return finalize(st, b, events);
    }

    if (checkEnd(b)) return finalize(st, b, events);

    // 行动条
    const all = [...b.allies, ...b.enemies].filter((u) => u.alive);
    all.forEach((u) => { u.gauge += effSpd(u); });

    const ready = all
      .filter((u) => u.gauge >= GAUGE_MAX)
      .sort((a, c) => {
        const gd = c.gauge - a.gauge;
        if (gd !== 0) return gd;
        const sd = a.slot - c.slot;
        if (sd !== 0) return sd;
        return a.id < c.id ? -1 : a.id > c.id ? 1 : 0;
      });

    for (const actor of ready) {
      if (b.over) break;
      if (!actor.alive) continue;
      actor.gauge -= GAUGE_MAX;
      performAction(st, b, actor);
      if (checkEnd(b)) break;
    }

    if (b.tick > TICK_LIMIT) {
      finish(b, false);
      addLog(b, { type: 'timeout' });
    }

    return finalize(st, b, events);
  }

  function finalize(st, b, events) {
    st.run.rngState = b.__rng >>> 0;
    delete b.__rng;
    return S().ok(st, events);
  }

  /* ---------- 战术 ---------- */

  function setTactic(state, tactic) {
    const st = S().clone(state);
    if (!st.run || !st.run.battle) return S().fail(state, 'NO_BATTLE', '当前没有战斗');
    if (!['balance', 'focus', 'safe'].includes(tactic)) return S().fail(state, 'BAD_TACTIC', '未知战术');
    st.run.battle.tactic = tactic;
    return S().ok(st, [{ type: 'tactic', meta: { tactic } }]);
  }

  /* ---------- 结算推进 ---------- */

  function continueBattle(state) {
    const st = S().clone(state);
    if (!st.run || !st.run.battle) return S().fail(state, 'NO_BATTLE', '当前没有战斗');
    const b = st.run.battle;
    if (!b.over) return S().fail(state, 'NOT_OVER', '战斗还没结束');

    if (!b.win) {
      return S().ok(st, [{ type: 'needWipe' }]);
    }

    // 胜利奖励只应用一次
    if (!b.rewardApplied) {
      b.rewardApplied = true;
      applyVictoryRewards(st, b);
    }

    // 写回角色状态
    writeBackParty(st, b);

    if (st.run.pendingLoot.length > 0) {
      st.run.stage = 'loot';
      return S().ok(st, [{ type: 'lootPending' }]);
    }

    st.run.battle = null;
    const fin = A.Expedition._internal.finishNodeInternal(st);
    return S().ok(fin.state, [{ type: 'battleDone' }].concat(fin.events || []));
  }

  function applyVictoryRewards(st, b) {
    const f = st.run.floor;
    const kind = b.kind;
    const diff = D().DIFFICULTIES[st.run.difficulty] || D().DIFFICULTIES.normal;

    const extraRoll = A.Random.chance(st.run.rngState, 0.5);
    st.run.rngState = extraRoll.state;
    const count = kind === 'boss' ? 4 : kind === 'elite' ? 3 : 1 + (extraRoll.value ? 1 : 0);
    const ilvl = f + (kind === 'boss' ? 2 : kind === 'elite' ? 1 : 0);
    const bias = (kind === 'boss' ? 3.2 : kind === 'elite' ? 2.2 : 0.8) + f * 0.25;

    let n = count;
    for (let i = 0; i < n; i++) {
      const r = A.Equipment.makeItem(st, { ilvl, bias });
      Object.assign(st, r.state);
      st.itemsById[r.item.id] = r.item;
      st.run.pendingLoot.push(r.item.id);
    }

    const gold = Math.round(((kind === 'boss' ? 90 : kind === 'elite' ? 55 : 26) + f * 10) * diff.goldMult);
    A.Expedition.addGold(st, gold);
    const shards = kind === 'boss' ? 4 : kind === 'elite' ? 2 : 0;
    if (shards) A.Expedition.addShards(st, shards);

    b.rewardGold = gold;
    b.rewardShards = shards;
  }

  function writeBackParty(st, b) {
    const rosterParty = A.Expedition.partyUnits(st);
    b.allies.forEach((a) => {
      const p = st.run.party.find((x) => x.uid === a.sourceUnitId);
      if (!p) return;
      const u = st.roster.find((x) => x.id === p.uid);
      const stats = u ? A.Roster.calcStats(st, u.id, A.Expedition.partyIds(st)) : null;

      let hp = Math.max(1, a.hp);
      if (b.win && stats) {
        hp = Math.min(stats.maxHp, hp + Math.round(stats.maxHp * 0.22));
        if (a.postHeal) hp = Math.min(stats.maxHp, hp + Math.round(stats.maxHp * a.postHeal));
      }
      p.hp = hp;
      p.stress = Math.min(100, p.stress + (b.win ? 7 : 12));
      if (u) u.stress = p.stress;
    });
  }

  /* ---------- 报告 ---------- */

  function report(state) {
    const b = state.run && state.run.battle;
    if (!b) return null;
    const advice = [];
    const allies = b.allies;
    const healed = allies.reduce((a, u) => a + (b.stats.per[u.id] ? b.stats.per[u.id].healing : 0), 0);
    const taken = allies.reduce((a, u) => a + (b.stats.per[u.id] ? b.stats.per[u.id].damageTaken : 0), 0);
    const frontDown = allies.filter((u) => u.slot <= 1 && !u.alive).length;

    if (!b.win) {
      if (frontDown >= 2) advice.push('frontCollapse');
      if (healed < taken * 0.25) advice.push('lowHealing');
      if (b.round > 20) advice.push('tooSlow');
    }
    return { win: b.win, round: b.round, tick: b.tick, stats: b.stats, advice, rewardGold: b.rewardGold || 0, rewardShards: b.rewardShards || 0 };
  }

  A.Combat = {
    GAUGE_MAX, TICKS_PER_ROUND,
    create, step, setTactic, continue: continueBattle, report,
    chooseSkill, targets: (state, actorId, skillId) => {
      const b = state.run && state.run.battle;
      if (!b) return [];
      const actor = [...b.allies, ...b.enemies].find((u) => u.id === actorId);
      if (!actor) return [];
      return targets(b, actor, D().SKILLS[skillId] || BASIC).map((t) => t.id);
    },
    applyHeal: (state, sourceId, targetId, amount) => {
      const st = S().clone(state);
      const b = st.run && st.run.battle;
      if (!b) return S().fail(state, 'NO_BATTLE', '当前没有战斗');
      const src = [...b.allies, ...b.enemies].find((u) => u.id === sourceId);
      const tgt = [...b.allies, ...b.enemies].find((u) => u.id === targetId);
      if (!src || !tgt) return S().fail(state, 'NO_UNIT', '找不到单位');
      healUnit(b, src, tgt, amount);
      return S().ok(st, [{ type: 'heal', actorId: sourceId, targetId, amount }]);
    },
    _internal: { makeCombatUnit, targets, scoreSkill, effSpd, effReduce, resolveRound, checkEnd, performAction, healUnit, applyBuff, checkBossPhase, BASIC },
  };
})(globalThis.Ashen ||= {});
