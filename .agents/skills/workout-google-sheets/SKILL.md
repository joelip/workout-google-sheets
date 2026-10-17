---
name: workout-google-sheets
description: "Monitor the Joe Lipper workout Google spreadsheet, Notion pages, and Gmail workflow: detect new weekly plans, require explicit emailed approval before creating a Notion week, create daily pages, resolve supported references to earlier workouts through a local history index, and answer clear inbound workout questions without duplicate replies. Use for recurring workout-sheet checks, earlier-workout reference requests, workout-inbox monitoring, new-week confirmations, create-day requests, and factual workout-plan or workout-result inquiries involving the workout-google-sheets repository."
---

# Workout Google Sheets

Use the repository CLI as the source of truth. Keep monitoring read-only until an explicit email authorizes a creation.

## Fixed setup

- Repository: locate the checkout named `workout-google-sheets`; on Joe's machine prefer `/Users/joelipper/Development/workout-google-sheets` because its ignored local files are configured.
- Spreadsheet: owner `kyle.habdo@trainingthinktank.com`, Drive title `Joe Lipper`, first tab `Client Sheet 2026`.
- Sheet link: `https://docs.google.com/spreadsheets/d/1JD6sMMDHWDia8pKUHIgQu0Ca7oSqT3TrmO32AMqWXeQ/edit`.
- Watch range: `'Client Sheet 2026'!B2:E2`; validation range: `'Client Sheet 2026'!B3:E3`.
- Gmail account: use the connected account named `Joe's Open Claw`. Send self-mail with `to: "me"`.
- State: default to `~/.codex/state/workout-google-sheets/workflow.json` and use `scripts/workflow_state.py` for every transition.
- Workout history index: default to `~/.codex/state/workout-google-sheets/history.sqlite`; reconcile this local mirror with the shared Cloudflare D1 history using the repository CLI before historical lookups. Keep the D1 token in `CLOUDFLARE_API_TOKEN` and never print it.

Run CLI commands from the configured repository root. `config.json`, `credentials.json`, and `token.json` are cwd-relative and gitignored. Google OAuth is read-only for Sheets plus Drive metadata; `config.json` also holds the Notion token, parent page, defaults, and current week number. Never print secrets.

## Daily new-week check

1. Run the repository's read-only heuristic:

   ```bash
   ./wgs check-for-new-week --latest-range "'Client Sheet 2026'!B2:E2" --previous-range "'Client Sheet 2026'!B3:E3" --json
   ```

2. Capture the actual watched cells with the existing read command:

   ```bash
   ./wgs get-workouts plans --cell-range "'Client Sheet 2026'!B2:E2"
   ```

3. Pipe only the rendered output beginning with `# Workout Plans:` (or the `No workout plans` line) to:

   ```bash
   python3 <skill-dir>/scripts/workflow_state.py observe-week --state ~/.codex/state/workout-google-sheets/workflow.json --sheet-id 1JD6sMMDHWDia8pKUHIgQu0Ca7oSqT3TrmO32AMqWXeQ --range "'Client Sheet 2026'!B2:E2"
   ```

   Treat the first observation as a baseline and do not email it. The repository heuristic alone is not an event cursor: it can remain true indefinitely. Notify only when the state tool returns `notify`; do not notify for `unchanged`, `awaiting-confirmation`, or `needs-review`.

4. Before sending, search Sent Mail in `Joe's Open Claw` for the exact marker returned by the state tool. If found, record the email transition without resending. Otherwise send to `me` with subject `New workout week ready [<marker>]`. Include the sheet link, say that new content appeared on `Client Sheet 2026`, and ask for an explicit reply such as `Yes, create the new week.` Do not interpret silence, a vague acknowledgment, or a new unrelated email as approval.
5. After a successful send, run `record-week-email --hash <hash>`. If sending fails, leave the phase pending so a later run can retry after first checking Sent Mail.

## Email confirmation and week creation

