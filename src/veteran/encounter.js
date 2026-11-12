'use strict';
/* 遭遇检查点与回转：敌人、初始 RNG、完整快照只生成一次；
   重试无限次且确定性；确认只提交一次；撤退有明确代价。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;
  const ST = () => V.State;
  const C = () => V.Combat;

  /** 从当前状态造一份纯数据快照，并把 encounter/battle 摘掉（避免自嵌套）。 */
  function makeCheckpoint(st, nodeId) {
    const cp = ST().clone(st);
    if (cp.run) {
      cp.run.battle = null;
      cp.run.encounter = null;
      cp.run.stage = 'prebattle';
      cp.run.lockedNodeId = nodeId;
      cp.run.pendingLoot = [];
    }
    return cp;
  }

  function formationFrom(st) {
    const party = (st.run.party || []).slice().sort((a, b) => a.slot - b.slot);
    const out = [null, null, null, null];
    party.forEach((p) => { if (p.slot >= 0 && p.slot < 4) out[p.slot] = p.uid; });
    return out;
  }

  function rulesFrom(st, formation) {
    const rules = {};
    formation.forEach((uid) => {
      if (!uid) return;
      const u = st.roster.find((x) => x.id === uid);
      if (u) rules[uid] = u.gambits.map((r) => ({ ...r, conditions: r.conditions.map((c) => ({ ...c })) }));
    });
    return rules;
  }

  /**
   * open(st, nodeId)：只在第一次生成敌人/RNG/检查点；重复调用返回同一遭遇。
   */
  function open(st, nodeId) {
    if (!st.run) return ST().fail(st, 'no_run', '还没有远征');
    const node = (st.run.nodes || []).find((n) => n.id === nodeId);
    if (!node) return ST().fail(st, 'no_node', '找不到这个节点');

    /* 幂等：同一个已锁定节点不重新生成 */
    if (st.run.encounter && st.run.lockedNodeId === nodeId) {
      const next = ST().clone(st);
      next.run.activeNodeId = nodeId;
      if (next.run.stage === 'map') next.run.stage = 'prebattle';
      return ST().ok(next, [{ type: 'encounterReused', meta: { encounterId: next.run.encounter.id } }]);
    }
    if (st.run.lockedNodeId && st.run.lockedNodeId !== nodeId) {
      return ST().fail(st, 'node_locked', '这次远征已经锁定了别的遭遇，不能换节点');
    }

    const kind = node.type === 'boss' ? 'boss' : node.type === 'elite' ? 'elite' : 'normal';
    const gen = C().generateEncounter(st, kind);

    const next = ST().clone(gen.state);
    next.run.lockedNodeId = nodeId;
    /* 遭遇本身就代表“进入这个节点”，finishNode 靠它标记完成 */
    next.run.activeNodeId = nodeId;
    next.run.stage = 'prebattle';
    next.run.encounter = {
      id: 'enc_' + nodeId + '_' + next.nextId,
      nodeId,
      kind,
      enemyBlueprint: gen.enemyBlueprint,
      combatRngStart: gen.combatRngStart,
      checkpoint: makeCheckpoint(next, nodeId),
      preparation: {
        formation: formationFrom(next),
        rules: rulesFrom(next, formationFrom(next)),
      },
      attemptNumber: 0,
      confirmId: null,
      pendingResult: null,
    };
    next.nextId += 1;

    return ST().ok(next, [{ type: 'encounterOpen', meta: { encounterId: next.run.encounter.id, kind } }]);
  }

  /**
   * editPreparation(st, patch)：只允许改四人的排列和合法 Gambit。
   * patch = {formation?: (id|null)[], rules?: Record<uid, Rule[]>}
   */
  function editPreparation(st, patch) {
    const enc = st.run && st.run.encounter;
    if (!enc) return ST().fail(st, 'no_encounter', '没有锁定遭遇');
    if (enc.pendingResult) return ST().fail(st, 'already_resolved', '已经出结果，不能再改整备');

    const next = ST().clone(st);
    const e = next.run.encounter;
    const errors = [];

    if (patch && patch.formation) {
      const f = patch.formation;
      if (!Array.isArray(f) || f.length !== 4) errors.push('阵型必须是 4 个槽位');
      else {
        const seen = new Set();
        f.forEach((uid, i) => {
          if (uid == null) return;
          if (!next.roster.some((u) => u.id === uid)) errors.push(`槽位 ${i + 1} 指向不存在的角色`);
          if (seen.has(uid)) errors.push(`角色 ${uid} 出现在多个槽位`);
          seen.add(uid);
        });
      }
    }

    if (patch && patch.rules) {
      Object.entries(patch.rules).forEach(([uid, rules]) => {
        const u = next.roster.find((x) => x.id === uid);
        if (!u) { errors.push(`规则指向不存在的角色 ${uid}`); return; }
        const v = V.Tactics.validate(rules, u.logicSlots);
        if (!v.ok) v.errors.forEach((m) => errors.push(`${u.name}：${m}`));
      });
    }

    if (errors.length) return ST().fail(st, 'bad_preparation', errors.join('；'), { details: errors });

    if (patch.formation) {
      e.preparation.formation = patch.formation.slice();
      /* 阵型应用到 party：slot 决定顺序，uid 不变 */
      next.run.party = patch.formation
        .map((uid, slot) => {
          if (!uid) return null;
          const prev = next.run.party.find((p) => p.uid === uid);
          return prev ? { ...prev, slot } : { uid, slot, hp: null, stress: 0 };
        })
        .filter(Boolean);
    }

    if (patch.rules) {
      Object.assign(e.preparation.rules, ST().clone(patch.rules));
      Object.entries(patch.rules).forEach(([uid, rules]) => {
        const u = next.roster.find((x) => x.id === uid);
        if (u) u.gambits = ST().clone(rules);
      });
    }

    return ST().ok(next, [{ type: 'preparationEdited' }]);
  }

  /** startAttempt：从检查点建战斗，绝不重新生成敌人。 */
  function startAttempt(st) {
    const enc = st.run && st.run.encounter;
    if (!enc) return ST().fail(st, 'no_encounter', '没有锁定遭遇');
    if (enc.pendingResult) return ST().fail(st, 'already_resolved', '已经出结果，先确认或重试');

    let base = st;
    /* 已经打过：从检查点重来（保留整备），而不是在残留战场上继续 */
    if (st.run.stage !== 'prebattle' || st.run.battle) {
      const rw = rewind(st);
      if (!rw.ok) return rw;
      base = rw.state;
    }

    const next = ST().clone(base);
    const e = next.run.encounter;
    e.attemptNumber += 1;
    if (next.stats) next.stats.retries = Math.max(0, (next.stats.retries || 0) + (e.attemptNumber > 1 ? 1 : 0));

    const cr = C().create(next, e.enemyBlueprint, e.combatRngStart);
    if (!cr.ok) return cr;
    const out = cr.state;
    out.run.stage = 'battle';
    return ST().ok(out, [{ type: 'attemptStart', meta: { attempt: e.attemptNumber } }]);
  }

  /** rewind：完整回到检查点，保留上次整备供修改。 */
  function rewind(st) {
    const enc = st.run && st.run.encounter;
    if (!enc) return ST().fail(st, 'no_encounter', '没有锁定遭遇');
    if (enc.confirmId) return ST().fail(st, 'already_confirmed', '已经确认，不能再回转');

    const restored = ST().clone(enc.checkpoint);
    const keepEncounter = ST().clone(enc);
    keepEncounter.pendingResult = null;
    keepEncounter.checkpoint = ST().clone(enc.checkpoint);

    restored.run.encounter = keepEncounter;
    restored.run.battle = null;
    restored.run.stage = 'prebattle';

    /* 阵型按整备应用 */
    const formation = keepEncounter.preparation.formation;
    restored.run.party = formation
      .map((uid, slot) => {
        if (!uid) return null;
        const prev = restored.run.party.find((p) => p.uid === uid);
        return prev ? { ...prev, slot } : { uid, slot, hp: null, stress: 0 };
      })
      .filter(Boolean);

    return ST().ok(restored, [{ type: 'rewind', meta: { attempt: keepEncounter.attemptNumber } }]);
  }

  /**
   * confirm：只对胜利结果提交。写入 runDelta + rewardSpec，进入 loot。
   * 重复调用返回同一状态且不重复发奖。
   */
  function confirm(st) {
    const enc = st.run && st.run.encounter;
    if (!enc) return ST().fail(st, 'no_encounter', '没有锁定遭遇');
    if (enc.confirmId) {
      return ST().ok(ST().clone(st), [{ type: 'alreadyConfirmed', meta: { confirmId: enc.confirmId } }]);
    }
    const pending = enc.pendingResult;
    if (!pending) return ST().fail(st, 'no_result', '还没有待确认结果');
    if (pending.outcome !== 'win') {
      return ST().fail(st, 'not_win', '败退请用「确认败退」结算');
    }

    const next = ST().clone(st);
    const e = next.run.encounter;
    const res = e.pendingResult;

    /* ① runDelta → run.party 与角色状态 */
    (res.runDelta.party || []).forEach((d) => {
      const p = next.run.party.find((x) => x.uid === d.uid);
      if (p) {
        p.hp = d.hp;
        p.stress = d.stress;
      }
      const u = next.roster.find((x) => x.id === d.uid);
      if (u) {
        u.stress = d.stress;
        if (d.affliction !== undefined) u.affliction = d.affliction;
      }
    });

    /* ② rewardSpec → 真实纹路（此时才分配 ID） */
    const gained = [];

    (res.rewardSpec.drops || []).forEach((drop) => {
      const part = ST().makePart(next, {
        kind: drop.kind === 'weapon' ? 'weapon' : 'circuit',
        templateId: drop.templateId,
        weaponId: drop.kind === 'weapon' ? drop.templateId : undefined,
        acquiredRunId: next.run.id,
        acquiredSeq: next.run.bag.length + next.run.pendingLoot.length + 1,
      });
      next.itemsById[part.id] = part;
      next.run.pendingLoot.push(part.id);
      gained.push(part.id);
    });

    next.run.goldFound += res.rewardSpec.gold || 0;
    next.run.shards += res.rewardSpec.shards || 0;

    const harvest = (next.run.ingredientLoot ||= {});
    for (const enemy of e.enemyBlueprint.units) {
      const seed = A.Random.seedFrom(`${e.combatRngStart}:${enemy.slot}`);
      V.Kitchen.addYield(harvest, V.Kitchen.harvestOptions(enemy.enemyType), seed);
    }
    if (e.kind === 'elite') V.Expedition.findFieldManuscript(next, 'elite');

    e.confirmId = 'cfm_' + e.id + '_' + e.attemptNumber;
    e.pendingResult = null;
    e.checkpoint = null; /* 确认后彻底删除检查点 */
    next.run.battle = null;
    next.run.stage = 'loot';

    return ST().ok(next, [{
      type: 'confirm',
      meta: { confirmId: e.confirmId, gained, gold: res.rewardSpec.gold },
    }]);
  }

  /** 撤退：紧急保留一半，确认败退全失。都回营，不永久杀人。 */
  function retreat(st, mode) {
    if (mode !== 'emergency' && mode !== 'defeat') {
      return ST().fail(st, 'bad_mode', '未知撤退方式');
    }
    return V.Expedition.retreat(st, mode);
  }

  /** 给 UI 的代价预览（不写 state）。 */
  function previewRetreat(st, mode) {
    return V.Expedition.previewRetreat(st, mode);
  }

  V.Encounter = {
    open, editPreparation, startAttempt, rewind, confirm, retreat, previewRetreat,
    makeCheckpoint, formationFrom, rulesFrom,
  };
})(globalThis.Ashen ||= {});
