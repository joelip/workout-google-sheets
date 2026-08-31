# D1 workout history sync

Cloudflare D1 is the shared source for the rolling workout-content cache. Each computer keeps a disposable local SQLite mirror at `~/.codex/state/workout-google-sheets/history.sqlite`. The SQLite file and its WAL files are never copied between computers.

## First-time setup

Create a Cloudflare API token with `D1 Write` access for the account. Keep the token out of `config.json` and export it in the shell:

```bash
export CLOUDFLARE_API_TOKEN="..."
```

The setup script installs dependencies, creates `config.json` if needed, creates a Western North America D1 database when no database ID is configured, initializes its schema, uploads the current local cache, and stores the token in the gitignored local `.env` file with mode `0600`:

```bash
./scripts/setup.sh --with-d1
```

The script uses `d1.accountId`, then `r2.accountId`, or `CLOUDFLARE_ACCOUNT_ID`. It saves the non-secret D1 database ID under `d1.databaseId` in the ignored `config.json`. `CLOUDFLARE_D1_DATABASE_ID` can override that value. The tracked SQL schema is in `migrations/0001_workout_history.sql`; normal CLI syncs also initialize the schema idempotently. Do not commit `.env`; it is already ignored. On another computer, create a separate D1-only token or transfer this token through a secure secret manager, then run the setup script there.

Before the first upload from the computer that already has Notion history, refresh that local cache:

```bash
./wgs history sync --json
./wgs history cloud sync --json
```

## Normal sync

Run this before reading historical references on any computer:

```bash
./wgs history cloud sync --json
```

On the computer refreshing from Notion, run both commands so newly edited workouts reach D1:

```bash
./wgs history sync --json
./wgs history cloud sync --json
```

Sync is bidirectional. For a page present on both sides, the record with the later Notion `last_edited_time` wins. An identical edit time with a different content hash is treated as a conflict and nothing is written. The merged cache is sorted newest first and D1 prunes by its current newest-first ordering after the upsert, so concurrent clients cannot make a stale ID list delete a newer page. Both copies retain 48 workouts, matching the 12-week/four-session history boundary.

## New computer

1. Clone the repository and run `./scripts/setup.sh`.
2. Copy the ignored Google/Notion credential files through your normal secure channel.
3. Add the existing non-secret `d1.accountId` and `d1.databaseId` values to `config.json`, or export their environment-variable equivalents.
4. Export `CLOUDFLARE_API_TOKEN` and run `bun scripts/setup-workout-state.ts --persist-token`; this stores it only in that checkout's ignored `.env`.
5. Run `./wgs history cloud sync --json`. With an empty local cache, this downloads the current D1 history.

Do not run `history sync` first on a new computer unless its Notion credentials are ready; `history cloud sync` alone is sufficient to hydrate the local history mirror.
