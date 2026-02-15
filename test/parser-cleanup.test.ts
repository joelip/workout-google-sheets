import { describe, expect, test } from 'bun:test';
import { WorkoutParser } from '../src/parser';

describe('WorkoutParser cleanup', () => {
  test('drops plus-only marker lines during parse', () => {
    const session = WorkoutParser.parseSingleCell([
      'Lower Body:',
      'A. Squat',
      '+',
      '- +',
      '*note',
      'B. Lunge',
    ].join('\n'));

    const lines = session.sections.flatMap((section) => [
      section.header ?? '',
      ...section.content,
    ]);

    expect(lines.includes('+')).toBe(false);
    expect(lines.includes('- +')).toBe(false);
    expect(lines.includes('A. Squat')).toBe(true);
    expect(lines.includes('B. Lunge')).toBe(true);
  });
});
