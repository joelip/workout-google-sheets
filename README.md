# workout-google-sheets

A TypeScript project using Bun runtime to authenticate with Google Sheets API and extract cell data.

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

3. Run the application:
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
- Extract data from specified cell ranges
- Built with TypeScript and Bun runtime

## Files

- `src/auth.ts` - Google OAuth authentication
- `src/sheets.ts` - Google Sheets API client
- `index.ts` - Main application entry point
- `credentials.json` - Google API credentials (create from example)
- `token.json` - OAuth tokens (auto-generated)
