import { fail } from './command-runtime';
import {
  formatWorkoutISODate,
  parseWorkoutDateInput,
} from './notion-workout-pages';
import type { ParsedWorkoutDate } from './notion-workout-pages';

export interface WorkoutDateRangeOptions {
  start?: string;
  end?: string;
  weekOf?: string;
  month?: string;
}

export interface WorkoutDateRange {
  startDate: string;
  endDate: string;
  label: string;
}

export function resolveWorkoutDateRangeOptions(
  options: WorkoutDateRangeOptions
): WorkoutDateRange {
  const modes = [
    Boolean(options.weekOf),
    Boolean(options.month),
    Boolean(options.start || options.end),
  ].filter(Boolean).length;

  if (modes === 0) {
    fail(
      'Missing date range. Use --start <date> --end <date>, --week-of <date>, or --month <YYYY-MM>.'
    );
  }

  if (modes > 1) {
    fail('Use only one of --start/--end, --week-of, or --month.');
  }

  if (options.month) {
    return resolveMonthRange(options.month);
  }

  if (options.weekOf) {
    return resolveWeekRange(options.weekOf);
  }

  if (!options.start || !options.end) {
    fail('Both --start <date> and --end <date> are required for a custom range.');
  }

  const startDate = formatWorkoutISODate(options.start);
  const endDate = formatWorkoutISODate(options.end);

  if (startDate > endDate) {
    fail(`Invalid date range: start date ${startDate} is after end date ${endDate}.`);
  }

  return {
    startDate,
    endDate,
    label: `${startDate} to ${endDate}`,
  };
}

function resolveWeekRange(dateInput: string): WorkoutDateRange {
  const parsedDate = parseWorkoutDateInput(dateInput);

  if (!parsedDate) {
    fail(
      `Invalid workout date "${dateInput}". Use YYYY-MM-DD or M/D/YYYY (for example, 2026-01-27 or 1/27/2026).`
    );
  }

  const date = toLocalDate(parsedDate);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  const start = addDays(date, -daysSinceMonday);
  const end = addDays(start, 6);
  const startDate = formatDateAsISO(start);
  const endDate = formatDateAsISO(end);

  return {
    startDate,
    endDate,
    label: `week of ${startDate}`,
  };
}

function resolveMonthRange(monthInput: string): WorkoutDateRange {
  const match = monthInput.trim().match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    fail(`Invalid --month "${monthInput}". Use YYYY-MM, for example 2026-01.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    fail(`Invalid --month "${monthInput}". Month must be between 01 and 12.`);
  }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const startDate = formatDateAsISO(start);
  const endDate = formatDateAsISO(end);

  return {
    startDate,
    endDate,
    label: monthInput.trim(),
  };
}

function toLocalDate(date: ParsedWorkoutDate): Date {
  return new Date(date.year, date.month - 1, date.day);
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function formatDateAsISO(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
