/// <reference path="../roll20.d.ts" />

// Three Dragon Ante - Roll20 API Script
// See README.md for game rules and scoring examples.

/**
 * @typedef {Object} Rolls
 * @property {number[]} d8
 * @property {number} [d6]
 * @property {number} [d4]
 */

/**
 * @typedef {Object} Participant
 * @property {string} id
 * @property {string} charName
 * @property {string} seatOwnerId
 * @property {string} seatOwnerName
 * @property {boolean} active
 * @property {Rolls} rolls
 * @property {string} [passedAt]
 */

/**
 * @typedef {Object} GameState
 * @property {string} stage
 * @property {string} createdBy
 * @property {Record<string, Participant>} participants
 */

(function () {
  const MODULE = 'Three Dragon Ante';
  const CMD = '!tda';
  const MODULE_SPEAKER = 'Дилер Трех Драконов';
  const MODULE_SPEAKER_DESCRIPTION = '';

  // Stages as codes; human-readable labels are in MSG.stageLabel
  var STAGES = {
    SIGNUP: 'SIGNUP',
    D8: 'D8',
    PASS_D8: 'PASS_D8',
    D6: 'D6',
    PASS_D6: 'PASS_D6',
    D4: 'D4',
    PASS_D4: 'PASS_D4',
    FINISHED: 'FINISHED'
  };

  // Messages and format helpers
  var MSG = {
    stageLabel: {
      SIGNUP: 'Ищем персонажей',
      D8: 'Раздаем первые карты(3d8)',
      PASS_D8: 'Игрокам раздали первые карты',
      D6: 'Раздаем вторую руку(1d6)',
      PASS_D6: 'У игроков две руки',
      D4: 'Раздаем финальную руку(1d4)',
      PASS_D4: 'Раскрываем руки и считаем результаты',
      FINISHED: 'Игра завершена'
    },
    common: {
      none: 'нет',
      passedSuffix: '(пас)'
    },
    help: [
      'Команды "Ставки Трех Драконов":',
      '- start  — (GM) начинает новую игру. Usage: !tda start',
      '- join   — Присоединиться персонажем. Usage: !tda join [имя персонажа|id] (или выделите фишку персонажа)',
      '- leave  — Покинуть игру персонажем. Usage: !tda leave [имя персонажа|id] (или выделите фишку персонажа)',
      '- pass   — Спасовать персонажем. Usage: !tda pass [имя персонажа|id] (или выделите фишку персонажа)',
      '- next   — (GM) перейти к следующей раздаче/этапу. Usage: !tda next',
      '- status — Показать текущий статус игры. Usage: !tda status',
      '- reset  — (GM) отменить текущую игру. Usage: !tda reset',
      '- help   — Показать эту справку. Usage: !tda help',
      'Кстати: Все броски шепчутся владельцу выбранного персонажа. После раздачи последних карт дилер посчитает карты и объявит победителя.'
    ],
    rules: {
      intro1: 'Для тех, кто подзабыл правила: игрокам раздаются три карты(3d8), затем при желании игроки могут спасовать. После этого раздется еще одна карта(1d6), снова возможность паса, затем последняя карта(1d4) и вскрытие.',
      intro2: 'Подсчет очков: пара драконов удваивается (4+4 x2 -> 16), три дракона умножаются втрое (4+4+4 x3 -> 32). Значения сверх тройки считаются как одиночные (3+3+3 x3 +3 -> 30).'
    },
    ensure: {
      noGame: 'За столом нет игроков. Желаете начать?'
    },
    start: {
      gmOnly: 'Прошу прощения, мне нужно согласование распорядителя.',
      announce: 'Начинаем игру в Ставку Трех Драконов. Просто занимайте свободные места!'
    },
    join: {
      notSignup: 'Простите, для этого не время.',
      needChar: 'Укажите персонажа: !tda join [имя|id] или выделите фишку персонажа на карте',
      notControlled: 'Вы не управляете этим персонажем.',
      already: 'Этот персонаж уже за столом.',
      notFound: 'Персонаж не найден: {query}',
      ok: '{char} присоединился к игре (владелец: {owner}).'
    },
    leave: {
      notFound: 'Персонаж не найден за столом.',
      needChar: 'Я не расслышал - кто именно говорил? Уточните: !tda leave [имя|id] или выделите фишку персонажа на карте',
      ok: '{char} покидает игру.',
      notNow: 'Боюсь, что ставки уже приняты. Можно уйти только после паса.'
    },
    pass: {
      notYours: 'Боюсь, что вы не находитесь за столом.',
      needChar: 'Я не расслышал - кто именно говорил? Уточните: !tda pass [имя|id] или выделите фишку персонажа на карте',
      notOnStage: 'Прошу прощения, но сейчас не время уходить из-за стола.',
      ok: '{char} сбрасывает карты.'
    },
    status: 'Текущее состояние: {stage}. Участники: {list}',
    proceed: {
      waiting: 'Карты на руках.',
      lastChance: 'Последний шанс остаться с фишками.',
      finished: 'Игра уже закончилась. Раздать новую?',
      empty: 'Стол свободен. Ждем игроков.'
    },
    next: {
      gmOnly: 'Я сам разберусь.'
    },
    reset: {
      gmOnly: 'Для этого мне нужно согласование распорядителя.',
      announce: 'Игра завершена по приказу распорядителя.'
    },
    spice: {
      d8: 'Дилер раздал игрокам первые карты.',
      d6: 'Каждый игрок получил дополнительную карту.',
      d4: 'Последние карты отданы игрокам.'
    },
    whispers: {
      d8: '{char}, Раздаю тебе первые карты(3d8={rolls}).',
      d6: '{char}, Вытягиваю следующую карту(1d6={rolls}): {hand}.',
      d4: '{char}, Твоя последняя карта(1d4={rolls}): {hand}.',
    },
    reveal: {
      nobody: 'Куда делись все игроки?',
      intro: 'Игроки вскрывают карты, посмотрим:\n {details}',
      solo: 'Побеждает единственный игрок: {char}!',
      hand: 'Рука игрока {char}: [{hand}] - {combo}, итог: {score}',
      winner: 'Победитель {char}, набрав {score}!',
      draw: 'Ничья! Победители {chars} набрали {score}.'
    },
    combos: {
      doubles: 'двойные драконы: {vals}',
      triples: 'тройные драконы: {vals}',
      none: 'без двойных и тройных драконов'
    },
    tension: [
      'Напряжение растет.',
      'Игроки с подозрением смотрят друг на друга.',
      'Фишки звенят на столе.',
      'Поднимаем ставки или кто-то готов сбросить?',
      'Взгляды игроков встречаются.',
      'Ставки высоки.',
      'За столом повисла тишина.',
      '',
      'Дилер оглядывает стол.',
      'Наблюдатели начинают тихо перешептываться.',
      'Кажется, не всех устраивают их карты.',
      'Дилер аккуратно поправляет фишки.',
      '',
      'Казалось бы, судьба еще не написана.',
      'Кто-то нервно сглотнул.',
      'Смех где‑то в углу стихает.',
      'Карты в руках шепчут о переменах.',
      'Мгновение решает многое.',
      'Ставки буквально пульсируют в воздухе.',
      'Атмосфера накаляется.',
      'Чья‑то рука дрогнула над фишками.',
      'Взгляд дилера стал жестче.',
      'Пальцы постукивают по деревянной кромке стола.',
      'Тайна карт грозит быть раскрытой.',
      'Кто‑то притворно кашлянул.',
      'Почти слышно, как игроки считают фишки.',
      'Тишина весит тяжелее, чем когда‑либо.',
      'Каждый считает свои шансы.',
      'Ветер перемен задувает свечу на столе.',
      'Наблюдатели охают, видя ставки.',
      'Сердца игроков бьются в такт раздаче.',
      'Одно неверное предположение — и всё решится.',
      'Тонкая нить удачи вот‑вот порвётся.',
      'Тишина сгущается, будто перед грозой.',
      'Судьбоносный взгляд пересекает весь стол.',
      'Судьба каждого сейчас пленена в картах.',
      'Последний вдох — и карты заговорят.',
      'Кто‑то снова забыл положить карту рубашкой вверх.',
      'Кто-то попытался поставить крышку?',
      'Пожалуйста, воздержитесь от еды за игральным столом.',
      'Кто-то за столом шепчет: «Сработай, пожалуйста!».',
      'У кого‑то в рукаве кажется завелся мышонок.',
      'Если повезёт — обещаю не смеяться (с трудом).',
      'В следующий раз приносите больше крепкого.',
      'Дилер шепчет: «Не смотри в карту, она стыдится».',
      'Если проиграешь — минус ужин и плюс история на всю жизнь.',
      'Дилер подмигнул: «Не смотри в чужие карты — смотри на фишки».',
      'Если эта ставка не сыграет — виноват наверняка дилер.',
      'Кто‑то сделал ставку с таким видом, будто платит за пирожок, а не за судьбу.'
    ]
  };

  /**
   * @param {string} str
   * @param {Record<string, any>} [vars]
   */
  function fmt(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] != null ? String(vars[k]) : '{' + k + '}'; });
  }

  /** @param {string} stage */
  function stageLabel(stage) {
    return MSG.stageLabel[/** @type {keyof typeof MSG.stageLabel} */ (stage)] || stage;
  }

  // Ensure persistent state bucket
  function getState() {
    state.TDA = state.TDA || {};
    state.TDA.game = state.TDA.game || null;
    return state.TDA;
  }

  /** @param {string} msg */
  function say(msg) {
    if (msg && msg.charAt(0) === '/') {
      sendChat(MODULE_SPEAKER_DESCRIPTION, msg);
    } else {
      sendChat(MODULE_SPEAKER, msg);
    }
  }
  /**
   * @param {string} playerName
   * @param {string} msg
   */
  function whisper(playerName, msg) {
    sendChat(MODULE_SPEAKER, '/w "' + playerName + '" ' + msg);
  }

  /** @param {any[]} arr */
  function randomPick(arr) {
    return arr[randomInteger(arr.length) - 1];
  }

  function tensionEnding() {
    var tensionEnding = randomPick(MSG.tension);
    if (randomInteger(100) > 90) {
      var secondPick = randomPick(MSG.tension);
      if (secondPick !== tensionEnding) {
        tensionEnding = tensionEnding + ' ' + secondPick;
      }
    }
    return tensionEnding;
  }

  /** @param {string} base */
  function spiceDesc(base) {
    say('/desc ' + base + ' ' + tensionEnding());
  }

  /** @param {string} playerid */
  function isGM(playerid) {
    return playerIsGM(playerid);
  }

  /**
   * @param {string} playerid
   * @param {string} [fallback]
   */
  function getPlayerName(playerid, fallback) {
    var p = getObj('player', playerid);
    return (p && p.get('displayname')) || fallback || 'Player';
  }

  /**
   * @param {number} sides
   * @param {number} n
   */
  function rollN(sides, n) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(randomInteger(sides));
    return arr;
  }

  /** @param {string} query */
  /** @param {string} query */
  function getCharByQuery(query) {
    if (!query) return null;
    var idMatch = query.match(/^@?([-A-Za-z0-9_]+)$/);
    /** @type {Character | null} */
    var char = null;
    if (idMatch) {
      char = /** @type {Character | undefined} */ (getObj('character', idMatch[1])) || null;
      if (char) return char;
    }
    var found = /** @type {Character[]} */ (findObjs({ type: 'character', name: query }));
    if (found && found.length) return found[0];
    // Try case-insensitive partial match
    var all = /** @type {Character[]} */ (findObjs({ type: 'character' }) || []);
    var lowered = query.toLowerCase();
    for (var i = 0; i < all.length; i++) {
      var nm = (all[i].get('name') || '').toLowerCase();
      if (nm === lowered || nm.indexOf(lowered) !== -1) return all[i];
    }
    return null;
  }

  /** @param {Character} char */
  function getCharacterControllers(char) {
    var ctrl = (char.get('controlledby') || '').split(',').filter(/** @param {string} s */ function (s) { return !!s; });
    return ctrl; // array of playerids or 'all'
  }

  /** @param {ChatMessage} msg */
  function getCharFromSelection(msg) {
    try {
      var sel = msg && msg.selected;
      if (sel && sel.length) {
        /** @type {Record<string, boolean>} */
        var map = {};
        for (var i = 0; i < sel.length; i++) {
          var it = sel[i];
          if (it && it._type === 'graphic') {
            var gr = getObj('graphic', it._id);
            if (gr) {
              var cid = gr.get('represents');
              if (cid) map[cid] = true;
            }
          }
        }
        var ids = Object.keys(map);
        if (ids.length === 1) {
          return /** @type {Character | undefined} */ (getObj('character', ids[0]));
        }
      }
    } catch (e) {
      // ignore selection errors
    }
    // Fallback: speaking as a character
    try {
      var sa = msg && msg.speakingas;
      if (sa && typeof sa === 'string' && sa.indexOf('character|') === 0) {
        var cid2 = sa.split('|')[1];
        if (cid2) {
          return /** @type {Character | undefined} */ (getObj('character', cid2));
        }
      }
    } catch (e2) {
      // ignore
    }
    return null;
  }

  /** @param {Participant} p */
  function participantLabel(p) {
    return p.charName;
  }

  /**
   * @param {Participant} p
   * @param {string} text
   */
  function whisperSeat(p, text) {
    whisper(p.seatOwnerName, text);
  }

  /** @param {GameState} g */
  function listParticipants(g) {
    var parts = Object.values(g.participants);
    if (!parts.length) return MSG.common.none;
    var actives = parts.filter(function (p) { return p.active; }).map(function (p) { return participantLabel(p); });
    var dropped = parts.filter(function (p) { return !p.active; }).map(function (p) { return participantLabel(p) + ' ' + MSG.common.passedSuffix; });
    return actives.concat(dropped).join(', ');
  }

  /** @param {GameState} g */
  function doRollsForStage(g) {
    var players = Object.values(g.participants).filter(function (p) { return p.active; });
    if (!players.length) return;
    if (g.stage === STAGES.D8) {
      players.forEach(function (p) {
        p.rolls.d8 = rollN(8, 3);
        whisperSeat(p, fmt(MSG.whispers.d8, { char: p.charName, rolls: p.rolls.d8.join(', ') }));
      });
      spiceDesc(MSG.spice.d8);
      g.stage = STAGES.PASS_D8;
    } else if (g.stage === STAGES.D6) {
      players.forEach(function (p) {
        p.rolls.d6 = rollN(6, 1)[0];
        whisperSeat(p, fmt(MSG.whispers.d6, { char: p.charName, rolls: p.rolls.d6, hand: summarizeRolls(p) }));
      });
      spiceDesc(MSG.spice.d6);
      g.stage = STAGES.PASS_D6;
    } else if (g.stage === STAGES.D4) {
      players.forEach(function (p) {
        p.rolls.d4 = rollN(4, 1)[0];
        whisperSeat(p, fmt(MSG.whispers.d4, { char: p.charName, rolls: p.rolls.d4, hand: summarizeRolls(p) }));
      });
      spiceDesc(MSG.spice.d4);
      finalizeAndAnnounce(g);
      return;
    }
  }

  /** @param {GameState} g */
  function activeCount(g) {
    return Object.values(g.participants).filter(function (p) { return p.active; }).length;
  }

  /** @param {GameState} g */
  function finalizeAndAnnounce(g) {
    g.stage = STAGES.FINISHED;
    var finalists = Object.values(g.participants).filter(function (p) { return p.active; });
    if (finalists.length === 0) {
      say(MSG.reveal.nobody);
      return;
    }
    var scored = finalists.map(function (p) { return { p: p, score: computeScore(p.rolls) }; });

    if (finalists.length === 1) {
      var solo = finalists[0];
      var soloScore = computeScore(solo.rolls);
      say(fmt(MSG.reveal.solo, { char: solo.charName }));
      say(fmt(MSG.reveal.hand, { char: solo.charName, hand: summarizeRolls(solo), combo: comboSummary(solo.rolls), score: soloScore }));
      return;
    }

    var details = scored
      .map(function (s) {
        return fmt(MSG.reveal.hand, { char: s.p.charName, hand: summarizeRolls(s.p), combo: comboSummary(s.p.rolls), score: s.score });
      })
      .join('\n');
    say(fmt(MSG.reveal.intro, { details: details }));

    var max = Math.max.apply(null, scored.map(function (s) { return s.score; }));
    var winners = scored.filter(function (s) { return s.score === max; });

    if (winners.length === 1) {
      say(fmt(MSG.reveal.winner, { char: winners[0].p.charName, score: winners[0].score }));
    } else {
      say(fmt(MSG.reveal.draw, { chars: winners.map(function (w) { return w.p.charName; }).join(', '), score: max }));
    }
  }

  /** @param {GameState} g */
  function finishIfAuto(g) {
    var count = activeCount(g);
    if (count <= 1) {
      finalizeAndAnnounce(g);
      return true;
    }
    return false;
  }

  /**
   * @param {GameState} g
   * @param {boolean} [force]
   */
  function proceed(g, force) {
    if (force === void 0) force = false;
    switch (g.stage) {
      case STAGES.SIGNUP:
        if (!Object.values(g.participants).length) {
          say(MSG.proceed.empty);
          return;
        }
        g.stage = STAGES.D8;
        doRollsForStage(g);
        break;
      case STAGES.PASS_D8:
        if (force) {
          g.stage = STAGES.D6;
          doRollsForStage(g);
        } else if (!finishIfAuto(g)) {
          say(MSG.proceed.waiting);
        }
        break;
      case STAGES.PASS_D6:
        if (force) {
          g.stage = STAGES.D4;
          doRollsForStage(g);
        } else if (!finishIfAuto(g)) {
          say(MSG.proceed.lastChance);
        }
        break;
      case STAGES.PASS_D4:
        finalizeAndAnnounce(g);
        break;
      case STAGES.D8:
      case STAGES.D6:
      case STAGES.D4:
        doRollsForStage(g);
        break;
      case STAGES.FINISHED:
        say(MSG.proceed.finished);
        break;
    }
  }

  /** @param {Rolls} rolls */
  function computeScore(rolls) {
    /** @type {number[]} */
    var values = [];
    if (rolls.d8) values = values.concat(rolls.d8);
    if (typeof rolls.d6 === 'number') values.push(rolls.d6);
    if (typeof rolls.d4 === 'number') values.push(rolls.d4);
    /** @type {Record<number, number>} */
    var counts = {};
    values.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var total = 0;
    Object.keys(counts).map(function (k) { return parseInt(k, 10); }).forEach(function (v) {
      var c = counts[v];
      if (c === 1) total += v;
      else if (c === 2) total += 2 * v * c; // 4*v
      else if (c >= 3) total += 3 * v * 3 + (c - 3) * v; // triple + singles
    });
    return total;
  }

  /** @param {Rolls} rolls */
  function comboSummary(rolls) {
    /** @type {number[]} */
    var values = [];
    if (rolls.d8) values = values.concat(rolls.d8);
    if (typeof rolls.d6 === 'number') values.push(rolls.d6);
    if (typeof rolls.d4 === 'number') values.push(rolls.d4);
    /** @type {Record<number, number>} */
    var counts = {};
    values.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    /** @type {number[]} */
    var doubles = [];
    /** @type {number[]} */
    var triples = [];
    Object.keys(counts).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; }).forEach(function (v) {
      if (counts[v] === 2) doubles.push(v);
      else if (counts[v] >= 3) triples.push(v);
    });
    var parts = [];
    if (doubles.length) parts.push(fmt(MSG.combos.doubles, { vals: doubles.join(', ') }));
    if (triples.length) parts.push(fmt(MSG.combos.triples, { vals: triples.join(', ') }));
    return parts.length ? parts.join('; ') : MSG.combos.none;
  }

  /** @param {Participant} p */
  function summarizeRolls(p) {
    var parts = [];
    if (p.rolls.d8 && p.rolls.d8.length) parts.push(p.rolls.d8.join(', '));
    if (typeof p.rolls.d6 === 'number') parts.push(p.rolls.d6);
    if (typeof p.rolls.d4 === 'number') parts.push(p.rolls.d4);
    return parts.join(', ');
  }

  /**
   * @param {Participant} p
   * @param {GameState} g
   */
  function passForParticipant(p, g) {
    if (!p.active) return false;
    if ([STAGES.PASS_D8, STAGES.PASS_D6, STAGES.PASS_D4].indexOf(g.stage) === -1) return 'notOnStage';
    p.active = false;
    p.passedAt = g.stage;
    spiceDesc(fmt(MSG.pass.ok, { char: p.charName }));
    return true;
  }

  /** @param {GameState} g */
  function status(g) {
    var stage = stageLabel(g.stage);
    var list = listParticipants(g);
    say(fmt(MSG.status, { stage: stage, list: list }));
  }

  function help() {
    say(MSG.help.join('\n'));
  }

  on('ready', function () {
    log(MODULE + ': ready');
  });

  on('chat:message', function (msg) {
    if (msg.type !== 'api') return;
    if (msg.playerid === 'API') return;
    var parts = msg.content.trim().split(/\s+/);
    var command = parts.shift();
    if (command !== CMD) return;

    var sub = (parts.shift() || '').toLowerCase();
    var s = getState();
    var g = s.game;
    var who = msg.who;
    var pid = msg.playerid;

    function ensureGameOrWarn() {
      if (!s.game) {
        say(MSG.ensure.noGame);
        return false;
      }
      return true;
    }

    /** @param {string} charId */
    function findSeatByCharId(charId) {
      return g && g.participants && g.participants[charId];
    }

    switch (sub) {
      case 'start': {
        if (!isGM(pid)) return whisper(who, MSG.start.gmOnly);
        s.game = { stage: STAGES.SIGNUP, createdBy: pid, participants: {} };
        say(MSG.start.announce);
        dealerRulesIntro();
        break;
      }
      case 'join': {
        if (!ensureGameOrWarn()) break;
        if (g.stage !== STAGES.SIGNUP) return whisper(who, MSG.join.notSignup);
        var query = parts.join(' ').trim();
        var char = null;
        if (query) {
          char = getCharByQuery(query);
          if (!char) return whisper(who, fmt(MSG.join.notFound, { query: query }));
        } else {
          char = getCharFromSelection(msg);
          if (!char) return whisper(who, MSG.join.needChar);
        }
        var controllers = getCharacterControllers(char);
        if (!(isGM(pid) || controllers.indexOf(pid) !== -1 || controllers.indexOf('all') !== -1)) {
          return whisper(who, MSG.join.notControlled);
        }
        var charId = char.id;
        var charName = char.get('name');
        if (g.participants[charId]) {
          return whisper(who, MSG.join.already);
        }
        var ownerName = getPlayerName(pid, who);
        g.participants[charId] = {
          id: charId,
          charName: charName,
          seatOwnerId: pid,
          seatOwnerName: ownerName,
          active: true,
          rolls: { d8: [] }
        };
        say(fmt(MSG.join.ok, { char: charName, owner: ownerName }));
        break;
      }
      case 'leave': {
        if (!ensureGameOrWarn()) break;
        var queryL = parts.join(' ').trim();
        var owned = Object.values(g.participants).filter(function (p) { return p.seatOwnerId === pid; });
        var target = null;
        if (queryL) {
          var cand = getCharByQuery(queryL);
          if (cand) target = g.participants[cand.id] || null;
          if (target && target.seatOwnerId !== pid && !isGM(pid)) target = null;
        } else {
          var selChar = getCharFromSelection(msg);
          if (selChar) {
            target = g.participants[selChar.id] || null;
            if (target && target.seatOwnerId !== pid && !isGM(pid)) target = null;
          }
          if (!target && owned.length === 1) {
            target = owned[0];
          }
        }
        if (!target) return whisper(who, owned.length > 1 ? MSG.leave.needChar : MSG.leave.notFound);
        if (g.stage === STAGES.SIGNUP || !target.active) {
          delete g.participants[target.id];
          say(fmt(MSG.leave.ok, { char: target.charName }));
        } else {
          whisper(who, MSG.leave.notNow);
        }
        break;
      }
      case 'pass': {
        if (!ensureGameOrWarn()) break;
        var queryP = parts.join(' ').trim();
        var mine = Object.values(g.participants).filter(function (p) { return p.seatOwnerId === pid && p.active; });
        if (!mine.length) return whisper(who, MSG.pass.notYours);
        var seat = null;
        if (mine.length === 1 && !queryP) {
          seat = mine[0];
        } else if (queryP) {
          var candP = getCharByQuery(queryP);
          if (candP) seat = g.participants[candP.id] || null;
          if (seat && seat.seatOwnerId !== pid && !isGM(pid)) seat = null;
        } else {
          var selP = getCharFromSelection(msg);
          if (selP) {
            seat = g.participants[selP.id] || null;
            if (seat && seat.seatOwnerId !== pid && !isGM(pid)) seat = null;
          }
          if (!seat) return whisper(who, MSG.pass.needChar);
        }
        if (!seat) return whisper(who, MSG.pass.needChar);
        var res = passForParticipant(seat, g);
        if (res === 'notOnStage') return whisper(who, MSG.pass.notOnStage);
        if (!finishIfAuto(g)) {
          // remain until GM advances
        }
        break;
      }
      case 'next': {
        if (!ensureGameOrWarn()) break;
        if (!isGM(pid)) return whisper(who, MSG.next.gmOnly);
        proceed(g, true);
        break;
      }
      case 'status': {
        if (!ensureGameOrWarn()) break;
        status(g);
        break;
      }
      case 'reset': {
        if (!isGM(pid)) return whisper(who, MSG.reset.gmOnly);
        s.game = null;
        say(MSG.reset.announce);
        break;
      }
      case 'help':
      case '':
      default: {
        help();
        break;
      }
    }
  });
  function dealerRulesIntro() {
    say(MSG.rules.intro1);
    say(MSG.rules.intro2);
  }

  if (typeof __TEST_MODE__ !== 'undefined' && __TEST_MODE__) {
    globalThis.__TEST_EXPORTS__ = { computeScore: computeScore, comboSummary: comboSummary };
  }
})();

