import { describe, expect, test } from 'bun:test';
import type { BlockWithDepth } from '../src/post-workout-rendering';
import {
  buildReferenceResolutionPlan,
  preflightReferenceApplication,
  verifyReferenceApplication,
} from '../src/workout-reference-resolver';
import type { CachedWorkoutPage } from '../src/workout-history';

describe('workout reference resolution', () => {
  test('resolves all six mixed-conditioning pace references from the latest prior workout', () => {
    const target = workoutPage({
      id: 'target',
      title: '8/28/2026',
      workoutDate: '2026-08-28',
      rawBlocks: [
        paragraphBlock('bike-fast', '2 Minute Bike Erg @ 2-4s faster than 7 minute pace'),
        paragraphBlock('bike-base', '2 Minute Bike Erg @ 7 minute pace'),
        paragraphBlock('row-fast', '2 Minute Row @ 2-4s faster than 7 minute pace'),
        paragraphBlock('row-base', '2 Minute Row @ 7 minute pace'),
        paragraphBlock('ski-fast', '2 Minute Ski Erg @ 2-4s faster than 7 minute pace'),
        paragraphBlock('ski-base', '2 Minute Ski Erg @ 7 minute pace'),
      ],
    });
    const earlierSource = sourceWorkout('8/9/2026', '2026-08-09', '2:05', '2:08', '2:30');
    const latestSource = sourceWorkout('8/16/2026', '2026-08-16', '2:03', '2:06', '2:27');

    const plan = buildReferenceResolutionPlan({
      targetPage: target,
      previousPages: [earlierSource, latestSource],
    });

    expect(plan.edits.map((edit) => edit.after)).toEqual([
      '2 Minute Bike Erg @ 1:59–2:01/1000m (2–4s faster than 7 minute pace)',
      '2 Minute Bike Erg @ 2:03/1000m (7 minute pace)',
      '2 Minute Row @ 2:02–2:04/500m (2–4s faster than 7 minute pace)',
      '2 Minute Row @ 2:06/500m (7 minute pace)',
      '2 Minute Ski Erg @ 2:23–2:25/500m (2–4s faster than 7 minute pace)',
      '2 Minute Ski Erg @ 2:27/500m (7 minute pace)',
    ]);
    expect(plan.edits.every((edit) => edit.source.pageTitle === '8/16/2026')).toBeTrue();
    expect(plan.edits.every((edit) => edit.confidence === 'high')).toBeTrue();
    expect(plan.unresolved).toEqual([]);
    expect(plan.planHash).toHaveLength(64);
  });

  test('reports a reference as unresolved when no prior pace exists', () => {
    const target = workoutPage({
      id: 'target',
      title: '8/28/2026',
      workoutDate: '2026-08-28',
      rawBlocks: [paragraphBlock('row-base', '2 Minute Row @ 7 minute pace')],
    });

    const plan = buildReferenceResolutionPlan({ targetPage: target, previousPages: [] });

    expect(plan.edits).toEqual([]);
    expect(plan.unresolved).toEqual([{
      blockId: 'row-base',
      text: '2 Minute Row @ 7 minute pace',
      modality: 'row',
      reason: 'no-prior-seven-minute-pace',
    }]);
  });

  test('requires an unchanged plain-text target before applying', () => {
    const target = workoutPage({
      id: 'target',
      title: '8/28/2026',
      workoutDate: '2026-08-28',
      rawBlocks: [paragraphBlock('bike-base', '2 Minute Bike Erg @ 7 minute pace')],
    });
    const plan = buildReferenceResolutionPlan({
      targetPage: target,
      previousPages: [sourceWorkout('8/16/2026', '2026-08-16', '2:03', '2:06', '2:27')],
    });

    expect(() => preflightReferenceApplication({
      plan,
      livePageLastEditedTime: target.lastEditedTime,
      liveBlocks: target.rawBlocks,
    })).not.toThrow();
    expect(() => preflightReferenceApplication({
      plan,
      livePageLastEditedTime: 'changed',
      liveBlocks: target.rawBlocks,
    })).toThrow('changed after history sync');
    expect(() => preflightReferenceApplication({
      plan,
      livePageLastEditedTime: target.lastEditedTime,
      liveBlocks: [paragraphBlock('bike-base', 'manually changed')],
    })).toThrow('changed after preview');
  });

  test('verifies every planned replacement after an apply', () => {
    const target = workoutPage({
      id: 'target',
      title: '8/28/2026',
      workoutDate: '2026-08-28',
      rawBlocks: [paragraphBlock('bike-base', '2 Minute Bike Erg @ 7 minute pace')],
    });
    const plan = buildReferenceResolutionPlan({
      targetPage: target,
      previousPages: [sourceWorkout('8/16/2026', '2026-08-16', '2:03', '2:06', '2:27')],
    });

    expect(() => verifyReferenceApplication(plan, [
      paragraphBlock('bike-base', '2 Minute Bike Erg @ 2:03/1000m (7 minute pace)'),
    ])).not.toThrow();
    expect(() => verifyReferenceApplication(plan, target.rawBlocks)).toThrow('manual review required');
  });
});

function sourceWorkout(
  title: string,
  workoutDate: string,
  bikePace: string,
  rowPace: string,
  skiPace: string
): CachedWorkoutPage {
  return workoutPage({
    id: `source-${workoutDate}`,
    title,
    workoutDate,
    rawBlocks: [
      paragraphBlock(`bike-${workoutDate}`, '3 Minute Bike Erg (45s @ hard / 2:15 @ 7 minute pace)'),
      bulletBlock(`bike-pace-${workoutDate}`, `7min pace: ${bikePace}`),
      paragraphBlock(`row-${workoutDate}`, '3 Minute Row (45s @ hard / 2:15 @ 7 minute pace)'),
      bulletBlock(`row-pace-${workoutDate}`, `7min pace: ${rowPace}`),
      paragraphBlock(`ski-${workoutDate}`, '3 Minute Ski Erg (45s @ hard / 2:15 @ 7 minute pace)'),
      bulletBlock(`ski-pace-${workoutDate}`, `7min pace: ${skiPace}`),
    ],
  });
}

function workoutPage(params: {
  id: string;
  title: string;
  workoutDate: string;
  rawBlocks: BlockWithDepth[];
}): CachedWorkoutPage {
  return {
    ...params,
    createdTime: 'created',
    lastEditedTime: 'edited',
    contentHash: `hash-${params.id}`,
    syncedAt: 'synced',
  };
}

function paragraphBlock(id: string, text: string): BlockWithDepth {
  return richTextBlock('paragraph', id, text);
}

function bulletBlock(id: string, text: string): BlockWithDepth {
  return richTextBlock('bulleted_list_item', id, text);
}

function richTextBlock(
  type: 'paragraph' | 'bulleted_list_item',
  id: string,
  text: string
): BlockWithDepth {
  return {
    id,
    type,
    depth: 0,
    [type]: {
      rich_text: [{
        type: 'text',
        text: { content: text, link: null },
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
        plain_text: text,
        href: null,
      }],
    },
  } as unknown as BlockWithDepth;
}
