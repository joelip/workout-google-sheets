import { describe, expect, test } from 'bun:test';
import { CommandError } from '../src/command-runtime';
import { resolveWorkoutDateRangeOptions } from '../src/workout-date-ranges';

describe('resolveWorkoutDateRangeOptions', () => {
  test('requires one date range selector', () => {
    expect(() => resolveWorkoutDateRangeOptions({}))
      .toThrow(CommandError);
  });

  test('resolves explicit start and end dates inclusively', () => {
    expect(resolveWorkoutDateRangeOptions({
      start: '1/27/2026',
      end: '2026-02-01',
    })).toEqual({
      startDate: '2026-01-27',
      endDate: '2026-02-01',
      label: '2026-01-27 to 2026-02-01',
    });
  });

  test('requires both start and end for explicit ranges', () => {
    expect(() => resolveWorkoutDateRangeOptions({ start: '2026-01-27' }))
      .toThrow(CommandError);
    expect(() => resolveWorkoutDateRangeOptions({ end: '2026-02-01' }))
      .toThrow(CommandError);
  });

  test('rejects multiple selector modes', () => {
    expect(() => resolveWorkoutDateRangeOptions({
      start: '2026-01-27',
      end: '2026-02-01',
      weekOf: '2026-01-27',
    })).toThrow(CommandError);
  });

  test('rejects reversed explicit ranges', () => {
    expect(() => resolveWorkoutDateRangeOptions({
      start: '2026-02-01',
      end: '2026-01-27',
    })).toThrow(CommandError);
  });

  test('resolves week-of as a Monday-to-Sunday calendar week', () => {
    expect(resolveWorkoutDateRangeOptions({ weekOf: '2026-01-28' })).toEqual({
      startDate: '2026-01-26',
      endDate: '2026-02-01',
      label: 'week of 2026-01-26',
    });
  });

  test('resolves month ranges from YYYY-MM input', () => {
    expect(resolveWorkoutDateRangeOptions({ month: '2026-02' })).toEqual({
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      label: '2026-02',
    });
  });

  test('rejects invalid month inputs', () => {
    expect(() => resolveWorkoutDateRangeOptions({ month: '2026-1' }))
      .toThrow(CommandError);
    expect(() => resolveWorkoutDateRangeOptions({ month: '01/2026' }))
      .toThrow(CommandError);
    expect(() => resolveWorkoutDateRangeOptions({ month: '2026-00' }))
      .toThrow(CommandError);
    expect(() => resolveWorkoutDateRangeOptions({ month: '2026-13' }))
      .toThrow(CommandError);
  });
});
