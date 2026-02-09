#!/usr/bin/env bun
import { Command } from 'commander';

const program = new Command();

program
  .name('wgs')
  .description('Workout Google Sheets CLI - Sync workouts between Google Sheets and Notion')
  .version('1.0.0');

program
  .command('create-week')
  .description('Create a weekly workout plan in Notion from Google Sheets')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--cell-range <range>', 'Cell range to extract (e.g., B2:E5)')
  .option('--dry-run', 'Output parsed data to file instead of creating Notion page')
  .option('--dump-google-response', 'Dump Google Sheets API response body to file')
  .action(async (options) => {
    const { runCreateWeek } = await import('./commands/create-week.js');
    await runCreateWeek(options);
  });

program
  .command('create-day')
  .description('Create a daily workout entry in Notion from a single Google Sheets cell')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--day <day>', 'Workout day number (1-4 maps to B2-E2)')
  .option('--session-cell <cell>', 'Single cell reference (e.g., B2)')
  .option('--dry-run', 'Skip Notion page creation (use with --output to preview)')
  .option('--output <format>', 'Output format: text (console) or json (file)')
  .action(async (options) => {
    const { runCreateDay } = await import('./commands/create-day.js');
    await runCreateDay(options);
  });

program
  .command('post-workout')
  .description('Post workout content from Notion page to Google Sheets as comments')
  .option('--session-cell <cell>', 'Cell reference (e.g., B2)')
  .option('--notion-page <title>', 'Title of the nested Notion page')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--test', 'Test mode - output content without posting to sheets')
  .action(async (options) => {
    const { runPostWorkout } = await import('./commands/post-workout.js');
    await runPostWorkout(options);
  });

program
  .command('fetch-comments')
  .description('Fetch Google Drive comments from the configured spreadsheet')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--since <window>', 'Time window: <n>h, <n>d, <n>w (default: 24h)', '24h')
  .action(async (options) => {
    const { runFetchComments } = await import('./commands/fetch-comments.js');
    await runFetchComments(options);
  });

program.parse();
