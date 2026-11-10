// Shared by the dashboard, the admin page and the tests. No dependencies.

export const FACTIONS = {
  marquise: { name: 'Marquise de Cat', short: 'Marquise', color: '#d9772b' },
  eyrie: { name: 'Eyrie Dynasties', short: 'Eyrie', color: '#2f5fa8' },
  alliance: { name: 'Woodland Alliance', short: 'Alliance', color: '#3f9b4b' },
  vagabond: { name: 'Vagabond', short: 'Vagabond', color: '#74787c' },
  riverfolk: { name: 'Riverfolk Company', short: 'Riverfolk', color: '#35a39f' },
  lizard: { name: 'Lizard Cult', short: 'Lizard Cult', color: '#98a02c' },
  duchy: { name: 'Underground Duchy', short: 'Duchy', color: '#c79a63' },
  corvid: { name: 'Corvid Conspiracy', short: 'Corvids', color: '#7d55a8' },
  hundreds: { name: 'Lord of the Hundreds', short: 'Hundreds', color: '#b3262b' },
  keepers: { name: 'Keepers in Iron', short: 'Keepers', color: '#7f93ad' },
};

export const FACTION_IDS = Object.keys(FACTIONS);

export function factionName(id) {
  return FACTIONS[id]?.short ?? id ?? 'Unknown';
}

/**
 * Turn the list of games into standings.
 * A coalition win counts as a win for both partners.
 */
export function computeStats(games) {
  const players = new Map();
  const factions = new Map();
  let coalitionWins = 0;
  let dominanceAttempts = 0;
  let dominanceWins = 0;

  const getPlayer = (name) => {
    if (!players.has(name)) {
      players.set(name, { name, games: 0, wins: 0, scoreSum: 0, scoreCount: 0, lastPlayed: null, factions: {} });
    }
    return players.get(name);
  };
  const getFaction = (id) => {
    if (!factions.has(id)) factions.set(id, { id, played: 0, wins: 0 });
    return factions.get(id);
  };

  for (const game of games) {
    if (game.win_type === 'coalition') coalitionWins++;
    for (const p of game.players ?? []) {
      const player = getPlayer(p.name);
      const faction = getFaction(p.faction);
      player.games++;
      faction.played++;
      const pf = (player.factions[p.faction] ??= { games: 0, wins: 0 });
      pf.games++;
      if (p.winner) {
        player.wins++;
        faction.wins++;
        pf.wins++;
      }
      if (typeof p.score === 'number') {
        player.scoreSum += p.score;
        player.scoreCount++;
      }
      if (p.badge === 'dominance') {
        dominanceAttempts++;
        if (p.winner) dominanceWins++;
      }
      if (game.date && (!player.lastPlayed || game.date > player.lastPlayed)) player.lastPlayed = game.date;
    }
  }

  const rate = (wins, n) => (n ? wins / n : 0);
  const playerRows = [...players.values()]
    .map((p) => {
      const best = Object.entries(p.factions)
        .filter(([, f]) => f.wins > 0)
        .sort((a, b) => b[1].wins - a[1].wins || a[1].games - b[1].games)[0];
      return {
        ...p,
        winRate: rate(p.wins, p.games),
        avgScore: p.scoreCount ? p.scoreSum / p.scoreCount : null,
        bestFaction: best ? best[0] : null,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games || a.name.localeCompare(b.name));

  const factionRows = [...factions.values()]
    .map((f) => ({ ...f, winRate: rate(f.wins, f.played) }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.played - a.played);

  return {
    players: playerRows,
    factions: factionRows,
    totals: {
      games: games.length,
      players: playerRows.length,
      coalitionWins,
      dominanceAttempts,
      dominanceWins,
      needsReview: games.filter((g) => g.needs_review).length,
    },
  };
}

/** Newest first; undated games keep their stored order at the end. */
export function sortGames(games) {
  return games
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      if (a.g.date && b.g.date) return a.g.date < b.g.date ? 1 : a.g.date > b.g.date ? -1 : b.i - a.i;
      if (a.g.date) return -1;
      if (b.g.date) return 1;
      return b.i - a.i;
    })
    .map((x) => x.g);
}

/** Oldest first. Undated games keep their stored order and come before dated ones. */
export function chronological(games) {
  return games
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      if (a.g.date && b.g.date) return a.g.date < b.g.date ? -1 : a.g.date > b.g.date ? 1 : a.i - b.i;
      if (!a.g.date && !b.g.date) return a.i - b.i;
      return a.g.date ? 1 : -1;
    })
    .map((x) => x.g);
}

