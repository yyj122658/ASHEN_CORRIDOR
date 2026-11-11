'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadGame } = require('../helpers/load-game.cjs');

const A = loadGame();
const St = A.Storage;

const V1_TEXT = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'v1-save.json'), 'utf8');

function mockStorage(init) {
  const data = Object.assign({}, init || {});
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _data: data,
  };
}

test('v1 迁移：资产守恒', () => {
  const r = St.migrateV1(V1_TEXT);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const s = r.state;

  assert.equal(s.gold, 512);
  assert.equal(s.shards, 14);
  assert.equal(s.bestDepth, 3);
  assert.equal(s.runs, 5);
  assert.equal(s.extracts, 3);
  assert.equal(s.roster.length, 5);
  assert.equal(s.team.filter(Boolean).length, 4);

  // 装备总数守恒：原 3 件穿戴 + 2 件仓库
  const owned = A.State.ownItemIds(s);
  assert.equal(owned.size, 5);
  assert.equal(s.stash.length, 2);

  // 具体引用
  const u1 = s.roster.find((u) => u.id === 'u1');
  assert.ok(u1.equip.weapon, '武器应迁移为 ID 引用');
  assert.equal(s.itemsById[u1.equip.weapon].base, '裂口长剑');
  assert.equal(s.itemsById[u1.equip.weapon].prefix, '锋利的');
  assert.equal(u1.star, 2);
  assert.equal(u1.affliction, 'fear');
});

test('v1 迁移：原字符串不被改写', () => {
  const copy = V1_TEXT;
  St.migrateV1(V1_TEXT);
  assert.equal(V1_TEXT, copy);
});

test('v1 迁移：缺失的 upgrades 子字段补默认，不覆盖已有等级', () => {
  const r = St.migrateV1(V1_TEXT);
  const s = r.state;
  assert.equal(s.upgrades.bag, 1, '保留已有的 bag 等级');
  assert.equal(s.upgrades.atk, 0);
  assert.equal(s.upgrades.hp, 0, '缺失字段补 0');
  assert.equal(s.upgrades.rec, 0);
  assert.equal(s.bagCap, 10, 'bag 升级后容量同步');
});

test('v1 迁移：补齐设置、难度与成就字段', () => {
  const s = St.migrateV1(V1_TEXT).state;
  assert.deepEqual(s.unlockedDifficulties, ['normal']);
  assert.equal(s.difficulty, 'normal');
  assert.deepEqual(s.achievements, []);
  assert.ok(s.settings && typeof s.settings.sound === 'boolean');
  assert.ok(Number.isInteger(s.rngState));
  assert.equal(s.schemaVersion, 2);
  assert.ok(A.State.validate(s).ok);
});

test('v1 迁移：商店候选不占 roster', () => {
  const s = St.migrateV1(V1_TEXT).state;
  assert.equal(s.shop.length, 2);
  assert.equal(s.roster.length, 5, '商店候选不能混进 roster');
  assert.equal(s.shop.find((o) => o.sold).sold, true);
});

test('load：v2 优先，缺失时迁移 v1', () => {
  const store = mockStorage({ [St.KEY_V1]: V1_TEXT });
  const r = St.load(store);
  assert.equal(r.status, 'migrated');
  assert.equal(r.state.gold, 512);
});

test('load：全新玩家返回 new', () => {
  const r = St.load(mockStorage());
  assert.equal(r.status, 'new');
});

test('load：v2 损坏时不静默抹档，回退 v1', () => {
  const store = mockStorage({
    [St.KEY_V2]: '{ this is not json',
    [St.KEY_V1]: V1_TEXT,
  });
  const r = St.load(store);
  assert.equal(r.status, 'migrated');
  assert.ok(r.errors.length > 0);
});

test('load：v2 与 v1 都坏 → corrupt，不覆盖', () => {
  const store = mockStorage({ [St.KEY_V2]: '{"schemaVersion":2,"state":{}}' });
  const r = St.load(store);
  assert.equal(r.status, 'corrupt');
  assert.equal(store._data[St.KEY_V2], '{"schemaVersion":2,"state":{}}');
});

test('decode：拒绝 NaN / 负数 / 未知 schema', () => {
  const s = A.State.create();
  const good = St.encode(s);
  assert.ok(St.decode(good).ok);

  const nan = JSON.parse(good);
  nan.state.gold = NaN;
  assert.ok(!St.decode(JSON.stringify(nan)).ok);

  const neg = JSON.parse(good);
  neg.state.gold = -5;
  assert.ok(!St.decode(JSON.stringify(neg)).ok);

  const badVer = JSON.parse(good);
  badVer.state.schemaVersion = 3;
  assert.ok(!St.decode(JSON.stringify(badVer)).ok);
});

