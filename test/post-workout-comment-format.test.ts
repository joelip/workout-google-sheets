import { describe, expect, test } from 'bun:test';
import {
  buildGoogleSheetsCommentChunks,
  type WorkoutContent,
} from '../src/commands/post-workout-comment-format';

describe('buildGoogleSheetsCommentChunks', () => {
  test('splits by top-level workout sections by default', () => {
    const workoutContent: WorkoutContent = {
      overallNotes: '### Overall Notes:\nRecovery felt solid today.',
      lowerBody: '### Lower Body:\nA. Back Squat\n4 x 6 @ 75% 1RM\n\nB. Reverse Lunge\n3 x 10 each side',
      upperBody: '### Upper Body:\nA. Bench Press\n4 x 5 @ 80%\n\nB. Pull-Up\n4 x 8',
    };

    const chunks = buildGoogleSheetsCommentChunks(workoutContent, 500);

    expect(chunks.length).toBe(3);
    expect(chunks.every(chunk => chunk.charCount <= 500)).toBe(true);
    expect(chunks.map(chunk => chunk.label)).toEqual([
      'Overall Notes',
      'Lower Body',
      'Upper Body',
    ]);
  });

  test('splits long lower-body content by movement letter without splitting movements', () => {
    const movementA = [
      'A. Back Squat',
      'Build to a strong top set of 5 with controlled tempo.',
      'Then complete 2 back-off sets at the same quality.',
    ].join('\n');
    const movementB = [
      'B. Split Squat',
      'Use full range and pause each rep in the bottom position.',
      'Keep torso tall and control every eccentric.',
    ].join('\n');
    const movementC = [
      'C. Hamstring Curl',
      '3 x 12 with full contraction and slow eccentric.',
      'Finish each set with 2-second peak squeeze.',
    ].join('\n');

    const workoutContent: WorkoutContent = {
      overallNotes: '',
      lowerBody: `### Lower Body:\n${movementA}\n\n${movementB}\n\n${movementC}`,
      upperBody: '',
    };

    const chunks = buildGoogleSheetsCommentChunks(workoutContent, 180);
    const lowerBodyChunks = chunks.filter(chunk => chunk.sectionName === 'Lower Body');

    expect(lowerBodyChunks.length).toBe(3);
    expect(lowerBodyChunks.every(chunk => chunk.charCount <= 180)).toBe(true);
    expect(lowerBodyChunks.map(chunk => chunk.label)).toEqual([
      'Lower Body (Part 1/3)',
      'Lower Body (Part 2/3)',
      'Lower Body (Part 3/3)',
    ]);

    const chunkWithA = lowerBodyChunks.find(chunk => chunk.content.includes('A. Back Squat'));
    const chunkWithB = lowerBodyChunks.find(chunk => chunk.content.includes('B. Split Squat'));
    const chunkWithC = lowerBodyChunks.find(chunk => chunk.content.includes('C. Hamstring Curl'));

    expect(chunkWithA?.content.includes('Then complete 2 back-off sets at the same quality.')).toBe(true);
    expect(chunkWithB?.content.includes('Keep torso tall and control every eccentric.')).toBe(true);
    expect(chunkWithC?.content.includes('Finish each set with 2-second peak squeeze.')).toBe(true);
  });

  test('keeps chunk numbering and metadata consistent', () => {
    const workoutContent: WorkoutContent = {
      overallNotes: '### Overall Notes:\nGood pace today.',
      lowerBody: '### Lower Body:\nA. Deadlift\n4 x 4',
      upperBody: '### Upper Body:\nA. Press\n4 x 6',
    };

    const chunks = buildGoogleSheetsCommentChunks(workoutContent, 500);

    expect(chunks.length).toBe(3);
    expect(chunks[0]?.chunkNumber).toBe(1);
    expect(chunks[1]?.chunkNumber).toBe(2);
    expect(chunks[2]?.chunkNumber).toBe(3);
    expect(chunks.every(chunk => chunk.chunkCount === 3)).toBe(true);
  });
});
