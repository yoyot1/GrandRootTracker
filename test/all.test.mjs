import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeStats } from '../docs/stats.js';
import { resolveName, buildGame, findDuplicate, factionFromBanner } from '../scripts/lib/normalize.mjs';
import { ingest } from '../scripts/ingest.mjs';
import { sampleGames } from './fixtures/sample-games.mjs';

const roster = [
  { name: 'yoyot1', aliases: [] },
  { name: 'shrd1123', aliases: [] },
  { name: 'DibsOnRugarth', aliases: ['Dibs'] },
  { name: 'gogogaijin', aliases: [] },
];

test('names: 1 and l are interchangeable, aliases resolve, strangers stay new', () => {
  assert.equal(resolveName('yoyotl', roster).name, 'yoyot1');
  assert.equal(resolveName('shrdll23', roster).name, 'shrd1123');
  assert.equal(resolveName('dibs', roster).name, 'DibsOnRugarth');
  assert.deepEqual(resolveName('DibsOnRugarh', roster), { name: 'DibsOnRugarth', known: true, fuzzy: true });
  assert.deepEqual(resolveName('NewPerson', roster), { name: 'NewPerson', known: false, fuzzy: false });
});

test('banner text maps to factions', () => {
  assert.equal(factionFromBanner('Riverfolk Company Wins!'), 'riverfolk');
  assert.equal(factionFromBanner('Hundreds Wins'), 'hundreds');
  assert.equal(factionFromBanner('Coalition Victory'), null);
});

const reading = (over = {}) => ({
  is_victory_screen: true,
  banner_text: 'Vagabond Wins',
  map: 'autumn',
  map_confidence: 'high',
  players: [
    { name: 'yoyotl', faction: 'vagabond', score: 33, badge: 'score', on_winner_podium: true, faction_confidence: 'high' },
    { name: 'gogogaijin', faction: 'riverfolk', score: 29, badge: 'score', on_winner_podium: false, faction_confidence: 'high' },
    { name: 'shrdl123', faction: 'duchy', score: 24, badge: 'score', on_winner_podium: false, faction_confidence: 'high' },
    { name: 'Constr', faction: 'hundreds', score: null, badge: 'dominance', badge_detail: 'fox', on_winner_podium: false, faction_confidence: 'high' },
  ],
  ...over,
});

test('buildGame: clean read of a known table needs no review', () => {
  const full = [...roster, { name: 'Constr', aliases: [] }];
  const { game, newPlayers } = buildGame(reading(), { id: 'a', date: '2026-11-01T00:00:00Z', roster: full, source: null });
  assert.equal(game.needs_review, false);
  assert.equal(game.win_type, 'score');
  assert.deepEqual(game.players.map((p) => p.name), ['yoyot1', 'gogogaijin', 'shrd1123', 'Constr']);
  assert.equal(game.players[3].badge, 'dominance');
  assert.equal(game.players[3].score, null);
  assert.deepEqual(newPlayers, []);
});

test('buildGame: new names, low confidence and banner mismatch are flagged', () => {
  const r = reading();
  r.players[1].faction_confidence = 'low';
  r.banner_text = 'Hundreds Wins';
  const { game, newPlayers } = buildGame(r, { id: 'a', date: null, roster, source: null });
  assert.equal(game.needs_review, true);
  assert.deepEqual(newPlayers, ['Constr']);
  assert.equal(game.review_notes.length, 3);
});

test('buildGame: coalition victory has two winners', () => {
  const r = reading({ banner_text: 'Coalition Victory' });
  r.players[3] = { name: 'Constr', faction: 'alliance', score: 30, badge: 'score', on_winner_podium: true, faction_confidence: 'high' };
  r.players[0] = { ...r.players[0], score: null, badge: 'coalition', badge_detail: 'alliance' };
  const { game } = buildGame(r, { id: 'a', date: null, roster: [...roster, { name: 'Constr', aliases: [] }], source: null });
  assert.equal(game.win_type, 'coalition');
  assert.equal(game.players.filter((p) => p.winner).length, 2);
  assert.equal(game.needs_review, false);
});

test('stats over the 24 sample games match the hand count', () => {
  const s = computeStats(sampleGames);
  const by = Object.fromEntries(s.players.map((p) => [p.name, p]));
  assert.equal(s.totals.games, 24);
  assert.equal(s.totals.players, 10);
  assert.deepEqual([by.DibsOnRugarth.games, by.DibsOnRugarth.wins], [21, 7]);
  assert.deepEqual([by.shrd1123.games, by.shrd1123.wins], [19, 5]);
  assert.deepEqual([by.yoyot1.games, by.yoyot1.wins], [18, 4]);
  assert.deepEqual([by.gogogaijin.games, by.gogogaijin.wins], [14, 5]);
  assert.deepEqual([by.Constr.games, by.Constr.wins], [8, 0]);
  assert.deepEqual([by.TheRandomosity.games, by.TheRandomosity.wins], [3, 1]);
  const f = Object.fromEntries(s.factions.map((x) => [x.id, x]));
  assert.deepEqual([f.hundreds.played, f.hundreds.wins], [18, 9]);
  assert.deepEqual([f.eyrie.played, f.eyrie.wins], [9, 0]);
  assert.equal(f.duchy.wins, 4);
  assert.equal(s.totals.coalitionWins, 1);
  assert.equal(s.totals.dominanceAttempts, 1);
  assert.equal(s.totals.dominanceWins, 0);
  assert.equal(s.players[0].name, 'DibsOnRugarth');
});

