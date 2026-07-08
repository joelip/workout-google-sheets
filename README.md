# workout-google-sheets

A TypeScript project using Bun runtime to extract workout data from Google Sheets and create structured Notion pages.

## Setup

1. Install dependencies:
```bash
bun install
```

2. Set up Google API credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable Google Sheets API and Google Drive API
   - Create OAuth 2.0 credentials (Desktop application)
   - Download credentials and save as `credentials.json` in project root

3. Set up Notion integration:
   - Go to [Notion Integrations](https://www.notion.so/my-integrations)
   - Create a new integration and get the token
   - Share your parent page with the integration
   - Copy `config.example.json` to `config.json` and add your token and parent page ID

4. Optional for `post-workout` image rehosting: set up a public Cloudflare R2 bucket behind a custom domain and add the `r2` credentials/settings to `config.json`

5. Run the CLI:
```bash
./wgs --help
```

## CLI Usage

The `wgs` CLI provides commands for syncing workouts between Google Sheets and Notion.

### Check For New Week
Check whether a new week appears to have been added in the sheet:
```bash
./wgs check-for-new-week
./wgs check-for-new-week --json
./wgs check-for-new-week --latest-range B2:E2 --previous-range B3:E3
```

Detection logic:
- Latest range (default `B2:E2`) must contain at least one filled cell
- Previous range (default `B3:E3`) must have fill + note in every cell

### Create Week
Create a weekly workout plan in Notion from a range of cells in Google Sheets:
```bash
./wgs create-week --cell-range B2:E5
./wgs create-week --sheet-owner user@gmail.com --sheet-title "My Workouts" --cell-range B2:E5
./wgs create-week --dry-run  # Output parsed data without creating Notion page
```

### Create Day
Create a single daily workout entry in Notion from one Google Sheets cell:
```bash
./wgs create-day --day 1
./wgs create-day --day 4
./wgs create-day --session-cell B2
./wgs create-day --combine=B2,C3
./wgs create-day --sheet-owner user@gmail.com --sheet-title "My Workouts" --session-cell B2
./wgs create-day --dry-run  # Output parsed data without creating Notion page
```

Use `--combine` to create one Notion page from multiple cells. Cells are fetched and parsed in the order provided, so `--combine=B2,C3` places B2 content first and C3 content immediately after it.

Day mapping for `--day`:
- `1` -> `B2`
- `2` -> `C2`
- `3` -> `D2`
- `4` -> `E2`

### Get Workout
Get a workout page from Notion by date as markdown:
```bash
./wgs get-workout 2026-01-27
./wgs get-workout 1/27/2026
```

The command looks for a nested Notion page with the normalized date title, such as `1/27/2026`, and prints standalone markdown to stdout.

### Get Workouts
Get workout pages from Notion for a date range as markdown:
```bash
./wgs get-workouts --start 2026-01-26 --end 2026-02-01
./wgs get-workouts --week-of 2026-01-27
./wgs get-workouts --month 2026-01
```

The command lists dated nested Notion pages once, filters them by the requested range, sorts them by date, and prints one markdown document. `--week-of` uses a Monday-to-Sunday calendar week.

### Post Workout
Post workout notes from a Notion page back to Google Sheets as cell comments:
```bash
./wgs post-workout --session-cell B2 --notion-page "1/27/2026"
./wgs post-workout --notion-page "1/27/2026" --text
./wgs post-workout --notion-page "1/27/2026" --text --sheets-chunked  # Split output into <= 2048-char chunks
./wgs post-workout --notion-page "1/27/2026" --sheets-chunked --copy  # Copy each raw chunk to clipboard history
```

If the page contains Notion-hosted image blocks and `r2` is configured, `post-workout` uploads those images to your public R2 bucket and inlines `Image: <public-url>` lines in the generated text.

### Global Options
The `--sheet-owner` and `--sheet-title` options can be set as defaults in `config.json` to avoid repeating them.

## Features

- OAuth authentication with Google Sheets API
- Secure token storage (ignored by git)
- Search sheets by owner email and title
- Extract and parse workout data from cell ranges
- Automatic parsing of workout sections (A., B2., etc.)
- Create structured Notion pages with bullet points
- Embed YouTube videos found in workout data
- Built with TypeScript and Bun runtime

## Data Format

The parser expects workout data in this format:
```
A. Warm-up
5 minutes light cardio
Dynamic stretching
https://youtube.com/watch?v=example

B1. Upper Body
Push-ups: 3 sets of 10
Pull-ups: 3 sets of 5

B2. Lower Body
Squats: 3 sets of 15
Lunges: 3 sets of 10 each leg
```

## Rep Max (RM) Resolution

The CLI can automatically resolve percentage-based weight references to actual weights based on your stored rep maxes.

### Configuration

Add a `repMaxes` array to your `config.json`:

```json
{
  "repMaxes": [
    { "exercise": "squat", "weight": 315, "aliases": ["back squat", "barbell squat"] },
    { "exercise": "bench press", "weight": 225, "aliases": ["bench"] },
    { "exercise": "deadlift", "weight": 405 }
  ],
  "defaultUnit": "lbs"
}
```

### Supported Patterns

The resolver recognizes these percentage patterns:

- `@75% 1RM` / `@75%1RM` / `@ 75% 1RM` - Uses exercise from section context
- `@80% squat` / `@75% bench press` - Explicit exercise name
- `75% of 1RM` - Uses exercise from section context
- `80% of squat` - Explicit exercise name

### Example

Before (in Google Sheets):
```
C. Back Squat: 4 x 6 @ 80% 1RM, rest 2 min
```

After (in Notion):
```
C. Back Squat: 4 x 6 @ 80% 1RM (252 lbs), rest 2 min
```

The resolver:
1. Extracts the exercise name from the section header ("Back Squat")
2. Matches it against your `repMaxes` config (finds "squat" with aliases)
3. Calculates 80% of 315 lbs = 252 lbs
4. Appends the calculated weight in parentheses (preserving the original percentage)

### Matching Logic

- Exact matches are preferred over partial matches
- Longer matches are preferred (e.g., "clean grip rdl" > "rdl" > "dl")
- Aliases are checked alongside canonical exercise names
- If no match is found, the original text is preserved

## Files

- `wgs` - CLI entry point (run from repo root)
- `src/cli.ts` - CLI command definitions
- `src/commands/` - Individual command implementations
- `src/auth.ts` - Google OAuth authentication
- `src/sheets.ts` - Google Sheets API client
- `src/notion.ts` - Notion API client and page creation
- `src/parser.ts` - Workout data parser with section detection
- `src/rm-resolver.ts` - Rep max percentage resolution
- `config.json` - Notion configuration (create from example)
- `credentials.json` - Google API credentials (create from example)
