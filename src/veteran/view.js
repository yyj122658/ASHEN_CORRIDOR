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
    if (u.side === 'ally') return 118 - (3 - u.slot) * 29;
    return 202 + u.slot * 29;
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
    if (o.sync === false) {
      const b0 = state && state.run && state.run.battle;
      if (b0) {
        bgId = b0.kind === 'boss' ? 'scene.boss' : 'scene.corridor';
        [...b0.allies, ...b0.enemies].forEach((u) => {
          if (!displayX.has(u.id)) displayX.set(u.id, targetX(u));
        });
        lastLogSeq = b0.logSeq || 0;
      }
      return;
    }
    const b = state && state.run && state.run.battle;
    if (b) {
      bgId = b.kind === 'boss' ? 'scene.boss' : 'scene.corridor';
      [...b.allies, ...b.enemies].forEach((u) => displayX.set(u.id, targetX(u)));
      /* 恢复战斗时按存活状态初始化，不重放历史伤害 */
      if (A.SpriteAnim && A.SpriteAnim.syncFromBattle) {
        A.SpriteAnim.syncFromBattle({
          logSeq: b.logSeq,
          allies: b.allies.map(toAnimUnit),
          enemies: b.enemies.map(toAnimUnit),
          over: b.over,
        });
      }
      lastLogSeq = b.logSeq || 0;
    }
  }

  /** 显示适配：把新单位结构翻译成旧动画模块认得的形状。 */
  function toAnimUnit(u) {
    return {
      id: u.id,
      side: u.side,
      cls: u.side === 'ally' ? (u.skinId === 'blade' ? 'blade' : 'other') : undefined,
      skinId: u.skinId,
      enemyType: u.enemyType,
      hp: u.hp,
      maxHp: u.maxHp,
      alive: u.alive !== false,
      shape: u.enemyType === 'bone' ? 'human' : (u.enemyType || 'human'),
    };
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
      if (l.type === 'hit' || l.type === 'crit') {
        const isCrit = l.type === 'crit';
        if (actor) {
          if (A.SpriteAnim) A.SpriteAnim.play(toAnimUnit(actor), 'attack');
          if (!rm && (!target || target.id !== actor.id)) {
            const dir = actor.side === 'ally' ? 1 : -1;
            lungeMap.set(actor.id, { dx: dir * (isCrit ? 13 : 9), ttl: 220, max: 220 });
          }
        }
        if (target) {
          if (A.SpriteAnim) A.SpriteAnim.play(toAnimUnit(target), 'hurt');
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
        if (actor && A.SpriteAnim) A.SpriteAnim.play(toAnimUnit(actor), 'attack');
        if (target) spawnPopup(unitX(target), GROUND - 56, '闪避', '#9A92A6', false);
      } else if (l.type === 'blocked') {
        if (target) {
          const tx = unitX(target);
          spawnPopup(tx, GROUND - 56, '格挡', '#7FBBC8', false);
          spawnParticle('shield', tx, GROUND - 20, '#7FBBC8');
        }
      } else if (l.type === 'death' && target) {
        if (A.SpriteAnim) A.SpriteAnim.play(toAnimUnit(target), 'death');
        spawnParticle('death', unitX(target), GROUND - 16, '#8A6F5E');
      } else if (l.type === 'telegraph' && actor) {
        if (A.SpriteAnim) A.SpriteAnim.play(toAnimUnit(actor), 'attack');
        spawnPopup(unitX(actor), GROUND - 66, '蓄力!', '#D36A65', true);
        if (!rm) shakeTimer = 140;
      } else if (l.type === 'heal') {
        if (actor && A.SpriteAnim) A.SpriteAnim.play(toAnimUnit(actor), 'attack');
        if (target && l.amount > 0) {
          const tx = unitX(target);
          spawnPopup(tx, GROUND - 58, `+${l.amount}`, '#8DB69B', false);
          spawnParticle('heal', tx, GROUND - 18, '#8DB69B');
          playSfx('heal');
        }
      } else if (l.type === 'shield' && target && l.amount > 0) {
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

  const SKIN_COLOR = {
    blade: '#6B483E', warden: '#5E6D86', ranger: '#4C6444',
    cleric: '#A4927C', warlock: '#5D4476', rogue: '#4B4E62',
  };
  const SKIN_TRIM = {
    blade: '#C46848', warden: '#B8C4D4', ranger: '#9DB070',
    cleric: '#EFD082', warlock: '#AD8AC7', rogue: '#7FBBC8',
  };

  function drawFallback(u, x, y, now) {
    const dir = u.side === 'ally' ? 1 : -1;
    const dead = u.alive === false;
    const scale = u.isBoss ? 1.45 : u.isElite ? 1.18 : 1;
    const rm = reducedMotion();
    const bob = (!dead && !rm) ? Math.round(Math.sin(now * 0.0045 + u.slot * 1.3) * 0.65) : 0;

    ctx.save();
    if (scale !== 1) {
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.translate(-x, -y);
    }
    ctx.globalAlpha = dead ? 0.34 : 1;

    /* 落地阴影 */
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(x - 8, y - 1, 16, 2);

    if (dead) {
      ctx.fillStyle = u.side === 'ally' ? '#4A4A5A' : '#4A3730';
      ctx.fillRect(x - 9, y - 5, 18, 4);
      ctx.fillStyle = 'rgba(229,219,202,0.15)';
      ctx.fillRect(x - 7, y - 4, 12, 1);
      ctx.restore();
      return;
    }

    /* 四足骨犬专用兽形剪影（紧贴轮廓，无方框背底） */
    if (u.enemyType === 'hound') {
      ctx.fillStyle = 'rgba(8,7,12,0.82)';
      ctx.fillRect(x - 8, y - 14 + bob, 13, 7);
      ctx.fillRect(x - 11, y - 17 + bob, 8, 7);
      ctx.fillStyle = '#8C7A68'; /* 四肢 */
      ctx.fillRect(x - 7, y - 8, 2, 8);
      ctx.fillRect(x - 4, y - 7, 2, 7);
      ctx.fillRect(x + 2, y - 8, 2, 8);
      ctx.fillRect(x + 5, y - 7, 2, 7);
      ctx.fillStyle = '#9D8C78'; /* 躯干与肋骨 */
      ctx.fillRect(x - 7, y - 13 + bob, 12, 5);
      ctx.fillStyle = '#524036';
      ctx.fillRect(x - 6, y - 12 + bob, 9, 3);
      ctx.fillStyle = '#B8A690'; /* 颅骨与吻部 */
      ctx.fillRect(x - 10, y - 16 + bob, 6, 5);
      ctx.fillRect(x - 12, y - 14 + bob, 3, 2);
      ctx.fillStyle = '#D0B99E'; /* 骨尾 */
      ctx.fillRect(x + 5, y - 14 + bob, 3, 2);
      ctx.fillStyle = '#FF6A48'; /* 眼 */
      ctx.fillRect(x - 9, y - 15 + bob, 1, 1);
      ctx.restore();
      return;
    }

    /* 飘浮幽魂剪影 */
    if (u.enemyType === 'wraith') {
      const floatY = (!rm) ? Math.round(Math.sin(now * 0.005 + u.slot) * 1.5) - 3 : -2;
      ctx.fillStyle = 'rgba(8,7,12,0.75)';
      ctx.fillRect(x - 6, y - 31 + floatY, 12, 26);
      ctx.fillStyle = '#4B3C68';
      ctx.fillRect(x - 5, y - 24 + floatY, 10, 17);
      ctx.fillStyle = '#362A4C';
      ctx.fillRect(x - 6, y - 10 + floatY, 3, 6);
      ctx.fillRect(x + 3, y - 11 + floatY, 3, 5);
      ctx.fillStyle = '#6A5692'; /* 兜帽与面具 */
      ctx.fillRect(x - 4, y - 32 + floatY, 8, 8);
      ctx.fillStyle = '#CFC3E8';
      ctx.fillRect(x - 3, y - 29 + floatY, 5, 4);
      ctx.fillStyle = '#9CF0FF';
      ctx.fillRect(x - 2, y - 28 + floatY, 2, 1);
      ctx.restore();
      return;
    }

    /* 石傀 / 扰位石傀 厚重体型 */
    if (u.enemyType === 'hulk' || u.enemyType === 'shuffler') {
      const coreCol = u.enemyType === 'shuffler' ? '#7FBBC8' : '#D87843';
      ctx.fillStyle = 'rgba(8,7,12,0.86)';
      ctx.fillRect(x - 9, y - 34 + bob, 18, 34);
      ctx.fillStyle = '#433C4A';
      ctx.fillRect(x - 6, y - 12, 4, 12);
      ctx.fillRect(x + 2, y - 12, 4, 12);
      ctx.fillStyle = '#5B5164';
      ctx.fillRect(x - 8, y - 29 + bob, 16, 17);
      ctx.fillStyle = '#75687E';
      ctx.fillRect(x - 7, y - 28 + bob, 6, 4);
      ctx.fillStyle = coreCol;
      ctx.fillRect(x - 2, y - 22 + bob, 4, 4);
      ctx.fillStyle = '#4F4658';
      ctx.fillRect(x - 4, y - 34 + bob, 8, 6);
      ctx.fillStyle = coreCol;
      ctx.fillRect(x - 2, y - 31 + bob, 3, 1);
      ctx.restore();
      return;
    }

    const body = u.side === 'ally' ? (SKIN_COLOR[u.skinId] || '#5E6478') : '#6B4A3C';
    const trim = u.side === 'ally' ? (SKIN_TRIM[u.skinId] || '#C8B98E') : '#A8765A';

    /* 贴体轮廓衬底（不封死腿间空隙） */
    ctx.fillStyle = 'rgba(8,7,12,0.84)';
    ctx.fillRect(x - 6, y - 25 + bob, 12, 15);
    ctx.fillRect(x - 5, y - 11, 4, 11);
    ctx.fillRect(x + 1, y - 11, 4, 11);
    ctx.fillRect(x - 5, y - 34 + bob, 10, 10);

    /* 披风（背侧） */
    if (u.side === 'ally') {
      ctx.fillStyle = u.skinId === 'cleric' ? '#8C7E6E' : '#2C2338';
      ctx.fillRect(x - dir * 6, y - 24 + bob, 3, 18);
    }

    /* 腿与战靴 */
    ctx.fillStyle = '#2B2436';
    ctx.fillRect(x - 4, y - 11, 3, 10);
    ctx.fillRect(x + 1, y - 11, 3, 10);
    ctx.fillStyle = '#463C52';
    ctx.fillRect(x - 5, y - 3, 4, 3);
    ctx.fillRect(x + 1, y - 3, 4, 3);

    /* 躯干、护甲高光与腰带 */
    ctx.fillStyle = body;
    ctx.fillRect(x - 5, y - 24 + bob, 10, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(x + (dir > 0 ? 3 : -5), y - 24 + bob, 2, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x - 4, y - 23 + bob, 2, 6);
    ctx.fillStyle = '#1D1724';
    ctx.fillRect(x - 5, y - 13 + bob, 10, 2);
    ctx.fillStyle = trim;
    ctx.fillRect(x - 1, y - 13 + bob, 2, 2);

    /* 护肩 */
    ctx.fillStyle = trim;
    ctx.fillRect(x + dir * 4 - (dir > 0 ? 0 : 2), y - 24 + bob, 3, 3);

    /* 头盔 / 兜帽 */
    ctx.fillStyle = u.side === 'ally' ? '#D6C3A5' : '#B59B82';
    ctx.fillRect(x - 3, y - 30 + bob, 6, 5);
    ctx.fillStyle = u.skinId === 'warden' ? '#7E8CA4' : body;
    ctx.fillRect(x - 4, y - 33 + bob, 8, 4);
    ctx.fillRect(x - 4, y - 30 + bob, 1, 5);
    ctx.fillRect(x + 3, y - 30 + bob, 1, 5);
    if (u.skinId === 'warden') {
      ctx.fillStyle = '#C8B98E';
      ctx.fillRect(x - 1, y - 35 + bob, 2, 2);
    }
    ctx.fillStyle = u.side === 'ally' ? '#1C1724' : '#FF6A48';
    ctx.fillRect(dir > 0 ? x + 1 : x - 2, y - 28 + bob, 2, 1);

    /* 手臂 */
    ctx.fillStyle = body;
    ctx.fillRect(x + dir * 5 - (dir > 0 ? 0 : 1), y - 22 + bob, 2, 7);

    /* 手中刻印剪影：按功法稀有度换形制（武器已移除） */
    const wx = x + dir * 6;
    const rarity = (u.ms && u.ms.spec && u.ms.spec.rarity) || 1;
    ctx.fillStyle = trim;
    if (rarity >= 6) {
      ctx.fillRect(wx, y - 28 + bob, 2, 16);
      ctx.fillStyle = '#F2CF7E';
      ctx.fillRect(wx - 2, y - 33 + bob, 6, 5);
    } else if (rarity >= 4) {
      ctx.fillRect(wx - 1, y - 24 + bob, 6, 5);
      ctx.fillStyle = '#D87843';
      ctx.fillRect(wx + (dir > 0 ? 5 : -2), y - 23 + bob, 2, 3);
    } else if (rarity >= 2) {
      ctx.fillRect(wx, y - 26 + bob, 1, 18);
      ctx.fillStyle = '#DDE5EE';
      ctx.fillRect(wx - 1, y - 30 + bob, 3, 4);
    } else {
      ctx.fillRect(wx, y - 24 + bob, 2, 12);
      ctx.fillStyle = '#D9AD65';
      ctx.fillRect(wx - 1, y - 13 + bob, 4, 1);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function overhead(u, x, y) {
    if (u.alive === false) return;
    const bw = 20;
    const bx = x - bw / 2;

    /* HP 条 */
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.fillRect(bx - 1, y - 46, bw + 2, 5);
    const ratio = Math.max(0, Math.min(1, u.hp / u.maxHp));
    ctx.fillStyle = ratio > 0.5 ? '#D36A65' : ratio > 0.25 ? '#D9AD65' : '#9E2A24';
    ctx.fillRect(bx, y - 45, Math.round(bw * ratio), 3);

    /* 行动条 Gauge (0..60) */
    const gPct = Math.max(0, Math.min(1, (u.gauge || 0) / 60));
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(bx - 1, y - 41, bw + 2, 2);
    ctx.fillStyle = gPct >= 0.85 ? '#F2CF7E' : '#8A7E6E';
    ctx.fillRect(bx, y - 41, Math.round(bw * gPct), 1.5);

    /* 护盾条 */
    if (u.shield > 0) {
      ctx.fillStyle = 'rgba(127,187,200,0.9)';
      const sw = Math.round(bw * Math.min(1, u.shield / Math.max(1, u.maxHp * 0.3)));
      ctx.fillRect(bx, y - 49, sw, 2);
    }

    /* 能量点（我方） */
    if (u.side === 'ally' && u.runtime) {
      const main = V.Circuit.outputTokens(u.runtime, 'main').length;
      const sup = V.Circuit.outputTokens(u.runtime, 'support').length;
      const px = x - 9;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i < main ? '#F2CF7E' : 'rgba(232,196,106,0.20)';
        ctx.fillRect(px + i * 5, y - 54, 3, 3);
      }
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i < sup ? '#7FBBC8' : 'rgba(127,187,200,0.20)';
        ctx.fillRect(px + i * 5, y - 59, 3, 2);
      }
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

    const paused = !!(V.App && V.App.ui && V.App.ui.paused);
    const effDt = paused ? 0 : dt;
    if (effDt > 0 && A.SpriteAnim) {
      const speed = Math.min((V.App && V.App.ui && V.App.ui.speed) || 1, 2);
      A.SpriteAnim.update([...b.allies.map(toAnimUnit), ...b.enemies.map(toAnimUnit)], effDt * speed);
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
      /* 残影折射表现 */
      if (u.refract > 0 && u.alive !== false) {
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#7FBBC8';
        ctx.fillRect(x - 6, y - 32, 12, 32);
        ctx.restore();
      }

      const anim = toAnimUnit(u);
      const played = A.SpriteAnim && A.SpriteAnim.supports(anim)
        && A.SpriteAnim.draw(ctx, anim, x, y, CELL);
      if (!played) drawFallback(u, x, y, paused ? 0 : now);

      if (ht && ht.ttl > 80) {
        ctx.save();
        ctx.fillStyle = ht.crit ? 'rgba(242, 207, 126, 0.32)' : 'rgba(255, 255, 255, 0.25)';
        ctx.fillRect(x - 7, y - 34, 14, 34);
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
    if (tc) tc.textContent = '战术：' + ({ balance: '均衡', focus: '集火', safe: '保守' }[b.tactic] || '均衡');
    const next = document.getElementById('btlNext');
    if (next) next.style.display = b.over ? '' : 'none';
    const tk = document.querySelector('.bt-tick');
    if (tk) tk.textContent = '第 ' + b.tick + ' 刻';
    /* 双方信息条随 tick 更新，但不动 canvas */
    const ab = document.querySelector('.side.allies');
    if (ab) ab.innerHTML = b.allies.map((u) => V.UI.battleBar(u)).join('');
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

  V.View = { mount, renderFrame, updateHud, reset, targetX, CW, CH, GROUND };
})(globalThis.Ashen ||= {});
