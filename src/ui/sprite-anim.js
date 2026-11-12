'use strict';
/* 战斗图集按单位身份加载，动作只消费表现事件。 */
(function (A) {
  'use strict';

  const BASE = 'assets/art/battle-v1/';
  const PRIORITY = { idle: 0, attack: 1, cast: 1, move: 1, guard: 2, dodge: 2, hurt: 2, death: 3 };

  // 脚底为原点。三个关键姿势依次为预备、出手、收势，单位为格宽的百分之一及角度。
  const choreography = {
    blade:     ['sweep','#d5bc91', [-8,0,-9], [22,-4,14], [7,0,5]],
    warden:    ['ring','#b0b9ae', [-4,3,-6], [11,3,9], [4,2,2]],
    ranger:    ['shaft','#d9b578', [2,1,5], [-9,-2,-9], [-3,0,-2]],
    warlock:   ['coil','#a993c9', [-2,-3,-5], [4,-13,7], [2,-5,2]],
    cleric:    ['ring','#f5ca83', [0,2,4], [3,-8,-4], [1,-3,-2]],
    rogue:     ['shaft','#a3bcb9', [-12,4,-12], [32,-7,19], [9,2,8]],
    wanderer0: ['sweep','#cfb48a', [-5,4,-15], [17,-6,20], [6,1,9]],
    wanderer1: ['ring','#97b5c4', [-4,4,-8], [9,5,13], [5,1,6]],
    wanderer2: ['shaft','#c6b5a3', [-8,1,-4], [22,0,9], [4,0,1]],
    wanderer3: ['coil','#c5b9ba', [-7,-3,-6], [9,-7,10], [-2,-2,-3]],
    wanderer4: ['sweep','#a4aac9', [-6,1,-9], [15,-14,15], [6,-5,5]],
    wanderer5: ['ring','#d0af77', [0,-7,-8], [9,5,14], [3,2,7]],
    wanderer6: ['shaft','#add7d8', [4,-3,6], [-6,-5,-8], [0,-2,-2]],
    wanderer7: ['sweep','#d78e6d', [-9,4,-13], [16,3,22], [8,2,10]],
    wanderer8: ['ring','#bcd2ab', [-4,1,-4], [2,-10,5], [-1,-3,0]],
    wanderer9: ['coil','#c7afd1', [-4,-2,-7], [7,-5,8], [3,-1,3]],
    wanderer10:['sweep','#b2bdcc', [-7,3,-8], [25,-18,18], [10,-5,8]],
    wanderer11:['coil','#a4bd8e', [-5,3,-9], [9,0,12], [4,1,6]],
    wanderer12:['ring','#b5b4d1', [-5,-5,-10], [8,-2,13], [3,-3,3]],
    wanderer13:['coil','#edab75', [-7,2,-10], [14,-6,16], [5,-2,6]],
    wanderer14:['shaft','#e0d8b7', [-4,3,-6], [26,-2,11], [6,1,4]],
  };
  const reactions = {
    move:[[0,1,-5],[0,-7,7],[0,-2,2]],
    dodge:[[-2,2,-6],[-19,-4,-17],[-6,1,-5]],
    guard:[[-3,2,-6],[-5,4,-9],[-2,2,-3]],
    cast:[[0,2,-5],[-2,-7,-7],[3,-2,5]],
  };

  function drawGesture(ctx, anim, score, time, scale) {
    const poses = reactions[anim] || (anim === 'attack' && score.slice(2));
    if (!poses) return;
    const stops = [0,.27,.54,.77,1], rest = [0,0,0];
    const i = time < stops[1] ? 0 : time < stops[2] ? 1 : time < stops[3] ? 2 : 3;
    const a = poses[i-1] || rest, b = poses[i] || rest;
    const t = (time - stops[i]) / (stops[i+1] - stops[i]);
    const ease = t*t*(3-2*t);
    const value = k => a[k] + (b[k]-a[k])*ease;
    ctx.translate(value(0)*scale, value(1)*scale);
    ctx.rotate(value(2)*Math.PI/180);
    if ((anim !== 'attack' && anim !== 'cast') || time < .26 || time > .86) return;
    const p = (time-.26)/.6;
    ctx.save();
    ctx.scale(scale,scale);
    ctx.globalAlpha *= Math.sin(p*Math.PI)*.9;
    ctx.strokeStyle = score[1];
    ctx.lineWidth = 2;
    ctx.beginPath();
    const kind = anim === 'cast' ? 'ring' : score[0];
    if (kind === 'sweep') {
      ctx.arc(7,-43,32,-1.5+p*.6,-1.4+p*2.8);
    } else if (kind === 'shaft') {
      ctx.moveTo(16+p*28,-45+p*3);
      ctx.lineTo(23+p*57,-48+p*3);
    } else if (kind === 'ring') {
      ctx.ellipse(12,-36,9+p*25,5+p*13,-.3,0,2*Math.PI);
    } else {
      ctx.moveTo(8,-32);
      ctx.bezierCurveTo(24,-64+p*20,33,-18-p*16,25+p*34,-45);
    }
    ctx.stroke();
    ctx.restore();
  }

  let atlas = null;
  const sheets = new Map();
  const loading = new Map();
  const states = Object.create(null);

  function characterStrip(id, facing) {
    const size = 192;
    const sheet = '../battle-v3/' + id + '.webp';
    function sequence(poses, durations, loop, impactFrame) {
      return { sheet, loop, impactFrame, frameCount: poses.length,
        frames: poses.map((pose, i) => ({
          rect: { x: pose * size, y: 0, w: size, h: size },
          pivot: { x: 96, y: 184 }, durationMs: durations[i],
        })),
      };
    }
    return { facing, frameSize: size, animations: {
      idle: sequence([0, 1], [610, 410], true),
      attack: sequence([1, 2, 3, 0], [80, 130, 180, 75], false, 2),
      hurt: sequence([4, 0], [170, 75], false),
      death: sequence([4, 5], [145, 260], false),
    } };
  }

  function init() {
    if (atlas) return true;
    const raw = typeof window !== 'undefined' ? window.ASHEN_BATTLE_ATLAS : null;
    if (!raw || !raw.characters) return false;
    const characters = { ...raw.characters };
    A.Veteran.Data.SKINS.forEach(({id}) => { if (!characters[id]) characters[id] = characterStrip(id, 'right'); });
    A.Veteran.Data.SKINS.forEach(({id}) => {
      const c = characters[id], clips = c.animations;
      const gesture = (source, indices, durations) => ({
        sheet:source.sheet, frameCount:indices.length, loop:false,
        frames:indices.map((index,i) => ({...source.frames[Math.min(index,source.frames.length-1)], durationMs:durations[i]})),
      });
      characters[id] = {...c, animations:{...clips,
        cast:gesture(clips.attack,[0,1,2,1],[95,140,150,85]),
        move:gesture(clips.idle,[0,1,0],[70,100,80]),
        guard:gesture(clips.hurt,[0,0,1],[75,105,90]),
        dodge:gesture(clips.idle,[1,0,1],[65,90,75]),
      }};
    });
    for (const {id,sprite} of Object.values(A.Veteran.Data.ENEMIES)) {
      if (!characters[id]) characters[id] = characters[sprite] || characterStrip(sprite || id, 'left');
    }
    atlas = { ...raw, characters };
    return true;
  }

  function loadSheet(sheet) {
    if (sheets.has(sheet)) return Promise.resolve(true);
    if (loading.has(sheet)) return loading.get(sheet);
    const job = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { sheets.set(sheet, img); resolve(true); };
      img.onerror = () => resolve(false);
      img.src = BASE + sheet;
    });
    loading.set(sheet, job);
    job.then(() => loading.delete(sheet));
    return job;
  }

  function preload(chars) {
    if (!init()) return Promise.resolve({ loaded: 0, failed: 0, supported: false });
    const list = chars ? new Set(chars) : Object.keys(atlas.characters);
    const jobs = [];
    list.forEach((cid) => {
      const c = atlas.characters[cid];
      if (!c) return;
      for (const action of ['idle','attack','hurt','death']) jobs.push(loadSheet(c.animations[action].sheet));
    });
    return Promise.all(jobs).then((res) => ({
      loaded: res.filter(Boolean).length, failed: res.filter((ok) => !ok).length, supported: isReady(),
    }));
  }

  function isReady() { return sheets.size > 0; }

  function charIdFor(u) {
    if (!u || !init()) return null;
    if (u.side === 'ally') {
      const id = u.skinId || u.cls;
      return A.Veteran.Data.SKINS.some((skin) => skin.id === id) ? id : null;
    }
    if (u.side !== 'enemy' || !Object.hasOwn(A.Veteran.Data.ENEMIES, u.enemyType)) return null;
    /* 亚种复用同族立绘：sprites 只在 identity 上分身，动作表还是那一套 */
    const want = A.Veteran.Data.ENEMIES[u.enemyType].sprite || u.enemyType;
    if (Object.hasOwn(atlas.characters, want)) return want;
    return Object.hasOwn(atlas.characters, u.enemyType) ? u.enemyType : null;
  }

  function supports(u) {
    const cid = charIdFor(u);
    return !!cid && Object.values(atlas.characters[cid].animations).every((anim) => sheets.has(anim.sheet));
  }

  /* ---------- 状态 ---------- */

  function ensure(u) {
    let st = states[u.id];
    if (!st) {
      st = { anim: u.alive === false ? 'death' : 'idle', frame: 0, elapsed: 0, done: u.alive === false };
      const cid = charIdFor(u);
      if (cid && st.anim === 'death') st.frame = atlas.characters[cid].animations.death.frameCount - 1;
      states[u.id] = st;
    }
    return st;
  }

  /**
   * 播放某动作。
   * - 同一动作未播完时不重启（多段伤害不会反复抽刀）
   * - death 一旦进入不再被覆盖
   * - 低优先级不能打断未完成的高优先级
   */
  function play(u, anim, opts) {
    if (!charIdFor(u)) return false;
    if (!atlas.characters[charIdFor(u)].animations[anim]) return false;
    const st = ensure(u);
    const force = !!(opts && opts.force);

    if (st.anim === 'death' && anim !== 'death') return false;
    if (!force && st.anim === anim && !st.done) return false;
    if (!force && PRIORITY[anim] < PRIORITY[st.anim] && !st.done) return false;

    st.anim = anim;
    st.frame = 0;
    st.elapsed = 0;
    st.done = false;
    return true;
  }

  /** 恢复战斗时按存活状态初始化，不重放历史事件。 */
  function syncFromBattle(b) {
    Object.keys(states).forEach((k) => { delete states[k]; });
    if (b) [...(b.allies || []), ...(b.enemies || [])].forEach(ensure);
  }

  /* ---------- 推进 ---------- */

  /**
   * @param units 当前战斗单位
   * @param dtMs 已按暂停/倍率处理过的时间增量
   */
  function update(units, dtMs, hooks) {
    if (!dtMs) return;
    units.forEach((u) => {
      if (!charIdFor(u)) return;
      const st = ensure(u);
      if (st.done) return;
      const prevFrame = st.frame;
      const cid = charIdFor(u);
      const anim = atlas.characters[cid].animations[st.anim];
      if (!anim) return;

      st.elapsed += dtMs;
      let guard = 0;
      while (guard++ < 32) {
        const f = anim.frames[Math.min(st.frame, anim.frames.length - 1)];
        const dur = Math.max(16, f.durationMs || 120);
        if (st.elapsed < dur) break;
        st.elapsed -= dur;

        if (st.frame < anim.frameCount - 1) {
          st.frame += 1;
        } else if (anim.loop) {
          st.frame = 0;
        } else if (st.anim === 'death') {
          st.frame = anim.frameCount - 1;
          st.done = true;
          st.elapsed = 0;
          break;
        } else {
          st.anim = 'idle';
          st.frame = 0;
          st.elapsed = 0;
          st.done = false;
          break;
        }
      }

      // 攻击出手帧：只触发表现（剑光/音效），不产生任何数值影响
      if (hooks && hooks.onAttackImpact && st.anim === 'attack' && st.frame !== prevFrame) {
        const cur = atlas.characters[charIdFor(u)].animations.attack;
        if (cur && cur.impactFrame != null && st.frame === cur.impactFrame) hooks.onAttackImpact(u);
      }
    });
  }

  /* ---------- 事件 ---------- */

  /* 动作驱动由 battle 视图直接调 play() 完成（见 src/veteran/view.js 的
     consumeEvents），这里不再按日志推导动作。 */

  /* ---------- 绘制 ---------- */

  /**
   * 在 footX/footY 处绘制（逻辑坐标，已由调用方设定好世界变换）。
   * @returns true 表示已用动画绘制，false 表示应回退原绘制
   */
  function draw(ctx, u, footX, footY, cellPx, reduceMotion = false) {
    if (!supports(u)) return false;
    const cid = charIdFor(u);
    const st = ensure(u);
    const c = atlas.characters[cid];
    const anim = c.animations[st.anim] || c.animations.idle;
    const f = anim.frames[Math.min(st.frame, anim.frames.length - 1)];
    const img = sheets.get(anim.sheet);
    if (!img || !f) return false;

    const s = cellPx / (c.frameSize || atlas.frameSize[0]);
    const wantRight = u.side === 'ally';
    const artRight = c.facing === 'right';
    const flip = wantRight !== artRight;

    ctx.save();
    ctx.translate(footX, footY);
    if (flip) ctx.scale(-1, 1);
    if (!reduceMotion && u.side === 'ally' && (st.anim === 'attack' || reactions[st.anim])) {
      let elapsed = st.elapsed, duration = 0;
      anim.frames.forEach((frame,i) => {
        if (i < st.frame) elapsed += frame.durationMs;
        duration += frame.durationMs;
      });
      drawGesture(ctx, st.anim, choreography[cid], Math.min(1,elapsed/duration), cellPx/100);
    }
    /* 亚种靠色调与主人区分：叠加在已有的受击亮化之上，不改任何数值 */
    if (u.filter) {
      const prev = ctx.filter && ctx.filter !== 'none' ? ctx.filter + ' ' : '';
      ctx.filter = prev + u.filter;
    }
    ctx.drawImage(
      img,
      f.rect.x, f.rect.y, f.rect.w, f.rect.h,
      -f.pivot.x * s, -f.pivot.y * s,
      f.rect.w * s, f.rect.h * s
    );
    ctx.restore();
    return true;
  }

  /** 攻击视觉出手点：用于同步剑光/音效，不产生任何数值影响。 */
  function isImpactFrame(u, impactFrame) {
    const cid = charIdFor(u);
    if (!cid || !atlas) return false;
    const st = ensure(u);
    const anim = atlas.characters[cid].animations[st.anim];
    if (!anim || anim.impactFrame == null) return false;
    return st.anim === 'attack' && st.frame === anim.impactFrame;
  }

  function stateOf(unitId) { return states[unitId] || null; }

  function reset() {
    Object.keys(states).forEach((k) => { delete states[k]; });
  }

  A.SpriteAnim = {
    init, preload, isReady, supports, charIdFor,
    play, update, draw, syncFromBattle, stateOf, isImpactFrame, reset,
    get atlas() { return atlas; },
  };
})(globalThis.Ashen ||= {});
