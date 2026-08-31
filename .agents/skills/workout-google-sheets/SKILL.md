---
name: workout-google-sheets
description: "Monitor the Joe Lipper workout Google spreadsheet, Notion pages, and Gmail workflow: detect new weekly plans, require explicit emailed approval before creating a Notion week, create daily pages, resolve supported references to earlier workouts through a shared D1-backed history index, and answer clear inbound workout questions without duplicate replies. Use for recurring workout-sheet checks, earlier-workout reference requests, workout-inbox monitoring, new-week confirmations, create-day requests, and factual workout-plan or workout-result inquiries involving the workout-google-sheets repository."
---

# Workout Google Sheets

Use the repository CLI as the source of truth. Keep monitoring read-only until an explicit email authorizes a creation.

## Fixed setup

- Repository: locate the checkout named `workout-google-sheets`; on Joe's machine prefer `/Users/joelipper/Development/workout-google-sheets` because its ignored local files are configured.
- Spreadsheet: owner `kyle.habdo@trainingthinktank.com`, Drive title `Joe Lipper`, first tab `Client Sheet 2026`.
- Sheet link: `https://docs.google.com/spreadsheets/d/1JD6sMMDHWDia8pKUHIgQu0Ca7oSqT3TrmO32AMqWXeQ/edit`.
- Watch range: `'Client Sheet 2026'!B2:E2`; validation range: `'Client Sheet 2026'!B3:E3`.
- Gmail account: use the connected account named `Joe's Open Claw`. Send self-mail with `to: "me"`.
- Workflow state: `~/.codex/state/workout-google-sheets/workflow.json`; use `bun <skill-dir>/scripts/workflow-state.ts` for every transition.
- History mirror: `~/.codex/state/workout-google-sheets/history.sqlite`; reconcile with D1 before historical lookups.

Run commands from the repository root. `config.json`, `credentials.json`, and `token.json` are cwd-relative and gitignored. Keep the D1 token in `CLOUDFLARE_API_TOKEN`. Never print secrets.

## Daily new-week check

1. Run the read-only heuristic and then capture the watched cells:

   ```bash
   ./wgs check-for-new-week --latest-range "'Client Sheet 2026'!B2:E2" --previous-range "'Client Sheet 2026'!B3:E3" --json
   ./wgs get-workouts plans --cell-range "'Client Sheet 2026'!B2:E2"
   ```

2. Pipe only the rendered plan output to:

   ```bash
   bun <skill-dir>/scripts/workflow-state.ts observe-week --state ~/.codex/state/workout-google-sheets/workflow.json --sheet-id 1JD6sMMDHWDia8pKUHIgQu0Ca7oSqT3TrmO32AMqWXeQ --range "'Client Sheet 2026'!B2:E2"
   ```

3. Treat the first observation as a baseline. Notify only for `notify`. Search Sent Mail for the returned marker before sending. Otherwise self-email with subject `New workout week ready [<marker>]`, the sheet link, and a request for explicit approval. Then run `record-week-email --hash <hash>`.

## Week and day creation

Require unambiguous approval in the marked thread. Claim before creating:

```bash
bun <skill-dir>/scripts/workflow-state.ts claim-week --state ~/.codex/state/workout-google-sheets/workflow.json --hash <hash> --confirmation-key <reply-message-id>
./wgs create-week --cell-range "'Client Sheet 2026'!B2:E2"
```

Run the CLI only when `claimed: true`. Complete with `complete-week`; on failure use `fail-week` and never automatically retry an interrupted creation.

For a single-day request, require exactly one day from 1 through 4 (1=`B2`, 2=`C2`, 3=`D2`, 4=`E2`):

```bash
bun <skill-dir>/scripts/workflow-state.ts claim-day --state ~/.codex/state/workout-google-sheets/workflow.json --request-key <message-id> --day <1-4>
./wgs create-day --day <1-4>
```

Run only when claimed. Then use `complete-day`; on failure use `fail-day` and do not retry automatically.

## Resolve references to earlier workouts

Before every lookup, hydrate and reconcile the local mirror:

```bash
./wgs history cloud sync --json
```

When this computer is responsible for refreshing from Notion, run:

```bash
./wgs history sync --json
./wgs history cloud sync --json
```

The index retains 48 workouts: 12 weeks at four sessions per week. Increase `--limit` only for an explicitly requested source beyond that retesting bound. D1 contains workout content; `workflow.json` remains local idempotency state.

Preview references from the mirror:

```bash
./wgs resolve-references --date today --json
```

Review every replacement, source page, source text, confidence, unresolved item, and plan hash. The supported rule resolves Bike Erg, Row, and Ski Erg instructions from the latest preceding seven-minute pace. Never guess unsupported references.

Apply only after clear user authorization, with the reviewed hash:

```bash
./wgs resolve-references --date today --apply --plan-hash <reviewed-hash>
```

Stop on concurrent changes, partial updates, unverifiable results, or D1 conflicts.

## Workout inquiry monitor

Search recent `INBOX` mail in `Joe's Open Claw`, excluding Sent, Spam, Trash, bulk mail, and automated notifications. Route marked week confirmations and exact day requests to those workflows. Answer only clear factual workout questions using the email thread, sheet, and existing read commands. Ask one clarification when the exact day, cell, date, week, or range is missing. Do not provide medical, safety, nutrition, or personal coaching judgment.

Claim before replying:

```bash
bun <skill-dir>/scripts/workflow-state.ts claim-inquiry --state ~/.codex/state/workout-google-sheets/workflow.json --message-key <message-id> --kind <answer|clarification>
```

Send only when claimed, in the same thread, with the returned marker once at the end. Complete with `complete-inquiry`; on failure use `fail-inquiry` and do not retry automatically. Reconcile an interrupted reply by searching the thread for its marker.

## Safety

- Never create a week or day without matching explicit authorization.
- Never apply historical values without a reviewed preview and matching plan hash.
- Never answer outside the strict factual workout scope or send duplicate replies.
- Never use `--dry-run` as an idempotency check; it writes a repository file.
- Do not use `post-workout`; it writes Google Sheets comments and is outside this workflow.
- Stop for manual review on state mismatch, sync conflict, concurrent changes, interrupted creation, or uncertain Gmail identity/thread matching.
