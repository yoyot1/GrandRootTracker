import { FACTION_IDS, MAP_IDS } from '../../docs/stats.js';

/**
 * The game's font draws 1, l and I identically (and 0 / O nearly so), so names
 * are compared on a key that folds those characters together.
 */
export function confusionKey(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[1li|]/g, 'l')
    .replace(/[0o]/g, 'o');
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? last : 1 + Math.min(last, prev[j], prev[j - 1]);
      last = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Match a name read from a screenshot to the roster.
 * roster: [{ name, aliases: [] }]
 * Returns { name, known, fuzzy }.
 */
export function resolveName(raw, roster) {
  const cleaned = String(raw ?? '').trim();
  const key = confusionKey(cleaned);
  for (const p of roster) {
    if ([p.name, ...(p.aliases ?? [])].some((n) => confusionKey(n) === key)) {
      return { name: p.name, known: true, fuzzy: false };
    }
  }
  if (key.length >= 5) {
    let best = null;
    for (const p of roster) {
      for (const n of [p.name, ...(p.aliases ?? [])]) {
        const d = levenshtein(confusionKey(n), key);
        if (d <= 1 && (!best || d < best.d)) best = { d, name: p.name };
      }
    }
    if (best) return { name: best.name, known: true, fuzzy: true };
  }
  return { name: cleaned, known: false, fuzzy: false };
}

const BANNER_FACTIONS = [
  [/marquise/i, 'marquise'],
  [/eyrie/i, 'eyrie'],
  [/alliance/i, 'alliance'],
  [/vagabond/i, 'vagabond'],
  [/riverfolk/i, 'riverfolk'],
  [/lizard|cult/i, 'lizard'],
  [/duchy/i, 'duchy'],
  [/corvid/i, 'corvid'],
  [/hundreds/i, 'hundreds'],
  [/keepers/i, 'keepers'],
];

export function factionFromBanner(text) {
  for (const [re, id] of BANNER_FACTIONS) if (re.test(text ?? '')) return id;
  return null;
}

/**
 * Convert the model's raw reading into a stored game.
 * Anything doubtful sets needs_review and adds a plain-language note.
 */
export function buildGame(extraction, { id, date, source, roster }) {
  const notes = [];
  const newPlayers = [];
  const banner = extraction.banner_text ?? '';
  const isCoalition = /coalition/i.test(banner);

  const players = (extraction.players ?? []).map((p) => {
    const resolved = resolveName(p.name, roster);
    if (!resolved.known) {
      newPlayers.push(resolved.name);
      notes.push(`New player name "${resolved.name}" — confirm the spelling.`);
    } else if (resolved.fuzzy) {
      notes.push(`Read "${p.name}" and matched it to ${resolved.name}.`);
    }
    let faction = FACTION_IDS.includes(p.faction) ? p.faction : null;
    if (!faction) notes.push(`Could not tell ${resolved.name}'s faction.`);
    else if (p.faction_confidence === 'low') notes.push(`${resolved.name}'s faction is a low-confidence read.`);
    const badge = ['dominance', 'coalition'].includes(p.badge) ? p.badge : 'score';
    return {
      name: resolved.name,
      faction,
      score: badge === 'score' && Number.isFinite(p.score) ? p.score : null,
      winner: Boolean(p.on_winner_podium),
      badge,
      badge_detail: badge === 'score' ? null : (p.badge_detail ?? null),
    };
  });

  const map = MAP_IDS.includes(extraction.map) ? extraction.map : null;
  if (!map) notes.push('Could not tell which map was played.');
  else if (extraction.map_confidence === 'low') notes.push(`Map read as ${map} with low confidence.`);

  const winners = players.filter((p) => p.winner);
  let winType = 'score';
  if (isCoalition) winType = 'coalition';
  else if (winners.some((p) => p.badge === 'dominance')) winType = 'dominance';

  if (winners.length === 0) notes.push('No winner identified.');
  if (!isCoalition && winners.length > 1) notes.push('More than one winner on a non-coalition screen.');
  if (isCoalition && winners.length !== 2) notes.push('Coalition victory should have exactly two winners.');
  if (players.length < 2 || players.length > 6) notes.push(`Unusual player count (${players.length}).`);

  const bannerFaction = factionFromBanner(banner);
  if (bannerFaction && winners.length && !winners.some((p) => p.faction === bannerFaction)) {
    notes.push(`Banner says "${banner}" but the winner was read as a different faction.`);
  }
  const seen = new Set();
  for (const p of players) {
    if (p.faction && p.faction !== 'vagabond' && seen.has(p.faction)) notes.push(`Two players read as ${p.faction}.`);
    if (p.faction) seen.add(p.faction);
  }
  const names = players.map((p) => p.name);
  if (new Set(names).size !== names.length) notes.push('The same player appears twice.');
  if (winType === 'score' && winners[0] && (winners[0].score ?? 0) < 30) {
    notes.push('Winner has fewer than 30 points.');
  }

  return {
    game: {
      id,
      date,
      map,
      win_type: winType,
      banner_text: banner,
      players,
      needs_review: notes.length > 0,
      review_notes: notes,
      source,
    },
    newPlayers,
  };
}

/** Same players, factions and scores as a game logged within a day: probably a repost. */
export function findDuplicate(game, games) {
  const sig = (g) =>
    g.players
      .map((p) => `${confusionKey(p.name)}:${p.faction}:${p.score}`)
      .sort()
      .join('|');
  const mine = sig(game);
  const t = game.date ? Date.parse(game.date) : null;
  return (
    games.find((g) => {
      if (g.id === game.id || sig(g) !== mine) return false;
      if (t === null || !g.date) return true;
      return Math.abs(Date.parse(g.date) - t) < 24 * 3600 * 1000;
    }) ?? null
  );
}
