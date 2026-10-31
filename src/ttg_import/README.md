# TTG Import

Imports monsters/NPCs from [5e14.ttg.club](https://5e14.ttg.club/bestiary) into
the **D&D 5E by Roll20** character sheet (NPC mode), and magic items into
handouts, in Russian, as they appear on the site.

## Highlights

- One click on ttg.club, one paste into Roll20 chat.
- Fills stat block: type, AC, HP + formula, speed, abilities, saves, skills,
  resistances/immunities, senses, languages, CR, XP.
- Traits, actions, bonus actions, reactions, legendary actions go into the
  sheet's repeating sections. Attacks (`Рукопашная/Дальнобойная атака ...`)
  become rollable: to-hit, reach/range, target, up to two damage parts.
- Monster description goes into the character bio.
- Magic items become GM-only handouts: type, rarity, attunement, description.

## How to Use

The Roll20 API sandbox can't make HTTP requests, and ttg.club doesn't allow
cross-site requests from Roll20, so the fetch happens on ttg.club through a
bookmarklet:

1. Install `main.js` as an API script in your game (game must use the
   "D&D 5E by Roll20" sheet).
2. Create a browser bookmark and set its URL to:

   ```
   javascript:(async()=>{const m=location.pathname.match(/^\/(bestiary|items\/magic)\/([^/?#]+)/);if(!m)return alert('Открой страницу монстра или магического предмета на 5e14.ttg.club');const d=await(await fetch('/api/v1/'+m[1]+'/'+m[2],{method:'POST'})).json();delete d.tags;delete d.lair;delete d.images;const c='!ttg '+JSON.stringify(d).replace(/[%<>&"\[\]{}@#|\\]/g,encodeURIComponent);await navigator.clipboard.writeText(c);alert('Скопировано: '+d.name.rus+'. Вставь в чат Roll20.')})()
   ```

3. Open a monster page, e.g. `https://5e14.ttg.club/bestiary/adult_red_dragon`,
   or a magic item page, e.g. `https://5e14.ttg.club/items/magic/ring_of_protection`,
   and click the bookmark.
4. Paste into Roll20 chat (as GM) and send. The script whispers a link to the
   new character or handout.
5. Optional: select a token on the map before sending. It gets linked to the
   character (name, size, bar 1 = HP unlinked, bar 2 = AC) and saved as the
   character's default token. The API can't make a token image itself, so
   drop any image from your library first.
6. Any token later linked to an NPC (dragged from the journal, or "Represents"
   set by hand) with an empty bar 1 gets the same name/size/HP/AC filled in.

## Commands

| Command | Who | Effect |
| --- | --- | --- |
| `!ttg <payload>` | GM | Creates an NPC character or a magic item handout from the bookmarklet payload. |

## Implementation Notes

- Data source: `POST /api/v1/bestiary/<slug>` and `/api/v1/items/magic/<slug>` (the same JSON the site page
  uses). `/api/v1/fvtt/bestiary` was rejected: it fails for many monsters and
  has wrong numbers (e.g. Adult Red Dragon's Frightful Presence DC).
- Payload is the JSON with only chat-hostile characters (`[ ] { } @ # % | " < > & \`)
  percent-encoded, so Roll20 doesn't treat them as inline rolls/attribute
  refs/macros; Cyrillic stays raw to keep the message short (~6 KB for an
  adult dragon, ~15 KB for a lich with its long description).
- Attributes are written with `setWithWorker` so the sheet computes
  modifiers and the roll buttons of attack rows.
- Not imported: token/avatar image (the API can only use images from your
  Roll20 library), lair actions, spell list as spells (spellcasting stays a
  trait text), magic items a monster carries, item images, mundane items.
