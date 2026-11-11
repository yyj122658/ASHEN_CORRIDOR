'use strict';
/* 灰烬回廊美术映射。
   - veteran-v1：工坊 / 营火 / 静养 / 板面底材 / 构件缩略图，走本模块自己的 BASE。
   - v1：营地场景、节点插画、职业立绘、首领肖像，走 A.Art 的固定映射。
   两套都缺失时只返回 ''，由 CSS 渐变底 + SVG 图标降级。 */
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  const BASE = 'assets/art/veteran-v1/';

  const ASSETS = {
    'veteran.scene.workshop': {
      path: 'scenes/workshop.png', w: 1536, h: 1024,
      focus: '65% 50%', alt: '旧铜工作台与暖炉',
    },
    'veteran.scene.field': {
      path: 'scenes/field-inscription.png', w: 1536, h: 1024,
      focus: '55% 55%', alt: '营火旁的临时烙印台',
    },
    'veteran.scene.recovery': {
      path: 'scenes/recovery.png', w: 1536, h: 1024,
      focus: '60% 50%', alt: '营地的静养角落',
    },
    'veteran.surface.board': {
      path: 'surfaces/living-metal.png', w: 1254, h: 1254,
      focus: '50% 50%', alt: '生命金属板面底材',
    },
    'veteran.relic.channel': {
      path: 'relics/ember-channel.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '导能残片',
    },
    'veteran.relic.capacitor': {
      path: 'relics/pulse-chamber.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '脉冲储能腔',
    },
    'veteran.relic.splitter': {
      path: 'relics/prism-splitter.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '三叉分流构件',
    },
    'veteran.relic.threshold': {
      path: 'relics/threshold-seal.png', w: 1254, h: 1254,
      focus: '50% 50%', alpha: true, alt: '阈值闸',
    },
  };

  const status = {};
  const cache = {};

  function get(id) {
    const a = ASSETS[id];
    if (!a) return null;
    return Object.assign({ id, src: BASE + a.path }, a);
  }

  function load(id) {
    const art = get(id);
    if (!art) return Promise.resolve({ id, ok: false });
    if (status[id] === 'ready') return Promise.resolve({ id, ok: true, img: cache[id] });
    if (status[id] === 'failed') return Promise.resolve({ id, ok: false });
    if (status[id] === 'loading') {
      return new Promise((resolve) => {
        const wait = () => {
          if (status[id] === 'loading') setTimeout(wait, 60);
          else resolve({ id, ok: status[id] === 'ready', img: cache[id] });
        };
        wait();
      });
    }
    status[id] = 'loading';
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
      img.src = art.src;
    });
  }

  function preload(ids) {
    return Promise.all((ids || []).map(load)).then((rs) => ({
      loaded: rs.filter((r) => r.ok).map((r) => r.id),
      failed: rs.filter((r) => !r.ok).map((r) => r.id),
    }));
  }

  function image(id) {
    return status[id] === 'ready' ? cache[id] : null;
  }
  function isReady(id) { return status[id] === 'ready'; }
  function statusOf(id) { return status[id] || 'unknown'; }

  /**
   * imgTag(id, cls, extraStyle)
   * 失败时立刻返回空串（事后失败由 onerror 隐藏），不会留破图。
   */
  function imgTag(id, cls, extraStyle) {
    const art = get(id);
    if (!art) return '';
    if (status[id] === 'failed') return '';
    const style = `object-position:${art.focus};${extraStyle || ''}`;
    /* 这些图都由 preloadFor 按页面预取过，这里用 eager 命中缓存；
       lazy 会让首屏外的缩略图在截图/快速滚动时显示为空框。 */
    return `<img class="v-art ${cls || ''}" src="${art.src}" loading="eager" decoding="async"
      alt="${art.alt}" style="${style}"
      onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  /* ---------- v1 美术（营地场景 / 节点插画 / 立绘 / 首领） ---------- */

  /* 皮肤 → v1 职业立绘。SKINS 只带 id 与中文名，画面对应在这里。 */
  const SKIN_PORTRAIT = {
    blade: 'portrait.blade',
    warden: 'portrait.warden',
    ranger: 'portrait.ranger',
    warlock: 'portrait.warlock',
    cleric: 'portrait.cleric',
    rogue: 'portrait.rogue',
  };

  /** 用 A.Art 的固定映射产出图片标签；没登记或已失败时返回 ''。 */
  function v1Tag(id, cls, style) {
    const art = A.Art && A.Art.getArt ? A.Art.getArt(id) : null;
    if (!art) return '';
    if (A.Art.statusOf(id) === 'failed') return '';
    return `<img class="v-art v1-art ${cls || ''}" src="${art.src}" loading="lazy" decoding="async"
      alt="" style="object-position:${art.objectPosition};${style || ''}"
      onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  /** 任意图片 id：v1 优先，其次 veteran-v1。 */
  function anyImgTag(id, cls, style) {
    return v1Tag(id, cls, style) || imgTag(id, cls, style);
  }

  /** 老兵立绘：按皮肤取 v1 肖像，缺失时返回 ''，卡片保留文字布局。 */
  function portraitTag(skinId, cls) {
    const id = SKIN_PORTRAIT[skinId];
    if (!id) return '';
    return v1Tag(id, 'portrait-img ' + (cls || ''));
  }

  /** 首领肖像：gatekeeper / memoryEater。 */
  function bossTag(bossId, cls) {
    if (bossId !== 'gatekeeper' && bossId !== 'memoryEater') return '';
    return v1Tag('enemy.' + bossId, 'boss-img ' + (cls || ''));
  }

  /* 构件模板 → 收藏品物件图 */
  const TEMPLATE_ART = {
    straight: 'veteran.relic.channel',
    elbow: 'veteran.relic.channel',
    ember: 'veteran.relic.channel',
    capacitor: 'veteran.relic.capacitor',
    splitter: 'veteran.relic.splitter',
    threshold: 'veteran.relic.threshold',
  };

  function relicArtFor(templateId) {
    return TEMPLATE_ART[templateId] || null;
  }

  /** 构件缩略图：没有图时返回空串，调用方保留文字布局。 */
  function relicThumb(templateId) {
    const id = relicArtFor(templateId);
    if (!id) return '';
    return `<span class="relic-thumb">${imgTag(id, 'relic-img')}</span>`;
  }

  /** 场景横幅：图缺失时整块不渲染，CSS 渐变兜底。
      先查 v1（营地 / 节点插画），再查 veteran-v1（工坊 / 营火 / 静养）。 */
  function sceneBanner(sceneId, cls, title, sub) {
    const img = anyImgTag(sceneId, 'banner-img');
    return `<div class="v-banner ${cls || ''} ${img ? '' : 'no-art'}">
      ${img}
      ${title ? `<div class="v-banner-title">${title}</div>` : ''}
      ${sub ? `<div class="v-banner-sub">${sub}</div>` : ''}
    </div>`;
  }

  function preloadFor(screen) {
    if (screen === 'camp' || screen === 'workshop') {
      return preload(['veteran.scene.workshop', 'veteran.surface.board',
        'veteran.relic.channel', 'veteran.relic.capacitor', 'veteran.relic.splitter', 'veteran.relic.threshold']);
    }
    if (screen === 'campNode') return preload(['veteran.scene.field']);
    if (screen === 'history') return preload(['veteran.scene.recovery']);
    return Promise.resolve({ loaded: [], failed: [] });
  }

  V.Art = {
    BASE, ASSETS, TEMPLATE_ART, SKIN_PORTRAIT, get, load, preload, image, isReady, statusOf,
    imgTag, v1Tag, anyImgTag, portraitTag, bossTag,
    relicArtFor, relicThumb, sceneBanner, preloadFor,
  };
})(globalThis.Ashen ||= {});
