import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createSandbox } from '../testing/roll20-mock.js';

const mainPath = fileURLToPath(new URL('./main.js', import.meta.url));

/** @param {string} name */
function fixture(name) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'));
}

/** Strips vm-realm prototypes so deepEqual compares plain data. @param {any} x */
function plain(x) {
  return JSON.parse(JSON.stringify(x));
}

/** Same encoding as the README bookmarklet. @param {any} data */
function command(data) {
  return '!ttg ' + JSON.stringify(data).replace(/[%<>&"\[\]{}@#|\\]/g, encodeURIComponent);
}

/** Imports `data` as GM; returns the sandbox, created character and its attributes by name. @param {any} data */
function runImport(data) {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM (GM)', content: command(data) });
  const [char] = sandbox.findObjs({ type: 'character' });
  /** @type {Record<string, any>} */
  const attrs = {};
  for (const a of sandbox.findObjs({ type: 'attribute', characterid: char?.id })) {
    attrs[a.get('name')] = a.get('current');
  }
  return { sandbox, char, attrs };
}

/**
 * Repeating rows of a section, in row-id (sheet display) order.
 * @param {Record<string, any>} attrs
 * @param {string} section
 */
function rows(attrs, section) {
  /** @type {Record<string, Record<string, any>>} */
  const byId = {};
  const prefix = `repeating_${section}_`;
  for (const [name, value] of Object.entries(attrs)) {
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    const id = rest.slice(0, 20);
    // Roll20 needs "-" + 19 of [0-9a-z]: capitals break setWithWorker, "_" breaks name parsing
    assert.match(id, /^-[0-9a-z]{19}$/, `bad row id: ${id}`);
    (byId[id] ??= {})[rest.slice(21)] = value;
  }
  return Object.keys(byId)
    .sort()
    .map((id) => byId[id]);
}

test('imports adult red dragon into NPC sheet attributes', () => {
  const { sandbox, char, attrs } = runImport(fixture('adult_red_dragon'));
  assert.equal(char.get('name'), 'Взрослый красный дракон');
  assert.equal(attrs.npc, '1');
  assert.equal(attrs.npc_type, 'Огромный дракон (цветной), хаотично-злой');
  assert.equal(attrs.npc_ac, '19');
  assert.equal(attrs.npc_actype, 'природный доспех');
  assert.equal(attrs.hp, '256');
  assert.equal(attrs.npc_hpformula, '19d12+133');
  assert.equal(attrs.npc_speed, '40 фт., летая 80 фт., лазая 40 фт.');
  assert.equal(attrs.strength_base, '27');
  assert.equal(attrs.wisdom_base, '13');
  assert.equal(attrs.charisma_mod, '5');
  assert.equal(attrs.npc_dex_save_base, '6');
  assert.equal(attrs.npc_cha_save_base, '11');
  assert.equal(attrs.npc_perception_base, '13');
  assert.equal(attrs.npc_stealth_base, '6');
  assert.equal(attrs.npc_immunities, 'огонь');
  assert.equal(attrs.npc_senses, 'тёмное зрение 120 фт., слепое зрение 60 фт., пассивная Внимательность 23');
  assert.equal(attrs.npc_languages, 'Драконий, Общий');
  assert.equal(attrs.npc_challenge, '17');
  assert.equal(attrs.npc_xp, '18000');
  assert.equal(attrs.npc_legendary_actions, '3');

  const actions = rows(attrs, 'npcaction');
  assert.deepEqual(
    actions.map((a) => a.name),
    ['Мультиатака', 'Укус', 'Коготь', 'Хвост', 'Ужасающая внешность', 'Огненное дыхание (перезарядка 5–6)']
  );
  assert.equal(actions[1].attack_flag, 'on');
  assert.equal(actions[1].attack_tohit, '14');
  assert.equal(actions[1].attack_damage, '2d10 + 8');
  assert.equal(actions[1].attack_damagetype2, 'огнём');
  assert.equal(actions[5].attack_flag, undefined);
  assert.match(actions[5].description, /Сл 21, получая 63 \(18d6\) урона огнём/);
  assert.equal(rows(attrs, 'npcaction-l').length, 3);
  assert.equal(rows(attrs, 'npctrait')[0].name, 'Легендарное сопротивление (3/день)');
  assert.match(rows(attrs, 'npctrait')[0].desc, /\S/);

  const [w] = sandbox.getWhispers();
  assert.equal(w.to, 'GM');
  assert.match(w.message, new RegExp(`journal.roll20.net/character/${char.id}`));
});

test('goblin boss: reactions, no legendary', () => {
  const { attrs } = runImport(fixture('goblin_boss'));
  assert.equal(attrs.npcreactionsflag, '1');
  assert.equal(rows(attrs, 'npcreaction')[0].name, 'Перенаправление атаки');
  assert.match(rows(attrs, 'npcreaction')[0].desc, /\S/);
  assert.equal(attrs.npc_legendary_actions, undefined);
  assert.equal(attrs.npc_hpformula, '6d6');
});

test('non-GM and garbage payloads create nothing', () => {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);
  sandbox.fireChatMessage({ playerid: 'p1', who: 'Player', content: command(fixture('goblin_boss')) });
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!ttg %E0%A4%A' });
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!ttg {"x":1}' });
  assert.equal(sandbox.findObjs({ type: 'character' }).length, 0);
  assert.equal(sandbox.getWhispers().length, 3);
});

test('selected token becomes the default token', () => {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);
  const token = sandbox.addGraphic({ name: '' });
  sandbox.fireChatMessage({
    playerid: 'gm1',
    who: 'GM',
    content: command(fixture('adult_red_dragon')),
    selected: [{ _id: token.id, _type: 'graphic' }],
  });
  const [char] = sandbox.findObjs({ type: 'character' });
  assert.equal(token.get('represents'), char.id);
  assert.equal(token.get('name'), 'Взрослый красный дракон');
  assert.equal(token.get('width'), 210); // huge = 3 cells
  assert.equal(token.get('bar1_value'), '256');
  assert.equal(token.get('bar2_value'), '19');
  assert.equal(char.get('_defaulttoken'), token.id);
});

