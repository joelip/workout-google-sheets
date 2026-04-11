import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import {
  SHEETS_CHUNK_CHAR_LIMIT,
  renderWorkoutTextOutput,
  splitWorkoutTextForSheets,
} from '../src/post-workout-chunking';

function readFixture(name: string): string {
  return readFileSync(`test/fixtures/${name}`, 'utf8').trim();
}

describe('post-workout sheets chunking', () => {
  test('splits the 3-chunk fixture at minor section and then upper body', () => {
    const text = readFixture('post-workout-3-chunk-example.txt');
    const chunks = splitWorkoutTextForSheets(text);

    expect(chunks).toHaveLength(3);
    expect(chunks[1]?.startsWith('Plyo Progression:')).toBe(true);
    expect(chunks[2]?.startsWith('### Upper Body:')).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= SHEETS_CHUNK_CHAR_LIMIT)).toBe(true);
  });

  test('splits the 2-chunk fixture into sheets-safe chunks', () => {
    const text = readFixture('post-workout-2-chunk-example.txt');
    const chunks = splitWorkoutTextForSheets(text);

    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= SHEETS_CHUNK_CHAR_LIMIT)).toBe(true);
  });

  test('prefers upper body split when both chunks fit under the limit', () => {
    const text = readFixture('post-workout-3-chunk-example.txt');
    const chunks = splitWorkoutTextForSheets(text, 3000);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.startsWith('### Upper Body:')).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= 3000)).toBe(true);
  });

  test('hard-splits when no line boundary exists before max chars', () => {
    const longLine = `### Lower Body:\n${'x'.repeat(5000)}`;
    const chunks = splitWorkoutTextForSheets(longLine, 2048);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 2048)).toBe(true);
  });

  test('removes plus-only bullet artifacts from rendered text', () => {
    const output = renderWorkoutTextOutput({
      overallNotes: '### Overall Notes:\n- Keep moving',
      lowerBody: '### Lower Body:\n- +\nA. Squat',
      upperBody: '### Upper Body:\n+\nB. Pull-up',
    });

    expect(output.includes('\n- +\n')).toBe(false);
    expect(output.includes('\n+\n')).toBe(false);
    expect(output.includes('A. Squat')).toBe(true);
    expect(output.includes('B. Pull-up')).toBe(true);
  });

  test('adds a blank line before top-level exercise headers inside a workout section', () => {
    const output = renderWorkoutTextOutput({
      lowerBody: [
        '### Lower Body:',
        'A1. Kickstand Wall Sit x 2 sets',
        '- 30s holds',
        'A2. Single Leg Hamstring Bridge x 2 sets',
        '- 15 reps',
        'Conditioning:',
        'Bike x 10 minutes',
        'B. Rear Foot Elevated Split Squat x 4 sets',
        '- 8 reps per side',
      ].join('\n'),
    });

    expect(output).toContain('A1. Kickstand Wall Sit x 2 sets\n- 30s holds\n\nA2. Single Leg Hamstring Bridge x 2 sets');
    expect(output).toContain('- 15 reps\n\nConditioning:\nBike x 10 minutes\n\nB. Rear Foot Elevated Split Squat x 4 sets');
    expect(output).not.toContain('### Lower Body:\n\nA1.');
  });
});
