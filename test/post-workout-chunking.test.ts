import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import {
  renderSheetsChunkedTextOutput,
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
    expect(chunks[1].startsWith('Plyo Progression:')).toBe(true);
    expect(chunks[2].startsWith('### Upper Body:')).toBe(true);
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
    expect(chunks[1].startsWith('### Upper Body:')).toBe(true);
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

  test('adds blank lines before lettered section headers', () => {
    const output = renderWorkoutTextOutput({
      lowerBody: [
        '### Lower Body:',
        'A1. Elevated Pigeon Stretch',
        '- 30s each side',
        'A2. Couch Stretch',
        '- Felt good.',
        'B. Front Squat',
      ].join('\n'),
    });

    expect(output).toContain('### Lower Body:\n\nA1. Elevated Pigeon Stretch');
    expect(output).toContain('- 30s each side\n\nA2. Couch Stretch');
    expect(output).toContain('- Felt good.\n\nB. Front Squat');
  });

  test('renders chunked output without chunk headings', () => {
    const text = readFixture('post-workout-3-chunk-example.txt');
    const chunks = splitWorkoutTextForSheets(text);
    const output = renderSheetsChunkedTextOutput(text);

    expect(output.includes('--- Chunk')).toBe(false);
    expect(output).toBe(chunks.join('\n\n'));
  });
});
