import { describe, expect, test } from 'bun:test';
import { CommandError } from '../src/command-runtime';
import { resolvePostWorkoutOptions } from '../src/commands/post-workout';

describe('resolvePostWorkoutOptions', () => {
  test('does not require session-cell in text mode', () => {
    const resolved = resolvePostWorkoutOptions({
      notionPage: '1/27/2026',
      text: true,
    });

    expect(resolved.textMode).toBe(true);
    expect(resolved.sessionCell).toBeUndefined();
    expect(resolved.notionPageTitle).toBe('1/27/2026');
  });

  test('requires sheet context and session-cell when posting to sheets', () => {
    expect(() => resolvePostWorkoutOptions({
      notionPage: '1/27/2026',
    })).toThrow(CommandError);
  });

  test('uses config defaults for sheet owner and title in non-text mode', () => {
    const resolved = resolvePostWorkoutOptions(
      {
        notionPage: '1/27/2026',
        sessionCell: 'B2',
      },
      {
        sheetOwner: 'user@example.com',
        sheetTitle: 'My Workouts',
      }
    );

    expect(resolved.textMode).toBe(false);
    expect(resolved.sessionCell).toBe('B2');
    expect(resolved.sheetOwner).toBe('user@example.com');
    expect(resolved.sheetTitle).toBe('My Workouts');
  });
});
