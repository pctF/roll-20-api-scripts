# Three Dragon Ante — Roll20 API Script

A lightweight, table-friendly implementation of a poker-like Three Dragon Ante mini‑game for Roll20.

Highlights:

- Private rolls: all rolls are whispered to each player during play.
- Auto‑finish: after the final d4 is dealt, the game reveals and scores automatically.
- Public summary: when the game ends, the dealer posts each finalist’s hand, doubles/triples, and totals.
- One active game at a time, driven by GM and player chat commands.

## How to Play (Flow)

1. GM starts a new game: `!tda start`.
    - The dealer posts a short rules description in chat.
2. Players join during signup: `!tda join`.
3. When ready, GM advances stages with `!tda next` (or let players pass first):
    - Deal 3d8 to each active player (whispered privately).
    - Pass phase (`!tda pass` allowed).
    - Deal 1d6 to each remaining active player (whispered privately).
    - Pass phase.
    - Deal 1d4 to each remaining active player (whispered privately).
4. After d4 is dealt, the dealer automatically reveals results and announces the winner(s).

Notes:

- Players may `!tda pass` only during pass stages.
- If all but one player pass early, the game auto‑finishes and declares the remaining player the winner.
- `!tda status` shows the current stage and participant list (no roll details during play).

## Scoring

Sum the values of all dice (3×d8 + d6 + d4).

- Doubles (exactly two of the same face value across all dice) count as doubled for both dice: effectively 4 × value.
- Triples (three or more of the same face value) count the first three as tripled: 3 × value × 3 = 9 × value. Any extra
  dice beyond the first three count as singles for that value.
- Singles count as their face value.

This aligns with the examples below and ensures that a 4‑ or 5‑of‑a‑kind is a triple plus singles.

### Scoring Examples

| d8 | d8 | d8 | d6 | d4 | total | explanation                                                 |
|----|----|----|----|----|-------|-------------------------------------------------------------|
| 5  | 4  | 3  | 2  | 1  | 15    | straight sum                                                |
| 3  | 7  | 5  | 4  | 3  | 28    | one double: 3(d8)×2 + 3(d4)×2                               |
| 1  | 3  | 2  | 2  | 1  | 15    | two doubles: 1(d8)×2 + 1(d4)×2 + 2(d8)×2 + 2(d6)×2          |
| 1  | 5  | 4  | 4  | 4  | 42    | triple: 4(d8)×3 + 4(d6)×3 + 4(d4)×3                         |
| 1  | 4  | 4  | 4  | 4  | 41    | treat as one triple + singles: 4×3 + 4×3 + 4×3 + 4 + 1 = 41 |
| 4  | 4  | 4  | 4  | 4  | 41    | triple + double: 4×3 + 4×3 + 4×3 + 4×2 + 4×2 = 41           |

## Commands

- `!tda start` — GM: start a new game (signup phase).
- `!tda join` — Join as a participant during signup.
- `!tda leave` — Leave during signup, or after you have passed.
- `!tda pass` — Pass during a pass stage to drop out.
- `!tda next` — GM: advance to the next stage and deal.
- `!tda status` — Show current stage and participants. Rolls remain private during play.
- `!tda reset` — GM: cancel the current game.
- `!tda help` — Show in‑chat help.

## Implementation Notes

- The script uses a single persistent game object in Roll20 `state`.
- Rolls are generated with `randomInteger` and whispered via `sendChat`.
- The dealer provides a short rules description automatically at game start.