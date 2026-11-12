'use strict';
/* 四位线性身位：slot0 最靠近敌方。swap / insertFront / anchored 与三种主手 mod。
   位置变化本身不再触发位置变化；不赠送行动；不改 gauge。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});
  const D = () => V.Data;

  function cloneUnits(units) { return units.map((u) => ({ ...u })); }

  function byId(units, id) { return units.find((u) => u.id === id) || null; }
  function bySlot(units, slot) { return units.find((u) => u.slot === slot) || null; }
  function aliveOf(units) { return units.filter((u) => u.alive !== false); }

  function hpPct(u) {
    if (!u || !u.maxHp) return 1;
    return Math.max(0, Math.min(1, u.hp / u.maxHp));
  }

  /** 同一时刻必须仍是 4 槽内互不重复；返回错误原因或 null。 */
  function slotProblem(units) {
    const seen = new Set();
    for (const u of units) {
      if (!Number.isInteger(u.slot) || u.slot < 0 || u.slot > 3) return `槽位越界：${u.id}=${u.slot}`;
      if (seen.has(u.slot)) return `槽位重复：${u.slot}`;
      seen.add(u.slot);
    }
    return null;
  }

  /** 交换两个单位的位置。空位保留（只交换 slot 值）。 */
  function swap(units, aId, bId) {
    if (aId === bId) return { ok: false, reason: '不能和自己交换' };
    const a = byId(units, aId);
    const b = byId(units, bId);
    if (!a || !b) return { ok: false, reason: '交换目标不存在' };
    if (a.anchored) return { ok: false, reason: `${a.name || a.id} 被钉住，不能参与交换` };
    if (b.anchored) return { ok: false, reason: `${b.name || b.id} 被钉住，不能参与交换` };

    const next = cloneUnits(units);
    const na = byId(next, aId);
    const nb = byId(next, bId);
    const tmp = na.slot;
    na.slot = nb.slot;
    nb.slot = tmp;
    const problem = slotProblem(next);
    if (problem) return { ok: false, reason: problem };

    return {
      ok: true,
      units: next,
      event: {
        type: 'swap', actorId: aId, targetId: bId,
        meta: { from: tmp, to: na.slot },
      },
    };
  }

  /** 自身插到 slot0，原 0..i-1 依次后移；不是只交换 0 和 i。 */
  function insertFront(units, unitId) {
    const u = byId(units, unitId);
    if (!u) return { ok: false, reason: '单位不存在' };
    if (u.anchored) return { ok: false, reason: `${u.name || u.id} 被钉住，不能前插` };
    const from = u.slot;
    if (from === 0) return { ok: true, units: cloneUnits(units), event: null };

    const shifting = units.filter((x) => x.slot < from);
    const anchored = shifting.find((x) => x.anchored);
    if (anchored) {
      return { ok: false, reason: `${anchored.name || anchored.id} 被钉住，挡住前插` };
    }

    const next = cloneUnits(units);
    const moved = [];
    next.forEach((x) => {
      if (x.id === unitId) {
        x.slot = 0;
        moved.push(x.id);
      } else if (x.slot < from) {
        x.slot += 1;
        moved.push(x.id);
      }
    });
    const problem = slotProblem(next);
    if (problem) return { ok: false, reason: problem };

    return {
      ok: true,
      units: next,
      event: {
        type: 'insertFront', actorId: unitId,
        meta: { from, to: 0, shifted: shiftedIds(units, from) },
      },
    };
  }

  function shiftedIds(units, beforeSlot) {
    return units.filter((x) => x.slot < beforeSlot).map((x) => x.id);
  }

  // 旧档中的拓片尚无阵形动作字段，按谱号从现行谱目补取。
  function hasMove(actor, id) {
    return actor.modId === id || [actor.ms, ...(actor.extraMs || [])].some(ms =>
      ms?.spec && (ms.spec.modId === id || D().manuscript(ms.spec.id)?.modId === id));
  }

  /* ------------------------------ 阵形动作 ------------------------------ */

  /** 一次根行动结束后：主动换位 → 援护检查。返回新战斗对象与事件。 */
  function resolveAfterAction(battle, rootAction) {
    const events = [];
    if (!battle || !rootAction) return { battle, events };

    const round = battle.round || 0;
    let allies = cloneUnits(battle.allies || []);
    let enemies = cloneUnits(battle.enemies || []);

    /* ① 主动换位：只处理我方，且要求这次根行动完成了主手伤害 */
    const actorId = rootAction.actorId;
    const actor = byId(allies, actorId);
    const dealt = rootAction.action === 'attack' || rootAction.action === 'main';
    if (actor && rootAction.side !== 'enemy' && dealt && rootAction.dealtDamage) {
      if (hasMove(actor, 'shadowAdvance') && actor.slot >= 2) {
        if (actor.movementUsedRound !== round) {
          const r = insertFront(allies, actorId);
          if (r.ok && r.event) {
            allies = r.units;
            const me = byId(allies, actorId);
            me.movementUsedRound = round;
            events.push({ type: 'move', actorId, meta: { kind: 'shadowAdvance', ...r.event.meta } });
          } else if (!r.ok) {
            events.push({ type: 'moveBlocked', actorId, meta: { kind: 'shadowAdvance', reason: r.reason } });
          }
        }
      }

      if (hasMove(actor, 'refractRetreat') && actor.slot === 0 && actor.movementUsedRound !== round) {
        const behind = bySlot(allies, 1);
        if (behind && behind.alive !== false) {
          const r = swap(allies, actorId, behind.id);
          if (r.ok) {
            allies = r.units;
            const me = byId(allies, actorId);
            me.movementUsedRound = round;
            me.refract = 1;
            events.push({ type: 'move', actorId, targetId: behind.id, meta: { kind: 'refractRetreat', from: 0, to: 1 } });
            events.push({ type: 'refract', actorId, meta: { charges: me.refract } });
          }
        }
      }
    }

    /* ② 援护：敌方一次行动（含多段）全部结束后，紧邻前方友军残血则前插 */
    if (rootAction.side === 'enemy' && rootAction.dealtDamage) {
      const candidates = allies
        .filter((u) => u.alive !== false && hasMove(u, 'ironCover') && u.coverUsedRound !== round)
        .sort((a, b) => a.slot - b.slot || String(a.id).localeCompare(String(b.id)));

      for (const guard of candidates) {
        const front = bySlot(allies, guard.slot - 1);
        if (guard.slot === 0) continue;
        if (!front || front.alive === false) continue;
        if (hpPct(front) >= 0.3) continue;

        const r = swap(allies, guard.id, front.id);
        if (!r.ok) {
          events.push({ type: 'moveBlocked', actorId: guard.id, meta: { kind: 'ironCover', reason: r.reason } });
          continue;
        }
        allies = r.units;
        const me = byId(allies, guard.id);
        const hurt = byId(allies, front.id);
        me.coverUsedRound = round;

        /* 转移灼烧/流血 */
        const transfer = (hurt.buffs || []).filter((b) => b.k === 'burn' || b.k === 'bleed');
        if (transfer.length) {
          hurt.buffs = hurt.buffs.filter((b) => !(b.k === 'burn' || b.k === 'bleed'));
          me.buffs = (me.buffs || []).concat(transfer.map((b) => ({ ...b })));
          events.push({ type: 'statusTransfer', actorId: guard.id, targetId: front.id, meta: { kinds: transfer.map((b) => b.k) } });
        }

        events.push({ type: 'move', actorId: guard.id, targetId: front.id, meta: { kind: 'ironCover', from: guard.slot, to: r.event.meta.to } });
        break; /* 一次根行动最多一个援护 */
      }
    }

    const nextBattle = { ...battle, allies, enemies };
    return { battle: nextBattle, events };
  }

  /** 给 UI 用的短日志文本。 */
  function describe(ev) {
    const kind = ev.meta && ev.meta.kind;
    const map = {
      shadowAdvance: '影进：插到最前',
      refractRetreat: '折光：与后排互换',
      ironCover: '铁壁援护：替残血同伴接阵',
      swap: '交换位置',
      insertFront: '前插',
    };
    return map[kind] || map[ev.type] || '位置变化';
  }

  V.Positions = {
    swap, insertFront, resolveAfterAction, describe,
    byId, bySlot, aliveOf, hpPct, slotProblem,
  };
})(globalThis.Ashen ||= {});
