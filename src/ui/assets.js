'use strict';
/* 固定资产映射与失败降级。路径相对 index.html。
   不通过 fetch(manifest.json)，保证 file:// 直接打开可用。

   2026-11-16：整体切到 assets/art/curated/ —— 96 张清洗产物的唯一入口。
   旧目录（v1 / veteran-v1 / battle-v1 / battle-v3）原样保留，只作为 battle-v3 条带的来源。 */
(function (A) {
  'use strict';

  const BASE = 'assets/art/curated/';

  const ART = {
    /* ---- 功能场景（640×360，横幅用；野外事件与摊位都挂在这里） ---- */
    'scene.camp':      { path: 'scenes/camp.png',        objectPosition: '50% 55%', ratio: '16/9' },
    'scene.workshop':  { path: 'scenes/workshop.png',    objectPosition: '50% 60%', ratio: '16/9' },
    'scene.merchant':  { path: 'scenes/merchant.png',    objectPosition: '50% 55%', ratio: '16/9' },
    'scene.event':     { path: 'scenes/event_altar.png', objectPosition: '50% 50%', ratio: '16/9' },
    'scene.chest':     { path: 'scenes/chest.png',       objectPosition: '50% 55%', ratio: '16/9' },
    'scene.extract':   { path: 'scenes/extract.png',     objectPosition: '50% 50%', ratio: '16/9' },

    /* ---- 层域背景（640×360，横幅 / 节点插画） ---- */
    'scene.corridor':  { path: 'backgrounds/biome_water.png',   objectPosition: '50% 50%', ratio: '16/9', groundY: 0.84 },
    'scene.waterway':  { path: 'backgrounds/biome_water.png',   objectPosition: '50% 50%', ratio: '16/9', groundY: 0.84 },
    'scene.spring':    { path: 'backgrounds/biome_spring.png',  objectPosition: '50% 50%', ratio: '16/9', groundY: 0.84 },
    'scene.furnace':   { path: 'backgrounds/biome_furnace.png', objectPosition: '50% 50%', ratio: '16/9', groundY: 0.84 },
    'scene.boss':      { path: 'backgrounds/biome_furnace.png', objectPosition: '50% 50%', ratio: '16/9', groundY: 0.84 },

    /* ---- 战斗背景（960×300 = 画布 320×100 的 3 倍，1:1 像素对齐） ---- */
    'scene.battle.water':   { path: 'backgrounds/biome_water_battle.png',   objectPosition: '50% 50%', ratio: '16/5', groundY: 0.84 },
    'scene.battle.spring':  { path: 'backgrounds/biome_spring_battle.png',  objectPosition: '50% 50%', ratio: '16/5', groundY: 0.84 },
    'scene.battle.furnace': { path: 'backgrounds/biome_furnace_battle.png', objectPosition: '50% 50%', ratio: '16/5', groundY: 0.84 },

    /* ---- 十四位传奇（96×96 清洗头像） ---- */
    'portrait.blade':   { path: 'portraits/blade.png',    objectPosition: '50% 40%', ratio: '1/1' },
    'portrait.warden':  { path: 'portraits/warden.png',   objectPosition: '50% 40%', ratio: '1/1' },
    'portrait.ranger':  { path: 'portraits/ranger.png',   objectPosition: '50% 40%', ratio: '1/1' },
    'portrait.warlock': { path: 'portraits/warlock.png',  objectPosition: '50% 40%', ratio: '1/1' },
    'portrait.cleric':  { path: 'portraits/cleric.png',   objectPosition: '50% 40%', ratio: '1/1' },
    'portrait.rogue':   { path: 'portraits/rogue.png',    objectPosition: '50% 40%', ratio: '1/1' },

    /* ---- 七种节点插画（48×48） ---- */
    'node.battle':      { path: 'nodes/node_battle.png',   objectPosition: '50% 50%', ratio: '1/1', fallbackId: 'scene.corridor' },
    'node.elite':       { path: 'nodes/node_elite.png',    objectPosition: '50% 50%', ratio: '1/1', fallbackId: 'scene.corridor' },
    'node.chest':       { path: 'nodes/node_chest.png',    objectPosition: '50% 50%', ratio: '1/1', fallbackId: 'scene.corridor' },
    'node.event':       { path: 'nodes/node_event.png',    objectPosition: '50% 50%', ratio: '1/1', fallbackId: 'scene.corridor' },
    'node.camp':        { path: 'nodes/node_camp.png',     objectPosition: '50% 50%', ratio: '1/1', fallbackId: 'scene.corridor' },
    'node.merchant':    { path: 'nodes/node_merchant.png', objectPosition: '50% 50%', ratio: '1/1', fallbackId: 'scene.corridor' },
    'node.boss':        { path: 'nodes/node_boss.png',     objectPosition: '50% 50%', ratio: '1/1', fallbackId: 'scene.corridor' },
  };

  /* 十四位传奇的立绘 id 由 SKINS 推导：portrait.<skinId>。
     六位老传奇手写在上面的表里（保持原字段顺序），剩下八位在这里补，
     免得「新加一个人忘了加图」变成静默缺失。 */
  const WANDERERS = ['wanderer0', 'wanderer1', 'wanderer2', 'wanderer3',
    'wanderer4', 'wanderer5', 'wanderer6', 'wanderer7'];
  WANDERERS.forEach((id) => {
    ART['portrait.' + id] = { path: 'portraits/' + id + '.png', objectPosition: '50% 40%', ratio: '1/1' };
  });

  /* 十四种敌人（含亚种与首领）：全部走 curated/enemies/<enemyType>.png。
     亚种与本体是两张图，不再靠色调区分 —— 文件名就是 enemyType，不需要映射表。 */
  const ENEMY_IDS = ['bone', 'hound', 'hulk', 'shuffler', 'wraith',
    'boneBell', 'houndLean', 'hulkSlag', 'wraithChoir',
    'shufflerDragger', 'stoker', 'gatekeeper', 'memoryEater', 'furnaceHeart'];
  ENEMY_IDS.forEach((id) => {
    ART['enemy.' + id] = { path: 'enemies/' + id + '.png', objectPosition: '50% 45%', ratio: '1/1' };
  });

  /* 首领：只有这三个有专属大图（112×112） */
  const BOSS_IDS = ['gatekeeper', 'memoryEater', 'furnaceHeart'];

  /* 战斗小人的静态帧（64×64 清洗版）：SpriteAnim 图集缺失时用它兜底，
     不再退回「7px 白字名字」。敌方复用 enemy.<id>，我方单独一套 sprite.<skinId>。 */
  WANDERERS.concat(['blade', 'warden', 'ranger', 'warlock', 'cleric', 'rogue']).forEach((id) => {
    ART['sprite.' + id] = { path: 'allies/' + id + '.png', objectPosition: '50% 50%', ratio: '1/1' };
  });

  /* 战斗特效的静态贴图：粒子层优先画它，缺图再退回矢量线。 */
  ['slash', 'burn', 'poison', 'bleed', 'corrode', 'shield'].forEach((kind) => {
    ART['vfx.' + kind] = { path: 'vfx/vfx_' + kind + '.png', objectPosition: '50% 50%', ratio: '1/1' };
  });

  // 运行时状态：'unknown' | 'ready' | 'failed'
  const status = {};
  const cache = {};

  function getArt(id) {
    const def = ART[id];
    if (!def) return null;
    return {
      id,
      src: BASE + def.path,
      fallbackId: def.fallbackId || null,
      objectPosition: def.objectPosition,
      groundY: def.groundY,
      ratio: def.ratio,
      status: status[id] || 'unknown',
    };
  }

  function loadImage(id) {
    const def = ART[id];
    if (!def) return Promise.resolve({ id, ok: false });
    if (cache[id]) return Promise.resolve({ id, ok: status[id] === 'ready' });

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        status[id] = 'ready';
        cache[id] = img;
        resolve({ id, ok: true, img });
      };
      img.onerror = () => {
        status[id] = 'failed';
        resolve({ id, ok: false });
      };
      img.src = BASE + def.path;
    });
  }

  function preloadArt(ids) {
    const list = ids || Object.keys(ART);
    return Promise.all(list.map(loadImage)).then((res) => ({
      loaded: res.filter((r) => r.ok).map((r) => r.id),
      failed: res.filter((r) => !r.ok).map((r) => r.id),
    }));
  }

  function getImage(id) {
    if (status[id] === 'ready' && cache[id]) return cache[id];
    return null;
  }

  function isReady(id) { return status[id] === 'ready'; }
  function statusOf(id) { return status[id] || 'unknown'; }

  /** 生成 <img> 标签；失败时 onerror 隐藏并挂上降级类。 */
  function imgTag(id, cls, alt) {
    const art = getArt(id);
    if (!art) return '';
    const st = statusOf(id);
    if (st === 'failed') return '';
    return `<img class="art ${cls || ''}" src="${art.src}" loading="lazy" decoding="async"
      alt="${alt || ''}" style="object-position:${art.objectPosition}"
      onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  /** 防止 <img onerror> 被当作可执行内容：本函数只用于我们自己写的固定路径。 */
  function safeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  A.Art = { ART, getArt, preloadArt, getImage, isReady, statusOf, imgTag, safeText, BASE, BOSS_IDS };
})(globalThis.Ashen ||= {});
