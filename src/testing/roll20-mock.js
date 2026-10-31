// Test-only harness that mocks the Roll20 API global surface so scripts under
// src/<script>/main.js can be loaded and driven from node:test without a live
// Roll20 game. Each createSandbox() call is a fresh vm context: isolation
// between tests is structural (a new global scope), not a manual reset step.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * @typedef {Object} SandboxOptions
 * @property {string[]} [gmPlayerIds] playerids for which playerIsGM() returns true
 * @property {(max: number) => number} [rng] overrides randomInteger's randomness; see sequenceRng
 */

/**
 * @typedef {Object} ChatEntry
 * @property {string} speakingAs
 * @property {string} message
 */

/** @param {(max: number) => number} [rng] */
function defaultRng(rng) {
  return rng ?? ((max) => Math.floor(Math.random() * max) + 1);
}

let nextId = 1;
function genId() {
  return `-MOCK${nextId++}`;
}

/**
 * @param {string} type
 * @param {Record<string, any>} attrs
 */
function makeObj(type, attrs) {
  const id = attrs.id || attrs._id || genId();
  /** @type {Record<string, any>} */
  const data = { ...attrs, id, _id: id, _type: type };
  return {
    id,
    _id: id,
    _type: type,
    get(/** @type {string} */ prop) {
      return data[prop];
    },
    set(/** @type {string | Record<string, any>} */ propsOrKey, /** @type {any} */ value) {
      if (typeof propsOrKey === 'object' && propsOrKey !== null) {
        Object.assign(data, propsOrKey);
      } else {
        data[propsOrKey] = value;
      }
    },
    // Sheet workers aren't simulated; same as set().
    setWithWorker(/** @type {Record<string, any>} */ props) {
      Object.assign(data, props);
    },
    remove() {
      data.__removed = true;
    },
  };
}

/** @param {SandboxOptions} [options] */
export function createSandbox(options = {}) {
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  /** @type {ChatEntry[]} */
  const chatLog = [];
  /** @type {Map<string, ReturnType<typeof makeObj>>} */
  const objects = new Map();
  const state = {};
  const rng = defaultRng(options.rng);

  function on(/** @type {string} */ event, /** @type {Function} */ cb) {
    (handlers[event] ??= []).push(cb);
  }

  function getObj(/** @type {string} */ type, /** @type {string} */ id) {
    return objects.get(`${type}:${id}`);
  }

  function findObjs(/** @type {Record<string, any>} */ query) {
    const results = [];
    for (const obj of objects.values()) {
      if (obj.get('__removed')) continue;
      let match = true;
      for (const key of Object.keys(query)) {
        if (key === 'type' ? obj._type !== query[key] : obj.get(key) !== query[key]) {
          match = false;
          break;
        }
      }
      if (match) results.push(obj);
    }
    return results;
  }

  function filterObjs(/** @type {(o: any) => boolean} */ predicate) {
    return [...objects.values()].filter((o) => !o.get('__removed')).filter(predicate);
  }

  function getAllObjs() {
    return [...objects.values()].filter((o) => !o.get('__removed'));
  }

  function playerIsGM(/** @type {string} */ playerId) {
    return (options.gmPlayerIds ?? []).includes(playerId);
  }

  function randomInteger(/** @type {number} */ max) {
    return rng(max);
  }

  function log() {}

  const sandbox = {
    on,
    sendChat: (
      /** @type {string} */ speakingAs,
      /** @type {string} */ message,
      /** @type {Function} */ callback,
      /** @type {any} */ _options
    ) => {
      chatLog.push({ speakingAs, message });
      callback?.([{ who: speakingAs, content: message }]);
    },
    log,
    getObj,
    findObjs,
    filterObjs,
    getAllObjs,
    createObj: (/** @type {string} */ type, /** @type {Record<string, any>} */ attrs) => addObj(type, attrs),
    // Real Roll20 stores a token blob on the character; the mock records the token's id there.
    setDefaultTokenForCharacter: (/** @type {any} */ character, /** @type {any} */ graphic) =>
      character.set('_defaulttoken', graphic.id),
    playerIsGM,
    randomInteger,
    state,
    console,
    __TEST_MODE__: true,
    /** @type {Record<string, any> | undefined} */
    __TEST_EXPORTS__: undefined,
  };
  vm.createContext(sandbox);

  function addObj(/** @type {string} */ type, /** @type {Record<string, any>} */ attrs) {
    const obj = makeObj(type, attrs);
    objects.set(`${type}:${obj.id}`, obj);
    return obj;
  }

  return {
    /** Runs scriptPath's top-level code inside this sandbox so it self-registers via on(). */
    loadScript(/** @type {string} */ scriptPath) {
      const code = readFileSync(scriptPath, 'utf8');
      vm.runInContext(code, sandbox, { filename: scriptPath });
    },
    /** Fires all handlers registered for `event` with the given args. */
    fireEvent(/** @type {string} */ event, /** @type {any[]} */ ...args) {
      (handlers[event] ?? []).forEach((cb) => cb(...args));
    },
    /** Convenience: fires a 'chat:message' event with sensible ChatMessage defaults. */
    fireChatMessage(/** @type {Partial<ChatMessage>} */ msg) {
      (handlers['chat:message'] ?? []).forEach((cb) =>
        cb({
          type: 'api',
          content: '',
          who: 'Player',
          playerid: 'p1',
          selected: [],
          ...msg,
        })
      );
    },
    /** Same as the script-side findObjs(), for asserting on created objects. */
    findObjs,
    addCharacter: (/** @type {Record<string, any>} */ attrs) => addObj('character', attrs),
    addPlayer: (/** @type {Record<string, any>} */ attrs) => addObj('player', attrs),
    addGraphic: (/** @type {Record<string, any>} */ attrs) => addObj('graphic', attrs),
    /** @returns {ChatEntry[]} */
    getChatLog() {
      return chatLog;
    },
    /** Whispers only, unpacked from `/w "Name" text` messages. */
    getWhispers() {
      return chatLog
        .map((c) => {
          const m = c.message.match(/^\/w\s+"([^"]+)"\s+([\s\S]*)$/);
          return m ? { to: m[1], message: m[2] } : null;
        })
        .filter((w) => w !== null);
    },
    /** @returns {Record<string, any>} live reference to the sandbox's `state` */
    get state() {
      return state;
    },
    /** Contents of the script's __TEST_EXPORTS__ hook, if it set one. */
    exports() {
      return /** @type {Record<string, any> | undefined} */ (sandbox.__TEST_EXPORTS__);
    },
  };
}

/** Deterministic dice sequence for reproducible flow tests; cycles once exhausted. */
export function sequenceRng(/** @type {number[]} */ values) {
  let i = 0;
  return () => values[i++ % values.length];
}
