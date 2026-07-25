# roll-20-api-scripts

Personal collection of [Roll20](https://roll20.net) API scripts (chat-command
bots for tabletop games run on Roll20). Each script is a single plain-JS file
pasted verbatim into Roll20's in-browser API sandbox.

## Hard constraint: deployment target

Roll20's API sandbox runs a script's file contents directly as a flat blob in
a shared global scope — no bundler, no `import`/`export`, no build step.
**Never add `import`/`export`/`require` to a script under `src/<script>/main.js`.**
Everything a script needs (`on`, `sendChat`, `getObj`, `findObjs`, `state`,
`randomInteger`, `playerIsGM`, etc.) is injected by Roll20 as a global at
runtime. The file you edit is the file you paste — there is no separate
build artifact.

## Typecheck

Scripts are authored as plain `.js` with JSDoc type annotations, checked by
the **real** TypeScript compiler (`tsc --noEmit`, config in `tsconfig.json`
with `checkJs`/`strict` both on — not cosmetic, it's enforced):

```
npm run typecheck
```

- `src/roll20.d.ts` has ambient global type defs for the Roll20 Mod API.
  `state` is typed `Record<string, any>` — each script should define its own
  local `@typedef`s for its slice of `state` (see `GameState`/`Participant`
  at the top of `src/tree_dragon_ante/main.js`) rather than leaving it `any`.
- When `getObj`/`findObjs` return a specific object type (e.g. `Character`),
  cast the result explicitly — the ambient signatures default to the generic
  `Roll20Object`.

## Tests

`npm test` runs Node's built-in test runner (`node --test`, zero extra
deps), which auto-discovers `src/**/*.test.js`.

```
npm test          # run once
npm run test:watch
npm run check     # typecheck + test, run before considering any change done
```

### The mock harness

`src/testing/roll20-mock.js` exports `createSandbox(options?)`, which mocks
the Roll20 global API surface using Node's `vm` module — each call creates a
fresh, isolated global scope (its own `state`, `on()` registry, chat log), so
test isolation is structural, not a manual reset step.

```js
import { createSandbox } from '../testing/roll20-mock.js';

const sandbox = createSandbox({ gmPlayerIds: ['gm1'], rng: (max) => 4 });
sandbox.loadScript(mainPath);              // runs the script's IIFE, capturing on() handlers
sandbox.addCharacter({ name: 'Alice', controlledby: 'p1' });
sandbox.fireChatMessage({ playerid: 'p1', who: 'Player1', content: '!cmd foo' });
sandbox.getChatLog();                      // [{ speakingAs, message }]
sandbox.getWhispers();                     // whispers only, unpacked from /w "Name" ...
sandbox.state;                             // live reference to the sandbox's `state`
sandbox.exports();                         // contents of the script's __TEST_EXPORTS__ hook
```

`randomInteger` is driven by the `rng` option (defaults to real randomness).
For flow tests with multiple dice types in one game, filter by `max` inside
your own `rng` function rather than assuming a fixed call count — scripts
often have non-dice `randomInteger` calls too (e.g. flavor-text selection in
`tree_dragon_ante`), interleaved between the dice rolls you care about. See
the `diceRng` helper in `src/tree_dragon_ante/main.test.js` for the pattern.

**`node --test` auto-discovery gotcha:** it runs any file whose basename
starts with `test-`, ends with `.test.js`/`-test.js`/`_test.js`, or sits
inside a directory literally named `test`/`tests` — so shared test-only
helpers/ambient-type files (like `src/testing/global-test-hooks.d.ts`) must
avoid those naming patterns, or `node --test` will try to execute them as a
test.

**Exposing pure logic for unit testing:** a script's IIFE closure hides its
internal functions. To unit-test one directly (e.g. `computeScore`) without
driving the full chat-command flow, add this one line right before the
closing `})();`:

```js
if (typeof __TEST_MODE__ !== 'undefined' && __TEST_MODE__) {
  globalThis.__TEST_EXPORTS__ = { computeScore, comboSummary };
}
```

This is inert in the real Roll20 sandbox (`__TEST_MODE__` is always
`undefined` there). `createSandbox()` sets `__TEST_MODE__ = true`, so
`sandbox.exports()` returns this object.

A `mock20` npm package exists but was deliberately not adopted: it mutates
the real Node `global` object as a singleton (no per-test isolation), is
CommonJS-only against this repo's ESM setup, and is years stale. Don't
re-propose it without a concrete gap in the current harness.

## Adding a new script

Copy `src/tree_dragon_ante/` as the template:

```
src/<script_name>/
  main.js         # IIFE, `var`, top-level on('ready')/on('chat:message'),
                   # `/// <reference path="../roll20.d.ts" />` at top,
                   # __TEST_EXPORTS__ hook at bottom if it has pure logic worth unit testing
  README.md        # Highlights / How to Play / Commands / Implementation Notes
  main.test.js      # node:test file, imports createSandbox from '../testing/roll20-mock.js'
```

Run `npm run check` before considering a new or changed script done.
