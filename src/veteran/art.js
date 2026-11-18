'use strict';
(function (A) {
  'use strict';
  const V = (A.Veteran ||= {});

  function registeredTag(id, cls, style) {
    const art = A.Art.getArt(id);
    if (!art || art.status === 'failed') return '';
    return `<img class="v-art ${cls || ''}" src="${art.src}" loading="lazy" decoding="async"
      alt="" style="object-position:${art.objectPosition};${style || ''}"
      onerror="this.classList.add('art-broken');this.removeAttribute('src')">`;
  }

  function anyImgTag(id, cls, style) {
    return registeredTag(id, cls, style);
  }

  function portraitTag(skinId, cls) {
    return registeredTag('portrait.' + skinId, 'portrait-img ' + (cls || ''));
  }

  /** 首领肖像：gatekeeper / memoryEater。 */
  function bossTag(bossId, cls) {
    if (!bossId || !A.Art.getArt('enemy.' + bossId)) return '';
    return registeredTag('enemy.' + bossId, 'boss-img ' + (cls || ''));
  }

  function plateTag(archetype, cls) {
    return registeredTag('plate.' + archetype, 'plate-art ' + (cls || ''));
  }

  function iconTag(name, cls) {
    return registeredTag('icon.' + name, 'icon-art ' + (cls || ''));
  }

  function sceneBanner(sceneId, cls, title, sub) {
    const img = anyImgTag(sceneId, 'banner-img');
    return `<div class="v-banner ${cls || ''} ${img ? '' : 'no-art'}">
      ${img}
      ${title ? `<div class="v-banner-title">${title}</div>` : ''}
      ${sub ? `<div class="v-banner-sub">${sub}</div>` : ''}
    </div>`;
  }

  function preloadFor(screen) {
    return A.Art.preloadArt(screen === 'workshop' ? ['scene.workshop'] : screen === 'camp' ? ['scene.camp'] : []);
  }

  V.Art = { anyImgTag, portraitTag, bossTag, plateTag, iconTag, sceneBanner, preloadFor };
})(globalThis.Ashen ||= {});
