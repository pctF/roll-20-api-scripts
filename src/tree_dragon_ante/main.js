/// <reference path="../roll20.d.ts" />

// Three Dragon Ante - Roll20 API Script
// See README.md for game rules and scoring examples.
(function () {
  const MODULE = 'Three Dragon Ante';
  const CMD = '!tda';
  const MODULE_SPEAKER = 'Дилер Трех Драконов';
  const MODULE_SPEAKER_DESCRIPTION = '';

  var STAGES = {
    SIGNUP: 'Ищем игроков',
    D8: 'Раздаем первые карты(3d8)',
    PASS_D8: 'Игрокам раздали первые карты',
    D6: 'Раздаем вторую руку(1d6)',
    PASS_D6: 'У игроков две руки',
    D4: 'Раздаем финальную руку(1d4)',
    PASS_D4: 'Раскрываем руки и считаем результаты',
    FINISHED: 'Игра завершена'
  };

  // Ensure persistent state bucket
  function getState() {
    state.TDA = state.TDA || {};
    state.TDA.game = state.TDA.game || null;
    return state.TDA;
  }

  function say(msg) {
    // Если сообщение — чат-команда (/desc, /em, /w и т.д.), не добавляем префикс.
    if (msg && msg.charAt(0) === '/') {
      sendChat(MODULE_SPEAKER_DESCRIPTION, msg);
    } else {
      // Всегда говорим от имени API, чтобы избежать ошибок разрешения имени и циклов.
      sendChat(MODULE_SPEAKER, msg);
    }
  }
  function whisper(playerName, msg) {
    // Шепчем от API; целевой игрок определяется по отображаемому имени.
    sendChat(MODULE_SPEAKER, '/w "' + playerName + '" ' + msg);
  }

  // Возвращает случайную «напряжённую» концовку для описательных сообщений.
  function tensionEnding() {
    var endings = [
      'Напряжение растет.',
      'Фишки звенят на столе.',
      'Взгляды игроков встречаются.',
      'Ставки высоки.',
      'За столом повисла тишина.',
      '',
      'Дилер оглядывает стол.',
      'Наблюдатели начинают тихо перешептываться.',
      'Кажется, не всех устраивают их карты.',
      'Дилер аккуратно поправляет фишки.',
      ''
    ];
    // randomInteger возвращает 1..N
    return endings[randomInteger(endings.length) - 1];
  }

  // Отправляет /desc с базовым текстом и случайной концовкой.
  function spiceDesc(base) {
    say('/desc ' + base + ' ' + tensionEnding());
  }

  function isGM(playerid) {
    return playerIsGM(playerid);
  }

  function getPlayerName(playerid, fallback) {
    var p = getObj('player', playerid);
    return (p && p.get('displayname')) || fallback || 'Player';
  }

  function rollN(sides, n) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(randomInteger(sides));
    return arr;
  }

  function listParticipants(g) {
    var parts = Object.values(g.participants);
    if (!parts.length) return 'none';
    var actives = parts.filter(function (p) { return p.active; }).map(function (p) { return p.name; });
    var dropped = parts.filter(function (p) { return !p.active; }).map(function (p) { return p.name + '(passed)'; });
    return actives.concat(dropped).join(', ');
  }

  function doRollsForStage(g) {
    var players = Object.values(g.participants).filter(function (p) { return p.active; });
    if (!players.length) return;
    if (g.stage === STAGES.D8) {
      players.forEach(function (p) {
        p.rolls.d8 = rollN(8, 3);
        whisper(p.name, 'Раздаю тебе первые карты(3d8): [' + p.rolls.d8.join(', ') + ']');
      });
      spiceDesc('Дилер раздал игрокам первые карты. Игроки с подозрением смотрят друг на друга.');
      g.stage = STAGES.PASS_D8;
    } else if (g.stage === STAGES.D6) {
      players.forEach(function (p) {
        p.rolls.d6 = rollN(6, 1)[0];
        whisper(p.name, 'Вытягиваю следующую карту(1d6): [' + p.rolls.d6 + ']');
        whisper(p.name, 'Твоя рука: ' + summarizeRolls(p));
      });
      spiceDesc('Каждый игрок получил дополнительную карту.');
      g.stage = STAGES.PASS_D6;
    } else if (g.stage === STAGES.D4) {
      players.forEach(function (p) {
        p.rolls.d4 = rollN(4, 1)[0];
        whisper(p.name, 'Твоя последняя карта(1d4): [' + p.rolls.d4 + ']');
        whisper(p.name, 'Твоя рука: ' + summarizeRolls(p));
      });
      spiceDesc('Последние карты отданы игрокам.');
      // Auto-finish the game after D4 rolls
      finalizeAndAnnounce(g);
      return;
    }
  }

  function activeCount(g) {
    return Object.values(g.participants).filter(function (p) { return p.active; }).length;
  }

  function finalizeAndAnnounce(g) {
    g.stage = STAGES.FINISHED;
    var finalists = Object.values(g.participants).filter(function (p) { return p.active; });
    if (finalists.length === 0) {
      say('Куда делись все игроки?');
      return;
    }
    var scored = finalists.map(function (p) { return { p: p, score: computeScore(p.rolls) }; });
    // Публично суммируем всех финалистов
    var details = scored
      .map(function (s) {
        return s.p.name + ': ' + summarizeRolls(s.p) + ' \n ' + comboSummary(s.p.rolls) + ' \n  Итог: ' + s.score + '\n\n';
      })
      .join(' || ');
    say('Игроки вскрывают карты, посмотрим:\n ' + details);

    if (finalists.length === 1) {
      var solo = finalists[0];
      var soloScore = computeScore(solo.rolls);
      say('Побеждает единственный игрок: ' + solo.name + '!');
      say('Рука игрока -> ' + solo.name + ': ' + summarizeRolls(solo) + ' | ' + comboSummary(solo.rolls) + ' | Итог: ' + soloScore);
      return;
    }
    var max = Math.max.apply(null, scored.map(function (s) { return s.score; }));
    var winners = scored.filter(function (s) { return s.score === max; });

    if (winners.length === 1) {
      say('Победитель ' + winners[0].p.name + ', набрав ' + winners[0].score + '!');
    } else {
      say('Ничья! Победители ' + winners.map(function (w) { return w.p.name; }).join(', ') + ' набрали ' + max + '.');
    }
  }

  function finishIfAuto(g) {
    var count = activeCount(g);
    if (count <= 1) {
      finalizeAndAnnounce(g);
      return true;
    }
    return false;
  }

  function proceed(g, force) {
    if (force === void 0) force = false;
    switch (g.stage) {
      case STAGES.SIGNUP:
        if (!Object.values(g.participants).length) {
          say('Стол свободен. Ждем игроков.');
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
          say('Карты на руках. Поднимаем ставки или кто-то готов сбросить?');
        }
        break;
      case STAGES.PASS_D6:
        if (force) {
          g.stage = STAGES.D4;
          doRollsForStage(g);
        } else if (!finishIfAuto(g)) {
          say('Последний шанс остаться с фишками. Поднимаем ставки или кто-то готов сбросить?');
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
        say('Игра уже закончилась. Раздать новую?');
        break;
    }
  }

  function computeScore(rolls) {
    var values = [];
    if (rolls.d8) values = values.concat(rolls.d8);
    if (typeof rolls.d6 === 'number') values.push(rolls.d6);
    if (typeof rolls.d4 === 'number') values.push(rolls.d4);
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

  function comboSummary(rolls) {
    var values = [];
    if (rolls.d8) values = values.concat(rolls.d8);
    if (typeof rolls.d6 === 'number') values.push(rolls.d6);
    if (typeof rolls.d4 === 'number') values.push(rolls.d4);
    var counts = {};
    values.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var doubles = [];
    var triples = [];
    Object.keys(counts).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; }).forEach(function (v) {
      if (counts[v] === 2) doubles.push(v);
      else if (counts[v] >= 3) triples.push(v);
    });
    var parts = [];
    if (doubles.length) parts.push('двойные драконы: ' + doubles.join(', '));
    if (triples.length) parts.push('тройные драконы: ' + triples.join(', '));
    return parts.length ? parts.join('; ') : 'без двойных и тройных драконов';
  }

  function summarizeRolls(p) {
    var parts = [];
    if (p.rolls.d8 && p.rolls.d8.length) parts.push(p.rolls.d8.join(', '));
    if (typeof p.rolls.d6 === 'number') parts.push(p.rolls.d6);
    if (typeof p.rolls.d4 === 'number') parts.push(p.rolls.d4);
    return parts.join(', ');
  }

  function handlePass(g, playerid, who) {
    var p = g.participants[playerid];
    if (!p) return whisper(who, 'Прошу прощения, мы в процессе игры. Вы можете посмотреть за игрой и присоединиться на следующей раздаче.');
    if (!p.active) return whisper(who, 'Я услышал вас и в первый раз.');
    if ([STAGES.PASS_D8, STAGES.PASS_D6, STAGES.PASS_D4].indexOf(g.stage) === -1)
      return whisper(who, 'Прошу прощения, но сейчас не время уходить из за стола.');
    p.active = false;
    p.passedAt = g.stage;
    say(p.name + ' сбрасывает карты.');
    if (!finishIfAuto(g)) {
      // remain on stage until GM advances
    }
  }

  function status(g) {
    var stage = g.stage;
    var list = listParticipants(g);
    say('Текущее состояние: ' + stage + '. Участники: ' + list);
  }

  function help() {
    say([
      'Команды "Ставки Трех Драконов":',
      '- start  — (GM) начинает новую игру. Usage: !tda start',
      '- join   — Присоединиться к игре на подготовительном этапе. Usage: !tda join',
      '- leave  — Покинуть игру на подготовительном этапе. Usage: !tda leave',
      '- pass   — Спасовать. Usage: !tda pass',
      '- next   — (GM) Спасовать. Usage: !tda next',
      '- status — Показать текущий статус игры. Usage: !tda status',
      '- reset  — (GM) отменить текущую игру. Usage: !tda reset',
      '- help   — Серьезно? Usage: !tda help',
      'Кстати: Все броски шепчутся во время игры. После раздачи последних карт - дилер посчитает карты и объявит победителя.'
    ].join('\n'));
  }

  on('ready', function () {
    log(MODULE + ': ready');
  });

  on('chat:message', function (msg) {
    if (msg.type !== 'api') return;
    // Prevent API echo/infinite loops
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
        say('За столом нет игроков. Желаете начать?("!tda start")');
        return false;
      }
      return true;
    }

    switch (sub) {
      case 'start': {
        if (!isGM(pid)) return whisper(who, 'Прошу прощения, мне нужно согласование распорядителя.');
        s.game = { stage: STAGES.SIGNUP, createdBy: pid, participants: {} };
        say('Начинаем игру в Ставку Трех Драконов. Просто занимайте свободные места!');
        dealerRulesIntro();
        break;
      }
      case 'join': {
        if (!ensureGameOrWarn()) break;
        if (g.stage !== STAGES.SIGNUP) return whisper(who, 'Простите, для этого не время.');
        var name = getPlayerName(pid, who);
        if (!g.participants[pid]) {
          g.participants[pid] = { id: pid, name: name, active: true, rolls: { d8: [] } };
          say(name + ' присоединился к игре.');
        } else {
          whisper(who, 'Да, конечно. Давайте подождем остальных.');
        }
        break;
      }
      case 'leave': {
        if (!ensureGameOrWarn()) break;
        var p = g.participants[pid];
        if (!p) return whisper(who, 'Хм.. как пожелаете?');
        if (g.stage === STAGES.SIGNUP || !p.active) {
          delete g.participants[pid];
          say(p.name + ' покидает игру.');
        } else {
          whisper(who, 'Боюсь что ставки уже приняты.');
        }
        break;
      }
      case 'pass': {
        if (!ensureGameOrWarn()) break;
        handlePass(g, pid, who);
        break;
      }
      case 'next': {
        if (!ensureGameOrWarn()) break;
        if (!isGM(pid)) return whisper(who, 'Я сам разберусь.');
        proceed(g, true);
        break;
      }
      case 'status': {
        if (!ensureGameOrWarn()) break;
        status(g);
        break;
      }
      case 'reset': {
        if (!isGM(pid)) return whisper(who, 'Для этого мне нужно согласование распорядителя.');
        s.game = null;
        say('Игра завершена по приказу распорядителя.');
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
    // Краткое описание правил от дилера
    say('Для тех, кто подзабыл правила: игрокам раздаются три карты(3d8), затем при желании игроки могут спасовать. После этого раздется еще одна карта(1d6), снова возможность паса, затем последняя карта(1d4) и вскрытие.');
    say('Подсчет очков: пара драконов удваивается (4+4 x2 -> 16), три дракона умножаются втрое (4+4+4 x3 -> 32). Значения сверх тройки считаются как одиночные (3+3+3 x3 +3 -> 30).');
  }
})();

