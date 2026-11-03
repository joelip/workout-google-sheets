import { describe, expect, test } from 'bun:test';
import { WorkoutParser } from '../src/parser';
import { NotionClient } from '../src/notion';

describe('WorkoutParser cleanup', () => {
  test('renders Sprint as a top-level heading for week and day sessions', () => {
    const workout = [
      'Lower Body:',
      'F. Single Leg Quad Extension',
      'Sprint:',
      'G. Echo Bike',
      'Upper Body:',
    ].join('\n');
    const day = WorkoutParser.parseSingleCell(workout);
    const week = WorkoutParser.parseWorkoutData([[workout]]);
    const client = new NotionClient({ notion: { token: 'test', parentPageId: 'test' } });
    const renderer = client as unknown as {
      buildSingleSessionContent(session: typeof day): Array<{ type?: string }>;
      buildPageContent(sessions: typeof week): Array<{ type?: string }>;
    };

    expect(day.sections.map(({ type, header }) => [type, header])).toEqual([
      ['upper_lower', 'Lower Body:'],
      ['section', 'F. Single Leg Quad Extension'],
      ['upper_lower', 'Sprint:'],
      ['section', 'G. Echo Bike'],
      ['upper_lower', 'Upper Body:'],
    ]);
    expect(renderer.buildSingleSessionContent(day).map((block) => block.type)).toEqual([
      'heading_3', 'paragraph', 'heading_3', 'paragraph', 'heading_3',
    ]);
    expect(renderer.buildPageContent(week).map((block) => block.type)).toEqual([
      'heading_2', 'heading_3', 'paragraph', 'heading_3', 'paragraph', 'heading_3',
    ]);
  });

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
