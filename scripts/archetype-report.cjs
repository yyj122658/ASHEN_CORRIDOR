'use strict';
/* 构筑体检：按「流派」装配四名传奇里的主 C，量一遍覆盖率、贯通、胜场与输出/治疗/护盾。
   目的不是替代真人试玩，而是保证每种流派都有可复现的装配路径，数值差距不会被写死在猜里。
   用法：node scripts/archetype-report.cjs [floor] */
const { loadVeteran } = require('../tests/helpers/load-veteran.cjs');

const V = loadVeteran().Veteran;
const D = V.Data;
const FLOOR = Number(process.argv[2]) || 28;
const SEEDS = [3, 9, 17, 31];

/** 找一块能放下这枚蚀刻法的板面位置。 */
function placeManuscript(st, u, msId) {
  const spec = D.MANUSCRIPTS[msId];
  for (let rot = 0; rot < 4; rot++) {
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        u.manuscript = { ...spec, x, y, rotation: rot, mirrorY: false };
        if (V.Circuit.manuscriptState(st, u.id).ok) return { x, y, rotation: rot, mirrorY: false };
      }
    }
  }
  return null;
}

/** 逐枚把纹章压在蚀刻法上：每一步都选「新增对齐格最多」的姿势。 */
function placeRunes(st, u, msId, msPose, runeIds, opts) {
  const keepRoute = !!(opts && opts.keepRoute);
  const plate = V.Circuit.plateOf(u);
  const spec = { ...D.MANUSCRIPTS[msId], ...msPose };
  const oriented = V.Manuscript.orient(
    V.Manuscript.normalize(spec), spec.rotation || 0, !!spec.mirrorY,
  );
  const base = (opts && opts.base) || [];  const used = new Set(V.Circuit.layout(st, base).cells.map((c) => c.x + ',' + c.y));
  let draft = base.slice();
  for (const id of runeIds) {
    const part = V.State.makePart(st, { kind: 'circuit', templateId: id });
    st.itemsById[part.id] = part;
    let best = null;
    let bestAligned = 0;
    for (let rot = 0; rot < 4; rot++) {
      for (const mir of [false, true]) {
        for (let y = 0; y < plate.size; y++) {
          for (let x = 0; x < plate.size; x++) {
            const shape = V.Circuit.transformTemplate(D.TEMPLATES[id], rot, mir);
            const cells = shape.cells.map((c) => [c.x + x, c.y + y]);
            if (cells.some(([cx, cy]) => !plate.cells.has(cx + ',' + cy) || used.has(cx + ',' + cy))) continue;
            const cand = [...draft, { itemId: part.id, templateId: id, x, y, rotation: rot, mirrorY: mir }];
            const cov = V.Manuscript.coverage(
              oriented, spec.x || 0, spec.y || 0,
              V.Manuscript.pieceIndex(V.Circuit.layout(st, cand)),
            );
            /* 只算这一枚自己压中的格：否则后来的纹章随便摆都不掉总覆盖，等于没判断 */
            const aligned = new Set(cov.alignedCells);
            const own = cells.filter(([cx, cy]) => aligned.has(cx + ',' + cy)).length;
            if (!own || own < bestAligned) continue;
            const load = V.Circuit.layout(st, cand).built.reduce((n, b) => n + b.tpl.load, 0) + (spec.load || 0);
            if (load > V.Circuit.loadCap(u)) continue;
            if (!V.Circuit.preview(st, u.id, cand).ok) continue;
            if (keepRoute && !V.Circuit.manuscriptState(st, u.id, cand).routed) continue;
            best = cand;
            bestAligned = cov.aligned;
          }
        }
      }
    }    if (!best) continue;
    draft = best;
    cellsOf(best[best.length - 1]).forEach((k) => used.add(k));
  }
  u.board.placements = draft;
  return draft;

  function cellsOf(pose) {
    const shape = V.Circuit.transformTemplate(D.TEMPLATES[pose.templateId], pose.rotation, pose.mirrorY);
    return shape.cells.map((c) => (c.x + pose.x) + ',' + (c.y + pose.y));
  }
}

/** 按给定摆法装配（用于需要精确走线的贯通流）。 */
function placeLayout(st, u, msId, parts) {
  let origin = null;
  for (let seed = 1; seed <= 240 && !origin; seed++) {
    u.plateSeed = seed;
    [origin] = V.Manuscript.placements({ ...D.MANUSCRIPTS[msId] }, V.Circuit.plateOf(u).cellsList);
  }
  if (!origin) return null;
  u.manuscript = { ...u.manuscript, x: origin[0], y: origin[1], rotation: 0, mirrorY: false };
  u.board.placements = parts.map(([tpl, x, y, rot, mir]) => {
    const item = V.State.makePart(st, { templateId: tpl });
    st.itemsById[item.id] = item;
    return { itemId: item.id, x: x + origin[0], y: y + origin[1], rotation: rot, mirrorY: !!mir };
  });
  return u.board.placements;
}

