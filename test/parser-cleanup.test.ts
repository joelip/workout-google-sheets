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

  test('treats plyo as a standalone minor section heading', () => {
    const session = WorkoutParser.parseSingleCell([
      'A. 2 Sets:',
      '- 12 Single Calf Raise per side',
      'Plyo:',
      '- 10 pogo hops',
    ].join('\n'));

    expect(session.sections).toEqual([
      {
        type: 'section',
        header: 'A. 2 Sets:',
        content: ['- 12 Single Calf Raise per side'],
        youtubeLinks: [],
      },
      {
        type: 'text',
        content: ['Plyo:'],
        youtubeLinks: [],
      },
      {
        type: 'text',
        content: ['- 10 pogo hops'],
        youtubeLinks: [],
      },
    ]);
  });
});
