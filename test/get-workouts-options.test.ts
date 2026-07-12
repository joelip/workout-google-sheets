import { describe, expect, test } from 'bun:test';
import { selectWorkoutPageRefsForDateRange } from '../src/commands/get-workouts';
import type { CompletedWorkoutPageRef } from '../src/completed-workout-document';

describe('selectWorkoutPageRefsForDateRange', () => {
  test('includes range boundaries and sorts by workout date', () => {
    const refs = [
      workoutPageRef({ id: 'page-3', title: '2/1/2026', workoutDate: '2026-02-01' }),
      workoutPageRef({ id: 'page-1', title: '1/26/2026', workoutDate: '2026-01-26' }),
      workoutPageRef({ id: 'page-4', title: '2/2/2026', workoutDate: '2026-02-02' }),
      workoutPageRef({ id: 'page-2', title: '1/27/2026', workoutDate: '2026-01-27' }),
    ];

    const selectedRefs = selectWorkoutPageRefsForDateRange(refs, {
      startDate: '2026-01-26',
      endDate: '2026-02-01',
      label: 'test range',
    });

    expect(selectedRefs.map((ref) => ref.id)).toEqual(['page-1', 'page-2', 'page-3']);
  });
});

function workoutPageRef(params: {
  id: string;
  title: string;
  workoutDate: string;
}): CompletedWorkoutPageRef {
  return {
    ...params,
    createdTime: '2026-01-01T00:00:00.000Z',
    lastEditedTime: '2026-01-01T00:00:00.000Z',
  };
}
