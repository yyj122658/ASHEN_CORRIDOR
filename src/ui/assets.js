'use strict';
/* 固定资产映射与失败降级。路径相对 index.html。
   不通过 fetch(manifest.json)，保证 file:// 直接打开可用。

   所有运行时图像来自 v4 九色资源目录。 */
(function (A) {
  'use strict';

  const BASE = 'assets/art/topology-v4/';

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
    'scene.battle.angled': { path: 'backgrounds/angled_sanctum.png', objectPosition: '50% 50%', ratio: '80/43' },

    'surface.board': { path: 'ui/living-metal.png', objectPosition: '50% 50%', ratio: '1/1' },
    'surface.forge': { path: 'ui/forged-steel.png' },
    'surface.wax': { path: 'ui/wax-grain.png' },
    'icon.scar': { path: 'ui/scar_mark.png', objectPosition: '50% 50%', ratio: '1/1' },
    'icon.rust': { path: 'ui/rust_mark.png', objectPosition: '50% 50%', ratio: '1/1' },
  };

  const D = A.Veteran.Data;
  const register = (kind, ids, ext = 'png') => {
    for (const id of ids) ART[kind + '.' + id] = {
      path: kind + '/' + id + '.' + ext,
      objectPosition: '50% 50%', ratio: '1/1',
    };
  };
  const skins = D.SKINS.map(skin => skin.id);
  register('portrait', skins);
  register('sprite', skins);
  register('enemy', Object.keys(D.ENEMIES));
  register('node', ['battle', 'elite', 'chest', 'event', 'camp', 'merchant', 'boss']);
  register('plate', Object.values(D.BODIES).map(body => body.archetype));
  register('family', ['straight', 'elbow', 'splitter', 'capacitor', 'threshold', 'ember']);
  register('rune', Object.keys(D.TEMPLATES), 'webp');
  register('etch-relief', [...Object.keys(D.MANUSCRIPTS), 'entry', 'exit'], 'webp');
  for (const pose of ['idle', 'powered', 'hot']) {
    for (const [id, spec] of Object.entries(D.TEMPLATES)) {
      const cols = Math.max(...spec.cells.map(([x]) => x)) + 1;
      const rows = Math.max(...spec.cells.map(([, y]) => y)) + 1;
      ART[`conduit.${pose}.${id}`] = { path: `conduit/${pose}/${id}.png`, ratio: cols + '/' + rows };
    }
  }
  ART['conduit.blueprint'] = { path: 'conduit/blueprint.png' };
  ART['conduit.overlays'] = { path: 'conduit/overlays.png' };
  ART['vfx.topology'] = { path: 'effects.png' };

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

  A.Art = { ART, getArt, preloadArt, getImage, isReady, statusOf, imgTag, safeText, BASE };
})(globalThis.Ashen ||= {});
