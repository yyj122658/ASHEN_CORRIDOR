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
     50 起换一档，80 起换第二档；玩家可以选择把压力顶上去换爆发。
     但 100 不是「更高一档」，是悬崖——见 resolveConfig() 与 rollResolve()。 */
  function pressureRegenMultiplier(stress) {
    return stress >= 80 ? 0.65 : stress >= 50 ? 0.85 : 1;
  }

  /** 压力带来的最终伤害乘算：50 起 +10%，80 起 +25%。
      裂了的人方向律反转——同一个档位在他身上是负担，不是红利。 */
  function pressureDamageMultiplier(stress, u) {
    if (u && u.cracked) return resolveConfig().crack.damageMult;
    return stress >= 80 ? 1.25 : stress >= 50 ? 1.10 : 1;
  }

  function resolveConfig() {
    return D().DESIGN.resolve || {
      whetChance: 0,
      crack: { damageMult: 1, takenMult: 1, polishMult: 1 },
      whet: { stress: 50, polishMult: 1 },
    };
  }

  function overloadConfig() {
    return D().DESIGN.overload || { stressPerPoint: 8, regenPerPoint: 0.04, heatThreshold: 50 };
  }

  /** 高热：压力进到这一档，超载扣的那一段回裕就不扣了。 */
  function heatConducting(u) {
    return !!u && u.side === 'ally' && (u.stress || 0) >= overloadConfig().heatThreshold;
  }

  /** 九标：直导通路的「动能缓冲」上限（独立于储能系，硬封顶 18 点）。 */
  function kineticCapOf(pulse) {
    const P = V.Circuit.PULSE;
    const straight = ((pulse || {}).straight) || 0;
    return Math.min(P.kineticCapHard == null ? 18 : P.kineticCapHard,
      Math.floor(straight * (P.kineticCapCells == null ? 2 : P.kineticCapCells)));
  }

  function energyRegen(u) {
    /* 超载罚项是**动态**的：u.regen 是建战时算好的账面值（含罚项），
       但压力在战斗里会涨会落，所以每帧要重新判一次「够不够热」。
       够热就把罚项加回去——压力自己的 0.85 / 0.65 乘算与裂的抛光惩罚不受影响。 */
    const penalty = heatConducting(u) ? 0 : (u.overloadPenalty || 0);
    /* 以「没扣罚项的原始值」为锚，而不是以已扣过又保底过的 u.regen 为锚：
       否则极端超载下（原始值被 0.1 保底截断）再补回罚项会凭空多出回裕。 */
    const anchor = u.regenBase != null ? u.regenBase : (u.regen ?? D().DESIGN.energyBase.regen);
    const base = Math.max(0.1, anchor - penalty);
    const bonus = hpPct(u) < 0.5 ? (u.lowHpRegen || 0) : 0;
    /* 八标：被「抽忆」抽过的人，回裕被压到 15% 一段时间（见 applyEnemyActionAura）。
       没有这一条，枯竭停机在数学上不可达：蚀刻法自带 0.9~1.7/s、纹路再叠 0~1.87/s，
       实际回裕 1.4~3.07/s，从 0 回 1 点只要 1~2 tick，「连续 6 tick 回不到 1 点」永远凑不出来。
       锁的是**回裕速度**而不是直接扣血 —— 被抽忆的人缓不过来，这才是「停机」的由来。 */
    const lock = u.energyLock > 0 ? 0.40 : 1;
    /* 抛光倍率：砺了更顺，裂了磨不动一道裂 */
    return (base + bonus) * lock * (u.side === 'ally'
      ? pressureRegenMultiplier(u.stress) * (u.polishMult || 1)
      : 1);
  }

  /* ------------------------------ 满压临界 ------------------------------ */

  /**
   * 顶到 100 的那一刻掷一次：大概裂，小概率砺。一人一场只掷一次。
   * 裂：方向律反转（伤害加成翻成负担、受伤加深、抛光打折），战斗结束带回营地，
   *     要等安抚才清——所以「带着裂下场」是真实代价，不是战后自动复原。
   * 砺：压力自己卸回 whet.stress，抛光更顺，不留任何记录。
   */
  function rollResolve(b, u) {
    const cfg = resolveConfig();
    u.resolveUsed = true;
    const whetChance = cfg.whetChance;
    if (rngChance(b, whetChance)) {
      u.stress = cfg.whet.stress;
      u.polishMult = cfg.whet.polishMult;
      log(b, {
        type: 'resolve', targetId: u.id, kind: 'whet',
        text: `${u.name}没有裂。压力退回${u.stress}，抛光转顺——这一下没留痕`,
      });
      return { kind: 'whet' };
    }
    u.cracked = true;
    u.affliction = 'crack';
    u.polishMult = cfg.crack.polishMult;
    log(b, {
      type: 'resolve', targetId: u.id, kind: 'crack',
      text: `${u.name}裂了。纹理方向律反转：满压的红利翻成负担，受伤 +${Math.round((cfg.crack.takenMult - 1) * 100)}%，抛光只剩 ${Math.round(cfg.crack.polishMult * 100)}%`,
    });
    return { kind: 'crack' };
  }

  function addStress(b, u, amount) {
    const mod = (b && b.bless && b.bless.stress) || 0;
    /* 腐蚀压制：被腐蚀的人更容易被压垮，压力进账 +30%——这是「加速敌人到 100 裂」的手段 */
    const press = amount > 0 && hasDot(u, 'corrode')
      ? ((D().DESIGN.corrode && D().DESIGN.corrode.stressMult) || 1.3)
      : 1;
    const gain = amount > 0 && (mod || press !== 1)
      ? Math.round(amount * (1 + mod) * press)
      : amount;
    const before = pressureRegenMultiplier(u.stress);
    const dmgBefore = pressureDamageMultiplier(u.stress, u);
    u.stress = Math.min(100, (u.stress || 0) + gain);
    const after = pressureRegenMultiplier(u.stress);
    const dmgAfter = pressureDamageMultiplier(u.stress, u);

    /* 过载熔毁（v4.0 的第三个终局）：已经裂了的人，压力再顶到 100 就不是「砺」了，
       是心核熔穿。两极共振例外——它把整仓压力换成一次自爆冲击。 */
    if (gain > 0 && u.cracked && u.alive !== false && u.stress >= 100 && !u.meltdownDone) {
      u.meltdownDone = true;
      if (u.innate === 'waist') {
        u.stress = 0;
        const burst = Math.max(1, Math.round((u.atk || 0) * (u.pulseAmp || 1) * 2.5));
        const foes = alive(u.side === 'ally' ? b.enemies : b.allies);
        log(b, { type: 'surge', actorId: u.id, text: `${u.name} 把整仓压力倒了出去（${burst} 点脉冲）` });
        foes.forEach((f) => applyDamage(b, u, f, burst, { pierce: true, aoe: true }));
      } else {
        u.hp = 0;
        u.alive = false;
        log(b, { type: 'death', targetId: u.id, text: `${u.name} 心核熔毁——压力在裂缝里烧穿了结构` });
      }
    }
    if (after < before) log(b, { type: 'stress', targetId: u.id,
      text: `${u.name}压力升至${u.stress}，自然回裕降至${Math.round(after * (u.polishMult || 1) * 100)}%，伤害提升 ${Math.round((dmgAfter - 1) * 100)}%` });
    /* 顶到 100 不是「更高一档」，是悬崖：这里掷一次裂 / 砺 */
    if (u.stress >= 100 && !u.resolveUsed && u.side === 'ally') rollResolve(b, u);
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
  /** 八标：敌方的节点脉动倍率随层数插值。第 7 层仍是浅层基准，第 49 层收到设计值。 */
  function enemyPaceAt(floor) {
    const D0 = D().DESIGN;
    const deep = D0.enemyPace == null ? 1.4 : D0.enemyPace;
    const shallow = D0.enemyPaceShallow == null ? deep : D0.enemyPaceShallow;
    const t = clamp((Number(floor) - 7) / 42, 0, 1);
    return shallow + (deep - shallow) * t;
  }

  function generateEncounter(st, kind, opts) {
    const next = ST().clone(st);
    const floor = (next.run && next.run.floor) || 1;
    const index = (next.stats && next.stats.runs) || 0;
    /* opts.bossId：只有模拟器/工具会传，用来把 F49 拆成「对三位首领」的三列 */
    const tpl = D().chapterEncounter(kind, index, floor, opts);

    const sc = D().DESIGN.scaling;
    /* 七个节点逐步升压，章末首领使用自身基准，随从使用独立倍率。 */
    const difficulty = (floor - 1) / 6;
    /* 八标：成长系数按层数在「浅层值」与「深层值」之间插值（见 data.js scaling 的注释） */
    const depthT = clamp((floor - 7) / 42, 0, 1);
    const mix = (deep, shallow) => shallow + (deep - shallow) * depthT;
    const scaleHp = 1 + difficulty * mix(sc.hpPerFloor, sc.hpPerFloorShallow == null ? sc.hpPerFloor : sc.hpPerFloorShallow);
    const scaleAtk = 1 + difficulty * mix(sc.atkPerFloor, sc.atkPerFloorShallow == null ? sc.atkPerFloor : sc.atkPerFloorShallow);

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
        /* v4.0：阻抗成长也走 scaling 表，不再写死 0.12（旧值到第 28 层会把首领 def 抬到 46） */
        def: Math.round(meta.def * (1 + difficulty * (sc.defPerFloor || 0))),
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
        /* 节点脉动：基础间隔乘 enemyPace，再按 spd 缩放（见 step 的 ratio） */
        /* 八标：节点脉动按层数插值（浅层 2.40 → 深层 enemyPace），见 data.js 的注释 */
        attackInterval: D().DESIGN.autoAttack.interval * enemyPaceAt(floor),
        onDeathBurst: meta.onDeathBurst || null,
        /* 外围节点层：精英 1~2、首领 2~3。先被打爆，再掉核心完整度 */
        outerNodes: meta.outerNodes || 0,
        /* 七标：三位关底首领各带一条正交的防御法则（见 data.js 的三角注释） */
        membrane: meta.membrane ? { ...meta.membrane } : null,
        plating: meta.plating ? { ...meta.plating } : null,
        onAction: meta.onAction ? { ...meta.onAction } : null,
        shieldCap: Math.round(hp * D().DESIGN.supportShieldCapPct),
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

    /* 七标：深层（F20+）的常规/精英遭遇补足到 4 名编队。
       四人小队对着 2~3 名敌人打，本质是排队点名：敌人还没轮到第二次脉动就被清完了，
       于是「外围熔断」「打断重铸」这些靠**敌人出手次数**成立的机制全部空转。
       4 名编队才能让「先打谁」真的成为一次决策。
       首领层不补：首领本体就是那第 4 个单位，再塞只会变成纯粹的数值墙。 */
    if (kind !== 'boss' && floor >= 20 && units.length < 4) {
      const zone = D().biome(floor);
      const pool = (zone && zone.pool) || [];
      for (let i = 0; units.length < 4 && i < pool.length * 2; i += 1) {
        push(pool[i % pool.length], { hpMult: tpl.elite ? 0.85 : 1, atkMult: 1 });
      }
    }

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

  /* ------------------------------ 相性（形状的天赋） ------------------------------ */

  /* 十四相只决定「这块铁怎么用」，**不改面板**：derive.js 的 hp/atk/def/spd 一个字没动。
     这里只做三件事：把相性 id 挂到战斗单位上、把装配期就能定的部分预先算成字段、
     把动态部分（回合数、受击、引爆）留给各自的结算点。 */
  function innateOf(unit) {
    const body = unit && unit.bodyPreset ? D().body(unit.bodyPreset) : null;
    return (body && body.innate && body.innate.id) || null;
  }

  /** 已摆纹路的模板（相性要按模板的格数 / 家族数东西） */
  function tplOf(st, placement) {
    const item = st.itemsById[placement && placement.itemId];
    return item ? D().template(item.templateId) : null;
  }

  /* ------------------------------ 建战斗 ------------------------------ */

  function buildAlly(st, partyEntry, unit) {
    const placements = (st.run.fieldLayouts && st.run.fieldLayouts[unit.id]) || unit.board.placements;
    const stats = V.Roster.stats(st, unit, placements);
    const cc = V.Circuit.compile(st, unit.id, placements);
    /* 超载：每超 1 点负荷，开局压力 +8、自然回裕 −0.04/s（压力到 50 之上时这笔罚项被高热抵掉） */
    const overload = (cc.ok && cc.value.overload) || 0;
    /* 蚀刻法状态：覆盖率决定的共鸣阶 + 贯通。没有蚀刻法时是空效果，不影响老存档 */
    const equipped = ST().manuscriptsOf(unit);
    /* 被动（passive）：把身上每一门的被动被动合成一份。
       全部**相加**，不乘算——乘算会让「四门同轴」变成唯一解，而四轴并装才是设计意图。 */
    const passive = (() => {
      const out = {};
      equipped.forEach((m) => {
        const p = (m && m.passive) || (D().manuscript(m && m.id) || {}).passive;
        if (!p) return;
        Object.keys(p).forEach((k) => {
          const v = p[k];
          if (typeof v === 'number') out[k] = (out[k] || 0) + v;
        });
      });
      return out;
    })();
    const ms = V.Circuit.manuscriptState(st, unit.id, placements);
    const extraMs = equipped.slice(1)
      .map((spec) => V.Circuit.manuscriptState(st, unit.id, placements, spec.id))
      .filter((state) => state.ok);
    /* 辅修的纹路增益减半计入余裕账：装第二门要立刻看得到数字变化 */
    /* 辅修的纹路增益按份额计入余裕账；份额由相性决定（默认 0.5，无相包容 0.75，双生主修第 2 门 1.0），
       所以这里先按 1 累加，乘份额留在下面 return 里做——否则改份额要动三处 */
    const extraBoost = extraMs.reduce((acc, state) => {
      const bo = (state.effects && state.effects.boost) || {};
      acc.max += bo.max || 0;
      acc.regen += bo.regen || 0;
      acc.skillCostCut += bo.skillCostCut || 0;
      return acc;
    }, { max: 0, regen: 0, skillCostCut: 0 });
    const SUB_SHARE = 0.5;

    /* ---- 相性：能在这里定的先算掉，战斗里只读字段 ---- */
    const innate = innateOf(unit);
    const usedPlacements = placements || [];
    const msStates = [ms, ...extraMs].filter((state) => state && state.ok);
    const mainRouted = !!(ms && ms.routed);
    const reachLen = (ms && ms.reachLen) || 0;
    /* 无相包容：辅修的乘算共享比例 +25%（0.5 → 0.75） */
    /* v4.0：无相包容改成负荷上限（见 Circuit.loadCap），不再动共享比例 */
    const subShare = SUB_SHARE;
    /* 双生主修：第一辅修按 100% 主修乘算结算 */
    const shareOf = (index) => (innate === 'twin' && index === 0 ? 1 : subShare);
    /* 逐门的份额和（第 1 辅修可能是 1.0，后面的仍是 0.5）——必须在 shareOf 之后算 */
    const extraShare = extraMs.reduce((sum, _state, i) => sum + shareOf(i), 0);
    /* 虚室生白：装配了几门浅层（1–2 阶） */
    const shallowCount = equipped.filter((m) => (m.rarity || 0) <= 2).length;
    /* 中脊挂刺：几门 1 阶辅修 */
    const tier1Subs = equipped.slice(1).filter((m) => (m.rarity || 0) === 1).length;
    /* 棘轮 / 波纹带：按纹路模板本身数，不看它压在哪 */
    const tpls = usedPlacements.map((p) => tplOf(st, p)).filter(Boolean);
    const smallCount = tpls.filter((tpl) => tpl.cells.length <= 2).length;
    const elbowCount = tpls.filter((tpl) => tpl.family === 'elbow' || tpl.id === 'elbow').length;
    /* 四达并存：已贯通的蚀刻法里，横向与纵向都要有一门 */
    const crucibleOn = (() => {
      if (innate !== 'crucible') return false;
      let wide = false;
      let tall = false;
      equipped.forEach((m) => {
        const state = msStates.find((x) => x.spec && x.spec.id === m.id);
        if (!state || !state.routed) return;
        const cells = V.State.manuscriptCells(m);
        if (!cells.length) return;
        const xs = cells.map((c) => c[0]);
        const ys = cells.map((c) => c[1]);
        const w = Math.max(...xs) - Math.min(...xs) + 1;
        const h = Math.max(...ys) - Math.min(...ys) + 1;
        if (w > h) wide = true;
        else if (h > w) tall = true;
      });
      return wide && tall;
    })();
    /* 一往无前：主修贯通才有那两条 */
    const agileOn = innate === 'agile' && mainRouted;
    /* 周流回环：贯通路径越长，主修乘算越高 */
    /* v4.0：周流回环改按闭环数吃脉冲幅值，见下面 innatePulse */
    const throatBonus = 0;
    const mainMult = ((ms && ms.effects && ms.effects.mainMult) || 1) + throatBonus;
    /* 孤弧锋锐：满覆盖 + 贯通 */
    const arcOn = innate === 'arc' && !!(ms && ms.pct === 100 && ms.routed);
    /* 棘轮：每件小纹路 +0.08，上限 0.48 */
    const ratchetBonus = innate === 'ratchet' ? Math.min(0.48, smallCount * 0.08) : 0;
    /* v4.0：这两条不再乘在招式上。
       四达并存改「分流系数 0.65 → 1.0」，两极共振改「压力 ≥50 时 ×1.45」，
       都在 buildAlly 的 pulseAmp 与 doBasicAttack 里结算。 */
    const innateSkillMult = 1;

    /* slot 是「这门功法的第几个招式」（1 起）。战斗日志带上它，
       才能统计「常规第 1 招 / 连携第 2 招 / 高阶第 3 招」的真实上场率。
       七标的「主动招式附加余裕」在这里就折进 cost —— 界面上写多少就扣多少，
       别在 skillCost 里偷偷加一笔，否则工坊面板会一直低报 1 点。 */
    const surcharge = D().DESIGN.skillEnergySurcharge || 0;
    const withSurcharge = (sk) => Object.assign({}, sk, { cost: Math.max(1, (sk.cost || 0) + surcharge) });
    const skillList = (ms.spec?.skills || []).map((sk, i) => ({
      ...withSurcharge(sk), slot: i + 1,
      cooldown: sk.cooldown,
    })).concat(
      extraMs.flatMap((state, index) =>
        /* 辅修的招式冷却比主修短 1 秒：主修先手，辅修跟上 */
        state.spec.skills.map((sk, i) => ({
          ...withSurcharge(sk), slot: i + 1, group: index + 1, cooldown: Math.max(1, (sk.cooldown || 4) - 1),
        }))));

    const maxHp = stats.maxHp;
    const hp = partyEntry.hp == null ? maxHp : clamp(partyEntry.hp, 1, maxHp);

    /* ---- 拓扑脉冲（v4.0）：路径特征在这里落成战斗参数 ---- */
    const panel = (cc.ok && cc.value && cc.value.panel) || stats.panel || { loops: 0, usedCells: 0, caps: 0, gates: 0 };
    const pulse = (ms && ms.pulse) || { intervalScale: 1, ampMult: 1, turns: 0, straight: 0, split: false, looped: false, capacitors: 0, gate: false, ember: false };
    /* 相性对编译规则的改写：母板不是加属性，是改公式 */
    /* 幅值 = 路径编译结果（弯折/分流/闭环）× 相性改写 */
    const pulseAmp = Math.round((pulse.ampMult || 1) * innatePulseOf(innate, pulse, panel, crucibleOn, unit) * 100) / 100;

    /* 余裕上限与起手值：起手是「半满」，见下面的 energy */
    const startEnergyMax = ((ms && ms.spec && ms.spec.energy && ms.spec.energy.max) || D().DESIGN.energyBase.max)
      + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.max) || 0)
      + Math.round(extraBoost.max * extraShare);
    const startEnergyVal = (ms && ms.effects && ms.effects.startEnergy) || 0;

    return {
      id: 'a_' + unit.id,
      sourceUnitId: unit.id,
      ms,
      extraMs,
      /* 时间轴与余裕：参数全部来自蚀刻法，没有蚀刻法就用基准值 */
      atkTimer: 0,
      dotTimer: 0,
      /* 余裕起手：不再从 0 起步 —— 从 0 起步会让「枯竭停机」开场就带走人，那是处决不是机制。
         七标：半满 → 1/4 满；八标：1/4 → 1/5 满（且保底 1 点）。
         回裕同时降到 0.42/s（从 0 回 1 点要 10 tick，已超过 6 tick 停机线），
         于是「这一手交不交」第一次成为真问题：连交两手就要赌下一回合的余裕。 */
      energy: Math.max(1, Math.floor(startEnergyMax * 0.20)) + startEnergyVal,
      energyMax: startEnergyMax,
      /* 超载：每超 1 点回裕 −regenPerPoint，但保底 0.1/s——
         压到 0 或负数会让这个人在战斗里彻底没有出手权，那不是「过用则裂」，是「不能玩」。
         regenBase 是**没扣罚项的原始值**，regen 是账面值；压力到 50 之上时
         energyRegen 会把罚项退回去（高热），所以两个数都要留着。 */
      regenBase: ((ms && ms.spec && ms.spec.energy && ms.spec.energy.regen) || D().DESIGN.energyBase.regen)
        + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.regen) || 0)
        + extraBoost.regen * extraShare + ratchetBonus,
      overloadPenalty: overload * overloadConfig().regenPerPoint,
      regen: Math.max(0.1,
        ((ms && ms.spec && ms.spec.energy && ms.spec.energy.regen) || D().DESIGN.energyBase.regen)
        + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.regen) || 0)
        + extraBoost.regen * extraShare + ratchetBonus - overload * overloadConfig().regenPerPoint),
      lowHpRegen: (ms && ms.effects && ms.effects.boost && ms.effects.boost.lowHpRegen) || 0,
      skillCostCut: ((ms && ms.effects && ms.effects.boost && ms.effects.boost.skillCostCut) || 0)
        + Math.round(extraBoost.skillCostCut * extraShare),
      skillMult: (1 + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.skillMult) || 0)) * mainMult,
      /* 三条流派轴：治疗只吃护持倍率，灼烧吃独立倍率，护盾吃独立倍率 */
      healMult: (ms && ms.effects && ms.effects.boost && ms.effects.boost.healMult) || 0,
      /* 被动：持续伤害加成与纹路 boost.dotMult 叠加，两者都是「加法」，不做乘算 */
      dotMult: ((ms && ms.effects && ms.effects.boost && ms.effects.boost.dotMult) || 0)
        + (passive.dotMult || 0),
      passive,
      shieldMult: (ms && ms.effects && ms.effects.boost && ms.effects.boost.shieldMult) || 0,
      supportMult: (ms && ms.effects.supportMult) || 1,
      emberAttack: !!(ms && ms.effects.boost && ms.effects.boost.ember),
      onHitEnergy: (ms && ms.spec && ms.spec.energy && ms.spec.energy.onHit) || 0,
      onAttackEnergy: (ms && ms.spec && ms.spec.energy && ms.spec.energy.onAttack) || 0,
      /* 直导系：路径每格 −4% 间隔（编译期算好，这里只乘） */
      attackInterval: D().DESIGN.autoAttack.interval
        * ((ms && ms.spec && ms.spec.attack && ms.spec.attack.intervalScale) || 1)
        * (pulse.intervalScale || 1),
      /* 弯折 / 分流 / 闭环：幅值在编译期乘完，这里再乘相性改写 */
      attackMult: D().DESIGN.autoAttack.mult
        * ((ms && ms.spec && ms.spec.attack && ms.spec.attack.mult) || 1)
        * (1 + ((ms && ms.effects && ms.effects.boost && ms.effects.boost.attackMult) || 0))
        * mainMult,
      pulseAmp,
      pulse,
      routedAtkBonus: (ms && ms.spec && ms.spec.attack && ms.spec.attack.routedBonus) || 0,
      /* 相性：战斗里只读这一包字段（界面也能直接念它，不用再算一遍） */
      innate,
      innateMods: {
        id: innate,
        subShare,                                   // 辅修乘算共享比例
        extraShares: extraMs.map((_state, i) => shareOf(i)), // 逐门的实际份额（双生主修第 2 门是 1.0）
        costCut: innate === 'conduit' ? shallowCount : 0,
        skillMult: innateSkillMult,                 // 四达并存 / 两极共振
        spineMult: innate === 'spine' ? Math.round((1 + Math.min(0.42, tier1Subs * 0.14)) * 1000) / 1000 : 1,
        castScale: innate === 'ripple' ? Math.max(0.4, 1 - elbowCount * 0.15) : 1,
        dodgeBonus: innate === 'ripple' ? Math.min(0.18, elbowCount * 0.03) : 0,
        regenBonus: ratchetBonus,                   // 齿咬碎纹
        startEnergy: 0,                             // v4.0 起由脉冲幅值承担
        mainMultBonus: throatBonus,                 // 周流回环
        agileOn,
        arcOn,
        crucibleOn,
        reachLen,
        mainRouted,
        smallCount,
        elbowCount,
      },
      skillList,
      cds: {},
      atkSinceSkill: 0,
      pendingSkill: null,
      side: 'ally',
      slot: partyEntry.slot,
      deployment: { x: V.Positions.homeX(partyEntry), y: V.Positions.homeY(partyEntry) },
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
      /* 电容缓冲上限：没有储能纹路就是 0。
         九标：直导通路的「动能缓冲」叠在同一个 shield 池上（每 2 格直导 +1 点/次命中），
         它的上限独立且额外，封顶 min(18, 直导格 × 2)。 */
      shieldCap: (stats.shieldCap || 0) + kineticCapOf(pulse),
      kineticGain: Math.floor((((pulse || {}).straight) || 0) * (V.Circuit.PULSE.kineticPerTwoCells == null ? 1 : V.Circuit.PULSE.kineticPerTwoCells) / 2),
      /* 闸系：压力 ≥50 或有缓冲时放大脉冲 */
      gateRune: !!pulse.gate,
      /* 余烬：每次脉冲吸压、按压力换幅值 */
      emberRune: !!pulse.ember,
      hits: D().DESIGN.baseHit,
      crit: D().DESIGN.baseCrit,
      /* 曲径通幽：曲折纹路越多越难被碰到；直导总线：每格直导 +2%（上限 +16%） */
      dodge: D().DESIGN.baseDodge
        + (innate === 'ripple' ? Math.min(0.18, elbowCount * 0.03) : 0)
        + (pulse.dodgeBonus || 0),
      alive: hp > 0,
      gauge: 0,
      casting: null,
      castTimer: 0,
      shield: panel.twinShield || 0,
      buffs: [],
      /* 八标：余烬通路穿过余烬件的人带着「炉温」入场。
         没有这一条，余烬的温控在 1.1s 节奏下永远爬不进高热区（见 circuit.js 的 emberWarm 注释）。 */
      stress: Math.min(100, (partyEntry.stress || 0) + overload * overloadConfig().stressPerPoint
        + (pulse.ember ? (V.Circuit.PULSE.emberWarm || 0) : 0)),
      affliction: unit.affliction || null,
      /* 带着裂痕下场的人，开场就是裂的——上一场没安抚，这一场继续背着。
         所以 resolveUsed 一开始就是 true：他这一场不会再掷一次。 */
      cracked: unit.affliction === 'crack',
      resolveUsed: unit.affliction === 'crack',
      polishMult: unit.affliction === 'crack' ? resolveConfig().crack.polishMult : 1,
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

  /**
   * 相性对脉冲的改写（纯函数，便于单独验证）。
   *
   * 这六条相性不再动面板，而是改「编译规则」：
   *   agile   板面每空 10% 的格 → 幅值 +8%（上限 +40%）
   *   corner  每次 90° 转折 → 再多 +12%（基础 12% → 24%）
   *   throat  每形成一个闭环 → +10%（上限 +60%）
   *   crucible 横向与纵向都贯通时，分流系数 0.65 → 1.0
   * 其余相性在自己的结算点生效（护盾、连携、回裕、闪避……）。
   *
   * @param {string} innate 相性 id
   * @param {object} pulse 编译出的路径特征
   * @param {object} panel 编译出的面板（要 usedCells / loops）
   * @param {boolean} crucibleOn 横 + 纵双贯通
   * @param {object} [unit] 用来取板面总格数
   * @returns {number} 乘在 pulse.ampMult 上的倍率
   */
  function innatePulseOf(innate, pulse, panel, crucibleOn, unit) {
    let mult = 1;
    if (innate === 'agile') {
      const total = Math.max(1, (unit && V.Circuit.plateOf(unit).cells.size) || 77);
      const empty = Math.max(0, 1 - ((panel && panel.usedCells) || 0) / total);
      mult += Math.min(0.4, Math.floor(empty * 10) * 0.08);
    }
    /* 三隅稳固：把「每次转折 +12%」整体换成「+18%」——
       不是叠一层，而是替换系数，所以用比值表达：(1+0.18t)/(1+0.12t)。 */
    if (innate === 'corner') {
      /* 与 PULSE.turnCap 同口径：否则「多拐几次」就成了无限倍率 */
      const t = Math.min(V.Circuit.PULSE.turnCap || 99, (pulse && pulse.turns) || 0);
      if (t > 0) mult *= (1 + t * 0.18) / (1 + t * 0.12);
    }
    if (innate === 'throat') mult += Math.min(0.6, ((panel && panel.loops) || 0) * 0.10);
    if (innate === 'crucible' && crucibleOn && pulse && pulse.split && !pulse.looped && !pulse.cleanSplit) {
      mult *= 1 / V.Circuit.PULSE.split;
    }
    return Math.round(mult * 100) / 100;
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
      /* 节点脉动：蓝图带过来的间隔必须真的落到战斗单位上，
         否则 pulseInterval 永远回落到 0.5s，enemyPace 白写 */
      attackInterval: bpUnit.attackInterval || D().DESIGN.autoAttack.interval * (D().DESIGN.enemyPace || 1),
      shield: 0,
      shieldCap: bpUnit.shieldCap || 0,
      outerNodes: bpUnit.outerNodes || 0,
      /* 相位护膜：开局满层，每回合补满（见 step 的回合边界） */
      membrane: bpUnit.membrane ? { ...bpUnit.membrane, left: bpUnit.membrane.layers } : null,
      plating: bpUnit.plating ? { ...bpUnit.plating } : null,
      onAction: bpUnit.onAction ? { ...bpUnit.onAction } : null,
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

    next.run.battle.field = V.Positions.initialField(next.run.battle);
    next.run.battle.fieldY = V.Positions.initialField(next.run.battle, V.Positions.homeY);
    log(next.run.battle, { type: 'note', text: `遭遇开始：${enemies.map((e) => e.name).join('、')}` });
    /* 开局就顶着满压进来的人（重载 + 上一场没安抚）：一样要过这道悬崖，别让他白拿 100 压 */
    allies.forEach((a) => {
      if (a.stress >= 100 && !a.resolveUsed) rollResolve(next.run.battle, a);
    });
    const problems = allies.filter((a) => !a.circuit);
    if (problems.length) {
      problems.forEach((a) => a.circuitErrors.forEach((m) => {
        log(next.run.battle, { type: 'note', text: `${a.name} 回路未编译：${m}` });
      }));
    }

    return ST().ok(next, [{ type: 'battleStart', meta: { kind: enemyBlueprint.kind } }]);
  }

  /* ------------------------------ 伤害 ------------------------------ */

  /* 缓冲上限来自拓扑编译（储能纹路每格 6 点）；没有储能纹路就是 0。
     老存档里没有这个字段的单位退回旧比例，避免读档即崩。 */
  function shieldCap(u) {
    if (u && Number.isFinite(u.shieldCap)) return Math.max(0, u.shieldCap);
    return Math.round(u.maxHp * D().DESIGN.supportShieldCapPct);
  }

  function addShield(u, amount) {
    /* 正面如壁：站在 1 号位时护盾更厚 */
    const gain = u.innate === 'aegis' && u.slot === 0 ? Math.round(amount * 1.25) : amount;
    const cap = shieldCap(u);
    const before = u.shield;
    u.shield = Math.min(cap, u.shield + gain);
    return u.shield - before;
  }

  /* 阻抗拦截：软底 70（PULSE.defBase），拦截至多 45%（PULSE.defCap）。
     八标：旧口径软底 30、无封顶，def 55 能拦 65%，再叠上「出手时先乘一次、
     结算时再乘一次」的两次口径，敌人重击真正透进来的只剩一成 ——
     熔断阈值（8% 完整度 ≈ 6~9 点）永远够不到，整条保险丝轴是死的。 */
  function mitigation(def) {
    const P = V.Circuit.PULSE;
    const base = def / (def + (P.defBase || 70));
    return Math.min(P.defCap == null ? 0.45 : P.defCap, base);
  }

  /**
   * 熔断一枚外围纹路，挡下整次直击。
   * 「外围」= 板面上任意一件还没熔断的纹路。熔断之后那格本场断路：
   * 阻抗 −2、缓冲上限 −6、脉冲幅值 ×0.95（轻量重编译，不回头重跑整张图）。
   * @returns {boolean} 是否真的熔断了一枚（false 表示没有保险丝可用）
   */
  function fuseNode(b, u) {
    /* 敌方没有板面纹路，用「外围节点层数」当同一回事：先爆壳，再掉核心 */
    if ((!u.circuit || !u.circuit.placements || !u.circuit.placements.length)) {
      if ((u.outerNodes || 0) > 0) {
        u.outerNodes -= 1;
        u.def = Math.max(0, (u.def || 0) - 2);
        log(b, { type: 'blocked', effect: 'fuse', targetId: u.id, amount: 0,
          text: `${u.name} 的外围节点被打爆一层（还剩 ${u.outerNodes} 层）` });
        return true;
      }
      return false;
    }
    u.fusedNodes = u.fusedNodes || [];
    const alive = u.circuit.placements.filter((p) => !u.fusedNodes.includes(p.itemId)
      && !u.circuit.protectedNodes?.includes(p.itemId));
    if (!alive.length) return false;
    const pick = alive[Math.floor(rngValue(b) * alive.length) % alive.length];
    u.fusedNodes.push(pick.itemId);
    u.def = Math.max(0, (u.def || 0) - 2);
    u.shieldCap = Math.max(0, (u.shieldCap || 0) - V.Circuit.PULSE.capShieldPerCell);
    u.shield = Math.min(u.shield || 0, u.shieldCap);
    u.pulseAmp = Math.round(Math.max(0.5, (u.pulseAmp || 1) * 0.95) * 100) / 100;
    log(b, { type: 'blocked', effect: 'fuse', targetId: u.id, amount: 0,
      text: `${u.name} 的 ${pick.itemId} 熔断，挡下这一击（本场报废）` });
    return true;
  }

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
    /* 八标：单发幅值（真正的「打出来的那一发」）由调用方显式带进来。
       在此之前 impact 取的是**已经被阻抗削过**的数 —— 于是 data.js 里按「12 对 60」
       写下的两道门槛（护膜 minHit 20 / 炉壁 pierceAt 18）永远够不到，
       整条对位轴是死的：实测 A/B/C 的单发幅值 11/18/15，削完只剩 7.7/12.6/10.5。 */
    const pulseIn = o.pulse != null ? Math.max(1, Math.round(o.pulse)) : null;
    const impactOf = (v) => (pulseIn == null ? v : pulseIn);
    /* ---- 打断按秒准备窗口 ----
       首领的「重铸」有 0.72s 的准备窗口（3 tick），窗口内挨到 >=20 的脉冲冲击就断，
       并且连带震碎它刚结起来的护盾。这是「高幅值蓄力」唯一的机制性价值：
       不是打得更疼，是让它打不出来。 */
    if (tgt && tgt.alive !== false && tgt.charging && tgt.charging.castTime
      && !o.isDot && impactOf(Math.max(1, Math.round(amount))) >= (tgt.charging.interruptAt || 20)) {
      const name = tgt.charging.name;
      tgt.charging = null;
      tgt.chargeTimer = 0;
      tgt.intent = null;
      const broken = tgt.shield || 0;
      tgt.shield = 0;
      log(b, {
        type: 'disrupt', effect: 'interrupt', targetId: tgt.id, amount: broken,
        text: `${tgt.name} 的${name}被打断${broken > 0 ? `，护盾一并震碎 ${broken}` : ''}`,
      });
    }
    /* raw：不参与任何加成/减伤的「已经算好的数」——目前只有覆盾的反弹用它，
       否则反弹值会被祝福与压力再乘一遍，越打越滚雪球 */
    const bless = (b && b.bless) || null;
    if (!o.raw) {
      /* 祝福：主手增伤与全队减伤，DOT 不吃减伤（否则灼烧会被两次削弱） */
      if (bless) {
        if (src && src.side === 'ally') amount *= 1 + bless.mainDmg;
        if (tgt.side === 'ally' && !o.isDot) amount *= 1 + bless.dmgTaken;
      }
    }
    /* 压力换伤害：我方出手越紧绷打得越狠，DOT 不重复吃这一层。
       裂了的人这一层是反的——同一个档位，红利翻成负担（见 pressureDamageMultiplier）。 */
    if (!o.raw) {
      if (src && src.side === 'ally' && !o.isDot) amount *= pressureDamageMultiplier(src.stress, src);
      /* 裂：裂缝在扩大，受到的伤害跟着一起涨。DOT 不吃，否则灼烧会被罚两次。 */
      if (tgt && tgt.side === 'ally' && tgt.cracked && !o.isDot) amount *= resolveConfig().crack.takenMult;
    }
    let dmg = Math.max(1, Math.round(amount));
    /* 「单发幅值」是**打出来的那一发**有多重，不是透进来剩多少。
       两道对位门槛（炉壁、护膜）都按这个数筛，否则先被阻抗削掉的薄脉冲
       会让门槛失效：60 点重炮削到 18 就变成「薄脉冲」，对位立刻失去意义。
       八标：这条注释之前是**谎话** —— impact 取的是 dmg，而 dmg 进来时已经过了阻抗。
       现在我方普攻/招式把原始幅值塞进 opts.pulse，门槛终于量到真值。 */
    const impact = impactOf(dmg);

    /* ---- Step 0：炉壁重甲（炉心俑）----
       薄脉冲在炉壁里再衰减四成：一刀 12~14 的连刺打上去只剩 7~8，
       对着 0.72s 的重铸窗口永远攒不出那一记打断。
       单发够重（>= pierceAt 20）直接贯穿，不吃这层衰减 ——
       「重炮能开炉壁，细刀不能」这条对位就写在这一句里。 */
    if (tgt.plating && !o.isDot && !o.raw && !o.pierce && impact < (tgt.plating.pierceAt || 20)) {
      const before = dmg;
      dmg = Math.max(1, Math.round(dmg * (1 - tgt.plating.reduce)));
      if (before > dmg) {
        log(b, { type: 'blocked', targetId: tgt.id, amount: before - dmg,
          text: `${tgt.name} 的${tgt.plating.name}吃掉 ${before - dmg} 点薄脉冲` });
      }
    }

    /* 正面如壁：格挡/减伤省下来的那一段是要还的——覆盾站在 1 号位时反弹 35% */
    let reflected = 0;
    if (!o.pierce) {
      const guarded = (tgt.buffs || []).some((x) => x.k === 'guard');
      if (guarded) {
        const before = dmg;
        dmg = Math.round(dmg * (1 - D().GUARD.reduce));
        if (tgt.innate === 'aegis' && tgt.slot === 0 && src) reflected += before - dmg;
        /* 一次举盾只兑现一次：用完即卸 */
        tgt.buffs = tgt.buffs.filter((x) => x.k !== 'guard');
      }
      const dr = (tgt.buffs || []).filter((x) => x.k === 'dmgReduce').reduce((a, x) => a + x.v, 0);
      if (dr) {
        const before = dmg;
        dmg = Math.round(dmg * (1 - clamp(dr, 0, 0.6)));
        if (tgt.innate === 'aegis' && tgt.slot === 0 && src) reflected += before - dmg;
      }
    }
    if (o.pierce) dmg = Math.round(dmg);

    /* 残影只挡直射，不挡 AOE / DOT / 贯穿 */
    if (!o.isDot && !o.aoe && !o.pierce && tgt.refract > 0) {
      tgt.refract -= 1;
      log(b, { type: 'blocked', targetId: tgt.id, text: `${tgt.name} 的残影挡下一次直射` });
      return { dealt: 0, absorbed: dmg, died: false };
    }

    /* ---- Step 1：阻抗拦截 → 废热 / 充能 ----
       被挡下的那部分脉冲没有消失，它变成了热（+压力）和电（+余裕）。
       DOT 不走这一层：毒是在身体里发作的，不是从外面打进来的。 */
    /* 穿刺（引爆、自爆、破甲重击）绕过阻抗：它本来就是在体内炸开的 */
    if (!o.isDot && !o.raw && !o.pierce) {
      /* 高幅值脉冲自带破甲：单次 >=22 的冲击把阻抗按半价算（见 doBasicAttack 的 armorPierce） */
      const def = effectiveDef(tgt) * (o.armorPierce ? 0.5 : 1);
      const intercepted = Math.round(dmg * mitigation(def));
      if (intercepted > 0) {
        dmg = Math.max(0, dmg - intercepted);
        /* 50% 变成废热 */
        addStress(b, tgt, Math.max(1, Math.round(intercepted * 0.5)));
        /* 装了储能纹路的，另外 50% 回充余裕 */
        if (tgt.circuit && tgt.circuit.panel && tgt.circuit.panel.caps > 0) {
          const gain = intercepted * 0.5;
          const emax = tgt.energyMax == null ? D().DESIGN.energyBase.max : tgt.energyMax;
          tgt.energy = Math.min(emax, (tgt.energy || 0) + gain);
        }
        log(b, { type: 'blocked', targetId: tgt.id, amount: intercepted,
          text: `${tgt.name} 的回路拦下 ${intercepted} 点脉冲（转入废热）` });
      }
    }

    /* ---- Step 2：电容缓冲 ----
       储能纹路截留 30% 直接充进缓冲池；上限由拓扑编译给（没有储能纹路就是 0）。 */
    if (!o.isDot && tgt.shieldCap > 0 && dmg > 0) {
      const charge = Math.round(dmg * V.Circuit.PULSE.capToShield);
      if (charge > 0) {
        dmg -= charge;
        addShield(tgt, charge);
      }
    }

    /* ---- Step 2b：缓冲被击破后，剩余脉冲全额结转 ----
       吸收量只受「缓冲池里还剩多少」限制，不受单次上限限制：
       打穿 30 点盾的 80 点重击，会原样把 50 点带进完整度。 */
    let absorbed = 0;
    if (tgt.shield > 0) {
      /* DOT 渗透：毒/灼烧是在体内发作的，一半直接穿缓冲。
         不这样的话，「回盾型首领」会把整条 DOT 轴完全吞掉。 */
      const pool = o.isDot ? Math.floor(dmg * 0.5) : dmg;
      absorbed = Math.min(tgt.shield, pool);
      tgt.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0 && tgt.shield === 0) {
        log(b, { type: 'blocked', effect: 'bufferBreak', targetId: tgt.id, amount: absorbed,
          text: tgt.name + ' 的缓冲耗尽' });
      }
    }

    /* ---- Step 3：外围节点熔断 ----
       单次直击够狠（>15）而且不是穿刺时，烧掉一枚还没熔断的外围纹路来挡这一下。
       代价是那个节点本场报废：阻抗、缓冲、脉冲幅值一起降一档（轻量重编译）。 */
    /* 熔断阈值跟着「目标有多大」走：max(5, 8% 完整度)。
       固定值在小体型上太钝、在首领身上又永远够不到 —— 12 点对 25 点完整度是半条命，
       对 120 点只是擦伤。改成按比例之后，中后期精英的重击才会稳定引爆保险丝。
       七标：13% → 8%（下限 7 → 5）。13% 对满配底盘（完整度 90~110）是 12~14 点，
       而敌人单次脉冲穿透阻抗后只剩 5~10 —— 阈值永远高过实际伤害，整条保险丝轴是死的。
       8% 落在 7~9 点，敌人重击（含破甲/高热增幅）刚好踩得上，储能缓冲与
       `warden` 保险丝保护的价值也才有兑现的场合。 */
    if (!o.pierce && !o.isDot && !o.raw
      && dmg > Math.max(
        V.Circuit.PULSE.fuseFloor == null ? 5 : V.Circuit.PULSE.fuseFloor,
        Math.round((tgt.maxHp || 0) * (V.Circuit.PULSE.fusePct == null ? 0.08 : V.Circuit.PULSE.fusePct)),
      )) {
      const fused = fuseNode(b, tgt);
      if (fused) dmg = 0;
    }

    /* ---- Step 4：相位护膜（守门人）----
       护膜在时，**够重**的脉冲（单发 >= minHit）被吃掉 80%，并剥掉 1 层；
       单发再高也只剥 1 层，多段招式与每跳 DOT 各剥 1 层。
       小脉冲（低于 minHit）从膜缝里穿过去，不减伤也不剥层 ——
       这就是「频次检验」的全部：细刀不管砍多少下，膜都不会为它让路；
       重炮每挨一发就少一层保护，四发之后就裸奔。 */
    if (tgt.membrane && tgt.membrane.left > 0 && !o.raw && dmg > 0
      && impact >= (tgt.membrane.minHit || 0)) {
      const before = dmg;
      dmg = Math.max(0, Math.round(dmg * (1 - tgt.membrane.reduce)));
      tgt.membrane.left -= 1;
      log(b, {
        type: 'blocked', effect: 'membrane', targetId: tgt.id, amount: (before - dmg),
        text: `${tgt.name} 的${tgt.membrane.name}吃下 ${before - dmg} 点（剩 ${tgt.membrane.left} 层）`,
      });
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

    /* 两极共振：单次挨打超过生命上限 15%，压力额外 +5（脆的代价） */
    if (actual > 0 && tgt.innate === 'waist' && tgt.side === 'ally'
      && actual > Math.round(tgt.maxHp * 0.15)) {
      addStress(b, tgt, 5);
    }
    /* 正面如壁：把省下来的伤害的一部分弹回去。raw 表示这段数不再吃任何加成 */
    if (reflected > 0 && src && src.alive !== false && tgt.alive !== false) {
      const back = Math.max(1, Math.round(reflected * 0.35));
      applyDamage(b, tgt, src, back, { pierce: true, raw: true });
      log(b, { type: 'hit', actorId: tgt.id, targetId: src.id, amount: back, text: `${tgt.name} 的盾面把 ${back} 点力弹了回去` });
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
      log(b, { type: 'death', actorId: src ? src.id : null, targetId: tgt.id, strike: !!o.strike, text: `${tgt.name} 倒下了` });
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
     中毒 / 灼烧 / 流血在出手前跳，腐蚀在出手后跳；每跳之前先判死，死了就不再往下结算。

     2026-11-15：四种异常各有自己的**追加结算时机**，不再只是「跳得慢/跳得快」：
       burn    时间跳伤（可叠层）+ 被带 detonateDot 的招式**引爆**剩余总伤 ×1.25
       poison  时间跳伤低 + **每次被普通攻击命中立刻追加一跳**（快攻/多段流专用）
       bleed   时间跳伤 + 目标**起手引导**或**换位**时被撕一次（克制引导与走位）
       corrode 时间跳伤 + 持续降防（每层 4%，上限 40%）+ 目标受到的压力 +30%
     这四条是 80 门功法分轴的底层凭据：没有它们，四大流派只是数值不同的同一个按钮。 */
  const DOT_KINDS = { poison: 'pre', burn: 'pre', bleed: 'pre', corrode: 'post' };
  const DOT_LABEL = { poison: '中毒', burn: '灼烧', bleed: '流血', corrode: '腐蚀' };
  const DOT_KIND_LIST = ['burn', 'poison', 'bleed', 'corrode'];

  function isDot(x) { return !!DOT_KINDS[x && x.k]; }
  function dotPhase(x) { return (x && x.on) || DOT_KINDS[x && x.k] || 'pre'; }

  /** 目标身上的某一类异常（可多段叠加，所以是数组） */
  function dotsOf(u, kind) {
    return (u && u.buffs ? u.buffs : []).filter((x) => isDot(x) && (!kind || kind === 'any' || x.k === kind));
  }

  function hasDot(u, kind) { return dotsOf(u, kind).length > 0; }

  function addDotStacks(tgt, dot, pulse) {
    tgt.buffs.push(dot);
    if (pulse?.dotStacks === 2) tgt.buffs.push({ ...dot });
  }

  /** 追加一跳指定异常：和自然跳伤同一套算法（吃 dotMult/引爆倍率以外的加成不动） */
  function tickDot(b, src, tgt, dot, note) {
    if (!dot || tgt.alive === false || tgt.hp <= 0) return 0;
    const amount = Math.max(1, Math.round(dot.v));
    applyDamage(b, null, tgt, amount, { isDot: true, pierce: true });
    dot.hits = Math.max(0, (dot.hits || 1) - 1);
    log(b, {
      type: 'dot', actorId: src ? src.id : null, targetId: tgt.id, amount, kind: dot.k,
      text: `${tgt.name} 的${DOT_LABEL[dot.k] || '持续伤害'}${note || '发作'} ${amount}${dot.hits > 0 ? `（还剩 ${dot.hits} 次）` : ''}`,
    });
    tgt.buffs = (tgt.buffs || []).filter((x) => !isDot(x) || (x.hits || 0) > 0);
    return amount;
  }

  /**
   * 引爆：把目标身上某类异常**剩余的总伤害**一次性倒出来。
   * 剩余总伤 = Σ(v × 剩余跳数)，再乘爆发系数与被动加成。引爆后层数清空。
   */
  function detonate(b, src, tgt, which, opts) {
    if (!tgt || tgt.alive === false || tgt.hp <= 0) return 0;
    const o = opts || {};
    const kinds = which === 'all' ? DOT_KIND_LIST : [which];
    const hit = dotsOf(tgt).filter((x) => kinds.includes(x.k));
    if (!hit.length) return 0;
    const remaining = hit.reduce((sum, x) => sum + Math.max(0, x.v) * Math.max(1, x.hits || 1), 0);
    if (remaining <= 0) return 0;
    const cfg = D().DESIGN.detonate || { mult: 1.25 };
    /* 孤弧锋锐：引爆时额外 +20%（与招式自带的引爆加成相加） */
    const detonateMult = 1 + (o.detonateMult || 0) + (src && src.innateMods && src.innateMods.arcOn ? 0.2 : 0);
    const amount = Math.max(1, Math.round(remaining * cfg.mult * detonateMult));
    const names = [...new Set(hit.map((x) => DOT_LABEL[x.k] || x.k))].join('、');
    /* 清层要在结算之前：避免引爆伤害被自己的 dot 结算重复触发 */
    const dead = new Set(hit);
    tgt.buffs = (tgt.buffs || []).filter((x) => !dead.has(x));
    applyDamage(b, src, tgt, amount, { pierce: true });
    log(b, {
      type: 'detonate', actorId: src ? src.id : null, targetId: tgt.id, amount,
      text: `${tgt.name} 的${names}被引爆，一次性 ${amount}`,
    });
    return amount;
  }

  /** 腐蚀降防：每层 4%，上限 40%。返回一个乘过减防的防御值 */
  function corrodeDefMult(tgt) {
    const n = dotsOf(tgt, 'corrode').reduce((sum, x) => sum + Math.max(1, x.hits || 1), 0);
    const cfg = D().DESIGN.corrode || { defPerStack: 0.04, defCap: 0.4 };
    return 1 - clamp(n * cfg.defPerStack, 0, cfg.defCap);
  }

  function effectiveDef(tgt) { return Math.max(0, tgt.def * corrodeDefMult(tgt)); }

  /** 流血撕裂：目标起手引导或换位时被撕一次。不消耗剩余跳数——它罚的是动作，不是时间 */
  function rendBleed(b, tgt, reason) {
    if (!tgt || tgt.alive === false || tgt.hp <= 0) return 0;
    const list = dotsOf(tgt, 'bleed');
    if (!list.length) return 0;
    const total = list.reduce((sum, x) => sum + Math.max(1, Math.round(x.v)), 0);
    applyDamage(b, null, tgt, total, { isDot: true, pierce: true });
    log(b, {
      type: 'dot', targetId: tgt.id, amount: total, kind: 'bleed',
      text: `${tgt.name} ${reason}，伤口裂开 ${total}`,
    });
    return total;
  }

  /** 普攻命中时的中毒追加：每层中毒立刻多跳一次，然后正常消耗跳数 */
  function poisonOnHit(b, src, tgt) {
    if (!tgt || tgt.alive === false) return 0;
    let total = 0;
    dotsOf(tgt, 'poison').forEach((dot) => {
      if (tgt.hp <= 0) return;
      total += tickDot(b, src, tgt, dot, '随刃入血');
    });
    return total;
  }

  /**
   * 一次换位的全部结算：写日志 + 流血撕裂。
   * 单独抽出来是为了让「换位会撕伤口」这条规则只有一处实现——
   * 之前它只是写了个 rendBleed 函数而没接到事件上，等于没做。
   * 两边都会换位（敌方前压同样算），所以按 id 在两边的队列里找。
   */
  function applyMove(b, ev) {
    const moved = byId(b.allies, ev.actorId) || byId(b.enemies, ev.actorId);
    if (!moved) return null;
    log(b, { ...ev, text: `${moved.name} · ${V.Positions.describe(ev)}（${ev.meta.from + 1}→${ev.meta.to + 1}位）` });
    rendBleed(b, moved, '换位');
    return moved;
  }

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
        /* 按次数的强化、持续伤害、以及「下一次受击」的举盾，都不随回合流逝 ——
           它们各自由出手/受击推动，挂秒表只会让它们在敌人动手前就失效。 */
        if (x.k === 'atkUp' || x.k === 'guard' || isDot(x)) return true;
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
    const pulse = o.pulse || actor.pulse;
    if (pulse?.waistPressure && !o.isDot && !o.aoe && !o.repeatedPulse) {
      addStress(b, actor, pulse.waistPressure);
      if (actor.alive === false || tgt.alive === false) return { dealtDamage: false, hits: 0 };
    }
    if (!rngChance(b, clamp(actor.hits - tgt.dodge, 0.05, 1))) {
      log(b, { type: 'miss', actorId: actor.id, targetId: tgt.id, strike: true, skillId: o.skillId, text: `${actor.name} 落空` });
      return { dealtDamage: false, hits: 0 };
    }
    /* 流血被动：对流血目标更容易出暴击——先割开，再补刀 */
    const critBonus = hasDot(tgt, 'bleed') ? ((actor.passive && actor.passive.bleedCritBonus) || 0) : 0;
    const crit = rngChance(b, clamp(actor.crit + critBonus, 0, 1));
    const atkBonus = (actor.buffs || []).filter((x) => x.k === 'atkUp').reduce((sum, x) => sum + x.v, 0);

    /* ---- 拓扑脉冲（v4.0）----
       普攻与招式走同一套：先把主修路径的幅值乘进来，再叠动态元件。
       pulseAmp 在 buildAlly 里编译好（弯折 / 分流 / 闭环 / 相性改写），这里只乘。 */
    let amp = (actor.pulseAmp || 1) * ((pulse?.anchorAmp || 1) / (actor.pulse?.anchorAmp || 1));
    /* 「放大」类增益走加算：闸门与两截同时开时是 +90%，不是 ×1.45×1.45=×2.10。
       连乘会让「高热 + 缓冲 + 两截」三件事叠成一张秒杀票 —— F49 两回合推平就是这么来的。 */
    let ampAdd = 0;
    /* 闸系：高热（压力 ≥50）或身上有缓冲时，闸门打开，脉冲放大 */
    if ((actor.gateRune || pulse?.gateBonus) && ((actor.stress || 0) >= 50 || (actor.shield || 0) > 0)) {
      ampAdd += V.Circuit.PULSE.gate - 1 + (pulse?.gateBonus || 0);
    }
    /* 余烬温控（v4.0 三标）：低压时主动蓄热、接近失控才泄压。
       以前「每次吸 2 点」是个只会降温的负反馈，余烬流永远进不了高热区；
       现在 stress < 60 反而 +3，>= 80 才 -2，中间那段是缓冲带。幅值仍按当前压力换算。 */
    if (actor.emberRune && !o.isDot) {
      const st0 = actor.stress || 0;
      const P = V.Circuit.PULSE;
      if (st0 < P.emberHot) addStress(b, actor, P.emberCharge);
      else if (st0 >= P.emberVent) addStress(b, actor, -P.emberStress);
      /* 压力换幅值封顶 +30%：不封顶的话 100 压就是 ×2.5，再乘下面那不是共振是秒杀 */
      amp *= 1 + Math.min(P.emberAmpCap, P.emberPerStress * (actor.stress || 0));
    }
    /* 九标：噬忆者的抽能被高热回路烧成了反冲 —— 下一击 +25% 过载脉冲 */
    if (actor.heatRebound > 0) {
      ampAdd += actor.heatRebound;
      actor.heatRebound = 0;
    }
    /* 两极共振：高热时脉冲更猛（与闸门加算） */
    if (actor.innate === 'waist' && (actor.stress || 0) >= 50) ampAdd += 0.45;
    amp *= 1 + ampAdd;
    /* 储能满溢：缓冲顶到上限，下一次出手把整仓倒出来 */
    if (actor.shieldCap > 0 && actor.shield >= actor.shieldCap && !o.isDot && !o.raw) {
      actor.shield = 0;
      amp *= V.Circuit.PULSE.overload;
      log(b, { type: 'surge', actorId: actor.id, text: `${actor.name} 的电容缓冲满溢，整仓放电` });
    }

    const raw = actor.atk * (o.mult || 1) * (1 + (o.dmgBonus || 0)) * (1 + atkBonus) * amp;
    /* 腐蚀在持续期间削防：这是「破甲压制」轴的全部意义，不写进 def 字段，
       否则拆掉腐蚀时要找回原值，容易写漏 */
    /* 孤弧锋锐：只削「防御减伤」这一层，其它减伤（格挡/减伤/残影）照旧 */
    const arcOn = !!(actor.innateMods && actor.innateMods.arcOn);
    const defUse = arcOn ? effectiveDef(tgt) * 0.75 : effectiveDef(tgt);
    const dmg = raw * (1 - mitigation(defUse)) * (crit ? 1.75 : 1);
    /* 单次脉冲够重（>=22）就自带破甲：阻抗按半价算 */
    const res = applyDamage(b, actor, tgt, dmg, {
      aoe: !!o.aoe, armorPierce: raw >= 22, pulse: raw * (crit ? 1.75 : 1), strike: true,
    });
    log(b, {
      type: crit ? 'crit' : 'hit', actorId: actor.id, targetId: tgt.id, amount: res.dealt,
      strike: true, skillId: o.skillId, defeated: res.died,
      text: `${actor.name} ${o.label || '攻击'} ${tgt.name}${crit ? '（暴击）' : ''} -${res.dealt}`,
    });
    /* 九标 · A 流派防御轴：直导通路的每次命中都给一层薄盾（每 2 格直导 +1 点）。
       它靠出手次数吃饭，所以「打得快」本身就把盾续上来了 —— 上限由 kineticCap 单独封顶。 */
    if (res.dealt > 0 && actor.kineticGain > 0 && actor.side === 'ally') {
      const got = addShield(actor, actor.kineticGain);
      if (got > 0 && b.logs.length < 400) {
        log(b, { type: 'shield', actorId: actor.id, targetId: actor.id, amount: got,
          text: `${actor.name} 的直导脉冲折成 ${got} 点动能缓冲` });
      }
    }
    /* 中毒：被普通攻击命中就立刻多跳一次，快攻/多段流因此能靠出手次数堆毒 */
    if (res.dealt > 0) poisonOnHit(b, actor, tgt);
    /* 腐蚀被动：对已中毒的目标，普攻附带一段按攻击力折算的附加伤 */
    const poisonAmp = (actor.passive && actor.passive.poisonOnBasic) || 0;
    if (res.dealt > 0 && poisonAmp > 0 && hasDot(tgt, 'poison') && tgt.alive !== false) {
      const extra = Math.max(1, Math.round(actor.atk * poisonAmp));
      applyDamage(b, actor, tgt, extra, { pierce: true });
      log(b, { type: 'hit', actorId: actor.id, targetId: tgt.id, amount: extra, text: `${tgt.name} 锈毒顺刃加深 ${extra}` });
    }
    if (o.ember && res.dealt > 0) {
      addDotStacks(tgt, { k: 'burn', v: Math.max(2, Math.round(actor.atk * 0.18 * (1 + (actor.dotMult || 0)))), hits: 2 }, pulse);
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
    let nearest = true;
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
        const rule = actor.gambits?.find(r => r.id === d.ruleId);
        nearest = !rule || (rule.id === 'g1' && rule.target === 'frontFoe'
          && (rule.conditions || []).every(c => c.type === 'always'));
      }
    } catch (e) { /* 指令异常不影响战斗，退回默认目标 */ }

    if (b.tactic === 'focus') return { targetId: pickTarget(b, actor, 'lowestHpFoe')?.id || null, action: 'main' };
    if (b.tactic === 'safe') return { targetId: alive(b.enemies).find((u) => u.charging)?.id || frontOf(b.enemies)?.id || null, action: 'main' };

    if (action === 'guard') return { targetId: actor.id, action };
    const fallback = V.Positions.style(actor).mode === 'melee' ? V.Positions.nearestFoe(b, actor) : frontOf(b.enemies);
    const selected = byId(b.enemies, targetId);
    const foe = nearest || !selected || selected.alive === false ? fallback?.id || null : selected.id;
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

  /** 条件判定：只做有限几种，便于 UI 解释。
      2026-11-15 新增五种，全部为「功法之间的配合」服务：
      targetHasDot（异常联动）/ afterTag（招式接续）/ selfHasShield（构盾后反击）
      / stressAbove（高压打法）/ minTier（靠拼图覆盖率解锁第二、第三招）。 */
  function condOk(b, actor, cond, ms, attackCount, target) {
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
    /* 目标身上有没有这类异常：连携招式的第一道门 */
    if (cond.targetHasDot) {
      if (!target || !hasDot(target, cond.targetHasDot)) return false;
    }
    /* 连携：最近 N 秒内放过带这个 tag 的招式。两种来源都算——
       ① 自己（5 秒窗口，够攒出下一手的余裕）；
       ② **任意存活队友**（3.5 秒窗口）：前排起手挂状态、后排主 C 接追击。
       队友窗口刻意比自己短，否则四个人可以无限互相续，连携就变成常态而不是配合。 */
    if (cond.afterTag) {
      const ownWin = D().DESIGN.comboWindow == null ? 5 : D().DESIGN.comboWindow;
      const mateWin = D().DESIGN.comboWindowAlly == null ? 3.5 : D().DESIGN.comboWindowAlly;
      const stepSec = D().DESIGN.stepSeconds;
      /* 双生主修：两团金属本来就长在一起，连携不挑标签——窗口内放过任意招式都算 */
      const twinRelax = actor.innate === 'twin';
      const fresh = (mem, win) => !!mem && (twinRelax ? !!mem.tag : mem.tag === cond.afterTag)
        && (b.tick - mem.tick) * stepSec <= win;
      const mates = (actor.side === 'ally' ? b.allies : b.enemies) || [];
      const fromMate = mates.some((u) => u !== actor && u.alive !== false && u.hp > 0 && fresh(u.tagMemory, mateWin));
      if (!fresh(actor.tagMemory, ownWin) && !fromMate) return false;
    }
    if (cond.selfHasShield && !(actor.shield > 0)) return false;
    if (cond.stressAbove != null && (actor.stress || 0) < cond.stressAbove) return false;
    /* 共鸣阶解锁：覆盖率拼到二阶/三阶，这一门才算完整 */
    if (cond.minTier != null && ((ms && ms.tierIndex) || 0) < cond.minTier) return false;
    return true;
  }

  function cooldownKey(sk) { return sk.group ? sk.group + ':' + sk.id : sk.id; }

  function skillCost(actor, sk) {
    const cut = sk.group ? actor.extraMs[sk.group - 1].effects.boost.skillCostCut : actor.skillCostCut;
    /* 七标的「主动招式附加 +1」已经在 buildAlly 折进 sk.cost（见 skillList），
       这里不再重复加：界面、日志、结算必须是同一个数。 */
    /* 虚室生白：每门浅层蚀刻法把全招式消耗压低 1 点（最低 1） */
    return Math.max(1, (sk.cost || 0) - (cut || 0) - ((actor.innateMods && actor.innateMods.costCut) || 0));
  }

  function readySkill(b, actor) {
    const count = 1 + (actor.extraMs || []).length;
    for (let offset = 0; offset < count; offset++) {
      const group = ((actor.nextGroup || 0) + offset) % count;
      const ms = group ? actor.extraMs[group - 1] : actor.ms;
      const attacks = group ? ms.atkSinceSkill : actor.atkSinceSkill;
      /* 招式顺序按数据里写的来——不要在这里重排。
         数据里「谁排第一」本身就是权限：双流把「右流」放在首位，是因为有人受伤时该先治；
         按槽位重排会把这条意图推翻（实测旧档双流会去打左流而不是救人）。
         第 2/3 招出场率靠**消耗**调，不靠插队——见 data.js 的 AXIS_SKILLS / PRESSURE_SKILLS。 */
      for (const sk of actor.skillList || []) {
        if ((sk.group || 0) !== group || actor.cds?.[cooldownKey(sk)] > 0) continue;
        if ((actor.energy || 0) < skillCost(actor, sk)) continue;
        /* 目标要先定下来：targetHasDot 这类条件看的是「这一下打在谁身上」 */
        const target = pickTarget(b, actor, sk.target);
        if (!target) continue;
        if (!condOk(b, actor, sk.cond, ms, attacks || 0, target)) continue;
        if (!(sk.effect?.heal && target.hp >= target.maxHp)) return sk;
      }
    }
    return null;
  }

  function startCast(b, actor, sk) {
    actor.stats.skills = (actor.stats.skills || 0) + 1;
    actor.casting = sk.id;
    /* 曲径通幽：曲折纹路越多，引导越短（最低 40%） */
    actor.castTimer = (sk.castTime || 0.6) * ((actor.innateMods && actor.innateMods.castScale) || 1);
    actor.cds = actor.cds || {};
    const siblings = actor.skillList.filter((s) => s.group === sk.group);
    for (const s of siblings.some((s) => s.sharedCooldown) ? siblings : [sk]) {
      actor.cds[cooldownKey(s)] = sk.cooldown || 4;
    }
    actor.energy = Math.max(0, (actor.energy || 0) - skillCost(actor, sk));
    /* 「普通攻击 N 次后」这个条件数的是普攻次数，不该被同一门的追打清零。
       以前每门只有 1 招，谁清零都无所谓；现在有第 2/3 招，
       追打一放就把计数重置，主招永远攒不满——实测煤层主招掉到 0.22 次/场。
       所以只有第 1 招（这门的主招）出手时才清零。 */
    if (sk.group) actor.extraMs[sk.group - 1].atkSinceSkill = 0;
    else if ((sk.slot || 1) === 1) actor.atkSinceSkill = 0;
    if (actor.extraMs?.length) actor.nextGroup = ((sk.group || 0) + 1) % (actor.extraMs.length + 1);
    actor.pendingSkill = sk;
    log(b, {
      type: 'cast', actorId: actor.id, skillId: sk.id, slot: sk.slot || 1, tag: sk.tag || '',
      strike: !sk.effect?.heal,
      text: `${actor.name} 起手「${sk.name}」`,
    });
    /* 流血：一进入引导就被撕一次。这是「流血」轴对引导大招的唯一制衡，
       也是玩家把流血挂到 boss 身上之后最想看到的反馈 */
    if ((sk.castTime || 0) > 0) {
      rendBleed(b, actor, '起手引导');
      if (actor.hp <= 0) { actor.casting = null; actor.pendingSkill = null; }
    }
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
    const pulse = sk.group ? actor.extraMs[sk.group - 1].pulse : actor.pulse;
    const skillMult = source ? (1 + source.boost.skillMult) * source.mainMult : (actor.skillMult || 1);
    const supportMult = source ? source.supportMult : (actor.supportMult || 1);
    const healMult = source ? (source.boost.healMult || 0) : (actor.healMult || 0);
    const dotMult = source ? (source.boost.dotMult || 0) : (actor.dotMult || 0);
    const shieldMult = source ? (source.boost.shieldMult || 0) : (actor.shieldMult || 0);
    const label = `「${sk.name}」`;
    /* 异常联动：目标身上有指定异常时，这一招的倍率再乘一层 */
    const dotBonus = eff.bonusIfDot && hasDot(tgt, eff.bonusIfDot.k) ? (eff.bonusIfDot.mult || 1) : 1;
    /* ---- 相性收口 ----
       innateSkillMult（四达并存 / 两极共振）装配期就算好了；
       累土递进按回合计、中脊挂刺只给主修，这两个必须现算。 */
    const roundNow = Math.floor((b.tick || 0) / (D().DESIGN.ticksPerRound || 6));
    const terraceMult = actor.innate === 'terrace' ? 1 + Math.min(0.32, roundNow * 0.04) : 1;
    const spineMult = actor.innate === 'spine' && !sk.group ? ((actor.innateMods && actor.innateMods.spineMult) || 1) : 1;
    const innateDmg = ((actor.innateMods && actor.innateMods.skillMult) || 1) * terraceMult * spineMult;
    if (eff.heal) {
      const amount = actor.atk * eff.heal * supportMult * (1 + healMult) * (1 + (b.healBonus || 0)) * terraceMult;
      healUnit(b, actor, tgt, amount);
    } else {
      const foes = alive(actor.side === 'ally' ? b.enemies : b.allies).sort((a, c) => a.slot - c.slot);
      const targets = eff.pierce ? foes.slice(0, eff.pierce) : [tgt];
      let pulses = 0;
      targets.forEach((target) => {
        for (let i = 0; i < (eff.hits || 1) && target.alive !== false; i++) {
          const repeatedPulse = i < pulses;
          pulses = Math.max(pulses, i + 1);
          doBasicAttack(b, actor, target.id, { mult: (eff.mult || 1.4) * skillMult * dotBonus * innateDmg, label, skillId: sk.id,
            pulse, repeatedPulse });
        }
      });
      if (eff.splash) foes.filter((u) => !targets.includes(u)).forEach((target) => {
        doBasicAttack(b, actor, target.id, { mult: (eff.mult || 1.4) * skillMult * dotBonus * eff.splash * innateDmg, label: label + '余波', aoe: true, skillId: sk.id, pulse });
      });
    }
    /* 盾击：把自己身上的护盾折成伤害。护盾轴的攻守转换就靠这一条 */
    if (eff.shieldScale && tgt.alive !== false && (actor.shield || 0) > 0) {
      const extra = Math.max(1, Math.round(actor.shield * eff.shieldScale * innateDmg));
      applyDamage(b, actor, tgt, extra, {});
      log(b, { type: 'hit', actorId: actor.id, targetId: tgt.id, amount: extra, text: `${actor.name} 以盾为刃 ${extra}` });
    }
    if (eff.shield) {
      const gained = addShield(actor, Math.round(actor.maxHp * eff.shield * (1 + shieldMult) * (1 + ((actor.passive && actor.passive.shieldGainMult) || 0))));
      log(b, { type: 'shield', actorId: actor.id, targetId: actor.id, amount: gained, text: `${actor.name} 获得 ${gained} 护盾` });
    }
    /* 挂异常：类型由 eff.dot.k 决定（缺省灼烧，兼容老数据） */
    if (eff.dot && tgt.alive !== false) {
      const kind = eff.dot.k || 'burn';
      addDotStacks(tgt, {
        k: kind,
        v: Math.max(2, Math.round(actor.atk * (eff.dot.dmgMult || 0.2) * (1 + dotMult))),
        hits: eff.dot.hits || 2,
      }, pulse);
      log(b, { type: 'dot', actorId: actor.id, targetId: tgt.id, kind, text: `${tgt.name} 染上${DOT_LABEL[kind] || kind}` });
    }
    /* 引爆：把剩余异常一次倒出来。引爆系数吃被动加成 */
    if (eff.detonateDot && tgt.alive !== false) {
      detonate(b, actor, tgt, eff.detonateDot, { detonateMult: (actor.passive && actor.passive.detonateMult) || 0 });
    }
    /* 冷却互馈：疗愈/辅助招顺带给其他门减冷却，是「一门带三门」的接口 */
    if (eff.cdrOther) {
      const self = cooldownKey(sk);
      Object.keys(actor.cds || {}).forEach((k) => {
        if (k === self) return;
        actor.cds[k] = Math.max(0, actor.cds[k] - eff.cdrOther);
      });
    }
    /* 压力自调：负数减压，正数加压（高压打法要能自己把压力推上去） */
    if (eff.stressDelta) {
      if (eff.stressDelta > 0) addStress(b, actor, eff.stressDelta);
      else actor.stress = Math.max(0, (actor.stress || 0) + eff.stressDelta);
    }
    /* 三隅稳固：每放一次招式，按主修路径的转折数补缓冲（每次转向 4 点，最多 3 次） */
    if (actor.innate === 'corner' && actor.alive !== false) {
      const turns = (actor.pulse && actor.pulse.turns) || 0;
      const got = addShield(actor, 4 * Math.min(3, turns));
      if (got > 0) log(b, { type: 'shield', actorId: actor.id, targetId: actor.id, amount: got, text: `${actor.name} 的回路把转向折成缓冲 +${got}` });
    }
    /* 记住这一下的 tag：连携招式靠它判断「上一次放的是什么」 */
    if (sk.tag) actor.tagMemory = { tag: sk.tag, tick: b.tick };
    /* 连携返还余裕：接续成功不该被余裕卡死 */
    if (sk.cond && sk.cond.afterTag) {
      const refund = (actor.passive && actor.passive.comboCdr) || 0;
      if (refund) actor.energy = Math.min(actor.energyMax, (actor.energy || 0) + refund);
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
      /* 八标：举盾是一次「换一次减伤」的买入，不是一次性状态。
         旧写法挂 {d:1}，回合边界（1.44s）就被 tickBuffs 清掉，而敌方脉动是 2.64s ——
         举盾几乎永远等不到那一击，80% 减伤实际兑现接近 0。
         现在这条 buff 不按时间衰减，只在**真正吃下一击**时消耗（见 applyDamage）。 */
      actor.buffs = (actor.buffs || []).filter((x) => x.k !== 'guard');
      actor.buffs.push({ k: 'guard' });
      actor.lastAction = 'guard';
      log(b, { type: 'guard', actorId: actor.id, text: `${actor.name} 举盾防守` });
      return { res: { dealtDamage: false, action: 'guard' }, action: 'guard' };
    }

    const res = doAutoAttack(b, actor, plan.targetId);
    actor.lastAction = 'attack';
    return { res: { dealtDamage: res.dealtDamage, action: 'attack' }, action: 'attack' };
  }

  /* ------------------------------ 敌方行动 ------------------------------ */

  /** 有限次的招式（`maxUses`）用完了就不该再被选中。
      目前只有炉心俑的「重铸」用它——没有上限的自愈会把残局拖成超时。 */
  function usesLeft(e, sk) {
    if (sk.maxUses == null) return Infinity;
    return sk.maxUses - ((e.skillUses && e.skillUses[sk.id]) || 0);
  }

  function markUse(b, e, sk) {
    if (sk.maxUses == null) return;
    e.skillUses = e.skillUses || {};
    e.skillUses[sk.id] = (e.skillUses[sk.id] || 0) + 1;
    if (e.skillUses[sk.id] >= sk.maxUses) {
      log(b, { type: 'note', actorId: e.id, text: `${e.name} 的「${sk.name}」用尽了` });
    }
  }

  function pickEnemySkill(b, e) {
    const ready = (e.skills || []).filter((s) => (e.cds[s.id] || 0) <= 0 && usesLeft(e, s) > 0);
    if (!ready.length) return null;
    /* 优先大招（预告），其次按定义顺序 */
    const tele = ready.find((s) => s.telegraph);
    if (tele && e.bossPhase >= 1) return tele;
    return ready[0];
  }

  /** 招式的附加效果：先剥盾、抽余裕、上眩光，再算伤害。 */
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
        log(b, { type: 'miss', actorId: e.id, targetId: tgt.id, strike: true, skillId: sk.id, text: `${e.name} 的${sk.name}落空` });
        return;
      }
      const dmg = e.atk * (e.pulseAmp || 1) * sk.mult * (1 - mitigation(tgt.def));
      const r = applyDamage(b, e, tgt, dmg, { aoe: list.length > 1, pierce: !!sk.pierce, strike: true });
      log(b, { type: 'hit', actorId: e.id, targetId: tgt.id, amount: r.dealt, strike: true, skillId: sk.id, defeated: r.died, text: `${e.name} 的${sk.name}命中 ${tgt.name} -${r.dealt}` });
      if (sk.lifesteal && r.dealt > 0) healUnit(b, e, e, r.dealt * sk.lifesteal);
      if (sk.dot && tgt.alive !== false) tgt.buffs.push({ ...sk.dot });
    });
    if (sk.stress) list.forEach((t) => t && t.alive !== false && addStress(b, t, sk.stress));
  }

  /** 敌方招式的选目标规则（模块级：行动与「蓄力到点」两处共用）。 */
  function enemyFoesOf(b, sk) {
    const foes = alive(b.allies).sort((a, c) => a.slot - c.slot);
    if (sk.target === 'allFoe') return foes;
    if (sk.target === 'lowestHpFoe') return foes.slice().sort((a, c) => hpPct(a) - hpPct(c)).slice(0, 1);
    if (sk.target === 'backFoe') return foes.slice(-1);
    return foes.slice(0, 1);
  }

  /**
   * 噬忆者的行动光环：抽前排余裕、剥缓冲、给全队加压力。
   * 九标：**高热反制** —— 压力 ≥50 的单位免疫抽能，并把这次压力转成下一击 +25% 的过载反冲。
   * 这条是「C 克噬忆者」的唯一腿：余烬流本来就要把自己烧到高热区，
   * 而常规续航流（A/B）在第 50 压之前就会被一路抽到停机。
   */
  const HEAT_REFUSE = 50;

  function applyEnemyActionAura(b, e) {
    const cfg = e.onAction || {};
    const foes = alive(b.allies).sort((a, c) => a.slot - c.slot);
    const fronts = cfg.drainTarget === 'front2' ? foes.slice(0, 2) : foes.slice(0, 1);
    if (cfg.drainEnergy) {
      fronts.forEach((front) => {
        /* 九标：高热免抽 —— 余烬流派把「被抽」变成「被充能」 */
        if ((front.stress || 0) >= HEAT_REFUSE) {
          front.heatRebound = Math.max(front.heatRebound || 0, 0.25);
          log(b, {
            type: 'blocked', actorId: e.id, targetId: front.id,
            text: `${e.name} 的${cfg.name || '抽忆'}抽不动 ${front.name}：高热回路把抽能烧成了反冲`,
          });
          return;
        }
        const drained = Math.min(front.energy || 0, cfg.drainEnergy);
        front.energy = Math.max(0, (front.energy || 0) - cfg.drainEnergy);
        /* 抽走的不只是余裕，还有「回上来的能力」——1s 内回裕只剩 40%。
           否则 3 点余裕只要 4 tick 就自然回满，抽忆等于没抽。 */
        front.energyLock = Math.max(front.energyLock || 0, 1.0);
        log(b, {
          type: 'disrupt', actorId: e.id, targetId: front.id, amount: Math.round(drained * 100) / 100,
          text: `${e.name} 的${cfg.name || '抽忆'}抽走 ${front.name} ${cfg.drainEnergy} 点余裕，回路一时缓不过来`,
        });
      });
    }
    /* 八标：噬忆者顺手剥掉前排身上的缓冲。
       储能流的整套引擎都建在「护盾 → 满溢放电」上（满仓一发 ×1.85），
       剥盾是唯一只打 B 不打 A/C 的开关 —— A 与 C 的 shieldCap 本来就是 0。 */
    /* 剥缓冲：固定 8 点，不再整条剥光（九标下调，给储能流留活路） */
    if (cfg.stripShield) {
      const n = typeof cfg.stripShield === 'number' ? cfg.stripShield : 8;
      alive(b.allies).forEach((a) => {
        if (!(a.shield > 0)) return;
        const lost = Math.min(a.shield, n);
        a.shield = Math.max(0, a.shield - n);
        log(b, { type: 'strip', actorId: e.id, targetId: a.id, amount: lost,
          text: `${e.name} 的${cfg.name || '抽忆'}化掉 ${a.name} ${lost} 点缓冲` });
      });
    }
    if (cfg.stressAll) {
      alive(b.allies).forEach((a) => addStress(b, a, cfg.stressAll));
    }
  }

  /**
   * 蓄力到点：把一个带 castTime 的敌方招式真正打出去。
   * 和「预告型大招」不同 —— 那一种是「下一次行动才打」，这个是**按秒**计的准备窗口，
   * 中途挨到重击就会被 applyDamage 打断。
   */
  function resolveEnemyCharge(b, e) {
    const sk = e.charging;
    if (!sk) return false;
    e.charging = null;
    e.chargeTimer = 0;
    e.intent = null;
    markUse(b, e, sk);
    enemySkillSupport(b, e, sk);
    const list = enemyFoesOf(b, sk);
    e.cds[sk.id] = (sk.cd || 0) + 1;
    if (!list.length) return false;
    enemySkillStrike(b, e, sk, list);
    log(b, { type: 'cast', actorId: e.id, skillId: sk.id, text: `${e.name} 的${sk.name}落了下来` });
    return true;
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
      if (got > 0) log(b, { type: 'shield', actorId: e.id, targetId: e.id, amount: got, text: `${e.name} 结起 ${got} 点硬壳` });
    }
  }

  function enemyTurn(b, e) {
    /* actionCount 由 beginAction 统一递增；这里不能再加一次，否则扰位节奏会翻倍 */

    /* 七标 · 噬忆者的行动光环：每次行动抽前排 2 人各 3 点余裕、全家 +10 压力。
       放在所有分支之前 —— 预告、辅助、普攻都算「一次行动」，
       否则它一放预告就白赚一回合。 */
    if (e.onAction) applyEnemyActionAura(b, e);

    /* 扰位石傀：每第 N 次行动把我方最后一名存活单位推到最前 */
    if (e.disrupt && e.actionCount % e.disrupt.everyActions === 0) {
      const mates = alive(b.allies).sort((a, c) => a.slot - c.slot);
      const last = mates[mates.length - 1];
      if (last) {
        const r = V.Positions.insertFront(b.allies, last.id);
        if (r.ok && r.event) {
          V.Positions.applyFormation(b, 'allies', r.units);
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

    if (!inActionRange(b, e)) return 'waiting';
    const foesOf = (sk) => enemyFoesOf(b, sk);

    /* 预告中的招式：这次真的打出去（带 castTime 的已经由计时器结算，走不到这里） */
    if (e.charging) {
      const sk = e.charging;
      e.charging = null;
      e.chargeTimer = null;
      e.intent = null;
      markUse(b, e, sk);
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
          log(b, { type: 'miss', actorId: e.id, targetId: tgt.id, strike: true, text: `${e.name} 落空` });
          return 'basic';
        }
        const dmg = e.atk * (e.pulseAmp || 1) * 1.0 * (1 - mitigation(tgt.def));
        const r = applyDamage(b, e, tgt, dmg, { strike: true });
        log(b, { type: 'hit', actorId: e.id, targetId: tgt.id, amount: r.dealt, strike: true, defeated: r.died, text: `${e.name} 攻击 ${tgt.name} -${r.dealt}` });
      }
      return 'basic';
    }

    /* 预告型大招：这次只宣告 */
    if (sk.telegraph) {
      e.charging = sk;
      /* castTime 存在时，准备窗口按秒走（3 tick = 0.72s），期间挨重击会被打断；
         没有 castTime 的老招式仍然是「下一次行动才落下」。 */
      e.chargeTimer = sk.castTime || null;
      e.intent = { skillId: sk.id, name: sk.name, target: sk.target };
      log(b, {
        type: 'telegraph', actorId: e.id, strike: sk.mult > 0,
        text: sk.castTime
          ? `${e.name} 正在准备：${sk.name}（${sk.castTime.toFixed(2)}s）`
          : `${e.name} 正在引导：${sk.name}`,
      });
      return 'telegraph';
    }

    e.cds[sk.id] = (sk.cd || 0) + 1;
    markUse(b, e, sk);
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
    /* 枯竭停机：能量见底太久，单位直接退出战斗。
       放在胜负判定之前——先让停摆的人下场，再数谁还站着。 */
    b.allies.forEach((u) => {
      if (u.alive === false) return;
      /* 8 tick = 1.92s：0.55/s 的回裕从 0 恢复到 1 点要 7.6 tick，门槛必须略低于它。
         七标：7 → 6 tick（1.44s，刚好一个完整回合）。7 tick 时自然空转刚好差半个 tick
         够不到，枯竭停机实际上只有「被抽余裕」一条触发路径；6 tick 让「连续一个回合
         都缓不过来」成为判据，同时留出 0.48s 的抢救余量。 */
      if ((u.starveTicks || 0) >= 6) {
        u.alive = false;
        u.hp = 0;
        log(b, { type: 'death', targetId: u.id, text: `${u.name} 枯竭停机——回路整个回合都没缓过来` });
      }
    });
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

  function aimTarget(b, actor, singleTarget = false) {
    if (actor.side === 'ally') {
      const skill = actor.pendingSkill || readySkill(b, actor);
      if (skill) return skill.effect?.heal ? null : pickTarget(b, actor, skill.target);
      const plan = gambitPlan(b, actor);
      return plan.action === 'guard' ? null : byId(b.enemies, plan.targetId);
    }
    const skill = actor.charging || pickEnemySkill(b, actor);
    if (skill && !(skill.mult > 0)) return null;
    if (skill && skill.target !== 'allFoe') return enemyFoesOf(b, skill)[0] || null;
    return skill ? (singleTarget ? null : V.Positions.nearestFoe(b, actor)) : frontOf(b.allies);
  }

  function inActionRange(b, actor) {
    return V.Positions.inReach(b, actor, aimTarget(b, actor, true));
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
      /* 相位护膜每回合补满：层数/回合是「频次检验」的计价单位 ——
         打不到那么多次的阵容，永远有一半脉冲是撞在膜上的。 */
      b.enemies.forEach((e) => {
        /* 九标：护膜不再每回合补满，只补 2 层（上限仍是 layers）。
           补满 5 层等于「只要还活着就永远有膜」，高频流剥层的努力全被抹掉。 */
        if (e.alive !== false && e.membrane) {
          const regrow = e.membrane.regrow == null ? 2 : e.membrane.regrow;
          const before = e.membrane.left || 0;
          e.membrane.left = Math.min(e.membrane.layers, before + regrow);
          if (e.membrane.left > before) log(b, { type: 'shield', effect: 'shield', targetId: e.id,
            text: e.name + ' 的相位护膜重新展开' });
        }
      });
      /* 八标 · 首领软狂暴时钟：第 10 回合之后每回合 +12% 脉冲幅值、+1 速度。
         没有这条时钟，劣势流派可以把首领「磨」到 27 回合还赢 ——
         那不是战术，是拖时间。时钟一开，残局必须用伤害解决，不能靠耐性解决。 */
      /* 精英也有自己的小表：精英场只有 3 个单位、整场挥 6~8 下，
         总伤害约为队伍 EHP 的 15% —— 结构上不可能减员，赢只是时间问题。
         第 6 回合起让精英也开始熵增，残局才会真的变成残局。 */
      b.enemies.forEach((e) => {
        if (e.alive === false) return;
        const from = e.isBoss ? 10 : (e.isElite ? 6 : Infinity);
        if (b.round <= from) return;
        e.pulseAmp = Math.round(((e.pulseAmp || 1) * 1.12) * 100) / 100;
        e.spd = (e.spd || 1) + 1;
        if (!e._entropyLogged) {
          e._entropyLogged = true;
          log(b, { type: 'note', targetId: e.id, text: `${e.name} 开始熵增：脉冲越来越重` });
        }
      });
      tickBuffs(b);
      if (endCheck(b)) return ST().ok(next, [{ type: 'round', meta: { round: b.round } }, { type: 'over' }]);
    }

    V.Positions.advanceField(b, u => aimTarget(b, u, V.Positions.style(u).mode === 'ranged'));

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
      if (u.energyLock > 0) u.energyLock = Math.max(0, u.energyLock - dt);
      u.energy = Math.min(emax, (u.energy || 0) + energyRegen(u) * dt);
      /* 枯竭停机：**非施法状态**下连续 6 tick（1.44s，一个完整回合）回不到 1 点余裕，回路停摆。
         施法中不计数 —— 引导本身就在烧余裕，把引导算进去会让「读条」变成自杀。 */
      /* 只对我方生效：敌方是「核心节点」，没有余裕预算这回事 ——
         把它们也算进来，所有敌人都会在第 8 tick 集体停机，战斗直接变成 1 回合。 */
      if (u.side === 'ally' && !u.casting && u.energy < 1) u.starveTicks = (u.starveTicks || 0) + 1;
      else u.starveTicks = 0;

      /* 敌方的按秒准备窗口：到点就结算，中途打断由 applyDamage 负责 */
      if (u.charging && u.chargeTimer != null) {
        u.chargeTimer = Math.max(0, u.chargeTimer - dt);
        if (u.chargeTimer === 0 && inActionRange(b, u)) resolveEnemyCharge(b, u);
      }

      const ratio = dt * ((effSpd(u) || baseSpd) / baseSpd);
      if (u.casting) {
        u.castTimer = Math.max(0, u.castTimer - dt);
        if (u.castTimer === 0 && (!u.pendingSkill || inActionRange(b, u))) finishCast(b, u);
      } else {
        u.atkTimer = (u.atkTimer || 0) + ratio;
      }
      /* 持续伤害挂在「自己一动」的节拍上：施法、引导都不暂停 */
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
      if (actDue || dotDue) due.push({ u, act: actDue, dot: dotDue });
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
      if (!pending.dot && !inActionRange(b, actor)) {
        actor.atkTimer = pulseInterval(actor);
        continue;
      }

      /* 出手前：中毒 / 灼烧 / 流血先跳；死在毒上，这一拍到此为止 */
      if (!resolveDots(b, actor, 'pre')) {
        if (endCheck(b)) break;
        continue;
      }

      const canAct = pending.act && inActionRange(b, actor);
      if (pending.act && !canAct) actor.atkTimer = pulseInterval(actor);
      if (canAct) {
        beginAction(b, actor);

        let rootAction;
        if (actor.side === 'ally') {
          const r = allyTurn(b, actor);
          /* 起手招式没有立即伤害，但换位/援护仍按一次出手结算 */
          rootAction = {
            actorId: actor.id, side: 'ally',
            action: r.action === 'cast' ? 'attack' : r.action,
            dealtDamage: !!r.res.dealtDamage,
          };
        } else {
          const action = enemyTurn(b, actor);
          if (action === 'waiting') actor.atkTimer = pulseInterval(actor);
          rootAction = { actorId: actor.id, side: 'enemy', action, dealtDamage: action === 'main' || action === 'basic' };
        }

        /* 出手后：腐蚀等「行动之后才发作」的伤害在这里结算，同样先判死 */
        resolveDots(b, actor, 'post');

        /* 根行动 → 伤害/死亡 → 主动换位 → 援护 */
        const pos = V.Positions.resolveAfterAction(b, rootAction);
        V.Positions.applyFormation(b, 'allies', pos.battle.allies);
        V.Positions.applyFormation(b, 'enemies', pos.battle.enemies);
        for (const ev of pos.events) {
          events.push(ev);
          if (ev.type === 'move') applyMove(b, ev);
        }
      } else {
        /* 这一拍没有出手（施法/引导中），腐蚀在拍末照样发作 */
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
      /* 满压临界的结果要报给界面：裂了的人得让玩家一眼看见，不然只是数字悄悄变差 */
      cracked: !!u.cracked,
      polishMult: u.polishMult == null ? 1 : u.polishMult,
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
    generateEncounter, create, step, report, prepareResult, setTactic, aimTarget,
    TICK_LIMIT, pressureRegenMultiplier, pressureDamageMultiplier, energyRegen, heatConducting,
    resolveConfig,
    _internal: {
      applyDamage, healUnit, checkBossPhase, buildAlly, buildEnemy,
      mitigation, addShield, rngValue, log, addStress, rollResolve,
      /* 异常与连携：测试要能直接驱动这四种结算，不必等战斗跑到那一步 */
      doBasicAttack, detonate, rendBleed, poisonOnHit, tickDot,
      dotsOf, hasDot, effectiveDef, corrodeDefMult,
      condOk, readySkill, startCast, finishCast, pickTarget, applyMove, innatePulseOf, fuseNode,
      /* 七标：三位关底首领的对位法则要能被单测直接驱动 */
      applyEnemyActionAura, enemyTurn,
    },
  };
})(globalThis.Ashen ||= {});
