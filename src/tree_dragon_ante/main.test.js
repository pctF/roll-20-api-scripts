import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createSandbox } from '../testing/roll20-mock.js';

/**
 * Dice-only rng: pops the next queued value for real die rolls (max 4/6/8),
 * and returns a fixed inert value for anything else (the script's flavor-text
 * randomInteger calls in tensionEnding(), e.g. picking from a ~49-entry list
 * and a "> 90" chance check) so those don't consume from the dice queue or
 * introduce nondeterminism into the assertions.
 * @param {number[]} diceValues
 */
function diceRng(diceValues) {
  let i = 0;
  return (/** @type {number} */ max) => {
    if (max === 4 || max === 6 || max === 8) return diceValues[i++];
    return 1;
  };
}

const mainPath = fileURLToPath(new URL('./main.js', import.meta.url));

// Scoring table from README.md ("Scoring Examples"), verified against
// computeScore's actual formula (triple = first three tripled, extras singles).
const scoringCases = [
  { dice: [5, 4, 3, 2, 1], total: 15 },
  { dice: [3, 7, 5, 4, 3], total: 28 },
  { dice: [1, 3, 2, 2, 1], total: 15 },
  { dice: [1, 5, 4, 4, 4], total: 42 },
  { dice: [1, 4, 4, 4, 4], total: 41 },
  { dice: [4, 4, 4, 4, 4], total: 44 },
];

for (const c of scoringCases) {
  test(`computeScore ${c.dice.join(',')} => ${c.total}`, () => {
    const sandbox = createSandbox();
    sandbox.loadScript(mainPath);
    const rolls = { d8: c.dice.slice(0, 3), d6: c.dice[3], d4: c.dice[4] };
    assert.equal(sandbox.exports()?.computeScore(rolls), c.total);
  });
}

test('full game flow: start -> join -> next x3 -> FINISHED with correct winner', () => {
  // Dice-max (4/6/8) calls in order: Alice d8(3), Bob d8(3), Alice d6, Bob d6, Alice d4, Bob d4
  const rng = diceRng([6, 5, 4, 8, 7, 6, 3, 5, 2, 4]);
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'], rng });
  sandbox.loadScript(mainPath);

  sandbox.addCharacter({ id: 'char-alice', name: 'Alice', controlledby: 'p1' });
  sandbox.addCharacter({ id: 'char-bob', name: 'Bob', controlledby: 'p2' });

  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!tda start' });
  sandbox.fireChatMessage({ playerid: 'p1', who: 'Player1', content: '!tda join Alice' });
  sandbox.fireChatMessage({ playerid: 'p2', who: 'Player2', content: '!tda join Bob' });

  assert.equal(sandbox.state.TDA.game.stage, 'SIGNUP');

  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!tda next' }); // deal d8
  assert.equal(sandbox.state.TDA.game.stage, 'PASS_D8');

  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!tda next' }); // deal d6
  assert.equal(sandbox.state.TDA.game.stage, 'PASS_D6');

  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!tda next' }); // deal d4 -> auto finish
  assert.equal(sandbox.state.TDA.game.stage, 'FINISHED');

  // Alice: 6+5+4+3+2 = 20, Bob: 8+7+6+5+4 = 30, no ties -> Bob wins
  const winnerMsg = sandbox
    .getChatLog()
    .find((c) => c.message.includes('Победитель'));
  assert.ok(winnerMsg, 'expected a winner announcement');
  assert.match(winnerMsg.message, /Bob/);
  assert.match(winnerMsg.message, /30/);

  const whispers = sandbox.getWhispers();
  assert.equal(whispers.filter((w) => /3d8=/.test(w.message)).length, 2);
  assert.equal(whispers.filter((w) => /1d6=/.test(w.message)).length, 2);
  assert.equal(whispers.filter((w) => /1d4=/.test(w.message)).length, 2);
});

test('start requires GM', () => {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);

  sandbox.fireChatMessage({ playerid: 'p1', who: 'Player1', content: '!tda start' });

  // getState() initializes state.TDA = { game: null } as a side effect of
  // handling any '!tda' command, even one rejected before 'start' runs.
  assert.equal(sandbox.state.TDA.game, null);
  const whispers = sandbox.getWhispers();
  assert.equal(whispers.length, 1);
  assert.match(whispers[0].message, /согласование распорядителя/);
});

test('join is rejected for a character the player does not control', () => {
  const sandbox = createSandbox({ gmPlayerIds: ['gm1'] });
  sandbox.loadScript(mainPath);
  sandbox.addCharacter({ id: 'char-alice', name: 'Alice', controlledby: 'p1' });

  sandbox.fireChatMessage({ playerid: 'gm1', who: 'GM', content: '!tda start' });
  sandbox.fireChatMessage({ playerid: 'p2', who: 'Player2', content: '!tda join Alice' });

  // participants is a plain object created inside the vm sandbox's realm, so
  // it has a different Object.prototype than this file's {} - compare keys
  // rather than using deepEqual across realms.
  assert.equal(Object.keys(sandbox.state.TDA.game.participants).length, 0);
  const whispers = sandbox.getWhispers();
  assert.equal(whispers.length, 1);
  assert.match(whispers[0].message, /не управляете этим персонажем/);
});
