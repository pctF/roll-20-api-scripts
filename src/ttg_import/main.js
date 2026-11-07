/// <reference path="../roll20.d.ts" />

// TTG Import - Roll20 API Script
// Imports monsters from https://5e14.ttg.club and https://dnd.su into "D&D 5E by Roll20"
// NPC sheets, magic items into handouts. The Roll20 sandbox can't do HTTP, so a bookmarklet
// on the site copies `!ttg <payload>` / `!dndsu <payload>` to the clipboard. See README.md.

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

/**
 * @typedef {Object} ItemData
 * @property {string} name
 * @property {string[]} meta italic header lines (type, rarity, price)
 * @property {string[]} paras description paragraphs, plain text
 */

(function () {
  var CMD = '!ttg';
  var CMD_DNDSU = '!dndsu';
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
    Восприятие: 'perception', // dnd.su
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
    thinsp: '\u2009',
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
    // type goes after the dice on ttg ("7 (2d6) урона огнём"), before on dnd.su ("урон огнём 7 (2d6)")
    var re = /([^.,\d()]*?)\s*\d+\s*\(([^)]*d[^)]*)\)\s*([^.,]*?)(?=\s*плюс\s|[.,]|$)/g;
    var d;
    while ((d = re.exec(hit))) {
      var type = (d[3] || d[1]).toLowerCase().replace(/^\s*плюс(?=\s)|(^|\s)урона?(?=\s|$)/g, ' ');
      damage.push({ formula: d[2].trim(), type: type.trim() });
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
    // dnd.su gives speed and senses as ready text
    setAttr(
      id,
      'npc_speed',
      typeof d.speed === 'string'
        ? d.speed
        : (d.speed || [])
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
    var senses =
      typeof d.senses === 'string'
        ? [d.senses]
        : ((d.senses && d.senses.senses) || []).map(
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
   * Creates a GM-only handout for a magic item.
   * @param {ItemData} it
   * @returns {Handout}
   */
  function importItem(it) {
    var h = /** @type {Handout} */ (createObj('handout', { name: it.name, inplayerjournals: '', archived: false }));
    var lines = it.meta.map((m) => '<i>' + escapeHtml(m) + '</i>').concat(it.paras.map(escapeHtml));
    h.set('notes', lines.map((p) => '<p>' + p + '</p>').join(''));
    return h;
  }

  /**
   * @param {any} d ttg payload: /api/v1/bestiary/<slug> or /api/v1/items/magic/<slug> response
   * @returns {{ item?: ItemData, monster?: any } | null}
   */
  function fromTtg(d) {
    if (d && d.name && d.rarity && d.description !== undefined) {
      var meta = d.type.name + (d.specialRaw ? ' (' + d.specialRaw + ')' : '') + ', ' + d.rarity.name;
      if (d.customization) meta += ' (требуется настройка)';
      return { item: { name: d.name.rus, meta: [meta], paras: htmlToText(d.description).split('\n').filter(Boolean) } };
    }
    return d && d.name && d.hits && d.ability ? { monster: d } : null;
  }

  // ---- dnd.su ----
  // No API there: the bookmarklet sends the card's HTML, reduced by simplifyDndSu.

  /**
   * Same reduction the dnd.su bookmarklet does before copying (keep README in sync): drops
   * attributes and every tag except list/paragraph/emphasis ones, so the payload stays small.
   * Idempotent, so raw card HTML and bookmarklet output parse the same.
   * @param {string} html
   */
  function simplifyDndSu(html) {
    return html
      .replace(/<sup[\s\S]*?<\/sup>/g, '')
      .replace(/<(\/?)(\w+)[^>]*>/g, function (_, close, tag) {
        tag = tag.toLowerCase();
        if (/^(li|h3|p|strong|em|b|i|br|ul)$/.test(tag)) return '<' + close + tag + '>';
        return tag === 'div' ? ' ' : '';
      })
      .replace(/\s+/g, ' ');
  }

  /** @param {string} html */
  function dndText(html) {
    return htmlToText(html).replace(/(\d)к(\d)/g, '$1d$2');
  }

  /** "Волк [Wolf]" -> "Волк" @param {string} title */
  function dndName(title) {
    return title.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  }

  /**
   * Contents of the top-level <li>s of the card's <ul class="params">.
   * @param {string} html simplified card HTML
   */
  function topItems(html) {
    /** @type {string[]} */
    var items = [];
    var depth = 0;
    var start = 0;
    var re = /<(\/?)(ul|li)>/g;
    var m;
    while ((m = re.exec(html))) {
      if (m[2] === 'ul') depth += m[1] ? -1 : 1;
      else if (depth === 1 && !m[1]) start = re.lastIndex;
      else if (depth === 1) items.push(html.slice(start, m.index));
    }
    return items.filter((s) => s.trim());
  }

  /**
   * Paragraph HTML strings of a section; nested list items become paragraphs.
   * @param {string} html
   */
  function blocks(html) {
    return html
      .replace(/<li>/g, '<p>• ')
      .replace(/<\/li>|<\/?ul>|<\/?h3>/g, '</p>')
      .split(/<\/?p>/)
      .filter((b) => dndText(b));
  }

  /**
   * "<strong><em>Укус</em>.</strong> Рукопашная..." -> { name: "Укус", text: "Рукопашная..." }.
   * A paragraph without a leading emphasized name, or whose emphasis ends with ":"
   * (spell lists: "<strong>3/день каждое</strong>: ..."), gets name "".
   * @param {string} html
   */
  function splitEntry(html) {
    var m = html.match(/^\s*((?:<(?:strong|em|b|i)>\s*)+)([^<]*)/);
    var after = m ? html.slice(m[0].length) : '';
    if (!m || /:\s*$/.test(m[2]) || /^(?:<\/?(?:strong|em|b|i)>|\s)*:/.test(after)) return { name: '', text: dndText(html) };
    return { name: dndText(m[2]).replace(/[.\s]+$/, ''), text: dndText(after).replace(/^[.\s]+/, '') };
  }

  /** @type {Record<string, string>} dnd.su section title -> ttg field */
  var DNDSU_SECTIONS = {
    '': 'feats',
    Действия: 'actions',
    'Бонусные действия': 'bonusActions',
    Реакции: 'reactions',
    'Легендарные действия': 'legendary',
  };

  /**
   * Converts a dnd.su bestiary card into the ttg shape importMonster reads.
   * @param {string} title card title, "Волк [Wolf]"
   * @param {string} html card body HTML
   */
  function parseDndSu(title, html) {
    /** @type {any} */
    var d = { name: { rus: dndName(title) }, ability: {}, legendary: { count: 3, list: [] } };
    /** @type {string[]} */
    var desc = [];
    /** @type {string[]} */
    var bio = [];
    topItems(simplifyDndSu(html)).forEach(function (li) {
      if (/<p>|<h3>/.test(li)) {
        var h = li.match(/^\s*<h3>([\s\S]*?)<\/h3>/);
        var title = h ? dndText(h[1]) : '';
        var body = h ? li.slice(h[0].length) : li;
        var key = DNDSU_SECTIONS[title];
        if (!key) {
          // description first, then lair, optional rules etc. under their titles
          var into = title === 'Описание' ? desc : bio;
          if (into === bio) bio.push(title);
          blocks(body).forEach((b) => into.push(dndText(b)));
          return;
        }
        /** @type {TtgEntry[]} */
        var list = key === 'legendary' ? d.legendary.list : (d[key] = d[key] || []);
        blocks(body).forEach(function (b) {
          var e = splitEntry(b);
          var last = list[list.length - 1];
          if (e.name || !last) {
            var count = key === 'legendary' && !e.name && e.text.match(/(\d+)\s+легендарн/);
            if (count) d.legendary.count = Number(count[1]);
            else list.push({ name: e.name, value: escapeHtml(e.text) });
          } else last.value += '\n' + escapeHtml(e.text); // spell list lines etc.
        });
        return;
      }
      var m = li.match(/^\s*<strong>([^<]*)<\/strong>([\s\S]*)$/);
      if (!m) {
        var text = dndText(li);
        if (/^Сил\s+\d/.test(text)) {
          text.replace(/(Сил|Лов|Тел|Инт|Мдр|Хар)\s+(\d+)/g, function (_, k, v) {
            d.ability[SAVES[k]] = Number(v);
            return '';
          });
        } else if (!d.size) {
          // "Средний Гуманоид (гит), любое мировоззрение"; first word is the size
          var sp = text.indexOf(' ');
          d.size = { rus: text.slice(0, sp) };
          d.type = { name: text.slice(sp + 1) };
        }
        return;
      }
      var label = dndText(m[1]).replace(/:$/, '');
      var v = dndText(m[2]);
      /** @param {string} s "+9" / "−1" */
      var num = (s) => Number(s.replace('−', '-'));
      var r;
      if (label === 'Класс Доспеха') {
        d.armorClass = parseInt(v, 10);
        var armor = v.replace(/^\d+\s*/, '').replace(/^\((.*)\)$/, '$1');
        d.armors = armor ? [{ name: armor }] : [];
      } else if (label === 'Хиты' && (r = v.match(/^(\d+)\s*(?:\(([^)]*)\))?/))) {
        d.hits = { average: Number(r[1]), formula: r[2] || '' };
      } else if (label === 'Скорость') d.speed = v;
      else if (label === 'Спасброски') {
        d.savingThrows = [];
        v.replace(/(Сил|Лов|Тел|Инт|Мдр|Хар)\s*([+−-]?\d+)/g, function (_, k, n) {
          d.savingThrows.push({ shortName: k, value: num(n) });
          return '';
        });
      } else if (label === 'Навыки') {
        d.skills = v.split(/,\s*/).map(function (s) {
          var sk = s.match(/^(.*?)\s*([+−-]\d+)$/);
          return sk ? { name: sk[1], value: num(sk[2]) } : { name: s };
        });
      } else if (/^Уязвимост/.test(label)) d.damageVulnerabilities = [v];
      else if (/^Сопротивлени/.test(label)) d.damageResistances = [v];
      else if (/^Иммунитет к урон/.test(label)) d.damageImmunities = [v];
      else if (/^Иммунитет к состояни/.test(label)) d.conditionImmunities = [v];
      else if (label === 'Чувства') d.senses = v;
      else if (label === 'Языки') d.languages = [v];
      else if (label === 'Опасность' && (r = v.match(/^([\d/]+)(?:\s*\(([\d\s]+)опыт)?/))) {
        d.challengeRating = r[1];
        if (r[2]) d.experience = Number(r[2].replace(/\D/g, ''));
      }
    });
    bio = desc.concat(bio);
    if (bio.length) d.description = escapeHtml(bio.join('\n'));
    return d;
  }

  /**
   * @param {string} title
   * @param {string} html
   * @returns {ItemData}
   */
  function parseDndSuItem(title, html) {
    /** @type {ItemData} */
    var it = { name: dndName(title), meta: [], paras: [] };
    topItems(simplifyDndSu(html)).forEach(function (li) {
      if (/<p>/.test(li)) blocks(li).forEach((b) => it.paras.push(dndText(b)));
      else if (dndText(li)) it.meta.push(dndText(li)); // "Кольцо, редкое (...)", "Рекомендованная стоимость: ..."
    });
    return it;
  }

  /**
   * @param {any} d dnd.su payload: { id: "bestiary:8259" | "items:94", name: card title, html: card body }
   * @returns {{ item?: ItemData, monster?: any } | null}
   */
  function fromDndSu(d) {
    if (!d || typeof d.name !== 'string' || typeof d.html !== 'string') return null;
    if (/^items:/.test(d.id)) return { item: parseDndSuItem(d.name, d.html) };
    var m = /^bestiary:/.test(d.id) ? parseDndSu(d.name, d.html) : null;
    return m && m.hits ? { monster: m } : null;
  }

  /**
   * @param {string} who
   * @param {string} text
   */
  function whisper(who, text) {
    sendChat(SPEAKER, '/w "' + who.replace(/ \(GM\)$/, '') + '" ' + text, undefined, { noarchive: true });
  }

  on('chat:message', function (/** @type {ChatMessage} */ msg) {
    var cmd = msg.content.split(' ')[0];
    if (msg.type !== 'api' || (cmd !== CMD && cmd !== CMD_DNDSU)) return;
    var site = cmd === CMD ? '5e14.ttg.club' : 'dnd.su';
    if (!playerIsGM(msg.playerid)) return whisper(msg.who, 'Импорт доступен только GM.');
    var payload = msg.content.slice(cmd.length).trim();
    if (!payload) return whisper(msg.who, 'Использование: открой монстра или магический предмет на ' + site + ', нажми закладку, вставь сюда.');
    var data;
    try {
      data = JSON.parse(decodeURIComponent(payload));
    } catch (e) {
      return whisper(msg.who, 'Не удалось разобрать данные: ' + e + '. Скопируй команду закладкой заново.');
    }
    var res = cmd === CMD ? fromTtg(data) : fromDndSu(data);
    if (!res) return whisper(msg.who, 'Это не монстр или магический предмет с ' + site + '.');
    if (res.item) {
      var h = importItem(res.item);
      return whisper(msg.who, 'Импортирован: [' + h.get('name') + '](http://journal.roll20.net/handout/' + h.id + ')');
    }
    var ch = importMonster(res.monster);
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
    globalThis.__TEST_EXPORTS__ = { htmlToText: htmlToText, parseAttack: parseAttack, parseDndSu: parseDndSu, simplifyDndSu: simplifyDndSu };
  }
})();
