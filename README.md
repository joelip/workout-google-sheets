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

4. Run the application:
```bash
bun run index.ts <owner-email> <sheet-title> <cell-range>
```

Example:
```bash
bun run index.ts user@gmail.com "My Workout Sheet" "B2:E5"
```

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

## Files

- `src/auth.ts` - Google OAuth authentication
- `src/sheets.ts` - Google Sheets API client
- `src/notion.ts` - Notion API client and page creation
- `src/parser.ts` - Workout data parser with section detection
- `index.ts` - Main application entry point
- `config.json` - Notion configuration (create from example)
- `credentials.json` - Google API credentials (create from example)
