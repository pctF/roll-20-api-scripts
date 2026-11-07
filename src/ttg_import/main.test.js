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

/**
 * Imports `data` as GM; returns the sandbox, created character and its attributes by name.
 * @param {any} data
 * @param {string} [content] chat message, defaults to the ttg command for `data`
 */
function runImport(data, content = command(data)) {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM (GM)', content });
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

// ---- dnd.su ----

const readme = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8');
const dndsuBookmarkletCode = readme.match(/^\s*javascript:(\(async\(\)=>\{const c=document\.querySelector\('\.card\.active.*)$/m)?.[1];

/**
 * Runs the README's dnd.su bookmarklet on a fake page holding fixture `f`'s card; returns the copied text.
 * @param {{ id: string, name: string, html: string }} f
 */
async function dndsuBookmarklet(f) {
  assert.ok(dndsuBookmarkletCode, 'dnd.su bookmarklet not found in README');
  let copied = '';
  const card = {
    dataset: { id: f.id },
    querySelector: (/** @type {string} */ sel) => (sel === '.card__body' ? { innerHTML: f.html } : { dataset: { copy: f.name } }),
  };
  const document = { querySelector: () => card };
  const navigator = { clipboard: { writeText: async (/** @type {string} */ t) => void (copied = t) } };
  await new Function('document', 'navigator', 'alert', 'return ' + dndsuBookmarkletCode)(document, navigator, () => {});
  return copied;
}

/** @param {string} name dnd.su fixture name without the "dndsu_" prefix */
async function runDndSu(name) {
  return runImport(null, await dndsuBookmarklet(fixture('dndsu_' + name)));
}

test('dnd.su: githyanki supreme commander through the README bookmarklet', async () => {
  const content = await dndsuBookmarklet(fixture('dndsu_githyanki_supreme_commander'));
  assert.match(content, /^!dndsu %7B%22id%22:%22bestiary:8259%22/);
  assert.ok(content.length < 6000, `payload ${content.length} chars`);

  const { sandbox, char, attrs } = runImport(null, content);
  assert.equal(char.get('name'), 'Гитъянки главнокомандующий');
  assert.equal(attrs.npc_type, 'Средний Гуманоид (гит), любое мировоззрение');
  assert.equal(attrs.npc_ac, '18');
  assert.equal(attrs.npc_actype, 'латы');
  assert.equal(attrs.hp, '187');
  assert.equal(attrs.npc_hpformula, '22d8 + 88');
  assert.equal(attrs.npc_speed, '30 футов');
  assert.equal(attrs.strength_base, '19');
  assert.equal(attrs.wisdom_base, '16');
  assert.equal(attrs.npc_con_save_base, '9');
  assert.equal(attrs.npc_dex_save_flag, undefined);
  assert.equal(attrs.npc_perception_base, '8');
  assert.equal(attrs.npc_intimidation_base, '9');
  assert.equal(attrs.npc_insight_base, '8');
  assert.equal(attrs.npc_senses, 'пассивное Восприятие 18');
  assert.equal(attrs.npc_languages, 'Гитский');
  assert.equal(attrs.npc_challenge, '14');
  assert.equal(attrs.npc_xp, '11500');

  assert.deepEqual(
    rows(attrs, 'npctrait').map((t) => t.name),
    ['Легендарное сопротивление (3/день)']
  );
  const actions = rows(attrs, 'npcaction');
  assert.deepEqual(
    actions.map((a) => a.name),
    ['Мультиатака', 'Серебряный двуручный меч', 'Использование заклинаний (Псионика)']
  );
  assert.equal(actions[1].attack_tohit, '12');
  assert.equal(actions[1].attack_range, 'досягаемость 5 футов');
  assert.equal(actions[1].attack_damage, '2d6 + 7');
  assert.equal(actions[1].attack_damagetype, 'рубящего');
  assert.equal(actions[1].attack_damage2, '5d6');
  assert.equal(actions[1].attack_damagetype2, 'психической энергией');
  // spell list paragraphs stay with the spellcasting entry
  assert.match(actions[2].description, /\n1\/день каждое: длань Бигби/);
  assert.equal(rows(attrs, 'npcbonusaction')[0].name, 'Астральный шаг');
  assert.equal(rows(attrs, 'npcreaction')[0].name, 'Парирование');
  assert.equal(attrs.npc_legendary_actions, '3');
  assert.deepEqual(
    rows(attrs, 'npcaction-l').map((a) => a.name),
    ['Приказ союзникам', 'Атака (2 действия)']
  );
  assert.match(char.get('bio'), /^Главнокомандующие управляют армиями/);
  assert.match(sandbox.getWhispers()[0].message, new RegExp(`journal.roll20.net/character/${char.id}`));
});

test('dnd.su: adult red dragon, damage type before dice, lair goes to bio after description', async () => {
  const { attrs, char } = await runDndSu('adult_red_dragon');
  assert.equal(attrs.npc_type, 'Огромный Дракон, хаотично-злой');
  assert.equal(attrs.npc_speed, '40 футов, летая 80 футов, лазая 40 футов');
  assert.equal(attrs.npc_immunities, 'огонь');
  assert.equal(attrs.npc_senses, 'слепое зрение 60 футов, тёмное зрение 120 футов, пассивное Восприятие 23');
  const bite = rows(attrs, 'npcaction')[1];
  assert.equal(bite.name, 'Укус');
  assert.equal(bite.attack_damage, '2d10 + 8');
  assert.equal(bite.attack_damagetype, 'колющий');
  assert.equal(bite.attack_damage2, '2d6');
  assert.equal(bite.attack_damagetype2, 'огнём');
  assert.equal(rows(attrs, 'npcaction-l').length, 3);
  assert.match(char.get('bio'), /^Наиболее алчные из истинных драконов/);
  assert.match(char.get('bio'), /<br>Логово<br>Красные драконы устраивают/);
  assert.match(char.get('bio'), /<br>• Магма вырывается/);
});

test('dnd.su: lich spell list, resistances, condition immunities, 4 legendary actions', async () => {
  const { attrs } = await runDndSu('lich');
  assert.equal(attrs.npc_resistances, 'некротическая энергия, холод, электричество');
  assert.equal(attrs.npc_immunities, 'яд; дробящий, колющий, рубящий от немагических атак');
  assert.equal(attrs.npc_condition_immunities, 'паралич, очарование, отравление, истощение, испуг');
  assert.equal(attrs.npc_xp, '33000');
  const spells = rows(attrs, 'npctrait').find((t) => t.name === 'Использование заклинаний');
  assert.match(spells?.desc, /\n• 9 уровень \(1 ячейка\): слово силы: смерть \[power word kill\]\.$/);
  assert.deepEqual(
    rows(attrs, 'npctrait').map((t) => t.name),
    ['Легендарное сопротивление (3/день)', 'Восстановление', 'Использование заклинаний', 'Сопротивление изгнанию']
  );
  const touch = rows(attrs, 'npcaction')[0];
  assert.equal(touch.attack_target, 'одно существо');
  assert.equal(touch.attack_damagetype, 'холодом');
  assert.equal(rows(attrs, 'npcaction-l').length, 4);
});

test('dnd.su: wolf, fractional CR, no saves or legendary actions', async () => {
  const { attrs } = await runDndSu('wolf');
  assert.equal(attrs.npc_challenge, '1/4');
  assert.equal(attrs.npc_xp, '50');
  assert.equal(attrs.npc_saving_flag, undefined);
  assert.equal(attrs.npc_legendary_actions, undefined);
  assert.equal(attrs.npc_hpformula, '2d8 + 2');
  assert.deepEqual(
    rows(attrs, 'npctrait').map((t) => t.name),
    ['Острый слух и тонкий нюх', 'Тактика стаи']
  );
});

test('dnd.su: magic items become handouts with type, rarity and price', async () => {
  for (const [name, notes] of [
    [
      'ring_of_protection',
      '<p><i>Кольцо, редкое (требуется настройка)</i></p><p><i>Рекомендованная стоимость: 501-5\u2009000 зм</i></p><p>Вы получаете бонус +1 к КД',
    ],
    ['flame_tongue', '<p><i>Оружие (любой меч), редкое (требуется настройка)</i></p><p><i>Рекомендованная'],
  ]) {
    const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
    sandbox.loadScript(mainPath);
    sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: await dndsuBookmarklet(fixture('dndsu_' + name)) });
    const [h] = sandbox.findObjs({ type: 'handout' });
    assert.ok(h.get('notes').startsWith(notes), h.get('notes'));
    assert.equal(sandbox.findObjs({ type: 'character' }).length, 0);
  }
});

test('dnd.su: other pages and garbage create nothing', () => {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);
  const spell = JSON.stringify({ id: 'spells:26', name: 'Волшебная рука', html: '<ul><li>x</li></ul>' });
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!dndsu ' + encodeURIComponent(spell) });
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!dndsu ' + encodeURIComponent(JSON.stringify(fixture('goblin_boss'))) });
  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!dndsu' });
  assert.equal(sandbox.findObjs({ type: 'character' }).length + sandbox.findObjs({ type: 'handout' }).length, 0);
  assert.deepEqual(
    sandbox.getWhispers().map((w) => w.message.slice(0, 20)),
    ['Это не монстр или ма', 'Это не монстр или ма', 'Использование: откро']
  );
});

test('simplifyDndSu is idempotent, so the script can re-apply it to bookmarklet output', () => {
  const sandbox = createSandbox();
  sandbox.loadScript(mainPath);
  const simplify = sandbox.exports()?.simplifyDndSu;
  for (const name of ['adult_red_dragon', 'lich', 'flame_tongue']) {
    const once = simplify(fixture('dndsu_' + name).html);
    assert.equal(simplify(once), once);
    assert.doesNotMatch(once, /<(?!\/?(li|h3|p|strong|em|b|i|br|ul)>)/);
  }
});