Search the notification thread identified by its exact marker. Require an unambiguous affirmative reply from the user that refers to creating that week. Reject or ask for clarification on ambiguous replies.

Before creation, atomically claim the operation:

```bash
python3 <skill-dir>/scripts/workflow_state.py claim-week --state ~/.codex/state/workout-google-sheets/workflow.json --hash <hash> --confirmation-key <reply-message-id>
```

Run the following only when the claim returns `claimed: true`:

```bash
./wgs create-week --cell-range "'Client Sheet 2026'!B2:E2"
```

This creates a Notion week and increments `data.currentWeekNumber`; it does not create a Google Sheet tab. On success run `complete-week --hash <hash>`. On failure run `fail-week --hash <hash> --reason <concise-reason>` and request manual review. Never automatically retry a failed or interrupted `creating` phase because the remote Notion write may already have succeeded.

## Emailed single-day request

Act only on an explicit request in `Joe's Open Claw` that identifies exactly one day from 1 through 4. The repository mapping is 1=`B2`, 2=`C2`, 3=`D2`, 4=`E2` on the first tab. If the day is missing, out of range, multiple, or ambiguous, ask for clarification and do not run the CLI.

Claim the Gmail message before creating:

```bash
python3 <skill-dir>/scripts/workflow_state.py claim-day --state ~/.codex/state/workout-google-sheets/workflow.json --request-key <message-id> --day <1-4>
```

Run `./wgs create-day --day <1-4>` only when `claimed: true`, then run `complete-day --request-key <message-id>`. On failure run `fail-day --request-key <message-id> --reason <concise-reason>` and do not retry automatically. Reply with the resulting Notion URL only after success.

If the request also explicitly asks to fill references to earlier workouts, create the day first, then follow the history-index preview and guarded apply workflow below. Do not claim that unsupported references were filled.

## Resolve references to earlier workouts

### Default scope and presentation of previous results

When asked to add previous results to a workout, cover movements involving weight/resistance or pace, not just cardio. Omit rep-only plyometrics unless explicitly requested.

- Include only previous weight/resistance or pace, recorded effort (such as RPE), volume (sets, reps, duration, or distance), and date performed. Use verified results for the matching movement; retain differences in volume so the prior performance is not mistaken for today's prescription.
- Omit narrative notes (technique, pain, fatigue, movement quality, and other commentary) unless explicitly requested. Do not translate narrative comments into an invented effort rating. Omit unrecorded fields rather than adding explanatory filler.
- Put each previous-result entry in a separate Notion bulleted-list block on a new line immediately below its movement. Never append it inline or as unbulleted text inside the movement's paragraph. Apply this format to narrative notes too when explicitly requested.
- Start the bullet with `Previous:` and do not wrap the entry in parentheses. Update an existing previous-result bullet when present to avoid duplicates.
- Example: `Previous: 105/115/125/125 lb; 4 × 8 reps on 8/28/2026.` Include effort when recorded, for example `RPE 8/10`.

These defaults govern historical annotations; explicit pace-target calculations may remain in the current workout instruction. Check that the reviewed update supports the requested scope and bullet formatting before applying it; do not silently substitute the cardio-only inline resolver for a broader previous-results update.

Use the repository commands rather than direct Notion API scripts. Before historical lookups, hydrate and reconcile the local mirror with D1:

```bash
./wgs history cloud sync --json
```

When refreshing from Notion, refresh the local index and then reconcile with D1 again:

```bash
./wgs history sync --json
./wgs history cloud sync --json
```

D1 shares cached workout content across computers; cloud reconciliation does not fetch fresh content from Notion. Keep `workflow.json` local. Stop on D1 conflicts and inspect them before continuing.

The sync lists dated pages once, keeps a newest-first rolling window of 48 workouts (12 weeks at four sessions per week), and fetches content only for new or changed pages. A second unchanged sync should fetch zero pages. Increase `--limit` only when the user explicitly needs a source beyond the 12-week retesting bound. Do not overload `workflow.json` with workout content; the SQLite history index is the content cache, while `workflow.json` remains the idempotency state for email and creation operations.

