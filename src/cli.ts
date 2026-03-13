#!/usr/bin/env bun
import { Command } from 'commander';
import { CommandError, formatUnknownError } from './command-runtime';

const program = new Command();

function withCommandErrorHandling<TOptions>(
  handler: (options: TOptions) => Promise<void>
): (options: TOptions) => Promise<void> {
  return async (options: TOptions): Promise<void> => {
    try {
      await handler(options);
    } catch (error) {
      if (error instanceof CommandError) {
        console.error(error.message);
        process.exitCode = error.exitCode;
        return;
      }

      console.error(`Error: ${formatUnknownError(error)}`);
      process.exitCode = 1;
    }
  };
}

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
  .action(withCommandErrorHandling(async (options) => {
    const { runCreateWeek } = await import('./commands/create-week.js');
    await runCreateWeek(options);
  }));

program
  .command('check-for-new-week')
  .description('Check if a new week appears to have been added in Google Sheets')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--latest-range <range>', 'Range for latest week check (default: B2:E2)')
  .option('--previous-range <range>', 'Range for previous week validation (default: B3:E3)')
  .option('--json', 'Output machine-readable JSON')
  .action(withCommandErrorHandling(async (options) => {
    const { runCheckForNewWeek } = await import('./commands/check-for-new-week.js');
    await runCheckForNewWeek(options);
  }));

program
  .command('create-day')
  .description('Create a daily workout entry in Notion from a single Google Sheets cell')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--day <day>', 'Workout day number (1-4 maps to B2-E2)')
  .option('--session-cell <cell>', 'Single cell reference (e.g., B2)')
  .option('--dry-run', 'Skip Notion page creation (use with --output to preview)')
  .option('--output <format>', 'Output format: text (console) or json (file)')
  .action(withCommandErrorHandling(async (options) => {
    const { runCreateDay } = await import('./commands/create-day.js');
    await runCreateDay(options);
  }));

program
  .command('post-workout')
  .description('Post workout content from Notion page to Google Sheets as comments')
  .option('--session-cell <cell>', 'Cell reference (required unless --text or --sheets-chunked)')
  .option('--notion-page <title>', 'Title of the nested Notion page')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--text', 'Text mode - output content without posting to sheets')
  .option('--sheets-chunked', 'Split text-mode console output into Sheets-safe chunks (<= 2048 chars)')
  .action(withCommandErrorHandling(async (options) => {
    const { runPostWorkout } = await import('./commands/post-workout.js');
    await runPostWorkout(options);
  }));

await program.parseAsync();
