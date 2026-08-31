import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResolveReferences } from '../src/commands/resolve-references';
import type { NestedWorkoutPage } from '../src/notion-workout-pages';
import type { BlockWithDepth } from '../src/post-workout-rendering';
import { WorkoutHistoryStore } from '../src/workout-history';

let tempDirectory: string | undefined;

afterEach(() => {
  if (tempDirectory) {
    rmSync(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  }
});

describe('resolve-references command', () => {
  test('produces a machine-readable dry run using only the local history index', async () => {
    const statePath = seedHistory();
    const output: string[] = [];
    const log = spyOn(console, 'log').mockImplementation((value) => output.push(String(value)));

    try {
      await runResolveReferences({ date: '2026-08-28', state: statePath, json: true });
    } finally {
      log.mockRestore();
    }

    expect(output).toHaveLength(1);
    const result = JSON.parse(output[0]!) as {
      mode: string;
      plan: { edits: Array<{ after: string; source: { pageTitle: string } }>; planHash: string };
    };
    expect(result.mode).toBe('dry-run');
    expect(result.plan.edits).toHaveLength(2);
    expect(result.plan.edits[0]).toMatchObject({
      after: '2 Minute Bike Erg @ 1:59–2:01/1000m (2–4s faster than 7 minute pace)',
      source: { pageTitle: '8/16/2026' },
    });
    expect(result.plan.planHash).toHaveLength(64);
  });

  test('refuses apply mode before any network request when the reviewed hash is absent', async () => {
    const statePath = seedHistory();

    await expect(runResolveReferences({
      date: '2026-08-28',
      state: statePath,
      apply: true,
    })).rejects.toEqual(expect.objectContaining({
      name: 'CommandError',
      message: 'Applying references requires --plan-hash from a reviewed dry run.',
    }));
  });
});

function seedHistory(): string {
  tempDirectory = mkdtempSync(join(tmpdir(), 'wgs-resolve-command-test-'));
  const statePath = join(tempDirectory, 'history.sqlite');
  const store = new WorkoutHistoryStore(statePath);
  store.upsertPage({
    page: nestedPage('source', '8/16/2026'),
    workoutDate: '2026-08-16',
    rawBlocks: [
      paragraphBlock('source-context', '3 Minute Bike Erg (45s @ hard / 2:15 @ 7 minute pace)'),
      bulletBlock('source-pace', '7min pace: 2:03'),
    ],
    syncedAt: 'sync',
  });
  store.upsertPage({
    page: nestedPage('target', '8/28/2026'),
    workoutDate: '2026-08-28',
    rawBlocks: [
      paragraphBlock('target-fast', '2 Minute Bike Erg @ 2-4s faster than 7 minute pace'),
      paragraphBlock('target-base', '2 Minute Bike Erg @ 7 minute pace'),
    ],
    syncedAt: 'sync',
  });
  store.close();
  return statePath;
}

function nestedPage(id: string, title: string): NestedWorkoutPage {
  return { id, title, createdTime: 'created', lastEditedTime: 'edited' };
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
    [type]: { rich_text: [{ plain_text: text }] },
  } as unknown as BlockWithDepth;
}
