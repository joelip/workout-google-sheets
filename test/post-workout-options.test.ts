import { describe, expect, test } from 'bun:test';
import { CommandError } from '../src/command-runtime';
import {
  copyChunksToClipboard,
  resolvePostWorkoutOptions,
} from '../src/commands/post-workout';

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

  test('allows copy mode with sheets chunking', () => {
    const resolved = resolvePostWorkoutOptions({
      notionPage: '1/27/2026',
      sheetsChunked: true,
      copy: true,
    });

    expect(resolved.textMode).toBe(true);
    expect(resolved.copyChunks).toBe(true);
  });

  test('rejects copy mode without sheets chunking', () => {
    expect(() => resolvePostWorkoutOptions({
      notionPage: '1/27/2026',
      text: true,
      copy: true,
    })).toThrow(CommandError);
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

describe('copyChunksToClipboard', () => {
  test('copies chunks sequentially without labels', async () => {
    const events: string[] = [];

    await copyChunksToClipboard(
      ['chunk one', 'chunk two'],
      async (chunk) => {
        events.push(`start ${chunk}`);
        await Promise.resolve();
        events.push(`end ${chunk}`);
      },
      async (milliseconds) => {
        events.push(`wait ${milliseconds}`);
      }
    );

    expect(events).toEqual([
      'start chunk one',
      'end chunk one',
      'wait 750',
      'start chunk two',
      'end chunk two',
    ]);
  });

  test('does not wait after the final chunk', async () => {
    const events: string[] = [];

    await copyChunksToClipboard(
      ['chunk one'],
      async (chunk) => {
        events.push(`copy ${chunk}`);
      },
      async () => {
        events.push('wait');
      }
    );

    expect(events).toEqual(['copy chunk one']);
  });
});
