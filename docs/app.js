import {
  FACTIONS, FACTION_IDS, MAP_IDS, factionName, mapName, slug,
  computeStats, sortGames, computeElo, expectedWins, pairMatchups, tally,
} from './stats.js';

// ---------- small DOM helpers ----------
const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
const pct = (x) => Math.round(x * 100) + '%';
const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const signed = (d) => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1);
const rate = (wins, games) => (games ? wins / games : 0);

const swatch = (id) => h('span', { class: 'swatch', style: `background:${FACTIONS[id]?.color ?? 'transparent'}` });
const playerLink = (name) => h('a', { href: `#player-${slug(name)}` }, name);
const factionLink = (id) => h('a', { class: 'faction', href: `#faction-${id}` }, swatch(id), factionName(id));
const num = (v) => h('td', { class: 'num' }, String(v));
const rateCell = (r) =>
  h('td', { class: 'num' },
    h('div', { class: 'rate' },
      h('div', { class: 'rate-track' }, h('div', { class: 'rate-fill', style: `width:${Math.round(r * 100)}%` })),
      h('span', { class: 'rate-num' }, pct(r))));
const deltaCell = (d) => h('td', { class: 'num ' + (d >= 0 ? 'delta-up' : 'delta-down') }, signed(d));

/** cols: [label, className?]; rows: arrays of <td> nodes. */
function table(cols, rows, cls = '') {
  return h('div', { class: 'scroll' },
    h('table', { class: cls },
      h('thead', {}, h('tr', {}, cols.map(([label, c]) => h('th', { class: c, scope: 'col' }, label)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r)))));
}
const section = (title, ...kids) => h('section', {}, h('h2', {}, title), kids);
const note = (text) => h('p', { class: 'section-note' }, text);
const facts = (pairs) => h('dl', { class: 'facts' }, pairs.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));

/** Wins/games grid. rowHead and colHead build the header cells. */
function recordGrid(rowIds, colIds, cell, rowHead, colHead, corner) {
  return h('div', { class: 'scroll' },
    h('table', { class: 'matrix' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, corner), colIds.map((c) => h('th', { scope: 'col' }, colHead(c))))),
      h('tbody', {}, rowIds.map((r) =>
        h('tr', {}, h('td', {}, rowHead(r)), colIds.map((c) => {
          const v = cell(r, c);
          if (!v) return h('td', { class: 'empty' }, '·');
          return h('td', { class: v.wins ? 'won' : '' }, `${v.wins}/${v.games}`);
        }))))));
}

function gameList(games) {
  if (!games.length) return note('No games yet.');
  return h('ol', { class: 'log' }, sortGames(games).map((g) =>
    h('li', {},
      h('div', { class: 'when' }, g.date ? fmt(g.date) : 'Undated',
        h('div', {}, mapName(g.map)),
        g.win_type === 'coalition' && h('div', {}, h('span', { class: 'pill' }, 'Coalition')),
        g.win_type === 'dominance' && h('div', {}, h('span', { class: 'pill' }, 'Dominance')),
        g.needs_review && h('div', {}, h('span', { class: 'pill warn' }, 'Unchecked')),
        g.image && h('div', {}, h('a', { href: g.image, target: '_blank', rel: 'noopener' }, 'Screenshot'))),
      h('div', { class: 'seats' }, g.players.map((p) =>
        h('span', { class: 'seat' + (p.winner ? ' winner' : '') },
          swatch(p.faction),
          h('span', { class: 'who' }, p.winner ? '🏆 ' : '', playerLink(p.name)),
          h('span', { class: 'pts' }, h('a', { href: `#faction-${p.faction}` }, factionName(p.faction)),
            ` ${p.badge === 'dominance' ? '· dominance' : p.badge === 'coalition' ? '· coalition' : (p.score ?? '?')}`)))))));
}

