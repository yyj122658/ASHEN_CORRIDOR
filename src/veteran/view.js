'use strict';
/* 战场显示：画布、脚底锚点、位置插值、逐帧动画复用、飘字粒子特效与质感降级绘制。
   只消费事件与状态，不回写任何领域数据。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const CW = 320;
  const CH = 100;
  const GROUND = 84;
  const SCALE = 3;
  const CELL = 40;

  let canvas = null;
  let ctx = null;
  let lastTs = 0;
  let bgId = 'scene.corridor';
  let displayX = new Map(); /* unitId -> 当前显示 x */
  let lastLogSeq = 0;

  /* 视觉表现状态（纯视图，不回写 state） */
  let lungeMap = new Map();     /* unitId -> { dx, ttl, max } */
  let hurtMap = new Map();      /* unitId -> { ttl, max, crit } */
  let popups = [];              /* { x, y, vy, text, color, big, ttl, max } */
  let particles = [];           /* { kind, x, y, tx, ty, color, ttl, max } */
  let shakeTimer = 0;

  function reset() {
    lastTs = 0;
    displayX = new Map();
    lastLogSeq = 0;
    lungeMap = new Map();
    hurtMap = new Map();
    popups = [];
    particles = [];
    shakeTimer = 0;
    if (A.SpriteAnim && A.SpriteAnim.reset) A.SpriteAnim.reset();
  }

  function reducedMotion() {
    const st = V.App && V.App.state;
    return !!(st && st.settings && st.settings.reducedMotion);
  }

  function playSfx(kind) {
    if (V.App && V.App.playSfx) V.App.playSfx(kind);
  }

  function targetX(u) {
    /* 我方 slot0 最靠中心（画布右侧），敌方 slot0 最靠中心（画布左侧） */
    if (u.side === 'ally') return 118 - u.slot * 29;
    return 202 + u.slot * 29;
  }

  function preloadPreparation(state) {
    const encounter = state.run && state.run.encounter;
    if (!encounter) return;
    const formation = encounter.preparation.formation;
    const skins = state.roster.filter(u => formation.includes(u.id)).map(u => u.skinId);
    /* 亚种读同族立绘，预加载也要按 sprite 取，否则第一帧会退化成名字 */
    const foes = encounter.enemyBlueprint.units.map((u) => {
      const meta = A.Veteran.Data.ENEMIES[u.enemyType];
      return (meta && meta.sprite) || u.enemyType;
    });
    A.SpriteAnim.preload([...skins, ...foes]);
    A.Art.preloadArt([encounter.kind === 'boss' ? 'scene.boss' : 'scene.corridor']);
  }

  /**
   * mount(state, opts)
   * 界面重建会换掉 <canvas>，所以每次渲染战场都要重新绑定上下文；
   * 但 displayX（位置插值）只在进入战场 / 回转时清空，避免位置跳变。
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
    bgId = b.kind === 'boss' ? 'scene.boss' : 'scene.corridor';
    if (o.sync !== false && A.Art) A.Art.preloadArt([bgId]);
    const units = [...b.allies, ...b.enemies];
    units.forEach((u) => {
      if (o.sync !== false || !displayX.has(u.id)) displayX.set(u.id, targetX(u));
    });
    if (A.SpriteAnim) {
      A.SpriteAnim.preload(units.map(A.SpriteAnim.charIdFor).filter(Boolean));
      if (o.sync !== false) A.SpriteAnim.syncFromBattle(b);
    }
    if (o.sync !== false) lastLogSeq = b.logSeq || 0;
  }

  function unitX(u) {
    return displayX.has(u.id) ? displayX.get(u.id) : targetX(u);
  }

  function spawnPopup(x, y, text, color, big) {
    if (popups.length > 28) popups.shift();
    const ox = ((popups.length % 3) - 1) * 7;
    const oy = ((popups.length % 2) * -6);
    popups.push({ x: x + ox, y: y + oy, vy: big ? -0.022 : -0.017, text, color, big: !!big, ttl: big ? 820 : 680, max: big ? 820 : 680 });
  }

  function spawnParticle(kind, x, y, color, tx, ty) {
    if (particles.length > 32) particles.shift();
    particles.push({ kind, x, y, tx: tx || x, ty: ty || y, color, ttl: 280, max: 280 });
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
      if (l.type === 'cast' && actor && A.SpriteAnim) A.SpriteAnim.play(actor, actor.side === 'ally' ? 'cast' : 'attack');
      if (l.type === 'move' && A.SpriteAnim) {
        for (const unit of [actor,target]) if (unit?.side === 'ally') A.SpriteAnim.play(unit, 'move');
      }
      if (l.type === 'hit' || l.type === 'crit') {
        const isCrit = l.type === 'crit';
        if (actor) {
          if (A.SpriteAnim) A.SpriteAnim.play(actor, 'attack');
          if (actor.side !== 'ally' && !rm && (!target || target.id !== actor.id)) {
            const dir = actor.side === 'ally' ? 1 : -1;
            lungeMap.set(actor.id, { dx: dir * (isCrit ? 13 : 9), ttl: 220, max: 220 });
          }
        }
        if (target) {
          if (A.SpriteAnim) A.SpriteAnim.play(target, 'hurt');
          const tx = unitX(target);
          hurtMap.set(target.id, { ttl: 180, max: 180, crit: isCrit });
          if (l.amount > 0) {
            spawnPopup(tx, GROUND - 58, `-${l.amount}${isCrit ? '!' : ''}`, isCrit ? '#F2CF7E' : '#EFE5D3', isCrit);
          }
          spawnParticle(isCrit ? 'crit' : 'slash', tx, GROUND - 20, isCrit ? '#F2CF7E' : '#E5DBCA');
          if (isCrit && !rm) shakeTimer = 180;
        }
        playSfx(isCrit ? 'crit' : 'hit');
      } else if (l.type === 'miss') {
        if (actor && A.SpriteAnim) A.SpriteAnim.play(actor, 'attack');
        if (target?.side === 'ally' && A.SpriteAnim) A.SpriteAnim.play(target, 'dodge');
        if (target) spawnPopup(unitX(target), GROUND - 56, '闪避', '#9A92A6', false);
      } else if (l.type === 'blocked') {
        if (target) {
          if (target.side === 'ally' && A.SpriteAnim) A.SpriteAnim.play(target,'guard');
          const tx = unitX(target);
          spawnPopup(tx, GROUND - 56, '格挡', '#7FBBC8', false);
          spawnParticle('shield', tx, GROUND - 20, '#7FBBC8');
        }
      } else if (l.type === 'death' && target) {
        if (A.SpriteAnim) A.SpriteAnim.play(target, 'death');
        spawnParticle('death', unitX(target), GROUND - 16, '#8A6F5E');
      } else if (l.type === 'telegraph' && actor) {
        if (A.SpriteAnim) A.SpriteAnim.play(actor, 'attack');
        spawnPopup(unitX(actor), GROUND - 66, '蓄力!', '#D36A65', true);
        if (!rm) shakeTimer = 140;
      } else if (l.type === 'heal') {
        if (actor && A.SpriteAnim) A.SpriteAnim.play(actor, actor.side === 'ally' ? 'cast' : 'attack');
        if (target && l.amount > 0) {
          const tx = unitX(target);
          spawnPopup(tx, GROUND - 58, `+${l.amount}`, '#8DB69B', false);
          spawnParticle('heal', tx, GROUND - 18, '#8DB69B');
          playSfx('heal');
        }
      } else if (l.type === 'shield' && target && l.amount > 0) {
        if (target.side === 'ally' && A.SpriteAnim) A.SpriteAnim.play(target,'guard');
        const tx = unitX(target);
        spawnPopup(tx, GROUND - 60, `+${l.amount}盾`, '#7FBBC8', false);
        spawnParticle('shield', tx, GROUND - 20, '#7FBBC8');
        playSfx('shield');
      } else if (l.type === 'surge' && actor) {
        spawnPopup(unitX(actor), GROUND - 64, '过载!', '#F2CF7E', false);
        spawnParticle('surge', unitX(actor), GROUND - 20, '#F2CF7E');
      } else if (l.type === 'ember' && target) {
        spawnParticle('ember', unitX(target), GROUND - 18, '#D87843');
      } else if (l.type === 'phase' && actor) {
        spawnPopup(unitX(actor), GROUND - 68, '狂暴阶段!', '#D36A65', true);
        if (!rm) shakeTimer = 240;
      } else if (l.type === 'victory') {
        playSfx('victory');
      } else if (l.type === 'defeat') {
        playSfx('defeat');
      }
    });
  }

  function drawBackground() {
    const art = A.Art && A.Art.getArt(bgId);
    const img = art ? A.Art.getImage(bgId) : null;
    if (img) {
      const ratio = img.width / img.height;
      const w = Math.max(CW, CH * ratio);
      const h = w / ratio;
      const dx = (CW - w) / 2;
      const dy = GROUND - h * (art.groundY != null ? art.groundY : 0.86);
      ctx.drawImage(img, dx, dy, w, h);
      ctx.fillStyle = 'rgba(11,10,16,0.44)';
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = 'rgba(11,10,16,0.62)';
      ctx.fillRect(0, GROUND, CW, CH - GROUND);
    } else {
      /* 程序化降级 */
      ctx.fillStyle = '#0C0912';
      ctx.fillRect(0, 0, CW, CH);
      for (let y = 0; y < GROUND; y += 7) {
        for (let x = (y % 14 === 0 ? 0 : -7); x < CW; x += 14) {
          const r = Math.abs(Math.sin(x * 12.99 + y * 78.23)) % 1;
          ctx.fillStyle = r > 0.55 ? '#1A1428' : r > 0.25 ? '#151021' : '#120E1C';
          ctx.fillRect(x + 1, y + 1, 12, 5);
        }
      }
      ctx.fillStyle = '#090710';
      ctx.fillRect(0, GROUND, CW, CH - GROUND);
      ctx.fillStyle = '#2A2038';
      ctx.fillRect(0, GROUND, CW, 1);
    }

    /* 战位地面石刻标线 */
    ctx.fillStyle = 'rgba(217,173,101,0.16)';
    for (let s = 0; s < 4; s++) {
      const ax = 118 - (3 - s) * 29;
      ctx.fillRect(ax - 7, GROUND + 2, 14, 1);
      const ex = 202 + s * 29;
      ctx.fillStyle = 'rgba(211,106,101,0.14)';
      ctx.fillRect(ex - 7, GROUND + 2, 14, 1);
      ctx.fillStyle = 'rgba(217,173,101,0.16)';
    }
  }

  function overhead(u, x, y) {
    if (u.alive === false) return;
    const bw = 20;
    const bx = x - bw / 2;

    /* 只画当前时间轴真正使用的生命与余裕，移除退役能量点。 */
    ctx.fillStyle = 'rgba(12,20,15,0.88)';
    ctx.fillRect(bx - 1, y - 44, bw + 2, 3);
    const ratio = Math.max(0, Math.min(1, u.hp / u.maxHp));
    ctx.fillStyle = ratio < 0.25 ? '#d88b73' : u.side === 'ally' ? '#a8b99c' : '#b87367';
    ctx.fillRect(bx, y - 43, Math.round(bw * ratio), 1);
    if (u.side === 'ally' && (u.skillList || []).length) {
      ctx.fillStyle = 'rgba(26,44,33,.9)';
      ctx.fillRect(bx, y - 40, bw, 1);
      ctx.fillStyle = u.casting ? '#dfc38b' : '#7caca0';
      const pct = u.casting ? 1 - u.castTimer / ((u.pendingSkill && u.pendingSkill.castTime) || 0.6) : (u.energy || 0) / (u.energyMax || 20);
      ctx.fillRect(bx, y - 40, Math.round(bw * Math.max(0, Math.min(1, pct))), 1);
    }
    if (u.shield > 0) {
      ctx.fillStyle = '#a1bfc4';
      ctx.fillRect(bx, y - 46, Math.round(bw * Math.min(1, u.shield / Math.max(1, u.maxHp * 0.3))), 1);
    }
    /* 蓄力预告 */
    if (u.charging) {
      ctx.fillStyle = '#D36A65';
      ctx.fillRect(x - 2, y - 64, 4, 4);
      ctx.fillRect(x - 1, y - 70, 2, 4);
    }

    if (u.isBoss) {
      ctx.fillStyle = u.bossPhase >= 2 ? '#D36A65' : '#E8C46A';
      ctx.fillRect(x - 1, y - 64, 2, 2);
      ctx.fillRect(x - 4, y - 63, 2, 1);
      ctx.fillRect(x + 3, y - 63, 2, 1);
    }
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => {
      p.ttl -= dt;
      return p.ttl > 0;
    });
    particles.forEach((p) => {
      const t = 1 - p.ttl / p.max;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      if (p.kind === 'slash' || p.kind === 'crit') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.kind === 'crit' ? 2.2 : 1.4;
        const r = 9 + t * 8;
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y - r * 0.7);
        ctx.lineTo(p.x + r, p.y + r * 0.7);
        if (p.kind === 'crit') {
          ctx.moveTo(p.x + r * 0.8, p.y - r * 0.8);
          ctx.lineTo(p.x - r * 0.8, p.y + r * 0.8);
        }
        ctx.stroke();
      } else if (p.kind === 'shield') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 + t * 9, -Math.PI * 0.65, Math.PI * 0.65);
        ctx.stroke();
      } else if (p.kind === 'heal') {
        ctx.fillStyle = p.color;
        const rise = t * 14;
        ctx.fillRect(p.x - 4, p.y - rise, 3, 1);
        ctx.fillRect(p.x - 3, p.y - 1 - rise, 1, 3);
        ctx.fillRect(p.x + 3, p.y - 4 - rise, 3, 1);
        ctx.fillRect(p.x + 4, p.y - 5 - rise, 1, 3);
      } else if (p.kind === 'surge' || p.kind === 'ember' || p.kind === 'death') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 + t * 13, 0, Math.PI * 2);
        ctx.stroke();
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

    bgId = b.kind === 'boss' ? 'scene.boss' : 'scene.corridor';
    consumeEvents(state);

    const dt = lastTs ? Math.min(120, now - lastTs) : 16;
    lastTs = now;

    const paused = !!(V.App && V.App.ui && (V.App.ui.paused || V.App.ui.modal));
    const effDt = paused ? 0 : dt;
    if (effDt > 0 && A.SpriteAnim) {
      const speed = (V.App && V.App.ui && V.App.ui.speed) || 1;
      A.SpriteAnim.update([...b.allies, ...b.enemies], effDt * speed);
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
    drawBackground();

    /* 位置插值与前冲/受击偏置 */
    [...b.allies, ...b.enemies].forEach((u) => {
      const tx = targetX(u);
      const cur = displayX.has(u.id) ? displayX.get(u.id) : tx;
      const nx = cur + (tx - cur) * Math.min(1, dt / 140);
      displayX.set(u.id, Math.abs(nx - tx) < 0.4 ? tx : nx);
    });

    const ordered = [...b.enemies.slice().sort((a, c) => c.slot - a.slot),
      ...b.allies.slice().sort((a, c) => c.slot - a.slot)];

    ordered.forEach((u) => {
      let x = Math.round(displayX.get(u.id) || targetX(u));
      const ln = lungeMap.get(u.id);
      if (ln) {
        if (!paused) ln.ttl -= dt;
        if (ln.ttl <= 0) lungeMap.delete(u.id);
        else x += Math.round(ln.dx * (ln.ttl / ln.max));
      }
      const ht = hurtMap.get(u.id);
      if (ht) {
        if (!paused) ht.ttl -= dt;
        if (ht.ttl <= 0) hurtMap.delete(u.id);
        else if (!reducedMotion()) x += (Math.floor(ht.ttl / 36) % 2 === 0 ? 1 : -1) * (u.side === 'ally' ? -2 : 2);
      }

      const y = GROUND;
      if (A.SpriteAnim) {
        ctx.save();
        if (u.refract > 0 && u.alive !== false) ctx.globalAlpha = 0.68;
        if (ht && ht.ttl > 80 && !reducedMotion()) ctx.filter = 'brightness(1.35)';
        const drawn = A.SpriteAnim.draw(ctx, u, x, y, CELL * (u.isBoss ? 1.45 : u.isElite ? 1.14 : 1), reducedMotion());
        if (!drawn && u.alive !== false) {
          ctx.fillStyle = '#d7c7ae';
          ctx.font = '7px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(u.name, x, y - 4);
        }
        ctx.restore();
      }
      overhead(u, x, y);
    });

    drawParticles(effDt);
    drawPopups(effDt);

    /* 首领蓄力预告角标 */
    const chargingEnemy = b.enemies.find((e) => e.alive !== false && e.charging);
    if (chargingEnemy) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(42, 14, 18, 0.85)';
      ctx.fillRect(CW * SCALE - 210, 10, 198, 26);
      ctx.strokeStyle = '#D36A65';
      ctx.strokeRect(CW * SCALE - 210, 10, 198, 26);
      ctx.fillStyle = '#FFB2AE';
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚠ ${chargingEnemy.name}蓄力：${chargingEnemy.charging.name}`, CW * SCALE - 111, 23);
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
    /* 双方信息条随 tick 更新，但不动 canvas */
    const ab = document.querySelector('.side.allies');
    if (ab) ab.innerHTML = b.allies.slice().sort((a, c) => c.slot - a.slot).map((u) => V.UI.battleBar(u)).join('');
    const eb = document.querySelector('.side.enemies');
    if (eb) eb.innerHTML = b.enemies.map((u) => V.UI.battleBar(u)).join('');
    const rn = document.querySelector('.bt-round');
    if (rn) rn.textContent = '回合 ' + b.round;

    const log = document.getElementById('battleLog');
    if (log) {
      log.innerHTML = (b.logs || []).slice(-14)
        .map((l) => `<div class="lg ${V.UI.logClass(l)}">${V.UI.esc(l.text || '')}</div>`).join('');
      log.scrollTop = log.scrollHeight;
    }
  }

  V.View = { preloadPreparation, mount, renderFrame, updateHud, reset, targetX, CW, CH, GROUND };
})(globalThis.Ashen ||= {});