Preview reference resolution from the cache:

```bash
./wgs resolve-references --date today --json
./wgs resolve-references --date 2026-08-28 --json
```

Resolution is read-only by default. Review every exact replacement, source page, source text, confidence, unresolved item, and plan hash. The current production rule resolves Bike Erg, Row, and Ski Erg instructions from the latest preceding seven-minute pace for that modality. Treat unsupported or unresolved references as intentional; never guess or bypass them with a custom write.

Apply only when the user clearly asked to update that page, using the exact hash from the reviewed dry run:

```bash
./wgs resolve-references --date today --apply --plan-hash <reviewed-hash>
```

Apply mode rechecks the live page edit time and every target block before writing, then reads the page back to verify the result. If it reports a concurrent change, partial update, or unverifiable result, inspect the Notion page and do not retry automatically.

## Frequent workout inquiry monitor

Search recent `INBOX` mail in `Joe's Open Claw`, excluding Sent, Spam, Trash, bulk mail, and automated notifications. Read the full message and its thread when context affects meaning. Classify each inbound message into exactly one route:

1. Use the week-confirmation route for an explicit reply to a marked new-week notification.
2. Use the create-day route for an explicit request to create one day numbered 1 through 4.
3. Use this inquiry route only for a clear question about Joe's workout plans, completed workout results, sheet content, or this connected workout workflow.
4. Leave unrelated mail untouched and unanswered.

Answer only from verified read-only sources: the email thread, the sheet link, and existing `get-workout plan`, `get-workouts plans`, `get-workout result`, or `get-workouts results` commands. Require the exact day, cell, date, week, or date range needed by the chosen command. Do not guess missing facts or present stale content as current.

For a clear, factual, in-scope question, prepare a short direct answer. For a workout-related but vague or ambiguous question, send one concise same-thread clarification asking only for the missing detail. For pain, injury, diagnosis, treatment, exercise safety, nutrition, personal coaching judgment, or any other medical/personal judgment, do not answer substantively; say this monitor cannot make that judgment and ask whether the sender instead wants factual plan or logged-result information. Do not reply at all to unrelated messages.

Before sending either an answer or clarification, claim the incoming Gmail message ID:

```bash
python3 <skill-dir>/scripts/workflow_state.py claim-inquiry --state ~/.codex/state/workout-google-sheets/workflow.json --message-key <message-id> --kind <answer|clarification>
```

Send only when `claimed: true`. Reply in the existing thread using the exact incoming message as reply context, preserve recipients, and include the returned marker once at the end: `[<marker>]`. After a successful reply, run `complete-inquiry --message-key <message-id>`. If sending fails, run `fail-inquiry --message-key <message-id> --reason <concise-reason>` and do not retry automatically.

When a later run receives `claimed: false`, never send again. If its phase is `replying`, search that exact thread for the marker: complete the state if the prior reply exists; otherwise stop for manual review because an interrupted send has an uncertain outcome. Treat `answered` and `failed` as terminal.

## Safety

- Never run `create-week` without explicit approval in the matching notification thread.
- Never run `create-day` without a clear email request for one supported day.
- Never apply earlier-workout reference changes without a reviewed preview and matching plan hash.
- Never answer an inquiry outside the strict workout scope or provide medical, safety, nutrition, or personal coaching judgment.
- Never reply to the same inbound Gmail message more than once; claim first and reconcile interrupted sends by marker.
- Never use `--dry-run` as an idempotency check: it writes a repository output file and does not prove a remote page is absent.
- Do not use `post-workout`; it writes comments to Google Sheets and is outside this workflow.
- Stop for manual review on state mismatch, concurrent content changes, an interrupted creation, or uncertain Gmail identity/thread matching.
