'use strict';
/* Canvas 战斗视图：只画画，不修改任何战斗结果。
   逻辑空间 320×100，地面 GROUND=84，按整数倍等比显示。 */
(function (A) {
  'use strict';

  const CW = 320, CH = 100, GROUND = 84, SCALE = 3;
  const TICKS_PER_ROUND = 6;

  let canvas = null;
  let ctx = null;
  let effects = [];
  let lastTime = 0;
  let lastFrameNow = 0;

  // 逐帧角色显示宽度（逻辑单位）；512 帧里角色实际占约 265px 宽
  const ANIM_CELL = 40;

  function unitPos(u) {
    const i = u.slot;
    if (u.side === 'ally') return { x: 118 - i * 29, y: GROUND };
    return { x: 202 + i * 29, y: GROUND };
  }

  function mount(state) {
    canvas = document.getElementById('cv');
    if (!canvas) { ctx = null; return; }
    ctx = canvas.getContext('2d');
    effects = [];
    lastFrameNow = 0;
    // 恢复战斗时按存活状态初始化，不重放历史伤害事件
    const b = state && state.run && state.run.battle;
    A.SpriteAnim.syncFromBattle(b);
  }

  function pushEffect(e) {
    e.life = e.life || 20;
    e.max = e.life;
    effects.push(e);
  }

  /** 由 app 在日志事件后调用，把逻辑事件转成视觉反馈。 */
  function onEvent(ev) {
    if (!ev) return;
    if (ev.type === 'hit' || ev.type === 'crit') {
      const pos = ev.__pos;
      if (!pos) return;
      pushEffect({ t: 'float', x: pos.x, y: pos.y - 42, txt: (ev.amount || 0) + (ev.meta && ev.meta.crit ? '!' : ''), col: ev.type === 'crit' ? '#D9AD65' : '#E5DBCA', big: ev.type === 'crit' });
      pushEffect({ t: 'slash', x: pos.x, y: pos.y - 14, col: ev.type === 'crit' ? '#D9AD65' : '#E5DBCA', life: 12 });
    } else if (ev.type === 'miss') {
      pushEffect({ t: 'float', x: 60, y: 40, txt: 'MISS', col: '#7FBBC8', life: 18 });
    } else if (ev.type === 'heal') {
      pushEffect({ t: 'float', x: 60, y: 40, txt: '+' + (ev.amount || 0), col: '#8DB69B', life: 20 });
    } else if (ev.type === 'bossPhase') {
      pushEffect({ t: 'shock', x: 240, y: GROUND - 20, col: '#D36A65', life: 26 });
    }
  }

  const hash01 = (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };

  let currentBgId = 'scene.corridor';

  function drawBackground(now) {
    // 优先使用场景图，按 groundY 锚点对齐；失败则程序绘制
    const art = A.Art.getArt(currentBgId);
    const img = art ? A.Art.getImage(currentBgId) : null;

    if (img && img.naturalWidth) {
      const targetH = CW * 3 / 10 * 10; // 320 * (1/3.2)... 用 3:1 比例
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const drawH = CW / imgRatio;
      const gy = (art.groundY || 0.84) * drawH;
      const offsetY = GROUND - gy; // 让图片地面线对齐到 GROUND
      ctx.drawImage(img, 0, offsetY, CW, drawH);
      // 覆盖一层暗色，保证人物可读
      ctx.fillStyle = 'rgba(11,10,16,0.45)';
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = 'rgba(11,10,16,0.62)';
      ctx.fillRect(0, GROUND, CW, CH - GROUND);
      return;
    }

    // 程序化降级背景
    ctx.fillStyle = '#0C0912';
    ctx.fillRect(0, 0, CW, CH);

    for (let y = 0; y < GROUND; y += 7) {
      for (let x = (y % 14 === 0 ? 0 : -7); x < CW; x += 14) {
        const r = hash01(x, y);
        ctx.fillStyle = r > 0.55 ? '#1A1428' : r > 0.25 ? '#151021' : '#120E1C';
        ctx.fillRect(x + 1, y + 1, 12, 5);
      }
    }

    for (const px of [14, 306]) {
      ctx.fillStyle = '#0A0710';
      ctx.fillRect(px - 9, 0, 18, GROUND);
      ctx.fillStyle = '#1E1729';
      ctx.fillRect(px - 9, 0, 2, GROUND);
      ctx.fillRect(px + 7, 0, 2, GROUND);
    }

    for (const tx of [46, 274]) {
      const g = ctx.createRadialGradient(tx, 34, 2, tx, 34, 46);
      g.addColorStop(0, 'rgba(216,120,67,0.22)');
      g.addColorStop(1, 'rgba(216,120,67,0)');
      ctx.fillStyle = g;
      ctx.fillRect(tx - 46, 0, 92, 90);
      const fl = 1 + Math.sin(now / 110 + tx) * 0.8;
      ctx.fillStyle = '#C9601E';
      ctx.fillRect(tx - 2, 28 - fl, 4, 5 + fl);
      ctx.fillStyle = '#E8963A';
      ctx.fillRect(tx - 1, 29 - fl, 2, 3 + fl);
    }

    ctx.fillStyle = '#090710';
    ctx.fillRect(0, GROUND, CW, CH - GROUND);
    ctx.fillStyle = '#2A2038';
    ctx.fillRect(0, GROUND, CW, 1);
  }

  function drawUnit(u, now) {
    const p = unitPos(u);

    // ① 逐帧动画优先：只要资源就绪就交给动画层，包括死亡倒地序列。
    //    这样下面的 `if (!u.alive)` 占位尸体分支不会抢在倒地动画前返回。
    if (A.SpriteAnim.supports(u) && A.SpriteAnim.draw(ctx, u, p.x, p.y, ANIM_CELL)) {
      drawOverhead(u, p);
      return;
    }

    if (!u.alive) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#4A3A52';
      ctx.fillRect(p.x - 8, p.y - 5, 16, 5);
      ctx.globalAlpha = 1;
      return;
    }

    const dir = u.side === 'ally' ? 1 : -1;
    const scale = u.isBoss ? 1.55 : u.isElite ? 1.22 : 1;
    let ox = 0;

    if (scale !== 1) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(scale, scale);
      ctx.translate(-p.x, -p.y);
    }

    const c = u.color, ac = u.accent;

    // 影子
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#000';
    ctx.fillRect(p.x - 8, p.y - 2, 16, 3);
    ctx.globalAlpha = 1;

    // 腿（比地面亮，保证在暗背景上可读）
    ctx.fillStyle = '#3A3048';
    ctx.fillRect(p.x - 4, p.y - 11, 3, 9);
    ctx.fillRect(p.x + 1, p.y - 11, 3, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(p.x - 4, p.y - 11, 1, 9);
    ctx.fillRect(p.x + 1, p.y - 11, 1, 9);
    // 靴
    ctx.fillStyle = '#302640';
    ctx.fillRect(p.x - 5, p.y - 3, 4, 2);
    ctx.fillRect(p.x + 1, p.y - 3, 4, 2);

    // 躯干
    ctx.fillStyle = c;
    ctx.fillRect(p.x - 5, p.y - 24, 10, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(p.x + (dir > 0 ? 3 : -5), p.y - 24, 2, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(p.x - 5, p.y - 13, 10, 2);
    // 布料/金属的像素颗粒
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(p.x - 3, p.y - 21, 1, 1);
    ctx.fillRect(p.x + 1, p.y - 18, 1, 1);
    ctx.fillRect(p.x - 1, p.y - 16, 1, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(p.x - 3, p.y - 23, 1, 1);
    ctx.fillStyle = ac;
    ctx.fillRect(p.x - 6, p.y - 24, 3, 3);
    ctx.fillRect(p.x + 3, p.y - 24, 3, 3);

    // 头
    const skin = u.shape === 'ghost' ? ac : u.shape === 'hulk' ? '#8A8A92' : '#D6C6AC';
    ctx.fillStyle = skin;
    ctx.fillRect(p.x - 3, p.y - 31, 7, 7);
    ctx.fillStyle = c;
    ctx.fillRect(p.x - 3, p.y - 32, 7, 3);
    ctx.fillStyle = u.side === 'ally' ? '#1A1420' : '#FF5A3A';
    ctx.fillRect(p.x + (dir > 0 ? 1 : -2), p.y - 28, 2, 1);

    // 武器剪影
    if (u.side === 'ally') {
      const wx = p.x + dir * 6;
      if (u.cls === 'blade') {
        ctx.fillStyle = '#B8B0CC';
        ctx.fillRect(wx, p.y - 27, 2, 16);
      } else if (u.cls === 'warden') {
        ctx.fillStyle = '#5A6A86';
        ctx.fillRect(wx, p.y - 24, 4, 13);
      } else if (u.cls === 'ranger') {
        ctx.strokeStyle = '#A88448';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(wx + 1, p.y - 18, 6, -1.25, 1.25);
        ctx.stroke();
      } else if (u.cls === 'warlock') {
        ctx.fillStyle = '#3A2A50';
        ctx.fillRect(wx, p.y - 29, 2, 19);
        ctx.fillStyle = '#C49AEC';
        ctx.fillRect(wx - 2, p.y - 33, 5, 4);
      } else if (u.cls === 'cleric') {
        ctx.fillStyle = '#D8C87A';
        ctx.fillRect(wx, p.y - 28, 2, 18);
        ctx.fillStyle = '#FFF8CF';
        ctx.fillRect(wx - 2, p.y - 24, 6, 2);
      } else if (u.cls === 'rogue') {
        ctx.fillStyle = '#A0B0C4';
        ctx.fillRect(wx, p.y - 20, 2, 8);
      }
    } else if (u.shape === 'hulk') {
      ctx.fillStyle = ac;
      ctx.fillRect(p.x - 8, p.y - 25, 3, 10);
      ctx.fillRect(p.x + 5, p.y - 25, 3, 10);
    } else if (u.shape === 'ghost') {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = ac;
      ctx.fillRect(p.x - 4, p.y - 10, 8, 10);
      ctx.globalAlpha = 1;
    }

    // 护盾
    if (u.shield > 0) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#7FBBC8';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - 7, p.y - 33, 14, 33);
      ctx.globalAlpha = 1;
    }

    drawOverhead(u, p);

    if (scale !== 1) ctx.restore();
  }

  /** 血条 / 护盾 / 意图：与角色绘制无关，动画角色同样需要。 */
  function drawOverhead(u, p) {
    // 已阵亡不再画头顶信息，避免血条飘在倒地角色上方
    if (u.alive === false || u.hp <= 0) return;
    // 贴地阴影（让脚有着落）
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#000';
    ctx.fillRect(p.x - 6, p.y - 1, 12, 1);
    ctx.fillRect(p.x - 4, p.y, 8, 1);
    ctx.globalAlpha = 1;

    // 头顶血条
    const bw = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(p.x - bw / 2 - 1, p.y - 46, bw + 2, 5);
    ctx.fillStyle = 'rgba(229,219,202,0.25)';
    ctx.fillRect(p.x - bw / 2 - 1, p.y - 46, bw + 2, 1);
    const ratio = Math.max(0, Math.min(1, u.hp / u.maxHp));
    ctx.fillStyle = ratio > 0.5 ? '#D36A65' : ratio > 0.25 ? '#D9AD65' : '#8A2A24';
    ctx.fillRect(p.x - bw / 2, p.y - 45, Math.round(bw * ratio), 3);

    // 意图标记
    if (u.intent) {
      ctx.fillStyle = '#D36A65';
      ctx.fillRect(p.x - 1, p.y - 45, 2, 3);
      ctx.fillRect(p.x - 3, p.y - 49, 6, 3);
    }
  }

  function drawEffects() {
    effects = effects.filter((e) => {
      e.life -= 1;
      const k = e.life / e.max;
      if (e.t === 'float') {
        ctx.globalAlpha = Math.min(1, k * 1.8);
        ctx.fillStyle = e.col;
        ctx.font = (e.big ? 'bold 7px' : '6px') + ' monospace';
        ctx.textAlign = 'center';
        ctx.fillText(e.txt, e.x, e.y - (1 - k) * 14);
        ctx.globalAlpha = 1;
      } else if (e.t === 'slash') {
        ctx.globalAlpha = k;
        ctx.strokeStyle = e.col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.x - 6, e.y - 6);
        ctx.lineTo(e.x + 6, e.y + 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (e.t === 'shock') {
        ctx.globalAlpha = k;
        ctx.strokeStyle = e.col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, (1 - k) * 26 + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      return e.life > 0;
    });
  }

  function renderFrame(state, now) {
    if (!canvas) mount();
    if (!ctx) return;
    const b = state.run && state.run.battle;
    if (!b) return;

    currentBgId = b.kind === 'boss' ? 'scene.boss' : 'scene.corridor';

    // —— 动画表现层：消费新事件、按真实时间推进（受暂停与倍率影响）——
    const units = [...b.allies, ...b.enemies];
    A.SpriteAnim.consume(b);
    const ui = A.App && A.App.ui;
    const dt = lastFrameNow ? Math.min(120, now - lastFrameNow) : 16;
    lastFrameNow = now;
    const speed = (ui && ui.speed) || 1;
    const paused = !!(ui && ui.paused) || (ui && ui.screen !== 'battle');
    A.SpriteAnim.update(units, paused ? 0 : dt * Math.min(speed, 2), {
      onAttackImpact(u) {
        const pos = unitPos(u);
        pushEffect({ t: 'slash', x: pos.x + (u.side === 'ally' ? 8 : -8), y: pos.y - 16, col: u.side === 'ally' ? '#E5DBCA' : '#D36A65', life: 10 });
        if (A.Sfx) A.Sfx.play('hit');
      },
    });

    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;

    drawBackground(now);

    const order = [...b.allies.slice().sort((x, y) => y.slot - x.slot),
                   ...b.enemies.slice().sort((x, y) => y.slot - x.slot)];
    order.forEach((u) => drawUnit(u, now));
    drawEffects();
  }

  /* ---------- HUD ---------- */

  function barHtml(u, side) {
    const hpPct = Math.max(0, Math.min(100, Math.round(u.hp / u.maxHp * 100)));
    const gPct = Math.max(0, Math.min(100, Math.round(u.gauge / 60 * 100)));
    const statuses = u.buffs.filter((bb) => bb.stackKey !== 'burn' || true).slice(0, 3)
      .map((bb) => ({ burn: '灼', spd: '缓', dmgReduce: '减', atk: '攻' }[bb.k] || ''))
      .filter(Boolean).join('');
    if (side === 'enemy') {
      return `<div class="ubar ${u.alive ? '' : 'dead'}">
        <div class="ubar-top"><span>${esc(u.name)}</span><span>${u.hp}</span></div>
        <div class="bar hp"><i style="width:${hpPct}%"></i></div>
        <div class="bar gauge"><i style="width:${gPct}%"></i></div>
      </div>`;
    }
    const cls = u.cls ? A.Data.CLASSES[u.cls] : null;
    return `<div class="ubar ${u.alive ? '' : 'dead'}">
      <div class="ubar-top"><span>${esc(u.name)}</span><span>${u.hp}/${u.maxHp}</span></div>
      <div class="bar hp"><i style="width:${hpPct}%"></i></div>
      <div class="bar gauge"><i style="width:${gPct}%"></i></div>
      <div class="ubar-bot"><span>${cls ? esc(cls.name) : ''}</span><span>${u.shield > 0 ? '盾 ' + Math.round(u.shield) : ''}${statuses}</span></div>
    </div>`;
  }

  const esc = (s) => A.Art.safeText(s);

  function updateHud(state) {
    const b = state.run && state.run.battle;
    if (!b) return;

    const eb = document.getElementById('enemyBars');
    if (eb) {
      const arr = b.enemies.slice(0, 4);
      while (arr.length < 4) arr.push(null);
      eb.innerHTML = arr.map((u) => (u ? barHtml(u, 'enemy') : '<div class="ubar empty"></div>')).join('');
    }

    const ab = document.getElementById('allyBars');
    if (ab) {
      const arr = b.allies.slice(0, 4).reverse();
      while (arr.length < 4) arr.unshift(null);
      ab.innerHTML = arr.map((u) => (u ? barHtml(u, 'ally') : '<div class="ubar empty"></div>')).join('');
    }

    const log = document.getElementById('btlLog');
    if (log) {
      const lines = b.logs.slice(-14).map((ev) => fmtLog(ev, b));
      log.innerHTML = lines.join('');
      log.scrollTop = log.scrollHeight;
    }

    const next = document.getElementById('btlNext');
    if (next) next.style.display = b.over ? '' : 'none';

    // 战斗界面不整体重建，速度/战术按钮文字必须在这里同步
    const ui = (A.App && A.App.ui) || {};
    const sp = document.getElementById('btlSpeed');
    if (sp) sp.textContent = '速度 ×' + (ui.speed || 1);
    const tc = document.getElementById('btlTactic');
    if (tc) tc.textContent = '战术：' + ({ balance: '均衡', focus: '集火', safe: '保守' }[b.tactic] || '均衡');

    const bossUnit = b.enemies.find((e) => e.isBoss);
    const bossBar = document.querySelector('.boss-card .bar i');
    if (bossBar && bossUnit) bossBar.style.width = Math.round(bossUnit.hp / bossUnit.maxHp * 100) + '%';
    const intentEl = document.querySelector('.boss-info .boss-intent');
    if (intentEl && bossUnit) {
      intentEl.innerHTML = bossUnit.intent
        ? `<span class="intent">预告：${esc((A.Data.SKILLS[bossUnit.intent] || {}).name || '大招')}</span>`
        : '正在观察你们';
    }
  }

  function nameOf(id, b) {
    const u = [...b.allies, ...b.enemies].find((x) => x.id === id);
    return u ? u.name : '';
  }

  function fmtLog(ev, b) {
    const a = nameOf(ev.actorId, b);
    const t = nameOf(ev.targetId, b);
    switch (ev.type) {
      case 'act': return `<div class="lg">${esc(a)} 使用 ${esc(ev.meta.skill)}</div>`;
      case 'hit': return `<div class="lg dmg">${esc(a)} → ${esc(t)} <b>${ev.amount}</b></div>`;
      case 'crit': return `<div class="lg crit">${esc(a)} → ${esc(t)} <b>${ev.amount}</b> 暴击</div>`;
      case 'miss': return `<div class="lg mute">${esc(t)} 闪开了</div>`;
      case 'heal': return `<div class="lg heal">${esc(a)} 治疗 ${esc(t)} +${ev.amount}</div>`;
      case 'dot': return `<div class="lg dmg">${esc(t)} 灼烧 -${ev.amount}</div>`;
      case 'death': return `<div class="lg sys">${esc(t)} 倒下</div>`;
      case 'skip': return `<div class="lg mute">${esc(a)} 被眩晕</div>`;
      case 'stun': return `<div class="lg sys">${esc(t)} 眩晕</div>`;
      case 'stress': return `<div class="lg sys">全队压力上升</div>`;
      case 'bossPhase': return `<div class="lg sys">${esc(ev.targetId ? nameOf(ev.targetId, b) : '首领')} 进入第二阶段</div>`;
      case 'note': return `<div class="lg sys">${esc((ev.meta && ev.meta.text) || '')}</div>`;
      case 'victory': return '<div class="lg sys">战斗胜利</div>';
      case 'defeat': return '<div class="lg sys">全员倒下</div>';
      case 'timeout': return '<div class="lg sys">战斗超时</div>';
      default: return '';
    }
  }

  A.BattleView = { mount, renderFrame, updateHud, onEvent, unitPos, pushEffect, CW, CH, GROUND };
})(globalThis.Ashen ||= {});
