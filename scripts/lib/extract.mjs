import { FACTION_IDS, MAP_IDS } from '../../docs/stats.js';

const PROMPT = `This image was posted in a Discord channel where players share the end-of-game victory screen from the digital edition of the board game Root.

If it is not a Root victory screen, set is_victory_screen to false and leave players empty.

Layout of a victory screen:
- A banner at the top names the winning faction ("Hundreds Wins", "Riverfolk Company Wins!") or says "Coalition Victory".
- A row of name banners runs along the bottom, one per player. The winner's banner is larger with a gold frame and sits under a character standing on a tree stump. In a coalition victory two winners are stacked together on the left.
- Each banner has a round badge. Normally it holds the player's score. If it holds an icon instead, the player has no score: a suit icon (fox, rabbit, mouse, bird) means they played a dominance card; a faction icon on a Vagabond's banner means the Vagabond formed a coalition with that faction.
- Each player's character stands or lies above their banner, in the same left-to-right order.

Identify each player's faction from the banner colour and the character together:
- marquise: orange banner, cat
- eyrie: dark blue banner, blue or purple bird with a crest
- alliance: green banner, fox in a pale green coat
- vagabond: grey banner, a lone adventurer (animal varies: raccoon, badger, wolf, beaver, opossum and others)
- riverfolk: teal banner, brown otter
- lizard: olive / yellow-green banner, pale green lizard
- duchy: tan / sand banner, mole in a miner's helmet
- corvid: purple banner, hooded crow
- hundreds: red banner, rat in a red tunic
- keepers: steel-blue / grey-blue banner, badger in blue armour with a spear

Eyrie and Keepers banners are both blue, and Duchy and Marquise banners are both orange-ish: use the character to decide, and set faction_confidence to "low" if the two cues disagree or the character is hard to see.

Identify the map from the scenery behind the characters:
- winter: snow on the ground and on the trees
- autumn: dark pine forest on dark ground, flat-topped grey cliffs behind
- mountain: jagged mountain peaks behind the forest, reddish-brown ground
- lake: bright green forest and grass with low rolling hills, no cliffs or peaks
Set map_confidence to "low" if the scenery does not clearly match one of these.

Copy player names exactly as written, character for character. The font draws the digit 1 and lowercase l identically; just give your best reading.

List players left to right.`;

const TOOL = {
  name: 'record_game',
  description: 'Record what the screenshot shows.',
  input_schema: {
    type: 'object',
    required: ['is_victory_screen', 'banner_text', 'map', 'map_confidence', 'players'],
    properties: {
      is_victory_screen: { type: 'boolean' },
      banner_text: { type: 'string', description: 'Text of the top banner, or empty.' },
      map: { type: ['string', 'null'], enum: [...MAP_IDS, null] },
      map_confidence: { type: 'string', enum: ['high', 'low'] },
      players: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'faction', 'score', 'badge', 'on_winner_podium', 'faction_confidence'],
          properties: {
            name: { type: 'string' },
            faction: { type: 'string', enum: FACTION_IDS },
            score: { type: ['integer', 'null'], description: 'Null when the badge shows an icon.' },
            badge: { type: 'string', enum: ['score', 'dominance', 'coalition'] },
            badge_detail: {
              type: ['string', 'null'],
              description: 'Dominance suit (fox, rabbit, mouse, bird) or the coalition partner faction id.',
            },
            on_winner_podium: { type: 'boolean' },
            faction_confidence: { type: 'string', enum: ['high', 'low'] },
          },
        },
      },
    },
  },
};

/**
 * Ask Claude to read one screenshot. Returns the record_game input object.
 */
export async function extractGame({ imageBase64, mediaType, apiKey, model, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
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
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const block = (body.content ?? []).find((b) => b.type === 'tool_use');
  if (!block) throw new Error('Claude API returned no structured result');
  return block.input;
}