// ---------- rating chart ----------
/** ids: series to draw, in colour order. label(id) names a series. */
function drawElo(box, elo, ids, label = (id) => id) {
  const n = elo.history.length;
  if (n < 2 || !ids.length) { box.replaceChildren(note('The chart appears once a few games are logged.')); return; }
  const series = ids.map((id, i) => {
    const pts = [];
    const carried = [];
    let last = null;
    elo.history.forEach((step, j) => {
      if (id in step.after) {
        if (last === null) pts.push({ x: j, y: elo.start });
        last = step.after[id];
        pts.push({ x: j + 1, y: last });
      }
      carried.push(last);
    });
    return { id, color: `var(--s${i + 1})`, pts, carried };
  }).filter((se) => se.pts.length);
  if (!series.length) { box.replaceChildren(note('No rated games yet.')); return; }

  const ys = series.flatMap((se) => se.pts.map((p) => p.y));
  const step = Math.max(...ys, elo.start) - Math.min(...ys, elo.start) > 150 ? 50 : 25;
  const y0 = Math.floor(Math.min(...ys, elo.start) / step) * step;
  const y1 = Math.max(y0 + step, Math.ceil(Math.max(...ys, elo.start) / step) * step);
  const W = Math.min(900, Math.max(300, box.clientWidth - 26)), H = W < 500 ? 250 : 320, m = { l: 46, r: 14, t: 10, b: 34 };
  const X = (v) => m.l + (v / n) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Line chart of ratings after each game. The same figures are in the tables on this page.' });
  for (let v = y0; v <= y1; v += step) {
    svg.append(s('line', { class: v === elo.start ? 'base' : 'grid', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
    svg.append(s('text', { class: 'tick', x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, String(v)));
  }
  const xStep = n > 60 ? 20 : n > 30 ? 10 : 5;
  for (let g = xStep; g <= n; g += xStep) svg.append(s('text', { class: 'tick', x: X(g), y: H - m.b + 16, 'text-anchor': 'middle' }, String(g)));
  svg.append(s('text', { class: 'tick', x: (m.l + W - m.r) / 2, y: H - 2, 'text-anchor': 'middle' }, 'Games played by the group'));
  const cross = s('line', { class: 'cross', y1: m.t, y2: H - m.b, visibility: 'hidden' });
  svg.append(cross);
  for (const se of series) {
    svg.append(s('path', { class: 'series', stroke: se.color, d: se.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('') }));
    const end = se.pts[se.pts.length - 1];
    svg.append(s('circle', { class: 'end', cx: X(end.x), cy: Y(end.y), r: 4.5, fill: se.color }));
  }

  const legend = series.length > 1 && h('div', { class: 'legend' }, series.map((se) =>
    h('span', {}, h('i', { style: `background:${se.color}` }), label(se.id), h('b', {}, String(Math.round(se.carried[n - 1]))))));
  const tip = h('div', { class: 'tip' });
  tip.hidden = true;
  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const vx = ((evt.clientX - rect.left) / rect.width) * W;
    const g = Math.min(n, Math.max(1, Math.round(((vx - m.l) / (W - m.l - m.r)) * n)));
    cross.setAttribute('x1', X(g)); cross.setAttribute('x2', X(g)); cross.setAttribute('visibility', 'visible');
    const stepData = elo.history[g - 1];
    const rows = series.filter((se) => se.carried[g - 1] !== null).sort((a, b) => b.carried[g - 1] - a.carried[g - 1]);
    tip.replaceChildren(
      h('span', { class: 'tip-head' }, `After game ${g}${stepData.date ? ' · ' + fmt(stepData.date) : ''}`),
      ...(rows.length ? rows.flatMap((se) => {
        const played = se.id in stepData.after;
        return [
          h('span', { class: 'tip-name' + (played ? ' played' : '') }, h('i', { style: `background:${se.color}` }), label(se.id)),
          h('span', { class: 'tip-val' + (played ? ' played' : '') }, String(Math.round(se.carried[g - 1]))),
        ];
      }) : [h('span', { class: 'tip-head' }, 'Not playing yet')]));
    tip.hidden = false;
    const px = (X(g) / W) * rect.width;
    const flip = px + tip.offsetWidth + 40 > rect.width;
    tip.style.left = flip ? '' : `${px + 24}px`;
    tip.style.right = flip ? `${rect.width - px + 24}px` : '';
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  box.replaceChildren(...[legend, svg, tip].filter(Boolean));
}

// ---------- data ----------
let D = null;
let charts = []; // redraw callbacks for the current view

function prepare(games) {
  const stats = computeStats(games);
  const elo = computeElo(games);
  const fElo = computeElo(games, { key: 'faction' });
  return {
    games, stats, elo, fElo,
    rating: new Map(elo.ratings.map((r) => [r.id, r])),
    fRating: new Map(fElo.ratings.map((r) => [r.id, r])),
    pExp: expectedWins(games, 'name'),
    fExp: expectedWins(games, 'faction'),
    pVs: pairMatchups(games, 'name'),
    fVs: pairMatchups(games, 'faction'),
    playerFaction: tally(games, (g, seat) => [seat.name, seat.faction]),
    factionPlayer: tally(games, (g, seat) => [seat.faction, seat.name]),
    playerMap: tally(games, (g, seat) => [seat.name, g.map]),
    factionMap: tally(games, (g, seat) => [seat.faction, g.map]),
    byRating: [...stats.players].sort((a, b) => (elo.ratings.findIndex((r) => r.id === a.name)) - (elo.ratings.findIndex((r) => r.id === b.name))),
    factionsByRating: fElo.ratings.map((r) => stats.factions.find((f) => f.id === r.id)).filter(Boolean),
    mapsPlayed: MAP_IDS.filter((id) => games.some((g) => g.map === id)),
  };
}

// ---------- views ----------
function leaderboard() {
  const chartBox = h('div', { class: 'chart' });
  const counts = [...D.rating.values()];
  let chosen = counts.filter((r) => r.games >= 5).sort((a, b) => b.games - a.games).slice(0, 6).map((r) => r.id);
  if (chosen.length < 2) chosen = counts.sort((a, b) => b.games - a.games).slice(0, 6).map((r) => r.id);
  // Colour by order of first appearance so a colour stays with its player.
  const firstSeen = [];
  for (const step of D.elo.history) for (const id of Object.keys(step.after)) if (!firstSeen.includes(id)) firstSeen.push(id);
  chosen = firstSeen.filter((id) => chosen.includes(id));
  charts.push(() => drawElo(chartBox, D.elo, chosen));

  return [
    section('Leaderboard',
      note('Ranked by rating. Select a player for their full record.'),
      table(
        [['#', 'rank'], ['Player'], ['Rating', 'num'], ['Games', 'num'], ['Wins', 'num'], ['Win rate', 'num'], ['Vs even odds', 'num'], ['Best faction']],
        D.byRating.map((p, i) => [
          h('td', { class: 'rank' }, String(i + 1)),
          h('td', { class: 'name' }, playerLink(p.name)),
          num(Math.round(D.rating.get(p.name).rating)), num(p.games), num(p.wins), rateCell(p.winRate),
          deltaCell(p.wins - (D.pExp.get(p.name) ?? 0)),
          h('td', {}, p.bestFaction ? factionLink(p.bestFaction) : '—'),
        ]))),
    section('Rating over time',
      note('Everyone starts at 1500. A win takes points from each opponent, more from higher-rated ones; a coalition win is split between the partners. Shown for the most active players.'),
      chartBox),
    section('Latest games', gameList(sortGames(D.games).slice(0, 5)),
      D.games.length > 5 && h('a', { class: 'more', href: '#games' }, `All ${D.games.length} games`)),
  ];
}

function factionsView() {
  const order = D.factionsByRating.map((f) => f.id);
  const players = D.byRating.map((p) => p.name);
  return [
    section('Factions',
      note('Ranked by rating, which treats each faction as a player. Select a faction for its full record.'),
      table(
        [['Faction'], ['Rating', 'num'], ['Played', 'num'], ['Wins', 'num'], ['Win rate', 'num'], ['Vs even odds', 'num']],
        D.factionsByRating.map((f) => [
          h('td', {}, factionLink(f.id)), num(Math.round(D.fRating.get(f.id).rating)), num(f.played), num(f.wins), rateCell(f.winRate),
          deltaCell(f.wins - (D.fExp.get(f.id) ?? 0)),
        ]))),
    section('Faction matchups',
      note('Games where both factions were at the table: wins for the row faction, then wins for the column faction, then games shared. Small counts are anecdotes, not trends.'),
      h('div', { class: 'scroll' },
        h('table', { class: 'matrix' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Faction'), order.map((id) => h('th', { scope: 'col' }, factionLink(id))))),
          h('tbody', {}, order.map((a) =>
            h('tr', {}, h('td', {}, factionLink(a)), order.map((b) => {
              const c = D.fVs[a]?.[b];
              if (!c) return h('td', { class: 'empty' }, '·');
              const theirs = D.fVs[b][a].wins;
              return h('td', { class: c.wins > theirs ? 'won' : '' }, `${c.wins}–${theirs} `, h('small', {}, `/${c.games}`));
            }))))))),
    section('Who wins with what',
      note('Wins / games for each player and faction.'),
      recordGrid(players, FACTION_IDS.filter((id) => order.includes(id)), (p, f) => D.playerFaction[p]?.[f], playerLink, factionLink, 'Player')),
  ];
}

function mapsView() {
  if (!D.mapsPlayed.length) return [section('Maps', note('No game has a map recorded yet.'))];
  const order = D.factionsByRating.map((f) => f.id);
  const unknown = D.games.filter((g) => !g.map).length;
  return [
    section('Maps',
      table(
        [['Map'], ['Games', 'num'], ['Most wins']],
        D.mapsPlayed.map((id) => {
          const wins = order.map((f) => [f, D.factionMap[f]?.[id]?.wins ?? 0]);
          const top = Math.max(0, ...wins.map((w) => w[1]));
          const leaders = wins.filter((w) => top && w[1] === top);
          return [h('td', { class: 'name' }, mapName(id)), num(D.games.filter((g) => g.map === id).length),
            h('td', {}, leaders.length ? [leaders.flatMap((w, i) => [i ? ', ' : '', factionLink(w[0])]), ` (${top} each)`.replace(' each', leaders.length > 1 ? ' each' : '')] : '—')];
        })),
      unknown ? note(`${unknown} ${unknown === 1 ? 'game has' : 'games have'} no map recorded.`) : null),
    section('Factions by map',
      note('Wins / games. With only a handful of games per map, treat these as a tally, not a verdict.'),
      recordGrid(order, D.mapsPlayed, (f, mp) => D.factionMap[f]?.[mp], factionLink, mapName, 'Faction')),
    section('Players by map',
      recordGrid(D.byRating.map((p) => p.name), D.mapsPlayed, (p, mp) => D.playerMap[p]?.[mp], playerLink, mapName, 'Player')),
  ];
}

function gamesView() {
  return [section('All games', gameList(D.games))];
}

function playerView(name) {
  const p = D.stats.players.find((x) => x.name === name);
  const r = D.rating.get(name);
  const rank = D.elo.ratings.findIndex((x) => x.id === name) + 1;
  const mine = D.games.filter((g) => g.players.some((seat) => seat.name === name));
  const chartBox = h('div', { class: 'chart' });
  charts.push(() => drawElo(chartBox, D.elo, [name]));
  const fRows = Object.entries(D.playerFaction[name] ?? {}).sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins);
  const avgWith = (f) => {
    const scores = mine.flatMap((g) => g.players.filter((seat) => seat.name === name && seat.faction === f && typeof seat.score === 'number').map((seat) => seat.score));
    return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
  };
  const rivals = Object.entries(D.pVs[name] ?? {}).sort((a, b) => b[1].games - a[1].games);

  return [
    h('div', { class: 'title-row' },
      h('a', { class: 'crumb', href: '#leaderboard' }, '← Leaderboard'),
      h('h2', {}, name)),
    facts([
      ['Rating', `${Math.round(r.rating)}`], ['Rank', `${rank} of ${D.elo.ratings.length}`], ['Peak rating', `${Math.round(r.peak)}`],
      ['Games', `${p.games}`], ['Wins', `${p.wins}`], ['Win rate', pct(p.winRate)],
      ['Vs even odds', signed(p.wins - (D.pExp.get(name) ?? 0))], ['Avg score', p.avgScore === null ? '—' : p.avgScore.toFixed(1)],
    ]),
    section('Rating', chartBox),
    h('div', { class: 'two-col' },
      section('Factions played',
        table([['Faction'], ['Games', 'num'], ['Wins', 'num'], ['Win rate', 'num'], ['Avg score', 'num']],
          fRows.map(([f, c]) => [h('td', {}, factionLink(f)), num(c.games), num(c.wins), rateCell(rate(c.wins, c.games)), num(avgWith(f))]))),
      section('Maps',
        table([['Map'], ['Games', 'num'], ['Wins', 'num'], ['Win rate', 'num']],
          D.mapsPlayed.filter((mp) => D.playerMap[name]?.[mp]).map((mp) => {
            const c = D.playerMap[name][mp];
            return [h('td', {}, mapName(mp)), num(c.games), num(c.wins), rateCell(rate(c.wins, c.games))];
          })))),
    section('Head to head',
      note(`Games ${name} shared with each opponent, and who won them.`),
      table([['Opponent'], ['Games together', 'num'], [`${name} won`, 'num'], ['They won', 'num']],
        rivals.map(([other, c]) => [h('td', { class: 'name' }, playerLink(other)), num(c.games), num(c.wins), num(D.pVs[other][name].wins)]))),
    section('Games', gameList(mine)),
  ];
}

function factionView(id) {
  const f = D.stats.factions.find((x) => x.id === id);
  const r = D.fRating.get(id);
  const rank = D.fElo.ratings.findIndex((x) => x.id === id) + 1;
  const theirs = D.games.filter((g) => g.players.some((seat) => seat.faction === id));
  const chartBox = h('div', { class: 'chart' });
  charts.push(() => drawElo(chartBox, D.fElo, [id], factionName));
  const pilots = Object.entries(D.factionPlayer[id] ?? {}).sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins);
  const rivals = Object.entries(D.fVs[id] ?? {}).sort((a, b) => b[1].games - a[1].games);

  return [
    h('div', { class: 'title-row' },
      h('a', { class: 'crumb', href: '#factions' }, '← Factions'),
      h('h2', {}, swatch(id), FACTIONS[id]?.name ?? id)),
    facts([
      ['Rating', `${Math.round(r.rating)}`], ['Rank', `${rank} of ${D.fElo.ratings.length}`],
      ['Played', `${f.played}`], ['Wins', `${f.wins}`], ['Win rate', pct(f.winRate)],
      ['Vs even odds', signed(f.wins - (D.fExp.get(id) ?? 0))],
    ]),
    section('Rating', chartBox),
    h('div', { class: 'two-col' },
      section('Played by',
        table([['Player'], ['Games', 'num'], ['Wins', 'num'], ['Win rate', 'num']],
          pilots.map(([name, c]) => [h('td', { class: 'name' }, playerLink(name)), num(c.games), num(c.wins), rateCell(rate(c.wins, c.games))]))),
      section('Maps',
        table([['Map'], ['Games', 'num'], ['Wins', 'num'], ['Win rate', 'num']],
          D.mapsPlayed.filter((mp) => D.factionMap[id]?.[mp]).map((mp) => {
            const c = D.factionMap[id][mp];
            return [h('td', {}, mapName(mp)), num(c.games), num(c.wins), rateCell(rate(c.wins, c.games))];
          })))),
    section('Against other factions',
      note(`Games ${factionName(id)} shared a table with each faction, and who won them.`),
      table([['Faction'], ['Games together', 'num'], [`${factionName(id)} won`, 'num'], ['They won', 'num']],
        rivals.map(([other, c]) => [h('td', {}, factionLink(other)), num(c.games), num(c.wins), num(D.fVs[other][id].wins)]))),
    section('Games', gameList(theirs)),
  ];
}

// ---------- routing ----------
function route() {
  const hash = location.hash.replace(/^#/, '');
  charts = [];
  let nav = 'leaderboard';
  let nodes;
  const player = hash.startsWith('player-') && D.stats.players.find((p) => slug(p.name) === hash.slice(7));
  const faction = hash.startsWith('faction-') && D.stats.factions.find((f) => f.id === hash.slice(8));
  if (player) nodes = playerView(player.name);
  else if (faction) { nodes = factionView(faction.id); nav = 'factions'; }
  else if (hash === 'factions') { nodes = factionsView(); nav = 'factions'; }
  else if (hash === 'maps') { nodes = mapsView(); nav = 'maps'; }
  else if (hash === 'games') { nodes = gamesView(); nav = 'games'; }
  else nodes = leaderboard();

  $('view').replaceChildren(...nodes.flat().filter(Boolean));
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  for (const draw of charts) draw();
}

async function start() {
  try {
    const res = await fetch('data/games.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const games = await res.json();
    D = prepare(games);
    const t = D.stats.totals;
    const dated = games.filter((g) => g.date).map((g) => g.date).sort();
    $('summary').textContent = games.length
      ? `${t.games} games · ${t.players} players` +
        (dated.length ? ` · ${fmt(dated[0])} to ${fmt(dated[dated.length - 1])}` : '') +
        ` · ${t.coalitionWins} coalition ${t.coalitionWins === 1 ? 'win' : 'wins'}, ${t.dominanceWins} dominance wins in ${t.dominanceAttempts} ${t.dominanceAttempts === 1 ? 'attempt' : 'attempts'}`
      : 'No games logged yet. Post a victory screen in the Discord channel and it will appear here within the hour.';
    const notices = [];
    if (games.length && games.every((g) => String(g.id).startsWith('sample-'))) notices.push('Preview built from the 24 sample screenshots. Dates appear once games come in from Discord.');
    if (t.needsReview) notices.push(`${t.needsReview} ${t.needsReview === 1 ? 'game has' : 'games have'} a reading that still needs checking on the admin page.`);
    if (notices.length) { $('notice').hidden = false; $('notice').textContent = notices.join(' '); }

    route();
    window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
    let lastWidth = $('view').clientWidth;
    window.addEventListener('resize', () => {
      if ($('view').clientWidth !== lastWidth) { lastWidth = $('view').clientWidth; for (const draw of charts) draw(); }
    });
  } catch (err) {
    $('summary').textContent = 'Could not load the game data.';
    $('notice').hidden = false;
    $('notice').className = 'notice warn';
    $('notice').textContent = `Loading the game data failed (${err.message}). Reload to try again.`;
  }
}
start();
