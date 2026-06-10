import { describe, expect, test } from 'bun:test';
import { CommandError } from '../src/command-runtime';
import {
  formatWorkoutDatePageTitle,
  formatWorkoutDatePageTitleFromDate,
} from '../src/notion-workout-pages';

describe('formatWorkoutDatePageTitle', () => {
  test('normalizes ISO dates to Notion page titles', () => {
    expect(formatWorkoutDatePageTitle('2026-01-27')).toBe('1/27/2026');
  });

  test('normalizes slash dates with leading zeros', () => {
    expect(formatWorkoutDatePageTitle('01/07/2026')).toBe('1/7/2026');
  });

  test('normalizes two-digit slash years', () => {
    expect(formatWorkoutDatePageTitle('1/27/26')).toBe('1/27/2026');
  });

  test('rejects invalid dates', () => {
    expect(() => formatWorkoutDatePageTitle('2026-02-31')).toThrow(CommandError);
  });

  test('formats Date objects with the same page title convention', () => {
    expect(formatWorkoutDatePageTitleFromDate(new Date(2026, 0, 27))).toBe('1/27/2026');
  });
});
