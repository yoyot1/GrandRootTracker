import { FACTION_IDS, MAP_IDS } from '../../docs/stats.js';

const PROMPT = `This image was posted in a Discord channel where players share the end-of-game victory screen from the digital edition of the board game Root.

If it is not a Root victory screen, set is_victory_screen to false and leave players empty.

Layout of a victory screen:
- A banner at the top names the winning faction ("Hundreds Wins", "Riverfolk Company Wins!") or says "Coalition Victory".
- A row of name banners runs along the bottom, one per player. The winner's banner is larger with a gold frame and sits under a character standing on a tree stump. In a coalition victory two winners are stacked together on the left.
- Each banner has a round badge. Normally it holds the player's score. If it holds an icon instead, the player has no score: a suit icon (fox, rabbit, mouse, bird) means they played a dominance card; a faction icon on a Vagabond's banner means the Vagabond formed a coalition with that faction.
- Each player's character stands or lies above their banner, in the same left-to-right order.

Identify each player's faction. The banner colour is the main cue; the character above the banner confirms it.
- marquise: bright ORANGE banner. Small pale grey cat with very large round yellow eyes ringed in black (it can look like goggles), orange tunic, sword at the belt.
- eyrie: deep royal BLUE banner (dark, saturated). Jay-like bird with a spiky crest, grey cloak and blue scarf. Its feathers can look blue or blue-violet; the banner is still blue.
- alliance: GREEN banner. Orange fox in a pale green coat.
- vagabond: GREY banner. A lone adventurer; the animal varies (raccoon, badger, wolf, beaver, opossum and others).
- riverfolk: TEAL / turquoise banner. Brown otter with a green neckerchief.
- lizard: OLIVE / yellow-green banner. Pale green lizard.
- duchy: pale TAN / sand banner (yellowish, much lighter and less saturated than Marquise orange). Mole in a yellow miner's helmet with round glasses.
- corvid: PURPLE banner. Hunched crow with a dark beak, purple hood and a patched mauve tunic.
- hundreds: RED banner. Dark rat with large pink ears in a red tunic.
- keepers: muted STEEL-BLUE / slate banner (lighter and greyer than Eyrie blue). Badger in pale blue armour holding a tall spear.

Losing characters are drawn smaller and may be slumped, dizzy or lying face down, which hides detail. When that happens rely on the banner colour.
Pairs that get confused: Eyrie (blue banner, bird) vs Corvid (purple banner, crow); Eyrie (deep blue) vs Keepers (grey-blue, badger); Marquise (bright orange, cat) vs Duchy (pale tan, mole). Compare the banners on the same screen against each other before deciding.
Apart from the Vagabond, no faction appears twice in a game, so use elimination.
Set faction_confidence to "high" whenever the banner colour and the character agree, or the banner colour alone is unmistakable. Use "low" only if you genuinely cannot decide between two factions.

Identify the map from the scenery behind the characters:
- winter: snow on the ground and on the trees
- autumn: dark pine forest on dark, almost black ground, with flat-topped grey cliffs behind
- mountain: jagged red-and-grey mountain peaks behind the forest, reddish-brown or pinkish ground
- lake: bright green forest on green grass, with dense rows of small green trees and a low grey-green ridge on the horizon; no cliffs and no peaks
Green grass underfoot means lake. Set map_confidence to "low" only if the scenery fits none of these.

Copy player names exactly as written, character for character. The font draws the digit 1 and lowercase l identically; just give your best reading.

List players left to right.

Record the result by calling the record_game tool exactly once. Do not answer in prose.`;

const TOOL = {
  name: 'record_game',
  description: 'Record what the screenshot shows.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['is_victory_screen', 'banner_text', 'map', 'map_confidence', 'players'],
    properties: {
      is_victory_screen: { type: 'boolean' },
      banner_text: { type: 'string', description: 'Text of the top banner, or empty.' },
      map: { type: 'string', enum: [...MAP_IDS, 'unknown'] },
      map_confidence: { type: 'string', enum: ['high', 'low'] },
      players: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'faction', 'score', 'badge', 'badge_detail', 'on_winner_podium', 'faction_confidence'],
          properties: {
            name: { type: 'string' },
            faction: { type: 'string', enum: FACTION_IDS },
            score: { type: 'integer', description: 'The number in the badge. Use 0 when the badge shows an icon instead.' },
            badge: { type: 'string', enum: ['score', 'dominance', 'coalition'] },
            badge_detail: {
              type: 'string',
              description: 'Dominance suit (fox, rabbit, mouse, bird) or the coalition partner faction id. Empty string when the badge is a score.',
            },
            on_winner_podium: { type: 'boolean' },
            faction_confidence: { type: 'string', enum: ['high', 'low'] },
          },
        },
      },
    },
  },
};

async function request({ imageBase64, mediaType, apiKey, model, fetchImpl, strict }) {
  return fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096, // leaves room for the model's thinking as well as the answer
      tools: [strict ? { ...TOOL, strict: true } : TOOL],
      tool_choice: { type: 'auto' }, // current models reject a forced tool choice
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });
}

/**
 * Ask Claude to read one screenshot. Returns the record_game input object.
 * Tries a schema-enforced call first; if the API rejects that request shape,
 * retries once without enforcement.
 */
export async function extractGame({ imageBase64, mediaType, apiKey, model, fetchImpl = fetch }) {
  const args = { imageBase64, mediaType, apiKey, model, fetchImpl };
  let res = await request({ ...args, strict: true });
  if (res.status === 400) {
    const first = (await res.text()).slice(0, 300);
    res = await request({ ...args, strict: false });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)} (first attempt: ${first})`);
  } else if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json();
  const block = (body.content ?? []).find((b) => b.type === 'tool_use');
  if (block) return block.input;
  // The model answered in text instead of calling the tool: accept JSON if that is what it wrote.
  const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  throw new Error(`Claude did not return a structured result (stop_reason: ${body.stop_reason})`);
}
