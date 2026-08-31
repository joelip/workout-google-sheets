import { describe, expect, test } from 'bun:test';
import {
  buildGoogleSheetsCommentChunks,
  GOOGLE_SHEETS_COMMENT_SAFE_CHARS,
  type WorkoutContent,
} from '../src/commands/post-workout-comment-format';

describe('buildGoogleSheetsCommentChunks', () => {
  test('returns single chunk when combined content fits within limit', () => {
    const workoutContent: WorkoutContent = {
      overallNotes: '### Overall Notes:\nRecovery felt solid today.',
      lowerBody: '### Lower Body:\nA. Back Squat\n4 x 6 @ 75% 1RM',
      upperBody: '### Upper Body:\nA. Bench Press\n4 x 5 @ 80%',
    };

    const chunks = buildGoogleSheetsCommentChunks(workoutContent);

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkNumber).toBe(1);
    expect(chunks[0]!.chunkCount).toBe(1);
    expect(chunks[0]!.content).toContain('### Overall Notes:');
    expect(chunks[0]!.content).toContain('### Lower Body:');
    expect(chunks[0]!.content).toContain('### Upper Body:');
  });

  test('produces 2-3 chunks for typical workout content at default limit', () => {
    const workoutContent: WorkoutContent = {
      overallNotes: '### Overall Notes:\n- Knee is a little swollen today. Consistent resting pain of about 1/10.',
      lowerBody: [
        '### Lower Body:',
        'A1. Loaded Arm Assisted Hip Airplane x 5 reps per side x 2 sets, rest 30s',
        '- 25lb KB',
        '- Felt pretty stable today.',
        '',
        'A2. Lateral Lunge x 4-6 reps per side x 2 sets, rest 60s',
        '- Unloaded. Right knee came into play.',
        '',
        'B. Hip Flexor Sit: 3 x 6-12 reps per side, rest 90s.',
        '- Still very challenging!',
        '- 7-7 / 7-7 / 6-6 by set',
        '',
        'C. Clean Grip RDL (20x1): 6-5-4-3-3, rest 2 minutes.',
        '- 185 / 195 / 205 / 225 x 2 sets',
        '',
        'D. Single Leg Shoulder Elevated Hip Thrust: 3 x 12 reps per side, rest 1-2 minutes.',
        '- A little more challenging today.',
      ].join('\n'),
      upperBody: [
        '### Upper Body:',
        'A. Supine Band ER Hold: 3 x 20-30s hold, rest 40-60s.',
        '- Same black band. Felt good.',
        '',
        'B1. Single Arm Quadruped Scap Push-up x 4-8 reps per side x 3 sets, rest 10-20s',
        '- 5-5 / 6-6 / 5-5',
        '- Still extremely challenging.',
        '',
        'B2. Chest Supported T Raise x 12 reps x 3, rest 1-2 minutes.',
        '- High effort but relatively smooth.',
        '',
        'C. Paused Db Bench Press: 6-8-12-12, rest 2 minutes.',
        '- 6 at 60lb / 8 at 45lb / 12 x 2 at 37.5lb',
        '',
        'D1. Shoulder Extension x 30s hold w/ light contraction x 3 sets, rest 30-60s',
        '- Kept it about the same as last time.',
        '',
        'D2. Thoracic Bridge w/ Crab Reach x 3-5 reps per side x 3 sets, rest 1 minute',
        '- did 3-3 / 4-4 / 5-5 reps by set',
        '',
        'E. Half-Kneeling Single Arm Lat Pulldown: 3 x 10-12 reps per side, rest 90 seconds.',
        '- Kept the ribs stacked and used a controlled three-second eccentric on every rep.',
        '',
        'F1. Tall-Kneeling Cable Press: 3 x 10 reps per side, rest 30 seconds.',
        '- Used a split stance and paused each rep at full reach without rotating the torso.',
        '',
        'F2. Chest-Supported Dumbbell Row: 3 x 12 reps, rest 90 seconds.',
        '- Held the top position for one second and kept the shoulders away from the ears.',
        '',
        'G. Side-Lying External Rotation: 2 x 15 reps per side, rest 60 seconds.',
        '- Finished with smooth reps and stopped before losing shoulder position.',
      ].join('\n'),
    };

    const chunks = buildGoogleSheetsCommentChunks(workoutContent);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(3);
    expect(chunks.every(c => c.chunkCount === chunks.length)).toBe(true);
  });

  test('does not repeat section headings across chunks', () => {
    const workoutContent: WorkoutContent = {
      overallNotes: '',
      lowerBody: [
        '### Lower Body:',
        'A. Back Squat: 4 x 6',
        '- Notes about squats',
        '',
        'B. Reverse Lunge: 3 x 10',
        '- Notes about lunges',
      ].join('\n'),
      upperBody: [
        '### Upper Body:',
        'A. Bench Press: 4 x 5',
        '- Notes about bench',
        '',
        'B. Pull-Up: 4 x 8',
        '- Notes about pull-ups',
      ].join('\n'),
    };

    const chunks = buildGoogleSheetsCommentChunks(workoutContent, 200);
    const allContent = chunks.map(c => c.content).join('|||');

    // Each heading should appear exactly once across all chunks
    expect(allContent.split('### Lower Body:').length).toBe(2); // 1 occurrence
    expect(allContent.split('### Upper Body:').length).toBe(2); // 1 occurrence
  });

  test('returns empty array for empty content', () => {
    const workoutContent: WorkoutContent = {
      overallNotes: '',
      lowerBody: '',
      upperBody: '',
    };

    const chunks = buildGoogleSheetsCommentChunks(workoutContent);
    expect(chunks.length).toBe(0);
  });

  test('chunk numbering is consistent', () => {
    const workoutContent: WorkoutContent = {
      overallNotes: '### Overall Notes:\nGood pace today.',
      lowerBody: '### Lower Body:\nA. Deadlift\n4 x 4\n\nB. Lunge\n3 x 8',
      upperBody: '### Upper Body:\nA. Press\n4 x 6\n\nB. Row\n3 x 10',
    };

    const chunks = buildGoogleSheetsCommentChunks(workoutContent, 150);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkNumber).toBe(i + 1);
      expect(chunks[i]!.chunkCount).toBe(chunks.length);
    }
  });

  test('default limit is 1500 chars', () => {
    expect(GOOGLE_SHEETS_COMMENT_SAFE_CHARS).toBe(1500);
  });
});