test('duplicate detection ignores the game itself and far-apart dates', () => {
  const a = { ...sampleGames[0], id: 'x', date: '2026-11-01T10:00:00Z' };
  const b = { ...sampleGames[0], id: 'y', date: '2026-11-01T12:00:00Z' };
  const c = { ...sampleGames[0], id: 'z', date: '2026-11-09T12:00:00Z' };
  assert.equal(findDuplicate(b, [a, b])?.id, 'x');
  assert.equal(findDuplicate(c, [a]), null);
});

// ---- end-to-end ingest against fake Discord + fake Claude ----

function fakeWorld() {
  const messages = [
    { id: '100', timestamp: '2026-11-01T20:00:00.000Z', author: { username: 'tom' }, attachments: [
      { id: '1', filename: 'win.png', content_type: 'image/png', url: 'https://cdn.test/win.png' } ] },
    { id: '101', timestamp: '2026-11-02T20:00:00.000Z', author: { username: 'tom' }, content: 'gg', attachments: [] },
    { id: '102', timestamp: '2026-11-03T20:00:00.000Z', author: { username: 'sam' }, attachments: [
      { id: '2', filename: 'cat.jpg', content_type: 'image/jpeg', url: 'https://cdn.test/cat.jpg' } ] },
    { id: '103', timestamp: '2026-11-04T20:00:00.000Z', author: { username: 'sam' }, attachments: [
      { id: '3', filename: 'broken.png', content_type: 'image/png', url: 'https://cdn.test/broken.png' } ] },
  ];
  const replies = [];
  const calls = { claude: 0 };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://discord.com/api/v10/channels/C/messages?')) {
      const after = BigInt(new URL(url).searchParams.get('after'));
      return json(messages.filter((m) => BigInt(m.id) > after).reverse());
    }
    if (url === 'https://discord.com/api/v10/channels/C/messages' && init.method === 'POST') {
      replies.push(JSON.parse(init.body));
      return json({ id: '999' });
    }
    if (url === 'https://cdn.test/broken.png') return new Response('nope', { status: 404 });
    if (url.startsWith('https://cdn.test/')) {
      return new Response(Buffer.from(url), { headers: { 'content-type': url.endsWith('jpg') ? 'image/jpeg' : 'image/png' } });
    }
    if (url === 'https://api.anthropic.com/v1/messages') {
      calls.claude++;
      const sent = Buffer.from(JSON.parse(init.body).messages[0].content[0].source.data, 'base64').toString();
      const input = sent.includes('cat') ? { is_victory_screen: false, banner_text: '', map: null, map_confidence: 'low', players: [] } : reading();
      return json({ content: [{ type: 'tool_use', name: 'record_game', input }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchImpl, replies, calls, messages };
}

test('ingest: logs victory screens once, skips other images, retries failures then gives up', async () => {
  const dataDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'root-')), 'data');
  await mkdir(dataDir);
  await writeFile(path.join(dataDir, 'players.json'), JSON.stringify(roster));
  const world = fakeWorld();
  const env = { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_ID: 'C', ANTHROPIC_API_KEY: 'k', DASHBOARD_URL: 'https://x.test/' };
  const run = () => ingest({ env, dataDir, fetchImpl: world.fetchImpl, log: () => {} });
  const read = async (f) => JSON.parse(await readFile(path.join(dataDir, f), 'utf8'));

  const first = await run();
  assert.equal(first.added, 1);
  let games = await read('games.json');
  assert.equal(games.length, 1);
  assert.equal(games[0].id, '100-1');
  assert.equal(games[0].date, '2026-11-01T20:00:00.000Z');
  assert.equal(games[0].players[0].name, 'yoyot1');
  assert.equal(games[0].source.posted_by, 'tom');
  // Only the victory screen is kept; the cat photo and the broken image are not.
  assert.equal(games[0].image, 'img/100-1.png');
  assert.deepEqual(await readdir(path.join(dataDir, '..', 'img')), ['100-1.png']);
  assert.equal((await readFile(path.join(dataDir, '..', 'img', '100-1.png'))).toString(), 'https://cdn.test/win.png');
  // Constr was not on the roster: flagged and added.
  assert.equal(games[0].needs_review, true);
  assert.ok((await read('players.json')).some((p) => p.name === 'Constr'));
  // Cursor stops before the broken image so it is retried.
  assert.equal((await read('state.json')).last_message_id, '102');
  assert.equal(world.replies.length, 1);
  assert.match(world.replies[0].content, /Logged: 🏆 yoyot1 \(Vagabond\) 33/);
  assert.deepEqual(world.replies[0].allowed_mentions, { parse: [] });

  await run();
  await run();
  const state = await read('state.json');
  assert.equal(state.failures['103-3'], 3);
  assert.equal(state.last_message_id, '103');

  const claudeCalls = world.calls.claude;
  const again = await run();
  assert.equal(again.added, 0);
  assert.equal(world.calls.claude, claudeCalls, 'nothing is re-read once the cursor has passed');
  games = await read('games.json');
  assert.equal(games.length, 1);
  assert.equal(world.replies.length, 1);
});