function sample(build, seed) {
  const st = V.State.create(seed);
  const u = st.roster[0];
  u.board.placements.forEach((p) => st.stash.push(p.itemId));
  u.board.placements = [];
  u.manuscript = null;
  for (let s = 1; !u.manuscript && s < 200; s++) {
    V.State.equipManuscript(st, u, build.ms);
    if (!u.manuscript) u.plateSeed = s;
  }
  const pose = placeManuscript(st, u, build.ms);
  if (!pose) return null;
  if (build.layout) {
    placeLayout(st, u, build.ms, build.layout);
    /* 摆好走线后板面位置可能变了，后续按新的落点算对齐 */
    const patched = { x: u.manuscript.x, y: u.manuscript.y, rotation: u.manuscript.rotation || 0, mirrorY: !!u.manuscript.mirrorY };
    if (build.extra) placeRunes(st, u, build.ms, patched, build.extra, { keepRoute: true, base: u.board.placements });
  } else {
    placeRunes(st, u, build.ms, pose, build.runes);
  }
  st.roster.forEach((x) => {
    x.gambits = [{
      id: 'g', enabled: true, conditions: [{ type: 'always' }], target: 'frontFoe',
      action: x === u && build.action ? build.action : 'main',
    }];
  });
  const info = V.Circuit.manuscriptState(st, u.id);
  let s = V.Expedition.start(st, { seed }).state;
  s.run.floor = Math.min(D.DESIGN.maxFloor, FLOOR);
  const gen = V.Combat.generateEncounter(s, 'normal');
  s = V.Combat.create(gen.state, gen.enemyBlueprint, gen.combatRngStart).state;
  for (let i = 0; !s.run.battle.over && i < 3200; i++) s = V.Combat.step(s).state;
  const b = s.run.battle;
  const sec = b.tick * D.DESIGN.stepSeconds;
  return {
    win: b.win, sec,
    dps: b.stats.damage / (sec || 1),
    heal: b.stats.healing || 0,
    shield: b.logs.filter((l) => l.type === 'support').reduce((n, l) => n + (l.amount || 0), 0),
    pct: info.pct, routed: info.routed, boost: info.effects.boost, tier: info.tierName,
  };
}

const BUILDS = [
  { name: '平A流', ms: 'inverse', runes: ['ember', 'brazier', 'fuse', 'flint'], note: '余烬纹章把平A堆满，靠攻速与灼烧' },
  { name: '走线对照', ms: 'corridor5', runes: ['ember', 'fuse', 'brazier'], note: '同一门蚀刻法，只堆增伤不走线' },
  { name: '贯通平A', ms: 'corridor5', layout: [['elbow', 2, 0, 0, false], ['straight', 0, 0, 0, false]], extra: ['ember', 'brazier', 'fuse', 'flint'], note: '两枚纹章先拼出通路，再补增伤' },
  { name: '逆脉贯通', ms: 'inverse', layout: [['reed', 1, 0, 0, true], ['rivet', 0, 0, 0, false], ['reed', 1, 1, 0, false], ['rivet', 0, 1, 0, false]], extra: ['ember', 'brazier', 'fuse'], note: '逆脉的平A在贯通时额外 +25%，走线才成立' },
  { name: '灼烧流', ms: 'flurry', runes: ['ember', 'fuse', 'brazier', 'wickbend'], note: '点火靠余烬，跳伤靠 dotMult' },
  { name: '招式流', ms: 'ember12', runes: ['cistern', 'bellowsCell', 'crook', 'wishbone'], note: '层岩/叠浪抬招式与上限' },
  { name: '治疗流', ms: 'ward', runes: ['rail', 'bellowsCell', 'hairpin', 'ampoule'], note: '治疗吃 healMult，不吃招式倍率' },
  { name: '护盾流', ms: 'corridor5', runes: ['capacitor', 'threshold', 'cistern'], action: 'support', note: '护持指令 + shieldMult，用行动换盾' },
];

const rows = BUILDS.map((build) => {
  const samples = SEEDS.map((seed) => sample(build, seed)).filter(Boolean);
  if (!samples.length) return { build, samples: [] };
  const avg = (k) => samples.reduce((n, r) => n + r[k], 0) / samples.length;
  return {
    build,
    samples,
    pct: Math.round(avg('pct')),
    routed: samples.filter((r) => r.routed).length,
    wins: samples.filter((r) => r.win).length,
    sec: avg('sec'),
    dps: Math.round(avg('dps')),
    heal: Math.round(avg('heal')),
    shield: Math.round(avg('shield')),
    boost: samples[0].boost,
  };
});

console.log(`构筑体检 · 第 ${Math.min(D.DESIGN.maxFloor, FLOOR)} 层普通遭遇 · ${SEEDS.length} 个种子`);
for (const r of rows) {
  if (!r.samples.length) { console.log(`${r.build.name}：装不上，跳过`); continue; }
  const b = r.boost;
  const parts = [
    b.attackMult ? `平A +${Math.round(b.attackMult * 100)}%` : '',
    b.skillMult ? `招式 +${Math.round(b.skillMult * 100)}%` : '',
    b.dotMult ? `灼烧 +${Math.round(b.dotMult * 100)}%` : '',
    b.healMult ? `治疗 +${Math.round(b.healMult * 100)}%` : '',
    b.shieldMult ? `护盾 +${Math.round(b.shieldMult * 100)}%` : '',
    b.regen ? `回能 +${b.regen.toFixed(2)}/s` : '',
    b.max ? `上限 +${Math.round(b.max)}` : '',
    b.lowHpRegen ? `残血回能 +${b.lowHpRegen.toFixed(2)}/s` : '',
    b.ember ? `点火 ${b.ember}` : '',
  ].filter(Boolean).join('、');
  console.log(`${r.build.name.padEnd(6)} 覆盖${String(r.pct).padStart(3)}% 贯通${r.routed}/${SEEDS.length} 胜${r.wins}/${SEEDS.length} `
    + `${r.sec.toFixed(1)}s DPS${String(r.dps).padStart(4)} 治疗${String(r.heal).padStart(4)} 护盾${String(r.shield).padStart(4)} | ${parts}`);
  console.log(`       ${r.build.note}`);
}
