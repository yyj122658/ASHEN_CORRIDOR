'use strict';
/* 战场显示：画布、脚底锚点、位置插值、逐帧动画复用、飘字粒子特效与质感降级绘制。
   只消费事件与状态，不回写任何领域数据。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const { width: CW, height: CH, ground: GROUND } = V.Positions.ARENA;
  const SCALE = 3;
  const CELL = 43;
  let effectTime = 0;

  let canvas = null;
  let ctx = null;
  let lastTs = 0;
  const bgId = 'scene.battle.angled';
  const travelMs = () => V.Data.DESIGN.stepSeconds * 1000;
  const tracks = new Map();
  const aims = new Map();
  let aimedBattle = null;
  let lastLogSeq = 0;

  /* 视觉表现状态（纯视图，不回写 state） */
  const strikeTargets = new Map();
  let hurtMap = new Map();
  let popups = [];              /* { x, y, vy, text, color, big, ttl, max } */
  let particles = [];           /* { kind, x, y, tx, ty, color, ttl, max } */
  let shakeTimer = 0;

  function reset() {
    fusedUnits.clear();
    effectTime = 0;
    lastTs = 0;
    tracks.clear();
    aims.clear();
    aimedBattle = null;
    lastLogSeq = 0;
    strikeTargets.clear();
    hurtMap = new Map();
    popups = [];
    particles = [];
    shakeTimer = 0;
    if (A.SpriteAnim && A.SpriteAnim.reset) A.SpriteAnim.reset();
  }

  function reducedMotion() {
    const st = V.App && V.App.state;
    return !!(st?.settings?.reducedMotion || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  function playSfx(kind) {
    if (V.App && V.App.playSfx) V.App.playSfx(kind);
  }

  /* ---- 2026-11-16：curated 资产的三个入口 ---- */

  /** 单位的静态小图 id：我方 sprite.<skinId>，敌方 enemy.<sprite|enemyType>。 */
  function spriteArtId(u) {
    if (!u || !A.Art) return null;
    if (u.side === 'ally') return u.skinId ? 'sprite.' + u.skinId : null;
    const key = u.enemyType;
    return key && A.Art.getArt('enemy.' + key) ? 'enemy.' + key : null;
  }

  const C = {
    ink: '#1E2230', slate: '#4F5968', steel: '#7A838F', bone: '#D4CABB',
    gold: '#BC9C50', fire: '#EC963F', cyan: '#57A6A7', violet: '#79508F', red: '#A64D4F',
  };
  const pulseColor = u => u?.cracked ? C.violet : u?.stress >= 50 ? C.fire : C.cyan;

  function targetX(u, battle) {
    return battle ? V.Positions.fieldX(battle, u) : V.Positions.homeX(u);
  }

  const footY = u => V.Positions.projectY(tracks.get(u.id)?.y ?? V.Positions.homeY(u));

  function trackAt(u, b) {
    const x = targetX(u, b), y = V.Positions.fieldY(b, u);
    const duration = travelMs();
    const track = { x, y, fromX: x, fromY: y, toX: x, toY: y, elapsed: duration, duration };
    tracks.set(u.id, track);
    return track;
  }

  function advanceTravel(u, b, dt, still) {
    const t = tracks.get(u.id) || trackAt(u, b);
    const x = targetX(u, b), y = V.Positions.fieldY(b, u);
    if (x !== t.toX || y !== t.toY) {
      t.fromX = t.x;
      t.fromY = t.y;
      t.toX = x;
      t.toY = y;
      t.elapsed = 0;
      t.duration = strikeTargets.has(u.id) ? 160 : travelMs();
    }
    const moving = t.elapsed < t.duration && !still;
    t.elapsed = moving ? Math.min(t.duration, t.elapsed + dt) : t.duration;
    const p = t.elapsed / t.duration;
    t.x = t.fromX + (t.toX - t.fromX) * p;
    t.y = t.fromY + (t.toY - t.fromY) * p;
    A.SpriteAnim.run(u, moving && u.alive !== false && Math.hypot(t.toX - t.fromX, t.toY - t.fromY) > 1, still ? Infinity : dt);
  }

  function preloadPreparation(state) {
    const encounter = state.run && state.run.encounter;
    if (!encounter) return;
    const skins = state.roster.filter(u => state.run.party.some(p => p.uid === u.id)).map(u => u.skinId);
    const foes = encounter.enemyBlueprint.units.map(u => u.enemyType);
    A.SpriteAnim.preload([...skins, ...foes]);
    A.Art.preloadArt([bgId, ...skins.map(skin => 'sprite.' + skin), ...foes.map(foe => 'enemy.' + foe)]);
    A.SpriteAnim.preloadEffects();
    A.Art.preloadArt([encounter.kind === 'boss' ? 'scene.boss' : 'scene.corridor']);
  }

  /**
   * mount(state, opts)
   * 界面重建会换掉 <canvas>，所以每次渲染战场都要重新绑定上下文；
   * 位置插值只在进入战场或回转时重置。
   */
  function mount(state, opts) {
    const o = opts || {};
    const el = document.getElementById('cv');
    if (!el) { canvas = null; ctx = null; return; }
    if (canvas !== el) {
      canvas = el;
      ctx = canvas.getContext('2d');
      lastTs = 0;
    }
    if (!ctx) return;
    const b = state && state.run && state.run.battle;
    if (!b) return;
    const units = [...b.allies, ...b.enemies];
    if (o.sync !== false && A.Art) {
      /* scene.corridor 一并预热：它仍是横幅与节点插画用的那张，
         test:battle-art 会等 isReady('scene.corridor') 才继续。 */
      A.Art.preloadArt([bgId, 'scene.corridor']);
      A.Art.preloadArt(units.map(spriteArtId).filter(Boolean));
    }
    units.forEach((u) => {
      if (o.sync !== false || !tracks.has(u.id)) trackAt(u, b);
    });
    if (A.SpriteAnim) {
      A.SpriteAnim.preload(units.map(A.SpriteAnim.charIdFor).filter(Boolean));
      A.SpriteAnim.preloadEffects();
      if (o.sync !== false) A.SpriteAnim.syncFromBattle(b);
    }
    if (o.sync !== false) {
      lastLogSeq = b.logSeq || 0;
      for (const log of b.logs || []) if (log.effect === 'fuse') fusedUnits.add(log.targetId);
      for (const initial of state.run.encounter?.enemyBlueprint?.units || []) {
        const enemy = b.enemies.find(u => u.id === 'e_' + initial.enemyType + '_' + initial.slot);
        if (enemy && (enemy.outerNodes || 0) < (initial.outerNodes || 0)) fusedUnits.add(enemy.id);
      }
    }
  }

  function unitX(u) {
    return tracks.get(u.id)?.x ?? targetX(u);
  }

  function spawnPopup(x, y, text, color, big) {
    if (popups.length > 28) popups.shift();
    const ox = ((popups.length % 3) - 1) * 7;
    const oy = ((popups.length % 2) * -6);
    popups.push({ x: x + ox, y: Math.max(20, y + oy), vy: big ? -0.022 : -0.017, text, color, big: !!big, ttl: big ? 820 : 680, max: big ? 820 : 680 });
  }

  function spawnParticle(kind, x, y, color, tx = x, ty = y, arrive = null, flip = false) {
    if (particles.length > 40) {
      const disposable = particles.findIndex(p => !p.arrive);
      if (disposable !== -1) particles.splice(disposable, 1);
    }
    const beam = tx !== x || ty !== y;
    const duration = arrive ? Math.min(215, Math.max(80, Math.hypot(tx - x, ty - y) * 1.15)) : beam ? 220 : 340;
    particles.push({ kind, x, y, tx, ty, beam, color, ttl: duration, max: duration, arrive, flip });
  }

  const heatSuffix = color => color === C.violet ? 'Crack' : color === C.fire ? 'Hot' : '';

  function spawnPulse(actor, target, rm, color = pulseColor(actor)) {
    const y = footY(target) - (target.isBoss ? 29 : 20);
    if (actor && actor !== target && !rm) {
      const kind = color === C.violet ? 'corrosion' : color === C.fire ? 'overheat' : 'pulse';
      spawnParticle(kind, unitX(actor), footY(actor) - 20, color, unitX(target), y);
    }
    spawnParticle('impact' + heatSuffix(color), unitX(target), y, color);
  }

  function showHit(target, log, rm, actor, syncDeath = false) {
    const crit = log.type === 'crit';
    if (target) {
      const tx = unitX(target);
      if (syncDeath && log.defeated) {
        A.SpriteAnim.play(target, 'death');
        spawnParticle('death', tx, footY(target) - 16, C.slate);
      } else {
        A.SpriteAnim.play(target, 'hurt');
        const dx = actor ? tx - unitX(actor) : target.side === 'ally' ? -1 : 1;
        const dy = actor ? footY(target) - footY(actor) : 0;
        const distance = Math.hypot(dx, dy) || 1;
        hurtMap.set(target.id, { ttl: 155, dx: dx / distance, dy: dy / distance, crit });
      }
      if (log.amount > 0) {
        spawnPopup(tx, footY(target) - 58, `-${log.amount}${crit ? '!' : ''}`, crit ? C.gold : C.bone, crit);
      }
      if (crit && !rm) shakeTimer = 180;
    }
    playSfx(crit ? 'crit' : 'hit');
  }

  function showMiss(target) {
    if (target?.side === 'ally') A.SpriteAnim.play(target, 'dodge');
    if (target) spawnPopup(unitX(target), footY(target) - 56, '闪避', C.steel, false);
  }

  function playWeaponStrike(weapon, actor, target, log, rm) {
    const color = pulseColor(actor);
    const suffix = heatSuffix(color);
    const miss = log.type === 'miss';
    const ranged = V.Positions.style(actor).mode === 'ranged';
    const arrive = () => {
      if (miss) showMiss(target);
      else {
        spawnPulse(null, target, rm, color);
        showHit(target, log, rm, actor, true);
      }
    };
    const started = A.SpriteAnim.strike(actor, released => {
      const x = unitX(actor);
      const tx = unitX(target);
      const ty = footY(target) - (target.isBoss ? 29 : 20);
      const right = Math.abs(tx - x) > 2 ? tx > x : A.SpriteAnim.stateOf(actor.id)?.facingRight ?? actor.side === 'ally';
      const dir = right ? 1 : -1;
      if (released && ranged && !rm) {
        spawnParticle(weapon + suffix, x + dir * 13, footY(actor) - 25, color,
          tx + (miss ? dir * 9 : 0), ty, arrive);
      } else {
        if (released) spawnParticle(weapon + suffix, ranged ? tx : tx - dir * 8,
          ty, color, undefined, undefined, null, dir < 0 && !ranged);
        arrive();
      }
    }, !!log.skillId);
    if (started) strikeTargets.set(actor.id, target);
  }

  function consumeEvents(state) {
    const b = state.run && state.run.battle;
    if (!b) return;
    if ((b.logSeq || 0) === lastLogSeq) return;
    /* 只消费新日志；回转后 logSeq 会变小，直接重置游标 */
    if ((b.logSeq || 0) < lastLogSeq) {
      lastLogSeq = b.logSeq || 0;
      return;
    }
    const fresh = (b.logs || []).filter((l) => (l.seq || 0) > lastLogSeq);
    lastLogSeq = b.logSeq || 0;
    if (!fresh.length) return;

    const byId = new Map([...b.allies, ...b.enemies].map((u) => [u.id, u]));
    const rm = reducedMotion();

    fresh.forEach((l) => {
      const actor = l.actorId ? byId.get(l.actorId) : null;
      const target = l.targetId ? byId.get(l.targetId) : null;
      const weapon = A.SpriteAnim.weaponFor(actor);
      if (l.type === 'cast' && actor?.side === 'ally') {
        A.SpriteAnim.play(actor, l.strike ? 'charge' : 'cast');
      }
      if (weapon && target && l.strike && ['hit', 'crit', 'miss'].includes(l.type)) {
        playWeaponStrike(weapon, actor, target, l, rm);
        return;
      }
      if (l.type === 'move' && A.SpriteAnim) {
        for (const unit of [actor,target]) if (unit?.side === 'ally') A.SpriteAnim.play(unit, 'move');
      }
      if (l.type === 'hit' || l.type === 'crit') {
        if (actor) A.SpriteAnim.play(actor, 'attack');
        if (target) spawnPulse(actor, target, rm);
        showHit(target, l, rm, actor);
      } else if (l.type === 'miss') {
        if (actor) A.SpriteAnim.play(actor, 'attack');
        showMiss(target);
      } else if (l.type === 'blocked') {
        if (target) {
          if (target.side === 'ally' && A.SpriteAnim) A.SpriteAnim.play(target,'guard');
          const tx = unitX(target);
          const kind = l.effect || (target.shield > 0 ? 'shield' : 'impact');
          const color = kind === 'fuse' ? C.red : C.cyan;
          const label = { fuse: '熔断', membrane: '碎膜', bufferBreak: '碎盾' }[kind] || '格挡';
          spawnPopup(tx, footY(target) - 56, label, color, false);
          if (kind === 'fuse') fusedUnits.add(target.id);
          spawnParticle(kind === 'bufferBreak' ? 'membrane' : kind, tx + (kind === 'fuse' ? (target.side === 'ally' ? -10 : 10) : 0),
            footY(target) - (target.isBoss ? 29 : 20), color);
        }
      } else if (l.effect === 'interrupt' && target) {
        spawnParticle('interrupt', unitX(target), footY(target) - 28, C.gold);
        spawnPopup(unitX(target), footY(target) - 61, '打断', C.gold, true);
        if (!rm) shakeTimer = 160;
      } else if (l.type === 'death' && target) {
        if (weapon && l.strike) return;
        if (A.SpriteAnim) A.SpriteAnim.play(target, 'death');
        spawnParticle('death', unitX(target), footY(target) - 16, C.slate);
      } else if (l.type === 'telegraph' && actor) {
        A.SpriteAnim.play(actor, l.strike ? 'charge' : 'cast');
        spawnPopup(unitX(actor), footY(actor) - 66, '引导!', C.red, true);
        if (!rm) shakeTimer = 140;
      } else if (l.type === 'guard' && actor) {
        A.SpriteAnim.play(actor, 'guard');
      } else if (l.type === 'heal') {
        if (actor && A.SpriteAnim) A.SpriteAnim.play(actor, actor.side === 'ally' ? 'cast' : 'attack');
        if (target && l.amount > 0) {
          const tx = unitX(target);
          spawnPopup(tx, footY(target) - 58, `+${l.amount}`, C.cyan, false);
          spawnParticle('heal', tx, footY(target) - 18, C.cyan);
          playSfx('heal');
        }
      } else if (l.type === 'shield' && target && (l.amount > 0 || l.effect)) {
        if (target.side === 'ally' && A.SpriteAnim) A.SpriteAnim.play(target,'guard');
        const tx = unitX(target);
        if (l.amount > 0) spawnPopup(tx, footY(target) - 60, `+${l.amount}盾`, C.cyan, false);
        spawnParticle('shield', tx, footY(target) - (target.isBoss ? 29 : 20), C.cyan);
        playSfx('shield');
      } else if (l.type === 'surge' && actor) {
        spawnPopup(unitX(actor), footY(actor) - 64, '过载!', C.gold, false);
        spawnParticle('surge', unitX(actor), footY(actor) - 20, C.gold);
      } else if (l.type === 'dot' && target) {
        if (target.alive !== false) {
          if (l.kind === 'corrode') spawnPulse(l.amount == null ? actor : null, target, rm, C.violet);
          else if (l.kind === 'burn') spawnParticle('impactHot', unitX(target), footY(target) - 18, C.fire);
          else spawnParticle(l.kind, unitX(target), footY(target) - 18, l.kind === 'bleed' ? C.red : C.violet);
        }
      } else if (l.type === 'ember' && target) {
        spawnParticle('impactHot', unitX(target), footY(target) - 18, C.fire);
      } else if (l.type === 'phase' && actor) {
        spawnPopup(unitX(actor), footY(actor) - 68, '狂暴阶段!', C.red, true);
        if (!rm) shakeTimer = 240;
      } else if (l.type === 'victory') {
        playSfx('victory');
      } else if (l.type === 'defeat') {
        playSfx('defeat');
      }
    });
  }

  function drawBackground(now) {
    const img = A.Art?.getImage(bgId);
    if (img) {
      ctx.drawImage(img, 0, 0, CW, CH);
    } else {
      /* 程序化降级 */
      ctx.fillStyle = C.ink;
      ctx.fillRect(0, 0, CW, CH);
      for (let y = CH * .32; y < CH; y += 7) {
        for (let x = (y % 14 === 0 ? 0 : -7); x < CW; x += 14) {
          const r = Math.abs(Math.sin(x * 12.99 + y * 78.23)) % 1;
          ctx.fillStyle = C.slate;
          ctx.globalAlpha = r * .45;
          ctx.fillRect(x + 1, y + 1, 12, 5);
        }
      }
      ctx.globalAlpha = 1;
    }
    for (const x of [20, 301]) A.SpriteAnim.drawEffect(ctx, 'brazier', now % 760 / 760, x, 53, 14, 14);
  }

  /**
   * 静态小人：没有多帧图集时的兜底。
   * 底部对齐 GROUND，加一点呼吸起伏（静止时 ±1px），受击/前冲的位移由外层 x 负责。
   * 返回 false 表示连图都没有，调用方自行决定文字占位。
   */
  function drawStill(u, x, y, cellPx, now, rm, facingRight) {
    const id = spriteArtId(u);
    const img = id ? A.Art.getImage(id) : null;
    if (!img) {
      ctx.fillStyle = '#D4CABB';
      ctx.font = '7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(u.name, x, y - 4);
      return false;
    }
    const w = Math.max(8, Math.round(cellPx));
    const h = Math.max(8, Math.round(w * (img.height / img.width)));
    const bob = rm || u.alive === false ? 0 : Math.round(Math.sin(now / 520 + (u.slot || 0) * 1.7));
    ctx.save();
    if (u.refract > 0 && u.alive !== false) ctx.globalAlpha = 0.68;
    ctx.translate(x, y + bob);
    if (facingRight !== (u.side === 'ally')) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    return true;
  }

  const fusedUnits = new Set();
  const gaugeRatio = (value, max) => Math.max(0, Math.min(1, (value || 0) / (max || 1)));

  function overhead(u, x, by, now) {
    const bw = 25;
    const bx = x - 12;
    const ratio = gaugeRatio(u.hp, u.maxHp);
    if (u.shield > 0) {
      ctx.fillStyle = C.cyan;
      ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
    }
    ctx.fillStyle = C.bone;
    ctx.fillRect(bx, by, bw, 5);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = C.ink;
      ctx.fillRect(bx + 1 + i * 4, by + 1, 3, 3);
      const filled = Math.ceil(Math.max(0, Math.min(1, ratio * 6 - i)) * 3);
      ctx.fillStyle = C.bone;
      ctx.fillRect(bx + 1 + i * 4, by + 2, filled, 1);
    }
    if (u.fusedNodes?.length || fusedUnits.has(u.id)) {
      ctx.fillStyle = C.red;
      ctx.fillRect(bx + bw - 4, by, 2, 2);
      ctx.fillRect(bx + bw - 6, by + 2, 2, 2);
      ctx.fillRect(bx + bw - 7, by + 4, 2, 1);
    }
    ctx.fillStyle = C.ink;
    ctx.fillRect(bx, by + 7, bw, 3);
    ctx.fillStyle = C.steel;
    ctx.fillRect(x, by + 7, 1, 3);
    ctx.fillStyle = C.cyan;
    const energy = Math.round(11 * gaugeRatio(u.energy, u.energyMax));
    ctx.fillRect(x - energy, by + 8, energy, 1);
    const heat = Math.round(11 * gaugeRatio(u.stress, 100));
    ctx.fillStyle = u.cracked ? C.violet : u.stress >= 50 ? C.fire : C.gold;
    ctx.fillRect(x + 1, by + 8, heat, u.stress >= 50 && Math.floor(now / 160) % 2 ? 2 : 1);
    const membrane = u.phaseMembrane || u.membrane;
    if (membrane?.left > 0) {
      const spin = Math.floor(now / 150) % 6 * Math.PI / 9;
      const cy = by - 8;
      const points = Array.from({length: 6}, (_, i) => {
        const angle = spin + i * Math.PI / 3;
        return [x + Math.round(6 * Math.cos(angle)), cy + Math.round(5 * Math.sin(angle))];
      });
      ctx.fillStyle = C.cyan;
      points.forEach(([ax, ay], i) => {
        const [bx, by] = points[(i + 1) % points.length];
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
        for (let j = 0; j < steps; j++) {
          ctx.fillRect(Math.round(ax + (bx - ax) * j / steps), Math.round(ay + (by - ay) * j / steps), 1, 1);
        }
      });
      ctx.font = 'bold 6px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(membrane.left), x + .5, cy + 2.5);
    }
    if (u.charging) {
      ctx.fillStyle = C.red;
      ctx.fillRect(bx + bw + 2, by, 1, 3);
      ctx.fillRect(bx + bw + 2, by + 4, 1, 1);
    }
  }

  function drawParticles(dt) {
    const arrivals = [];
    particles = particles.filter((p) => {
      p.ttl -= dt;
      if (p.ttl <= 0 && p.arrive) arrivals.push(p.arrive);
      return p.ttl > 0;
    });
    arrivals.forEach(arrive => arrive());
    particles.forEach((p) => {
      const t = 1 - p.ttl / p.max;
      ctx.save();
      if (p.arrive) {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        ctx.translate(Math.round(p.x + dx*t), Math.round(p.y + dy*t));
        ctx.rotate(Math.atan2(dy, dx));
        const arrow = p.kind.startsWith('arrow');
        if (!A.SpriteAnim.drawEffect(ctx, p.kind, t, arrow ? -6 : 0, 0, arrow ? 22 : 30, arrow ? 15 : 30)) {
          ctx.fillStyle = p.color;
          ctx.fillRect(-14, 0, 16, 1);
        }
      } else if (p.beam) {
        const dx = p.tx - p.x, dy = p.ty - p.y;
        const distance = Math.hypot(dx, dy);
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(dy, dx));
        if (!A.SpriteAnim.drawEffect(ctx, p.kind, t, distance / 2, 0, distance, 24)) {
          ctx.fillStyle = p.color;
          ctx.fillRect(0, 0, Math.round(distance), 1);
        }
      } else {
        if (p.flip) {
          ctx.translate(p.x * 2, 0);
          ctx.scale(-1, 1);
        }
        const size = p.kind === 'interrupt' ? 49 : 37;
        if (!A.SpriteAnim.drawEffect(ctx, p.kind, t, p.x, p.y, size, size)) {
          ctx.fillStyle = p.color;
          const spread = Math.round(3 + t * 11);
          for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
            ctx.fillRect(p.x + spread * dx, p.y + spread * dy, 2, 2);
          }
        }
      }
      ctx.restore();
    });
  }

  function drawPopups(dt) {
    popups = popups.filter((p) => {
      p.ttl -= dt;
      p.y += p.vy * dt;
      return p.ttl > 0;
    });
    if (!popups.length) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    popups.forEach((p) => {
      const alpha = Math.min(1, (p.ttl / p.max) * 1.6);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = p.big ? 'bold 18px "Microsoft YaHei", sans-serif' : 'bold 14px "Microsoft YaHei", sans-serif';
      const sx = p.x * SCALE;
      const sy = p.y * SCALE;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#07050A';
      ctx.strokeText(p.text, sx, sy);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, sx, sy);
    });
    ctx.restore();
  }

  function renderFrame(state, now) {
    if (!ctx) return;
    const b = state.run && state.run.battle;
    if (!b) return;

    consumeEvents(state);

    const dt = lastTs ? Math.min(120, now - lastTs) : 16;
    lastTs = now;

    const paused = !!(V.App && V.App.ui && (V.App.ui.paused || V.App.ui.modal));
    const effDt = paused ? 0 : dt;
    const visualDt = effDt * (V.App?.ui.speed || 1);
    const still = reducedMotion();
    const units = [...b.enemies, ...b.allies];
    for (const u of units) advanceTravel(u, b, visualDt, still);
    if (visualDt > 0) A.SpriteAnim.update(units, visualDt);
    if (aimedBattle !== b) {
      aims.clear();
      for (const u of units) if (u.alive !== false) aims.set(u.id, V.Combat.aimTarget(b, u) || V.Positions.nearestFoe(b, u));
      aimedBattle = b;
    }

    let shx = 0;
    let shy = 0;
    if (shakeTimer > 0 && !paused) {
      shakeTimer = Math.max(0, shakeTimer - dt);
      shx = (Math.sin(now * 0.08) * 1.4);
      shy = (Math.cos(now * 0.11) * 1.0);
    }

    ctx.setTransform(SCALE, 0, 0, SCALE, shx * SCALE, shy * SCALE);
    ctx.imageSmoothingEnabled = false;
    if (!paused) effectTime += effDt;
    const fxNow = reducedMotion() ? 0 : effectTime;
    drawBackground(fxNow);

    const gauges = [];

    units.sort((a, c) => footY(a) - footY(c)).forEach((u) => {
      const t = tracks.get(u.id);
      let x = t.x, y = footY(u);
      const pose = A.SpriteAnim.stateOf(u.id)?.anim;
      const attacking = pose === 'attack' || pose === 'release';
      if (!attacking) strikeTargets.delete(u.id);
      const strikeTarget = strikeTargets.get(u.id);
      const target = strikeTarget || aims.get(u.id);
      const travel = t.elapsed < t.duration ? t.toX - t.fromX : 0;
      const dx = pose === 'run' && Math.abs(travel) > 2 ? travel : target ? unitX(target) - x : 0;
      const facingRight = A.SpriteAnim.face(u, dx, visualDt);
      if (!still && strikeTarget && V.Positions.style(u).mode === 'melee') {
        const dx = unitX(strikeTarget) - x, dy = footY(strikeTarget) - y;
        const distance = Math.hypot(dx, dy);
        const lunge = Math.min(9, Math.max(0, distance - 10)) * A.SpriteAnim.reach(u) / (distance || 1);
        x += dx * lunge;
        y += dy * lunge;
      }
      const ht = hurtMap.get(u.id);
      if (ht) {
        ht.ttl -= visualDt;
        if (ht.ttl <= 0) hurtMap.delete(u.id);
        else if (!still) {
          const recoil = Math.sin(Math.PI * Math.pow(1 - ht.ttl / 155, .55)) * (ht.crit ? 5 : 3);
          x += ht.dx * recoil;
          y += ht.dy * recoil;
        }
      }

      x = Math.round(x);
      y = Math.round(y);
      if (u.alive !== false) {
        ctx.fillStyle = 'rgba(15,17,26,.6)';
        ctx.beginPath();
        ctx.ellipse(x, y + 1, u.isBoss ? 16 : 10, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (A.SpriteAnim) {
        const cellPx = CELL * (u.isBoss ? 1.45 : u.isElite ? 1.14 : 1);
        ctx.save();
        if (u.refract > 0 && u.alive !== false) ctx.globalAlpha = 0.68;
        if (ht && ht.ttl > 90 && !still) ctx.filter = 'brightness(' + (1 + .28 * (ht.ttl - 90) / 65) + ')';
        const drawn = A.SpriteAnim.draw(ctx, u, x, y, cellPx, still, facingRight);
        ctx.restore();
        /* 没有多帧图集（八位流浪者、敌方亚种、首领）就画 curated 的 64px 静态小人；
           连图片也没加载时（test:ui 会 abort 掉 /assets/）才退回文字占位。 */
        if (!drawn && u.alive !== false) drawStill(u, x, y, cellPx, now, still, facingRight);
      }
      if (u.alive !== false) {
        const base = y - (u.isBoss ? 55 : 43);
        const min = u.membrane?.left > 0 ? 14 : 3;
        const rows = [0, 11, 22, 33].map(offset => base - offset);
        const by = rows.find(row => row >= min && gauges.every(g =>
          Math.abs(g.x - x) >= 26 || Math.abs(g.by - row) >= 11)) ?? Math.max(min, base);
        gauges.push({ u, x, by });
      }
    });
    gauges.forEach(g => overhead(g.u, g.x, g.by, fxNow));

    drawParticles(visualDt);
    drawPopups(effDt);

    /* 首领引导预告角标 */
    const chargingEnemy = b.enemies.find((e) => e.alive !== false && e.charging);
    if (chargingEnemy) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(42, 14, 18, 0.85)';
      ctx.fillRect(CW * SCALE - 210, 10, 198, 26);
      ctx.strokeStyle = C.red;
      ctx.strokeRect(CW * SCALE - 210, 10, 198, 26);
      ctx.fillStyle = C.bone;
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚠ ${chargingEnemy.name}引导：${chargingEnemy.charging.name}`, CW * SCALE - 111, 23);
      ctx.restore();
    }

    /* 战斗结束：边缘压暗 */
    if (b.over) {
      const g = ctx.createLinearGradient(0, 0, 0, CH);
      g.addColorStop(0, 'rgba(11,10,16,0.55)');
      g.addColorStop(0.5, 'rgba(11,10,16,0.18)');
      g.addColorStop(1, 'rgba(11,10,16,0.62)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CW, CH);
    }
  }

  const flowCache = new WeakMap();

  function pixelRail(c, a, b, radius, color) {
    c.fillStyle = color;
    c.fillRect(Math.min(a[0], b[0]) - radius, Math.min(a[1], b[1]) - radius,
      Math.abs(b[0] - a[0]) + radius * 2, Math.abs(b[1] - a[1]) + radius * 2);
  }

  function drawConduit(c, path, fx, color, tick) {
    if (path.length < 2) return;
    const { cell } = fx;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      pixelRail(c, a, b, 2, color);
      if ((tick + i * 7) % 29 > 4 || fx.connectors.get(a.join(',')) === fx.connectors.get(b.join(','))) continue;
      const x = Math.round((a[0] + b[0])/2), y = Math.round((a[1] + b[1])/2);
      c.fillStyle = C.cyan;
      c.fillRect(x-4, y-1, 8, 2);
      c.fillRect(x-1, y-4, 2, 8);
      c.fillStyle = C.bone;
      c.fillRect(x-1, y-1, 2, 2);
    }
    for (let i = 1; i < path.length - 1; i++) {
      const [x, y] = path[i], before = path[i - 1], after = path[i + 1];
      if (before[0] === after[0] || before[1] === after[1]) continue;
      const radius = tick % 12 < 4 ? 6 : 5;
      c.fillStyle = C.gold;
      for (let row = -radius + 1; row < radius; row++) {
        const half = radius - Math.abs(row);
        c.fillRect(x - half, y + row, 2 * half, 1);
      }
      c.fillStyle = C.bone;
      c.fillRect(x - 1, y - 2, 2, 4);
      c.fillRect(x - 2, y - 1, 4, 2);
    }
    const length = (path.length - 1) * cell;
    const spacing = Math.round(cell * .8);
    for (let pos = (tick * 4 + 12) % spacing; pos < length; pos += spacing) {
      const i = Math.floor(pos / cell), t = pos / cell - i;
      const a = path[i], b = path[i + 1];
      const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
      const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      c.fillStyle = C.bone;
      for (let step = -2; step <= 2; step++) {
        const forward = 2 - Math.abs(step);
        c.fillRect(x + dx * forward - dy * step - 1, y + dy * forward + dx * step - 1, 2, 2);
      }
      c.fillStyle = color;
      c.fillRect(x - 8 * dx - 1, y - 8 * dy - 1, 3, 3);
    }
  }

  function renderTopology(state, now) {
    const field = document.querySelector('.topology-flow');
    if (!field) return;
    if (!flowCache.has(field)) {
      const [gx, gy] = field.dataset.origin.split(',').map(Number);
      const board = field.previousElementSibling;
      const cell = Number(board.dataset.cell);
      const center = ([x, y]) => [Math.round(gx + (x + .5) * cell), Math.round(gy + (y + .5) * cell)];
      const paths = JSON.parse(field.dataset.flow).map(path => path.map(center));
      const owners = new Map(), connectors = new Map();
      for (const [item, cells] of JSON.parse(field.dataset.pieces)) {
        const points = cells.map(center);
        owners.set(item, points);
        points.forEach(xy => connectors.set(xy.join(','), item));
      }
      flowCache.set(field, { board, paths, owners, connectors, cell, context: field.getContext('2d'),
        mask: board.querySelector('.conduit-mask'), fuses: board.querySelector('.conduit-fuses') });
    }
    const fx = flowCache.get(field);
    if (!fx.context) return;
    const u = field.dataset.live === '1' ? state.run?.battle?.allies.find(a => a.sourceUnitId === field.dataset.unit) : null;
    const color = (u?.stress ?? Number(field.dataset.stress)) >= 50 ? C.fire : C.cyan;
    const tick = reducedMotion() ? 0 : Math.floor(now / 31);
    const burnt = (u?.fusedNodes || []).flatMap(id => fx.owners.get(id) || []);
    const fault = [color, ...burnt.flat()].join(',');
    if (fault !== fx.fault) {
      fx.fault = fault;
      const damage = new Set(burnt.map(xy => xy.join(',')));
      fx.activePaths = fx.paths.map(path => {
        const stop = path.findIndex(xy => damage.has(xy.join(',')));
        return stop < 0 ? path : path.slice(0, stop);
      });
      // Clip the bright sprite to live edges, leaving unused branches and everything past a fuse dark.
      const clip = fx.activePaths.flatMap(path => path.slice(1).map(([bx, by], i) => {
        const [ax, ay] = path[i];
        const w = Math.abs(bx - ax) + 10, h = Math.abs(by - ay) + 10;
        return `M${Math.min(ax, bx)-5} ${Math.min(ay, by)-5}h${w}v${h}h-${w}Z`;
      })).join('');
      fx.mask?.setAttribute('d', clip);
      fx.board.classList.toggle('is-hot', color === C.fire);
      if (fx.fuses) fx.fuses.innerHTML = burnt.map(([x, y]) => V.RuneArt.conduitOverlay('fuse', x, y, fx.cell)).join('');
    }
    const stamp = [fx.paths.length && tick, fault].join(',');
    if (stamp === fx.stamp) return;
    fx.stamp = stamp;

    const c = fx.context;
    c.clearRect(0, 0, field.width, field.height);
    for (const path of fx.activePaths) drawConduit(c, path, fx, color, tick);
  }

  function updateHud(state) {
    const b = state.run && state.run.battle;
    if (!b) return;
    const sp = document.getElementById('btlSpeed');
    if (sp) sp.textContent = '速度 ×' + ((V.App && V.App.ui && V.App.ui.speed) || 1);
    const tc = document.getElementById('btlTactic');
    if (tc) tc.textContent = '战术：' + ({ balance: '均衡', focus: '集火', safe: '压制' }[b.tactic] || '均衡');
    const next = document.getElementById('btlNext');
    if (next) next.style.display = b.over ? '' : 'none';
    const tk = document.querySelector('.bt-tick');
    if (tk) tk.textContent = (b.tick * V.Data.DESIGN.stepSeconds).toFixed(1) + 's';
    for (const card of document.querySelectorAll('.topology-crew-card')) {
      const unit = b.allies.find(u => u.sourceUnitId === card.dataset.id);
      if (!unit) continue;
      const update = (selector, text) => {
        const label = card.querySelector(selector);
        if (label.textContent !== String(text)) label.textContent = text;
      };
      update('[data-integrity]', unit.hp + '/' + unit.maxHp);
      update('[data-amplitude]', Math.round(unit.atk * (unit.pulseAmp || 1) * 10) / 10);
      update('[data-impedance]', unit.def);
      if (card.getAttribute('aria-pressed') === 'true') {
        const buffer = document.querySelector('[data-topology-buffer]');
        if (buffer) {
          const text = (unit.shield || 0) + ' / ' + (unit.fusedNodes?.length || 0);
          if (buffer.textContent !== text) buffer.textContent = text;
        }
      }
    }
    const rn = document.querySelector('.bt-round');
    if (rn) rn.textContent = '回合 ' + b.round;

    const status = document.querySelector('[data-battle-status]');
    if (status && status.dataset.tick !== String(b.tick)) {
      status.dataset.tick = String(b.tick);
      status.innerHTML = [...b.allies, ...b.enemies].map(V.UI.battleBar).join('');
    }

    const log = document.getElementById('battleLog');
    if (log && log.dataset.seq !== String(b.logSeq)) {
      log.dataset.seq = String(b.logSeq);
      log.innerHTML = (b.logs || []).slice(-14)
        .map((l) => `<div class="lg ${V.UI.logClass(l)}">${V.UI.esc(l.text || '')}</div>`).join('');
      log.scrollTop = log.scrollHeight;
    }
  }

  V.View = { preloadPreparation, mount, renderFrame, renderTopology, updateHud, reset, targetX, CW, CH, GROUND };
})(globalThis.Ashen ||= {});
