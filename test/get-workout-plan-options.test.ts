import { describe, expect, test } from 'bun:test';
import { CommandError } from '../src/command-runtime';
import {
  renderWorkoutPlan,
  renderWorkoutPlans,
  resolveGetWorkoutPlanOptions,
  resolveGetWorkoutPlansOptions,
} from '../src/commands/get-workout-plan';

describe('resolveGetWorkoutPlanOptions', () => {
  test('resolves a single plan cell with sheet defaults', () => {
    const resolved = resolveGetWorkoutPlanOptions(
      { day: '1' },
      {
        sheetOwner: 'user@example.com',
        sheetTitle: 'Workout Sheet',
      }
    );

    expect(resolved).toEqual({
      sheetOwner: 'user@example.com',
      sheetTitle: 'Workout Sheet',
      sourceCells: ['B2'],
    });
  });

  test('resolves combined cells in order', () => {
    const resolved = resolveGetWorkoutPlanOptions({
      sheetOwner: 'user@example.com',
      sheetTitle: 'Workout Sheet',
      combine: 'B2,C3',
    });

    expect(resolved.sourceCells).toEqual(['B2', 'C3']);
  });

  test('requires sheet context and a source cell selector', () => {
    expect(() => resolveGetWorkoutPlanOptions({ day: '1' })).toThrow(CommandError);
    expect(() => resolveGetWorkoutPlanOptions({
      sheetOwner: 'user@example.com',
      sheetTitle: 'Workout Sheet',
    })).toThrow(CommandError);
  });
});

describe('resolveGetWorkoutPlansOptions', () => {
  test('uses config defaults for sheet context and cell range', () => {
    const resolved = resolveGetWorkoutPlansOptions(
      {},
      {
        sheetOwner: 'user@example.com',
        sheetTitle: 'Workout Sheet',
        cellRange: 'B2:E2',
      }
    );

    expect(resolved).toEqual({
      sheetOwner: 'user@example.com',
      sheetTitle: 'Workout Sheet',
      cellRange: 'B2:E2',
    });
  });

  test('requires a cell range for plural plans', () => {
    expect(() => resolveGetWorkoutPlansOptions(
      {},
      {
        sheetOwner: 'user@example.com',
        sheetTitle: 'Workout Sheet',
      }
    )).toThrow(CommandError);
  });
});

describe('workout plan rendering', () => {
  test('renders one raw plan cell as markdown', () => {
    expect(renderWorkoutPlan(['B2'], ['A. Squat\n3 x 5'])).toBe(
      '# Workout Plan: B2\n\nA. Squat\n3 x 5'
    );
  });

  test('renders combined plan cells with cell headings', () => {
    expect(renderWorkoutPlan(['B2', 'C3'], ['A. Squat', 'B. Press'])).toBe(
      '# Workout Plan: B2,C3\n\n## B2\n\nA. Squat\n\n## C3\n\nB. Press'
    );
  });

  test('renders a range as ordered sessions and ignores empty cells', () => {
    expect(renderWorkoutPlans('B2:E2', [['A. Squat', '', 'B. Press']])).toBe(
      '# Workout Plans: B2:E2\n\n## Session 1\n\nA. Squat\n\n## Session 2\n\nB. Press'
    );
  });

  test('renders a clear message for empty plan ranges', () => {
    expect(renderWorkoutPlans('B2:E2', [])).toBe('No workout plans found in range B2:E2.');
  });
});