test('token dragged onto the map for an imported NPC gets HP/AC bars', () => {
  const { sandbox, char } = runImport(fixture('goblin_boss'));
  const token = sandbox.addGraphic({ represents: char.id, bar1_value: '' });
  sandbox.fireEvent('add:graphic', token);
  assert.equal(token.get('name'), 'Босс гоблинов');
  assert.equal(token.get('bar1_value'), '21');
  assert.equal(token.get('bar1_max'), '21');
  assert.equal(token.get('bar2_value'), '17');
  assert.equal(token.get('width'), 70);
});

test('parseAttack: melee with two damage parts', () => {
  const sandbox = createSandbox();
  sandbox.loadScript(mainPath);
  const bite = fixture('adult_red_dragon').actions.find((/** @type {any} */ a) => a.name === 'Укус');
  assert.deepEqual(plain(sandbox.exports()?.parseAttack(bite.value)), {
    type: 'Melee',
    tohit: '14',
    range: 'досягаемость 10 фт.',
    target: 'одна цель',
    damage: [
      { formula: '2d10 + 8', type: 'колющего' },
      { formula: '2d6', type: 'огнём' },
    ],
    description: '',
  });
});

test('parseAttack: ranged-or-melee, non-attack returns null', () => {
  const sandbox = createSandbox();
  sandbox.loadScript(mainPath);
  const { actions } = fixture('goblin_boss');
  const javelin = sandbox.exports()?.parseAttack(actions[2].value);
  assert.equal(javelin.type, 'Ranged');
  assert.equal(javelin.tohit, '2');
  assert.equal(javelin.range, 'досягаемость 5 фт. или дистанция 30/120 фт.');
  assert.deepEqual(plain(javelin.damage), [{ formula: '1d6', type: 'колющего' }]);
  assert.equal(sandbox.exports()?.parseAttack(actions[0].value), null);
});

test('htmlToText: dice-roller, entities, paragraphs', () => {
  const sandbox = createSandbox();
  sandbox.loadScript(mainPath);
  assert.equal(
    sandbox.exports()?.htmlToText('<p>Урон&nbsp;63&nbsp;(<dice-roller label="Урон" formula="18к6"/>) &laquo;x&raquo;</p><p>Б</p>'),
    'Урон 63 (18d6) «x»\nБ'
  );
});


test('magic item becomes a GM-only handout', () => {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: command(fixture('adamantine_armor')) });
  const [h] = sandbox.findObjs({ type: 'handout' });
  assert.equal(h.get('name'), 'Адамантиновый доспех');
  assert.equal(h.get('inplayerjournals'), '');
  assert.match(h.get('notes'), /^<p><i>доспех \(средний или тяжёлый, но не доспех из шкур\), необычный<\/i><\/p><p>Это доспехи усилены/);
  assert.equal(sandbox.findObjs({ type: 'character' }).length, 0);
  assert.match(sandbox.getWhispers()[0].message, /journal\.roll20\.net\/handout\//);
});

test('magic item requiring attunement says so', () => {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: command(fixture('ring_of_protection')) });
  const [h] = sandbox.findObjs({ type: 'handout' });
  assert.match(h.get('notes'), /^<p><i>кольцо, редкое \(требуется настройка\)<\/i><\/p>/);
});
