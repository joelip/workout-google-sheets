import { describe, expect, test } from 'bun:test';
import { CommandError } from '../src/command-runtime';
import {
  resolveWorkoutDateLimit,
  selectLatestWorkoutPageRefs,
} from '../src/commands/get-workout-dates';
import type { CompletedWorkoutPageRef } from '../src/completed-workout-document';

describe('resolveWorkoutDateLimit', () => {
  test('accepts a positive integer', () => {
    expect(resolveWorkoutDateLimit('4')).toBe(4);
  });

  test('rejects missing and invalid limits', () => {
    expect(() => resolveWorkoutDateLimit(undefined)).toThrow(CommandError);
    expect(() => resolveWorkoutDateLimit('0')).toThrow(CommandError);
    expect(() => resolveWorkoutDateLimit('-1')).toThrow(CommandError);
    expect(() => resolveWorkoutDateLimit('2.5')).toThrow(CommandError);
    expect(() => resolveWorkoutDateLimit('four')).toThrow(CommandError);
  });
});

describe('selectLatestWorkoutPageRefs', () => {
  test('returns the requested number in newest-first order without mutating input', () => {
    const refs = [
      workoutPageRef({ id: 'page-2', title: '8/12/2026', workoutDate: '2026-08-12' }),
      workoutPageRef({ id: 'page-4', title: '8/17/2026', workoutDate: '2026-08-17' }),
      workoutPageRef({ id: 'page-1', title: '8/10/2026', workoutDate: '2026-08-10' }),
      workoutPageRef({ id: 'page-3', title: '8/14/2026', workoutDate: '2026-08-14' }),
    ];

    const selectedRefs = selectLatestWorkoutPageRefs(refs, 3);

    expect(selectedRefs.map((ref) => ref.title)).toEqual([
      '8/17/2026',
      '8/14/2026',
      '8/12/2026',
    ]);
    expect(refs.map((ref) => ref.id)).toEqual(['page-2', 'page-4', 'page-1', 'page-3']);
  });
});

function workoutPageRef(params: {
  id: string;
  title: string;
  workoutDate: string;
}): CompletedWorkoutPageRef {
  return {
    ...params,
    createdTime: '2026-08-01T00:00:00.000Z',
    lastEditedTime: '2026-08-01T00:00:00.000Z',
  };
}
