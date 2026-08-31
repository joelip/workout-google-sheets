import { describe, expect, test } from 'bun:test';
import { resolveHistoryLimit } from '../src/commands/history';
import {
  DEFAULT_HISTORY_PAGE_LIMIT,
  DEFAULT_HISTORY_WEEK_LIMIT,
  DEFAULT_WORKOUTS_PER_WEEK,
} from '../src/workout-history';

describe('resolveHistoryLimit', () => {
  test('defaults to the rolling-window limit', () => {
    expect(DEFAULT_HISTORY_WEEK_LIMIT).toBe(12);
    expect(DEFAULT_WORKOUTS_PER_WEEK).toBe(4);
    expect(DEFAULT_HISTORY_PAGE_LIMIT).toBe(48);
    expect(resolveHistoryLimit(undefined)).toBe(48);
  });

  test('accepts a positive integer override', () => {
    expect(resolveHistoryLimit('12')).toBe(12);
  });

  test('rejects invalid limits', () => {
    expect(() => resolveHistoryLimit('0')).toThrow('positive integer');
    expect(() => resolveHistoryLimit('1.5')).toThrow('positive integer');
  });
});
