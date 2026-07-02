import { describe, expect, test } from 'bun:test';
import { WorkoutParser } from '../src/parser';

const B2_WORKOUT = [
  'Neck/Upper Body Rehab:',
  'A. Neck Extension PAILs/RAILs: 3 x 3-5 reps of 5s pushing into hand',
  'https://www.youtube.com/shorts/4kKGE8yhYyQ',
  '',
  'B. Neck Lateral Side Bend PAILs/RAILs: 3 x 3-5 reps',
  'https://www.youtube.com/shorts/ThahXsTy6zE',
].join('\n');

const C3_WORKOUT = [
  'Day 2:',
  'A. 2 Sets:',
  '3 Standing Hip CARS per side @ slow/smooth control',
  'https://www.youtube.com/shorts/C4MDREc9ERg',
  '',
  'Plyo:',
  'B. Light Tier Split Exchange Leaps: 3 x 20 reps, rest 1 minute.',
  '',
  'Upper Body:',
  'A. DB Pec Fly (20x1): 3 x 10 reps, rest 2 minutes.',
].join('\n');

function sectionText(session: ReturnType<typeof WorkoutParser.parseSingleCell>): string[] {
  return session.sections.flatMap((section) => [
    section.header ?? '',
    ...section.content,
  ]).filter(Boolean);
}

describe('WorkoutParser.mergeSessions', () => {
  test('combines B2 then C3 content in the requested order', () => {
    const merged = WorkoutParser.mergeSessions([
      WorkoutParser.parseSingleCell(B2_WORKOUT),
      WorkoutParser.parseSingleCell(C3_WORKOUT),
    ]);

    const text = sectionText(merged);

    expect(text).toContain('Neck/Upper Body Rehab:');
    expect(text).toContain('B. Neck Lateral Side Bend PAILs/RAILs: 3 x 3-5 reps');
    expect(text).toContain('Day 2:');
    expect(text).toContain('Upper Body:');
    expect(text).toContain('A. DB Pec Fly (20x1): 3 x 10 reps, rest 2 minutes.');

    expect(text.indexOf('Neck/Upper Body Rehab:')).toBeLessThan(text.indexOf('Day 2:'));
    expect(text.indexOf('Day 2:')).toBeLessThan(text.indexOf('Upper Body:'));
  });

  test('does not share section arrays with source sessions', () => {
    const first = WorkoutParser.parseSingleCell(B2_WORKOUT);
    const merged = WorkoutParser.mergeSessions([first]);

    merged.sections[0]?.content.push('mutated merged content');

    expect(first.sections[0]?.content).not.toContain('mutated merged content');
  });
});
