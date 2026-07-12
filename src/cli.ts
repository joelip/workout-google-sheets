#!/usr/bin/env bun
import { Command } from 'commander';
import { CommandError, fail, formatUnknownError } from './command-runtime';

const program = new Command();

interface GetWorkoutCliOptions {
  sheetOwner?: string;
  sheetTitle?: string;
  day?: string;
  sessionCell?: string;
  combine?: string;
}

interface GetWorkoutsCliOptions {
  start?: string;
  end?: string;
  weekOf?: string;
  month?: string;
  sheetOwner?: string;
  sheetTitle?: string;
  cellRange?: string;
}

function hasGetWorkoutPlanOptions(options: GetWorkoutCliOptions): boolean {
  return Boolean(
    options.sheetOwner
    || options.sheetTitle
    || options.day
    || options.sessionCell
    || options.combine
  );
}

function hasGetWorkoutsPlanOptions(options: GetWorkoutsCliOptions): boolean {
  return Boolean(
    options.sheetOwner
    || options.sheetTitle
    || options.cellRange
  );
}

function withCommandErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<void>
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs): Promise<void> => {
    try {
      await handler(...args);
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
  .description('Create a daily workout entry in Notion from one or more Google Sheets cells')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--day <day>', 'Workout day number (1-4 maps to B2-E2)')
  .option('--session-cell <cell>', 'Single cell reference (e.g., B2)')
  .option('--combine <cells>', 'Comma-separated cells to combine in order (e.g., B2,C3)')
  .option('--dry-run', 'Skip Notion page creation (use with --output to preview)')
  .option('--output <format>', 'Output format: text (console) or json (file)')
  .action(withCommandErrorHandling(async (options) => {
    const { runCreateDay } = await import('./commands/create-day.js');
    await runCreateDay(options);
  }));

program
  .command('get-workout')
  .description('Get a workout result from Notion or plan from Google Sheets')
  .argument('[target]', 'result, plan, or a legacy result date')
  .argument('[date]', 'Workout result date (YYYY-MM-DD or M/D/YYYY)')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--day <day>', 'Workout day number (1-4 maps to B2-E2)')
  .option('--session-cell <cell>', 'Single cell reference (e.g., B2)')
  .option('--combine <cells>', 'Comma-separated cells to combine in order (e.g., B2,C3)')
  .action(withCommandErrorHandling(async (
    target: string | undefined,
    date: string | undefined,
    options: GetWorkoutCliOptions
  ) => {
    if (target === 'plan') {
      if (date) {
        fail('get-workout plan does not accept a date argument. Use --day, --session-cell, or --combine.');
      }

      const { runGetWorkoutPlan } = await import('./commands/get-workout-plan.js');
      await runGetWorkoutPlan(options);
      return;
    }

    if (target === 'result') {
      if (hasGetWorkoutPlanOptions(options)) {
        fail('Google Sheets plan options require: get-workout plan <options>.');
      }

      if (!date) {
        fail('Missing workout result date. Use: get-workout result <date>');
      }

      const { runGetWorkout } = await import('./commands/get-workout.js');
      await runGetWorkout(date);
      return;
    }

    if (!target) {
      fail('Missing target. Use: get-workout result <date>, get-workout <date>, or get-workout plan <options>.');
    }

    if (date) {
      fail('Use: get-workout result <date>, get-workout <date>, or get-workout plan <options>.');
    }

    if (hasGetWorkoutPlanOptions(options)) {
      fail('Google Sheets plan options require: get-workout plan <options>.');
    }

    const { runGetWorkout } = await import('./commands/get-workout.js');
    await runGetWorkout(target);
  }));

program
  .command('get-workouts')
  .description('Get workout results from Notion or plans from Google Sheets')
  .argument('[target]', 'results, plans, or omitted for legacy results mode')
  .option('--start <date>', 'Start date (YYYY-MM-DD or M/D/YYYY)')
  .option('--end <date>', 'End date (YYYY-MM-DD or M/D/YYYY)')
  .option('--week-of <date>', 'Calendar week containing this date')
  .option('--month <month>', 'Month in YYYY-MM format')
  .option('--sheet-owner <email>', 'Google Sheets owner email')
  .option('--sheet-title <title>', 'Google Sheets document title')
  .option('--cell-range <range>', 'Cell range to extract (e.g., B2:E5)')
  .action(withCommandErrorHandling(async (
    target: string | undefined,
    options: GetWorkoutsCliOptions
  ) => {
    if (target === 'plans') {
      const { runGetWorkoutPlans } = await import('./commands/get-workout-plan.js');
      await runGetWorkoutPlans(options);
      return;
    }

    if (target && target !== 'results') {
      fail('Unknown get-workouts target. Use: get-workouts results <options> or get-workouts plans <options>.');
    }

    if (hasGetWorkoutsPlanOptions(options)) {
      fail('Google Sheets plan options require: get-workouts plans <options>.');
    }

    const { runGetWorkouts } = await import('./commands/get-workouts.js');
    await runGetWorkouts(options);
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
  .option('--copy', 'Copy each Sheets chunk to the macOS clipboard history (requires --sheets-chunked)')
  .action(withCommandErrorHandling(async (options) => {
    const { runPostWorkout } = await import('./commands/post-workout.js');
    await runPostWorkout(options);
  }));

await program.parseAsync();
