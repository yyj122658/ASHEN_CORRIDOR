'use strict';
/* 战场显示：画布、脚底锚点、位置插值、逐帧动画复用与降级。
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

  function reset() {
    lastTs = 0;
    displayX = new Map();
    lastLogSeq = 0;
    if (A.SpriteAnim && A.SpriteAnim.reset) A.SpriteAnim.reset();
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

  function consumeEvents(state) {
    const b = state.run && state.run.battle;
    if (!b || !A.SpriteAnim) return;
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
    fresh.forEach((l) => {
      const actor = l.actorId ? byId.get(l.actorId) : null;
      const target = l.targetId ? byId.get(l.targetId) : null;
      if (l.type === 'hit' || l.type === 'crit') {
        if (actor) A.SpriteAnim.play(toAnimUnit(actor), 'attack');
        if (target) A.SpriteAnim.play(toAnimUnit(target), 'hurt');
      } else if (l.type === 'miss') {
        if (actor) A.SpriteAnim.play(toAnimUnit(actor), 'attack');
      } else if (l.type === 'death' && target) {
        A.SpriteAnim.play(toAnimUnit(target), 'death');
      } else if (l.type === 'telegraph' && actor) {
        A.SpriteAnim.play(toAnimUnit(actor), 'attack');
      } else if (l.type === 'heal' && actor) {
        A.SpriteAnim.play(toAnimUnit(actor), 'attack');
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
      ctx.fillStyle = 'rgba(11,10,16,0.46)';
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = 'rgba(11,10,16,0.60)';
      ctx.fillRect(0, GROUND, CW, CH - GROUND);
      return;
    }
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

  const SKIN_COLOR = {
    blade: '#5E6E8E', warden: '#6A7C98', ranger: '#5E7248',
    cleric: '#7C6A94', warlock: '#584470', rogue: '#565062',
  };

  function drawFallback(u, x, y) {
    const dir = u.side === 'ally' ? 1 : -1;
    const dead = u.alive === false;
    const scale = u.isBoss ? 1.5 : u.isElite ? 1.2 : 1;
    const body = u.side === 'ally' ? (SKIN_COLOR[u.skinId] || '#5E6478') : '#6B4A3C';
    const accent = u.side === 'ally' ? '#C8B98E' : '#8E5A46';

    ctx.save();
    if (scale !== 1) {
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.translate(-x, -y);
    }
    ctx.globalAlpha = dead ? 0.34 : 1;

    /* 落地阴影 */
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 7, y - 1, 14, 2);

    if (dead) {
      ctx.fillStyle = u.side === 'ally' ? '#4A4A5A' : '#4A3730';
      ctx.fillRect(x - 9, y - 5, 18, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - 10, y - 1, 20, 2);
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    /* 轮廓：先描一圈近黑底，保证在场景图上能分离出来（必须在内容之前） */
    ctx.fillStyle = 'rgba(8,7,12,0.82)';
    ctx.fillRect(x - 6, y - 25, 12, 25);
    ctx.fillRect(x - 4, y - 33, 8, 9);

    /* 腿与靴 */
    ctx.fillStyle = '#2E2838';
    ctx.fillRect(x - 4, y - 11, 3, 9);
    ctx.fillRect(x + 1, y - 11, 3, 9);
    ctx.fillStyle = '#3E3648';
    ctx.fillRect(x - 5, y - 3, 4, 2);
    ctx.fillRect(x + 1, y - 3, 4, 2);

    /* 躯干 + 暗面 + 腰带 */
    ctx.fillStyle = body;
    ctx.fillRect(x - 5, y - 24, 10, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(x + (dir > 0 ? 3 : -5), y - 24, 2, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 5, y - 13, 10, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x - 4, y - 23, 2, 7);

    /* 肩甲（朝向侧更亮） */
    ctx.fillStyle = accent;
    ctx.fillRect(x + dir * 4 - (dir > 0 ? 0 : 2), y - 24, 2, 3);

    /* 头：脸只露一条，兜帽盖住上半 */
    ctx.fillStyle = u.side === 'ally' ? '#C9B79A' : '#AE957C';
    ctx.fillRect(x - 3, y - 30, 6, 5);
    ctx.fillStyle = body;
    ctx.fillRect(x - 3, y - 32, 6, 4);
    ctx.fillRect(x - 4, y - 30, 1, 4);
    ctx.fillRect(x + 3, y - 30, 1, 4);
    ctx.fillStyle = u.side === 'ally' ? '#1C1724' : '#FF6A48';
    ctx.fillRect(dir > 0 ? x + 1 : x - 2, y - 28, 2, 1);

    /* 手臂 */
    ctx.fillStyle = body;
    ctx.fillRect(x + dir * 5 - (dir > 0 ? 0 : 1), y - 22, 2, 7);

    /* 武器剪影：只做识别，不表达数值 */
    const wx = x + dir * 6;
    ctx.fillStyle = accent;
    if (u.weaponId === 'shortBlade') {
      ctx.fillRect(wx, y - 25, 1, 13);
      ctx.fillRect(wx - 1, y - 13, 3, 1);
    } else if (u.weaponId === 'towerShield') {
      ctx.fillRect(wx, y - 22, 4, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(wx, y - 22, 4, 1);
    } else if (u.weaponId === 'longSpear') {
      ctx.fillRect(wx, y - 29, 1, 20);
      ctx.fillRect(wx - 1, y - 31, 3, 2);
    } else if (u.weaponId === 'heavyCannon') {
      ctx.fillRect(wx - 1, y - 21, 5, 4);
      ctx.fillStyle = '#3A3030';
      ctx.fillRect(wx + (dir > 0 ? 4 : -2), y - 20, 3, 2);
    } else if (u.weaponId === 'ritualStaff') {
      ctx.fillRect(wx, y - 28, 1, 17);
      ctx.fillStyle = '#D8C87A';
      ctx.fillRect(wx - 1, y - 31, 3, 3);
    } else if (u.enemyType) {
      /* 敌方：爪/骨刺 */
      ctx.fillStyle = '#B9A48C';
      ctx.fillRect(wx, y - 18, 1, 8);
      ctx.fillRect(wx + dir, y - 20, 1, 4);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function overhead(u, x, y) {
    if (u.alive === false) return;
    const bw = 18;
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(x - bw / 2 - 1, y - 44, bw + 2, 5);
    const ratio = Math.max(0, Math.min(1, u.hp / u.maxHp));
    ctx.fillStyle = ratio > 0.5 ? '#D36A65' : ratio > 0.25 ? '#D9AD65' : '#8A2A24';
    ctx.fillRect(x - bw / 2, y - 43, Math.round(bw * ratio), 3);

    /* 护盾条 */
    if (u.shield > 0) {
      ctx.fillStyle = 'rgba(127,187,200,0.85)';
      const sw = Math.round(bw * Math.min(1, u.shield / Math.max(1, u.maxHp * 0.3)));
      ctx.fillRect(x - bw / 2, y - 47, sw, 2);
    }

    /* 能量点（我方） */
    if (u.side === 'ally' && u.runtime) {
      const main = V.Circuit.outputTokens(u.runtime, 'main').length;
      const sup = V.Circuit.outputTokens(u.runtime, 'support').length;
      let px = x - 9;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i < main ? '#E8C46A' : 'rgba(232,196,106,0.18)';
        ctx.fillRect(px + i * 5, y - 52, 3, 3);
      }
      let sx = x - 9;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i < sup ? '#7FBBC8' : 'rgba(127,187,200,0.18)';
        ctx.fillRect(sx + i * 5, y - 57, 3, 2);
      }
    }

    /* 蓄力预告 */
    if (u.charging) {
      ctx.fillStyle = '#D36A65';
      ctx.fillRect(x - 2, y - 62, 4, 4);
      ctx.fillRect(x - 1, y - 68, 2, 4);
    }

    if (u.isBoss) {
      ctx.fillStyle = '#E8C46A';
      ctx.fillRect(x - 1, y - 62, 2, 2);
      ctx.fillRect(x - 4, y - 61, 2, 1);
      ctx.fillRect(x + 3, y - 61, 2, 1);
    }
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
    if (!paused && A.SpriteAnim) {
      const speed = Math.min((V.App && V.App.ui && V.App.ui.speed) || 1, 2);
      A.SpriteAnim.update([...b.allies.map(toAnimUnit), ...b.enemies.map(toAnimUnit)], dt * speed);
    }

    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawBackground();

    /* 位置插值 */
    [...b.allies, ...b.enemies].forEach((u) => {
      const tx = targetX(u);
      const cur = displayX.has(u.id) ? displayX.get(u.id) : tx;
      const nx = cur + (tx - cur) * Math.min(1, dt / 140);
      displayX.set(u.id, Math.abs(nx - tx) < 0.4 ? tx : nx);
    });

    const ordered = [...b.enemies.slice().sort((a, c) => c.slot - a.slot),
      ...b.allies.slice().sort((a, c) => c.slot - a.slot)];

    ordered.forEach((u) => {
      const x = Math.round(displayX.get(u.id) || targetX(u));
      const y = GROUND;
      const anim = toAnimUnit(u);
      const played = A.SpriteAnim && A.SpriteAnim.supports(anim)
        && A.SpriteAnim.draw(ctx, anim, x, y, CELL);
      if (!played) drawFallback(u, x, y);
      overhead(u, x, y);
    });

    /* 战斗结束：只做边缘压暗，胜负交给下方的结果面板，不画横贯画面的线 */
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