/**
 * Elo for a winner-takes-all multiplayer game.
 * Each winner is scored as beating each loser; losers do not exchange points
 * with each other. A game moves at most K points to the winner in total, split
 * between partners in a coalition. key is 'name' (players) or 'faction'.
 */
export function computeElo(games, { key = 'name', k = 32, start = 1500 } = {}) {
  const rating = new Map();
  const played = new Map();
  const peak = new Map();
  const get = (id) => rating.get(id) ?? start;
  const history = [];

  chronological(games).forEach((game, index) => {
    const seats = (game.players ?? []).filter((p) => p[key]);
    const winners = seats.filter((p) => p.winner);
    const losers = seats.filter((p) => !p.winner);
    const delta = new Map();
    for (const p of seats) delta.set(p[key], 0);
    if (winners.length && losers.length) {
      const share = k / (winners.length * losers.length);
      for (const w of winners) {
        for (const l of losers) {
          if (w[key] === l[key]) continue;
          const expected = 1 / (1 + 10 ** ((get(l[key]) - get(w[key])) / 400));
          const d = share * (1 - expected);
          delta.set(w[key], delta.get(w[key]) + d);
          delta.set(l[key], delta.get(l[key]) - d);
        }
      }
    }
    const after = {};
    for (const [id, d] of delta) {
      const r = get(id) + d;
      rating.set(id, r);
      played.set(id, (played.get(id) ?? 0) + 1);
      peak.set(id, Math.max(peak.get(id) ?? start, r));
      after[id] = r;
    }
    history.push({ index, date: game.date ?? null, after });
  });

  const ratings = [...rating.entries()]
    .map(([id, r]) => ({ id, rating: r, games: played.get(id), peak: peak.get(id) }))
    .sort((a, b) => b.rating - a.rating);
  return { ratings, history, start };
}

/**
 * Wins compared with an even-odds baseline: in a four-player game each seat is
 * "expected" to win a quarter of the time. key is 'name' or 'faction'.
 */
export function expectedWins(games, key = 'name') {
  const out = new Map();
  for (const game of games) {
    const seats = (game.players ?? []).filter((p) => p[key]);
    const winners = seats.filter((p) => p.winner).length;
    if (!seats.length) continue;
    for (const p of seats) out.set(p[key], (out.get(p[key]) ?? 0) + winners / seats.length);
  }
  return out;
}

export const MAPS = {
  autumn: { name: 'Autumn' },
  winter: { name: 'Winter' },
  lake: { name: 'Lake' },
  mountain: { name: 'Mountain' },
};
export const MAP_IDS = Object.keys(MAPS);
export const mapName = (id) => MAPS[id]?.name ?? 'Unknown map';

/**
 * For every pair of players (key 'name') or factions (key 'faction') that
 * shared a table: how many games, and how many each won.
 * result[a][b] = { games, wins } where wins is a's wins in those games.
 */
export function pairMatchups(games, key) {
  const m = {};
  for (const game of games) {
    const present = [...new Set((game.players ?? []).map((p) => p[key]).filter(Boolean))];
    const won = new Set((game.players ?? []).filter((p) => p.winner).map((p) => p[key]));
    for (const a of present) {
      for (const b of present) {
        if (a === b) continue;
        const cell = ((m[a] ??= {})[b] ??= { games: 0, wins: 0 });
        cell.games++;
        if (won.has(a)) cell.wins++;
      }
    }
  }
  return m;
}
export const factionMatchups = (games) => pairMatchups(games, 'faction');

/**
 * Two-way record table. pick(game, seat) returns [row, column] or null.
 * result[row][column] = { games, wins }.
 */
export function tally(games, pick) {
  const out = {};
  for (const game of games) {
    for (const seat of game.players ?? []) {
      const rc = pick(game, seat);
      if (!rc || rc[0] == null || rc[1] == null) continue;
      const cell = ((out[rc[0]] ??= {})[rc[1]] ??= { games: 0, wins: 0 });
      cell.games++;
      if (seat.winner) cell.wins++;
    }
  }
  return out;
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
