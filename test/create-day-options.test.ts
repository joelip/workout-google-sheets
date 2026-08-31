import { describe, expect, test } from 'bun:test';
import { CommandError } from '../src/command-runtime';
import { resolveCreateDayCells } from '../src/commands/create-day';

describe('resolveCreateDayCells', () => {
  test('parses ordered cells from combine option', () => {
    expect(resolveCreateDayCells({ combine: 'B2,C3' })).toEqual(['B2', 'C3']);
  });

  test('normalizes whitespace and casing in combine option', () => {
    expect(resolveCreateDayCells({ combine: ' b2, c3 ' })).toEqual(['B2', 'C3']);
  });

  test('rejects combine with day or session-cell', () => {
    expect(() => resolveCreateDayCells({ combine: 'B2,C3', day: '1' })).toThrow(CommandError);
    expect(() => resolveCreateDayCells({ combine: 'B2,C3', sessionCell: 'B2' })).toThrow(CommandError);
  });

  test('resolves existing day and session-cell inputs', () => {
    expect(resolveCreateDayCells({ day: '1' })).toEqual(['B2']);
    expect(resolveCreateDayCells({ sessionCell: 'c3' })).toEqual(['C3']);
  });

  test('preserves a tab-qualified session-cell reference', () => {
    expect(resolveCreateDayCells({ sessionCell: "'Master Sheet 2026'!d13" })).toEqual(["'Master Sheet 2026'!D13"]);
  });
});