// ---- ratings and faction analysis ----
import { computeElo, expectedWins, factionMatchups, chronological } from '../docs/stats.js';

test('elo: first four-player win moves 16 points and the system is zero-sum', () => {
  const one = computeElo(sampleGames.slice(0, 1));
  const by = Object.fromEntries(one.ratings.map((r) => [r.id, r.rating]));
  assert.equal(Math.round(by.yoyot1 * 1000) / 1000, 1516);
  assert.equal(Math.round(by.Constr * 1000) / 1000, 1494.667);
  const all = computeElo(sampleGames);
  const sum = all.ratings.reduce((s, r) => s + r.rating - 1500, 0);
  assert.ok(Math.abs(sum) < 1e-6);
  assert.equal(all.history.length, 24);
  assert.equal(all.ratings.reduce((s, r) => s + r.games, 0), 96);
});

test('elo: coalition partners split the gain; faction ratings work the same way', () => {
  const co = computeElo([sampleGames[4]]);
  const by = Object.fromEntries(co.ratings.map((r) => [r.id, r.rating]));
  assert.equal(by.DibsOnRugarth, 1508);
  assert.equal(by.TheRandomosity, 1508);
  assert.equal(by.yoyot1, 1492);
  const f = computeElo(sampleGames, { key: 'faction' });
  assert.equal(f.ratings[0].id, 'hundreds');
  assert.equal(f.ratings.at(-1).id, 'eyrie');
});

test('expected wins sum to the number of wins; matchups count shared tables', () => {
  const e = expectedWins(sampleGames, 'faction');
  const total = [...e.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 25) < 1e-9); // 23 single wins + 2 coalition winners
  assert.equal(e.get('hundreds'), 18 * 0.25 + 0); // Hundreds never sat in the coalition game
  const m = factionMatchups(sampleGames);
  assert.deepEqual(m.hundreds.eyrie, { games: 6, wins: 4 });
  assert.deepEqual(m.eyrie.hundreds, { games: 6, wins: 0 });
});

test('chronological puts undated games first in stored order, then by date', () => {
  const g = [{ id: 'b', date: '2026-02-01' }, { id: 'u1', date: null }, { id: 'a', date: '2026-01-01' }, { id: 'u2', date: null }];
  assert.deepEqual(chronological(g).map((x) => x.id), ['u1', 'u2', 'a', 'b']);
});

// ---- maps and pair records ----
import { tally, pairMatchups, slug } from '../docs/stats.js';

test('maps: read from the screenshot, flagged when unclear, tallied per faction', () => {
  const full = [...roster, { name: 'Constr', aliases: [] }];
  const ok = buildGame(reading(), { id: 'a', date: null, roster: full, source: null }).game;
  assert.equal(ok.map, 'autumn');
  assert.equal(ok.needs_review, false);
  const unsure = buildGame(reading({ map_confidence: 'low' }), { id: 'a', date: null, roster: full, source: null }).game;
  assert.equal(unsure.needs_review, true);
  const none = buildGame(reading({ map: 'desert' }), { id: 'a', date: null, roster: full, source: null }).game;
  assert.equal(none.map, null);
  assert.equal(none.needs_review, true);

  const counts = {};
  for (const g of sampleGames) counts[g.map] = (counts[g.map] ?? 0) + 1;
  assert.deepEqual(counts, { autumn: 7, mountain: 6, winter: 4, lake: 7 });
  const byMap = tally(sampleGames, (g, s) => [s.faction, g.map]);
  assert.deepEqual(byMap.hundreds.mountain, { games: 5, wins: 4 });
  assert.deepEqual(byMap.hundreds.winter, { games: 3, wins: 2 });
});

test('player head-to-head and slugs', () => {
  const m = pairMatchups(sampleGames, 'name');
  assert.equal(m.yoyot1.gogogaijin.games, m.gogogaijin.yoyot1.games);
  assert.deepEqual(m.Constr.yoyot1, { games: 7, wins: 0 });
  assert.equal(slug('DibsOnRugarth'), 'dibsonrugarth');
  assert.equal(slug('The Random_osity!'), 'the-random-osity');
});