test('decode：拒绝跨仓库与装备的重复归属', () => {
  const s = A.State.create();
  const mk = A.Equipment.makeItem(s, { ilvl: 3, bias: 1, slot: 'weapon' });
  const st = mk.state;
  st.itemsById[mk.item.id] = mk.item;
  st.stash.push(mk.item.id);
  st.roster[0].equip.weapon = mk.item.id;

  const dec = St.decode(St.encode(st));
  assert.ok(!dec.ok);
  assert.ok(dec.errors.some((e) => e.includes('物品归属重复')));
});

test('战斗中存档 round-trip 后继续得到相同结果', () => {
  let s = A.State.create();
  s.roster.forEach((u) => { u.star = 2; });
  s = A.Expedition.start(s, { seed: 2024 }).state;
  s.run.floor = 3;
  s = A.Combat.create(s, 'normal').state;

  for (let i = 0; i < 10; i++) s = A.Combat.step(s).state;

  const text = St.encode(s);
  const dec = St.decode(text);
  assert.ok(dec.ok, JSON.stringify(dec.errors));

  let a = s, b2 = dec.state;
  for (let i = 0; i < 20; i++) {
    if (!a.run.battle || a.run.battle.over) break;
    a = A.Combat.step(a).state;
    b2 = A.Combat.step(b2).state;
  }
  assert.equal(a.run.rngState, b2.run.rngState);
  assert.deepEqual(
    a.run.battle.enemies.map((e) => e.hp),
    b2.run.battle.enemies.map((e) => e.hp)
  );
});

test('战斗中存档不包含函数、DOM 或循环引用', () => {
  let s = A.State.create();
  s = A.Expedition.start(s, { seed: 5 }).state;
  s = A.Combat.create(s, 'normal').state;
  const text = St.encode(s);
  assert.ok(text.length > 100);
  const parsed = JSON.parse(text);
  assert.equal(parsed.state.schemaVersion, 2);
  // 战斗单位里不应出现函数
  const unit = parsed.state.run.battle.allies[0];
  Object.keys(unit).forEach((k) => {
    assert.notEqual(typeof unit[k], 'function', k + ' 不应是函数');
  });
});

test('结算后存档：reload 不重复发奖', () => {
  let s = A.State.create();
  s = A.Expedition.start(s, { seed: 11 }).state;
  const r = A.Expedition.extract(s, 'extract');
  assert.ok(r.ok);
  const st = r.state;
  const gold = st.gold;
  const shards = st.shards;

  const dec = St.decode(St.encode(st));
  assert.ok(dec.ok);
  assert.equal(dec.state.gold, gold);
  assert.equal(dec.state.shards, shards);
  assert.equal(dec.state.run, null);
  assert.ok(dec.state.settlement);
});

test('save 写入后可被 load 读回', () => {
  const store = mockStorage();
  const s = A.State.create();
  s.gold = 777;
  const w = St.save(store, s);
  assert.ok(w.ok, w.error);
  const r = St.load(store);
  assert.equal(r.status, 'loaded');
  assert.equal(r.state.gold, 777);
});

test('save 拒绝非法状态，不写入坏数据', () => {
  const store = mockStorage();
  const s = A.State.create();
  s.roster[1].id = s.roster[0].id;
  const w = St.save(store, s);
  assert.ok(!w.ok);
  assert.equal(store.getItem(St.KEY_V2), null);
});

test('导入：含 HTML 的名称按普通文本保存，不执行', () => {
  const s = A.State.create();
  s.roster[0].name = '<img src=x onerror=alert(1)>';
  const text = St.encode(s);
  const dec = St.decode(text);
  assert.ok(dec.ok);
  assert.equal(dec.state.roster[0].name, '<img src=x onerror=alert(1)>');
  assert.equal(typeof dec.state.roster[0].name, 'string');
});

test('导入：失败时保留旧档不变', () => {
  const store = mockStorage();
  const good = A.State.create();
  good.gold = 321;
  St.save(store, good);
  const before = store.getItem(St.KEY_V2);

  const r = St.importSave(store, '{ broken');
  assert.ok(!r.ok);
  assert.equal(store.getItem(St.KEY_V2), before);
});

test('导入：成功前保存最近有效备份', () => {
  const store = mockStorage();
  const old = A.State.create();
  old.gold = 111;
  St.save(store, old);

  const next = A.State.create();
  next.gold = 999;
  const r = St.importSave(store, St.encode(next));
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.ok(store.getItem(St.KEY_BACKUP), '应留下备份');
  assert.equal(St.load(store).state.gold, 999);
});
