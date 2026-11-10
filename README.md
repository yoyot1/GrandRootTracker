# Root League Ledger

Turns victory screenshots posted in a Discord channel into a stats dashboard.

- A scheduled GitHub Action reads new messages in the channel twice an hour.
- Each image goes to Claude, which reads the players, factions, scores and winner.
- Results are committed to `docs/data/games.json`; GitHub Pages serves the dashboard from `docs/`.
- `admin.html` lets you correct any game and manage player names.

Running cost: GitHub Actions and Pages are free for a public repository. Claude costs roughly a cent per screenshot.

## Setup (about 15 minutes)

### 1. Repository

Create a **public** GitHub repository and push this folder to its `main` branch. (Pages on a private repository needs a paid GitHub plan.)

### 2. Discord bot

1. Go to <https://discord.com/developers/applications> and create a New Application.
2. Open **Bot**, turn on **Message Content Intent**, and copy the bot token.
3. Open **OAuth2 → URL Generator**, tick the `bot` scope and the permissions **View Channels**, **Read Message History** and **Send Messages**. Open the generated URL and add the bot to your server.
4. In Discord, turn on **Settings → Advanced → Developer Mode**. Right-click the results channel and choose Copy Channel ID; right-click the server icon and choose Copy Server ID.

### 3. Claude API key

Create a key at <https://console.anthropic.com> and add a few dollars of credit.

### 4. Repository settings

Under **Settings → Secrets and variables → Actions**:

| Name | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | the bot token (must be a secret) |
| `ANTHROPIC_API_KEY` | the Claude key (must be a secret) |
| `DISCORD_CHANNEL_ID` | the channel ID |
| `DISCORD_GUILD_ID` | the server ID (used for "open in Discord" links) |
| `DASHBOARD_URL` | `https://<you>.github.io/<repo>/` |
| `DISCORD_REPLY` | `false` for the first run (see below) |
| `SAVE_IMAGES` | optional; set to `false` to stop keeping screenshots |
| `ANTHROPIC_MODEL` | optional; defaults to `claude-sonnet-5-5` |

The two keys must be **secrets**. The rest can be secrets or variables; the workflow accepts either. Variables are easier to live with because you can read them back and edit them later, whereas a secret can only be replaced.

**What `DISCORD_REPLY` does:** when it is unset or `true`, the bot posts a short reply under each screenshot it logs ("Logged: 🏆 yoyot1 (Vagabond) 33 · ..."), so players can see straight away if something was misread. Set it to `false` and the bot stays silent and only updates the dashboard.

**Keeping the Claude key safe:** it lives only in GitHub's encrypted secret store, never in the repository. GitHub hands it to the workflow at run time, masks it in logs, and withholds it from pull requests coming from forks. The script sends it to `api.anthropic.com` and nowhere else. Anyone you give write access to the repository could change the workflow to leak it, so keep collaborators to people you trust, and set a monthly spend limit in the Anthropic Console as a backstop.

Under **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/docs`.

### 5. Backfill

Open **Actions → Ingest victory screens → Run workflow**. The first run reads the channel's whole history, 40 images per run; run it again until the log says nothing is left.

Keep `DISCORD_REPLY` set to `false` during the backfill, otherwise the bot replies to every old screenshot. Afterwards delete the variable (or set it to `true`) so each new game gets a reply showing what was read.

### 6. Admin page

Create a fine-grained personal access token at <https://github.com/settings/personal-access-tokens> limited to this repository with **Contents: Read and write**. Open `admin.html` on the Pages site, paste the token, and load the games. The token is stored only in that browser.

## Saved screenshots

Each victory screen is saved to `docs/img/` (other images posted in the channel are not). The copy is a reduced version, about 1600 pixels wide and typically a few hundred kilobytes, so a few hundred games fit comfortably within GitHub's limits. The game log links to it, and the admin page shows it beside the fields you are editing. Deleting a game on the admin page leaves its image file in the repository; remove it by hand if you want it gone.

Because the repository is public, saved screenshots are public too.

## How readings are checked

A game is marked "needs checking" (shown first on the admin page, and noted in the bot's reply) when:

- a player name is not on the roster (it is added automatically, pending your confirmation);
- a faction was a low-confidence read (Eyrie/Keepers and Duchy/Marquise share similar banner colours);
- the winner's faction does not match the banner text, there is no winner, or two players share a faction;
- it looks like a repost of a game logged within the last day.

The game font draws `1` and `l` the same, so names are matched to the roster with those characters treated as equal. To teach it a new spelling, add an alias on the admin page.

## The dashboard

One page with several views; each has its own link you can share.

- **Leaderboard:** players ranked by rating, the rating chart, and the latest games.
- **Player view:** select any player name for their rating history, record by faction and map, head-to-head against each opponent, and their games.
- **Faction view:** select any faction for its rating history, who plays it, record by map and against each other faction, and its games.
- **Factions, Maps, Games:** the combined tables, matchup grid, map records and full game log.

The map (Autumn, Winter, Lake or Mountain) is read from the scenery behind the characters. An unclear read is flagged for checking, and the map can be corrected on the admin page.

## How the numbers are worked out

- **Rating:** Elo, starting at 1500 with K = 32. The winner is scored as beating each other player, gaining more from higher-rated opponents; losers do not trade points with each other. A coalition win splits the gain between the two partners. Factions get a rating the same way, treating each faction as a player.
- **Vs even odds:** wins minus the wins you would expect if every seat had the same chance (a quarter of a win per four-player game).
- **Faction matchups:** for each pair of factions, the games where both were at the table and how many each won.

Ratings depend on game order, which comes from the Discord message time.

## Things to know

- GitHub runs scheduled workflows late when it is busy, so a game can take up to an hour to appear. Use **Run workflow** for an immediate update.
- GitHub pauses scheduled workflows after 60 days without a commit to the repository. Any logged game counts as a commit; if the group takes a long break, re-enable the workflow from the Actions tab.
- Images that fail three times (deleted, unreadable) are skipped and listed under `failures` in `docs/data/state.json`.
- Coalition wins count as a win for both partners.

## Development

```
npm test          # unit tests plus an end-to-end ingest run against fake Discord and Claude
npm run ingest    # needs the environment variables from step 4
```

No dependencies; Node 20 or newer.
