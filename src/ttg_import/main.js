/// <reference path="../roll20.d.ts" />

// TTG Import - Roll20 API Script
// Imports monsters from https://5e14.ttg.club into "D&D 5E by Roll20" NPC sheets.
// The Roll20 sandbox can't do HTTP, so a bookmarklet on ttg.club fetches the
// monster JSON and copies `!ttg <payload>` to the clipboard. See README.md.

/**
 * @typedef {Object} TtgEntry
 * @property {string} name
 * @property {string} value HTML text
 */

/**
 * @typedef {Object} TtgAttack
 * @property {string} type Melee | Ranged
 * @property {string} tohit
 * @property {string} range
 * @property {string} target
 * @property {{ formula: string, type: string }[]} damage
 * @property {string} description
 */

(function () {
  var CMD = '!ttg';
  var SPEAKER = 'TTG Import';

  var ABILITIES = [
    ['str', 'strength'],
    ['dex', 'dexterity'],
    ['con', 'constitution'],
    ['int', 'intelligence'],
    ['wis', 'wisdom'],
    ['cha', 'charisma'],
  ];

  /** @type {Record<string, string>} ttg save shortName -> sheet ability key */
  var SAVES = { Сил: 'str', Лов: 'dex', Тел: 'con', Инт: 'int', Мдр: 'wis', Хар: 'cha' };

  /** @type {Record<string, string>} ttg skill name -> sheet skill attr */
  var SKILLS = {
    Акробатика: 'acrobatics',
    Анализ: 'investigation',
    Атлетика: 'athletics',
    Внимательность: 'perception',
    Выживание: 'survival',
    Выступление: 'performance',
    Запугивание: 'intimidation',
    История: 'history',
    'Ловкость рук': 'sleight_of_hand',
    Магия: 'arcana',
    Медицина: 'medicine',
    Обман: 'deception',
    Природа: 'nature',
    Проницательность: 'insight',
    Религия: 'religion',
    Скрытность: 'stealth',
    Убеждение: 'persuasion',
    'Уход за животными': 'animal_handling',
  };

  /** @type {Record<string, string>} */
  var ENTITIES = {
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    laquo: '«',
    raquo: '»',
    hellip: '…',
    minus: '−',
    quot: '"',
    lt: '<',
    gt: '>',
    amp: '&',
  };

  /** @param {string} f ttg dice formula, e.g. "2к10 + 8" */
  function dice(f) {
    return f.replace(/к/g, 'd');
  }

  /** @param {string | undefined} html */
  function htmlToText(html) {
    return String(html || '')
      .replace(/<dice-roller[^>]*formula="([^"]*)"[^>]*\/>/g, function (_, f) {
        return dice(f);
      })
      .replace(/<\/p>|<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&(#\d+|[a-z]+);/g, function (m, e) {
        if (e[0] === '#') return String.fromCharCode(Number(e.slice(1)));
        return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
      })
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }

  /**
   * Parses "Рукопашная атака оружием: +14 к попаданию, досягаемость 10 фт., одна цель. Попадание: ..."
   * @param {string} html
   * @returns {TtgAttack | null}
   */
  function parseAttack(html) {
    var text = htmlToText(html);
    var m = text.match(
      /^(Рукопашная|Дальнобойная)[^:]*?атака[^:]*:\s*\+?(-?\d+) к попаданию,\s*([^,]+),\s*([^.]*)\.\s*Попадание:\s*([\s\S]*)$/
    );
    if (!m) return null;
    var hit = m[5];
    var damage = [];
    var re = /\d+\s*\(([^)]*d[^)]*)\)\s*([^.,]*?)(?=\s+плюс|[.,]|$)/g;
    var d;
    while ((d = re.exec(hit))) {
      damage.push({ formula: d[1].trim(), type: d[2].replace(/\s*урона?\s*/g, ' ').trim() });
    }
    return {
      type: m[1] === 'Рукопашная' ? 'Melee' : 'Ranged',
      tohit: m[2],
      range: m[3].trim(),
      target: m[4].trim(),
      damage: damage,
      // shortcut: assumes the hit sentence has no inner "." (e.g. "на 10 фт."); full text if this misfires
      description: hit.replace(/^[^.]*\.\s*/, ''),
    };
  }

  var rowSeq = 0;
  // Digits + lowercase only: capitals break setWithWorker on repeating rows, and "_" inside
  // the id breaks attribute-name parsing (sheet workers split on "_").
  var ROW_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
  var BASE = ROW_CHARS.length;
  // Repeating row ids sort lexicographically on the sheet, so prefix with a monotonic counter.
  function rowId() {
    var n = Date.now() * 1000 + rowSeq++;
    var id = '';
    for (var i = 0; i < 10; i++) {
      id = ROW_CHARS[n % BASE] + id;
      n = Math.floor(n / BASE);
    }
    for (var j = 0; j < 9; j++) id += ROW_CHARS[Math.floor(Math.random() * BASE)];
    return '-' + id;
  }

  /**
   * @param {string} charId
   * @param {string} name
   * @param {string | number} current
   * @param {string | number} [max]
   */
  function setAttr(charId, name, current, max) {
    var attr = /** @type {Attribute} */ (createObj('attribute', { characterid: charId, name: name, current: '' }));
    /** @type {Record<string, string>} */
    var props = { current: String(current) };
    if (max !== undefined) props.max = String(max);
    // setWithWorker so the sheet computes derived fields (mods, rollbase, ...)
    attr.setWithWorker(props);
  }

  /**
   * @param {string} charId
   * @param {string} section e.g. "npcaction"
   * @param {Record<string, string>} fields
   */
  function addRow(charId, section, fields) {
    var id = rowId();
    Object.keys(fields).forEach(function (k) {
      setAttr(charId, 'repeating_' + section + '_' + id + '_' + k, fields[k]);
    });
  }

  /** @param {TtgEntry} a */
  function actionFields(a) {
    var atk = parseAttack(a.value);
    if (!atk) return { name: a.name, description: htmlToText(a.value), 'npc_options-flag': '0' };
    /** @type {Record<string, string>} */
    var f = {
      name: a.name,
      attack_flag: 'on',
      attack_type: atk.type,
      attack_tohit: atk.tohit,
      attack_range: atk.range,
      attack_target: atk.target,
      description: atk.description,
      'npc_options-flag': '0',
    };
    if (atk.damage[0]) {
      f.attack_damage = atk.damage[0].formula;
      f.attack_damagetype = atk.damage[0].type;
    }
    if (atk.damage[1]) {
      f.attack_damage2 = atk.damage[1].formula;
      f.attack_damagetype2 = atk.damage[1].type;
    }
    return f;
  }

  /** @param {any} list */
  function joinList(list) {
    return (list || []).map(String).join(', ');
  }

  /**
   * @param {any} d ttg /api/v1/bestiary/<slug> response
   * @returns {Character}
   */
  function importMonster(d) {
    var ch = /** @type {Character} */ (createObj('character', { name: d.name.rus, inplayerjournals: '', archived: false }));
    if (d.description) ch.set('bio', htmlToText(d.description).replace(/\n/g, '<br>'));
    var id = ch.id;

    var type = d.size.rus + ' ' + d.type.name;
    if (d.type.tags && d.type.tags.length) type += ' (' + d.type.tags.join(', ') + ')';
    if (d.alignment) type += ', ' + d.alignment;

    setAttr(id, 'npc', 1);
    setAttr(id, 'npc_options-flag', 0);
    setAttr(id, 'npc_name', d.name.rus);
    setAttr(id, 'npc_type', type);
    setAttr(id, 'npc_ac', d.armorClass);
    setAttr(id, 'npc_actype', (d.armors || []).map((/** @type {any} */ a) => a.name).join(', '));
    setAttr(id, 'hp', d.hits.average, d.hits.average);
    var hpf = dice(d.hits.formula || '');
    if (d.hits.bonus) hpf += (d.hits.sign || ' + ').trim() + d.hits.bonus;
    setAttr(id, 'npc_hpformula', hpf);
    setAttr(
      id,
      'npc_speed',
      (d.speed || [])
        .map((/** @type {any} */ s) => (s.name ? s.name + ' ' : '') + s.value + ' фт.' + (s.additional ? ' (' + s.additional + ')' : ''))
        .join(', ')
    );

    ABILITIES.forEach(function (a) {
      // ttg spells wisdom "wiz"
      var v = d.ability[a[0]] !== undefined ? d.ability[a[0]] : d.ability.wiz;
      setAttr(id, a[1] + '_base', v);
      setAttr(id, a[1], v);
      setAttr(id, a[1] + '_mod', Math.floor((v - 10) / 2));
    });

    if (d.savingThrows && d.savingThrows.length) {
      setAttr(id, 'npc_saving_flag', 1);
      d.savingThrows.forEach((/** @type {any} */ s) => {
        var key = SAVES[s.shortName];
        if (!key) return;
        setAttr(id, 'npc_' + key + '_save_base', s.value);
        setAttr(id, 'npc_' + key + '_save_flag', 1);
      });
    }
    if (d.skills && d.skills.length) {
      setAttr(id, 'npc_skills_flag', 1);
      d.skills.forEach((/** @type {any} */ s) => {
        var key = SKILLS[s.name];
        if (!key) return;
        setAttr(id, 'npc_' + key + '_base', s.value);
        setAttr(id, 'npc_' + key + '_flag', 1);
      });
    }

    setAttr(id, 'npc_vulnerabilities', joinList(d.damageVulnerabilities));
    setAttr(id, 'npc_resistances', joinList(d.damageResistances));
    setAttr(id, 'npc_immunities', joinList(d.damageImmunities));
    setAttr(id, 'npc_condition_immunities', joinList(d.conditionImmunities));
    var senses = ((d.senses && d.senses.senses) || []).map(
      (/** @type {any} */ s) => s.name + ' ' + s.value + ' фт.' + (s.additional ? ' (' + s.additional + ')' : '')
    );
    if (d.senses && d.senses.passivePerception) senses.push('пассивная Внимательность ' + d.senses.passivePerception);
    setAttr(id, 'npc_senses', senses.join(', '));
    setAttr(id, 'npc_languages', joinList(d.languages) || '—');
    if (d.challengeRating && d.challengeRating !== '—') setAttr(id, 'npc_challenge', d.challengeRating);
    if (d.experience) setAttr(id, 'npc_xp', d.experience);

    (d.feats || []).forEach((/** @type {TtgEntry} */ f) =>
      // sheet field is "desc" for traits/reactions, "description" for actions
      addRow(id, 'npctrait', { name: f.name, desc: htmlToText(f.value) })
    );
    (d.actions || []).forEach((/** @type {TtgEntry} */ a) => addRow(id, 'npcaction', actionFields(a)));
    if (d.bonusActions && d.bonusActions.length) {
      setAttr(id, 'npcbonusactionsflag', 1);
      d.bonusActions.forEach((/** @type {TtgEntry} */ a) => addRow(id, 'npcbonusaction', actionFields(a)));
    }
    if (d.reactions && d.reactions.length) {
      setAttr(id, 'npcreactionsflag', 1);
      d.reactions.forEach((/** @type {TtgEntry} */ r) =>
        addRow(id, 'npcreaction', { name: r.name, desc: htmlToText(r.value) })
      );
    }
    var legendary = d.legendary && d.legendary.list;
    if (legendary && legendary.length) {
      setAttr(id, 'npc_legendary_actions', d.legendary.count || 3);
      legendary.forEach((/** @type {TtgEntry} */ a) => addRow(id, 'npcaction-l', actionFields(a)));
    }
    return ch;
  }

  /** @type {Record<string, number>} size word at the start of npc_type -> token side in grid cells */
  var TOKEN_CELLS = { Большой: 2, Огромный: 3, Громадный: 4 };

  /**
   * @param {string} charId
   * @param {string} name
   */
  function attrValue(charId, name) {
    var a = findObjs({ type: 'attribute', characterid: charId, name: name })[0];
    return a ? String(a.get('current')) : '';
  }

  /**
   * Fills a token from the character sheet: name, size, bar 1 = HP (unlinked,
   * so each copy tracks its own), bar 2 = AC.
   * @param {Graphic} token
   * @param {Character} ch
   */
  function setupToken(token, ch) {
    var side = 70 * (TOKEN_CELLS[attrValue(ch.id, 'npc_type').split(' ')[0]] || 1);
    var hp = attrValue(ch.id, 'hp');
    token.set({
      represents: ch.id,
      name: ch.get('name'),
      showname: true,
      width: side,
      height: side,
      bar1_link: '',
      bar1_value: hp,
      bar1_max: hp,
      bar2_link: '',
      bar2_value: attrValue(ch.id, 'npc_ac'),
      bar2_max: '',
    });
  }

  // Tokens dragged out from the journal (or linked by hand) to an NPC get their bars filled.
  /** @param {Graphic} token */
  function onTokenLinked(token) {
    var ch = /** @type {Character | undefined} */ (getObj('character', token.get('represents')));
    if (!ch || token.get('bar1_value') || attrValue(ch.id, 'npc') !== '1') return;
    setupToken(token, ch);
  }
  on('add:graphic', onTokenLinked);
  on('change:graphic:represents', onTokenLinked);

  /** @param {string} s */
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Creates a GM-only handout from a ttg /api/v1/items/magic/<slug> response.
   * @param {any} d
   * @returns {Handout}
   */
  function importItem(d) {
    var h = /** @type {Handout} */ (createObj('handout', { name: d.name.rus, inplayerjournals: '', archived: false }));
    var meta = d.type.name + (d.specialRaw ? ' (' + d.specialRaw + ')' : '') + ', ' + d.rarity.name;
    if (d.customization) meta += ' (требуется настройка)';
    var paras = htmlToText(d.description).split('\n').filter(Boolean);
    h.set('notes', ['<i>' + escapeHtml(meta) + '</i>'].concat(paras.map(escapeHtml)).map((p) => '<p>' + p + '</p>').join(''));
    return h;
  }

  /**
   * @param {string} who
   * @param {string} text
   */
  function whisper(who, text) {
    sendChat(SPEAKER, '/w "' + who.replace(/ \(GM\)$/, '') + '" ' + text, undefined, { noarchive: true });
  }

  on('chat:message', function (/** @type {ChatMessage} */ msg) {
    if (msg.type !== 'api' || msg.content.split(' ')[0] !== CMD) return;
    if (!playerIsGM(msg.playerid)) return whisper(msg.who, 'Импорт доступен только GM.');
    var payload = msg.content.slice(CMD.length).trim();
    if (!payload) return whisper(msg.who, 'Использование: открой монстра на 5e14.ttg.club, нажми закладку, вставь сюда.');
    var data;
    try {
      data = JSON.parse(decodeURIComponent(payload));
    } catch (e) {
      return whisper(msg.who, 'Не удалось разобрать данные: ' + e + '. Скопируй команду закладкой заново.');
    }
    if (data && data.name && data.rarity && data.description !== undefined) {
      var h = importItem(data);
      return whisper(msg.who, 'Импортирован: [' + h.get('name') + '](http://journal.roll20.net/handout/' + h.id + ')');
    }
    if (!data || !data.name || !data.hits || !data.ability) {
      return whisper(msg.who, 'Это не монстр или магический предмет с ttg.club.');
    }
    var ch = importMonster(data);
    var sel = (msg.selected || []).find((s) => s._type === 'graphic');
    var token = sel && /** @type {Graphic | undefined} */ (getObj('graphic', sel._id));
    if (token) {
      setupToken(token, ch);
      setDefaultTokenForCharacter(ch, token);
    }
    whisper(
      msg.who,
      'Импортирован: [' + ch.get('name') + '](http://journal.roll20.net/character/' + ch.id + ')' +
        (token ? ', токен настроен.' : '. Чтобы настроить токен, выдели его перед вставкой команды.')
    );
  });

  if (typeof __TEST_MODE__ !== 'undefined' && __TEST_MODE__) {
    globalThis.__TEST_EXPORTS__ = { htmlToText: htmlToText, parseAttack: parseAttack };
  }
})();
