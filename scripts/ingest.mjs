#!/usr/bin/env node
// Reads new messages from the Discord channel, sends each screenshot to Claude,
// and appends the results to docs/data/games.json. Run on a schedule by
// .github/workflows/ingest.yml. Safe to re-run: every image is logged once.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMessagesAfter, imageAttachments, downloadImage, replyToMessage } from './lib/discord.mjs';
import { extractGame } from './lib/extract.mjs';
import { buildGame, findDuplicate } from './lib/normalize.mjs';
import { factionName } from '../docs/stats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FAILURES = 3;
const EXTENSIONS = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');

export function summaryLine(game) {
  const parts = game.players.map((p) => {
    const tail = p.badge === 'dominance' ? 'dominance' : p.badge === 'coalition' ? 'coalition' : (p.score ?? '?');
    return `${p.winner ? '🏆 ' : ''}${p.name} (${factionName(p.faction)}) ${tail}`;
  });
  return parts.join(' · ');
}

export async function ingest({
  env = process.env,
  dataDir = path.join(ROOT, 'docs', 'data'),
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const token = env.DISCORD_BOT_TOKEN;
  const channelId = env.DISCORD_CHANNEL_ID;
  const apiKey = env.ANTHROPIC_API_KEY;
  for (const [k, v] of Object.entries({ DISCORD_BOT_TOKEN: token, DISCORD_CHANNEL_ID: channelId, ANTHROPIC_API_KEY: apiKey })) {
    if (!v) throw new Error(`Missing ${k}`);
  }
  const model = env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const reply = (env.DISCORD_REPLY ?? 'true') !== 'false';
  const dashboardUrl = env.DASHBOARD_URL || '';
  const maxPerRun = Number(env.MAX_IMAGES_PER_RUN || 40);
  const saveImages = (env.SAVE_IMAGES ?? 'true') !== 'false';
  const imageDir = path.join(dataDir, '..', 'img');

  const files = {
    games: path.join(dataDir, 'games.json'),
    players: path.join(dataDir, 'players.json'),
    state: path.join(dataDir, 'state.json'),
  };
  const games = await readJson(files.games, []);
  const roster = await readJson(files.players, []);
  const state = await readJson(files.state, { last_message_id: null, failures: {} });
  state.failures ??= {};

  const messages = await fetchMessagesAfter({ channelId, after: state.last_message_id, token, fetchImpl });
  log(`${messages.length} new message(s)`);

  const known = new Set(games.map((g) => g.id));
  let processed = 0;
  let added = 0;
  let stoppedEarly = false;

  try {
    for (const message of messages) {
      let messageDone = true;
      for (const att of imageAttachments(message)) {
        const id = `${message.id}-${att.id}`;
        if (known.has(id)) continue;
        if ((state.failures[id] ?? 0) >= MAX_FAILURES) continue;
        if (processed >= maxPerRun) {
          messageDone = false;
          stoppedEarly = true;
          break;
        }
        processed++;
        try {
          const image = await downloadImage(att, { fetchImpl });
          const extraction = await extractGame({
            imageBase64: image.base64,
            mediaType: image.mediaType,
            apiKey,
            model,
            fetchImpl,
          });
          if (!extraction.is_victory_screen) {
            log(`skip ${id}: not a victory screen`);
            continue;
          }
          const { game, newPlayers } = buildGame(extraction, {
            id,
            date: message.timestamp,
            roster,
            source: {
              message_id: message.id,
              attachment_id: att.id,
              channel_id: channelId,
              guild_id: message.guild_id ?? env.DISCORD_GUILD_ID ?? null,
              posted_by: message.author?.global_name ?? message.author?.username ?? null,
            },
          });
          // Keep a copy of the screenshot, for victory screens only.
          if (saveImages) {
            const file = `${id}.${EXTENSIONS[image.mediaType] ?? 'png'}`;
            await mkdir(imageDir, { recursive: true });
            await writeFile(path.join(imageDir, file), image.buffer);
            game.image = `img/${file}`;
          }
          const dup = findDuplicate(game, games);
          if (dup) {
            game.needs_review = true;
            game.review_notes.push('Looks like a repost of a game already logged — delete one of them.');
          }
          for (const name of newPlayers) {
            if (!roster.some((p) => p.name === name)) roster.push({ name, aliases: [] });
          }
          games.push(game);
          known.add(id);
          added++;
          delete state.failures[id];
          log(`logged ${id}: ${summaryLine(game)}`);

          if (reply) {
            const lines = [`Logged: ${summaryLine(game)}`];
            if (game.needs_review) lines.push(`⚠️ Needs a check: ${game.review_notes.join(' ')}`);
            if (dashboardUrl) lines.push(`<${dashboardUrl}>`);
            await replyToMessage({ channelId, messageId: message.id, content: lines.join('\n'), token, fetchImpl }).catch(
              (err) => log(`reply failed: ${err.message}`),
            );
          }
        } catch (err) {
          state.failures[id] = (state.failures[id] ?? 0) + 1;
          log(`error on ${id} (attempt ${state.failures[id]}/${MAX_FAILURES}): ${err.message}`);
          if (state.failures[id] < MAX_FAILURES) messageDone = false;
        }
      }
      // Only move the cursor past a message once nothing in it needs a retry.
      if (!messageDone) break;
      state.last_message_id = message.id;
    }
  } finally {
    await writeJson(files.games, games);
    await writeJson(files.players, roster);
    await writeJson(files.state, state);
  }

  log(`added ${added} game(s)${stoppedEarly ? '; more remain for the next run' : ''}`);
  return { added, processed, stoppedEarly };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ingest().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
