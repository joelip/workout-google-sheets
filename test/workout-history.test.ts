import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlockWithDepth } from '../src/post-workout-rendering';
import type { NestedWorkoutPage } from '../src/notion-workout-pages';
import {
  syncWorkoutHistory,
  WorkoutHistoryStore,
} from '../src/workout-history';

let tempDirectory: string | undefined;

afterEach(() => {
  if (tempDirectory) {
    rmSync(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  }
});

describe('WorkoutHistoryStore', () => {
  test('syncs only new or changed dated pages and removes stale entries', async () => {
    const store = makeStore();
    let pages = [
      nestedPage('page-1', '8/16/2026', 'edit-1'),
      nestedPage('page-2', '8/28/2026', 'edit-2'),
      nestedPage('notes', 'Notes', 'edit-notes'),
    ];
    const extractedPageIds: string[] = [];
    const notionClient = {
      listNestedPages: async () => pages,
      extractPageContent: async (pageId: string) => {
        extractedPageIds.push(pageId);
        return [paragraphBlock(`content-${pageId}`)];
      },
    };

    const first = await syncWorkoutHistory({
      store,
      notionClient,
      now: () => 'sync-1',
    });
    expect(first).toMatchObject({
      discoveredPages: 2,
      indexedPages: 2,
      fetchedPages: 2,
      unchangedPages: 0,
      removedPages: 0,
    });
    expect(extractedPageIds.sort()).toEqual(['page-1', 'page-2']);

    const second = await syncWorkoutHistory({
      store,
      notionClient,
      now: () => 'sync-2',
    });
    expect(second.fetchedPages).toBe(0);
    expect(second.unchangedPages).toBe(2);
    expect(extractedPageIds).toHaveLength(2);

    pages = [nestedPage('page-2', '8/28/2026', 'edit-3')];
    const third = await syncWorkoutHistory({
      store,
      notionClient,
      now: () => 'sync-3',
    });
    expect(third.fetchedPages).toBe(1);
    expect(third.removedPages).toBe(1);
    expect(extractedPageIds).toEqual(['page-1', 'page-2', 'page-2']);
    expect(store.getPage('page-1')).toBeNull();
    expect(store.getPage('page-2')).toMatchObject({
      workoutDate: '2026-08-28',
      lastEditedTime: 'edit-3',
      syncedAt: 'sync-3',
    });
    expect(store.getMetadata('lastFullSyncAt')).toBe('sync-3');
    store.close();
  });

  test('returns preceding pages newest first', () => {
    const store = makeStore();
    for (const [id, title] of [['one', '8/10/2026'], ['two', '8/16/2026'], ['target', '8/28/2026']]) {
      store.upsertPage({
        page: nestedPage(id!, title!, `edit-${id}`),
        workoutDate: `2026-08-${title!.split('/')[1]!.padStart(2, '0')}`,
        rawBlocks: [paragraphBlock(id!)],
        syncedAt: 'sync',
      });
    }

    expect(store.listPagesBefore('2026-08-28').map((page) => page.id)).toEqual(['two', 'one']);
    store.close();
  });

  test('indexes the newest bounded window rather than walking the archive oldest first', async () => {
    const store = makeStore();
    const extractedPageIds: string[] = [];
    const pages = [
      nestedPage('oldest', '1/1/2024', 'edit-oldest'),
      nestedPage('middle', '6/1/2025', 'edit-middle'),
      nestedPage('newest', '8/28/2026', 'edit-newest'),
    ];

    const summary = await syncWorkoutHistory({
      store,
      notionClient: {
        listNestedPages: async () => pages,
        extractPageContent: async (pageId) => {
          extractedPageIds.push(pageId);
          return [paragraphBlock(pageId)];
        },
      },
      maxPages: 2,
    });

    expect(summary).toMatchObject({ discoveredPages: 3, indexedPages: 2, fetchedPages: 2 });
    expect(extractedPageIds).toEqual(['newest', 'middle']);
    expect(store.getPage('oldest')).toBeNull();
    store.close();
  });
});

function makeStore(): WorkoutHistoryStore {
  tempDirectory = mkdtempSync(join(tmpdir(), 'wgs-history-test-'));
  return new WorkoutHistoryStore(join(tempDirectory, 'history.sqlite'));
}

function nestedPage(id: string, title: string, lastEditedTime: string): NestedWorkoutPage {
  return {
    id,
    title,
    createdTime: 'created',
    lastEditedTime,
  };
}

function paragraphBlock(text: string): BlockWithDepth {
  return {
    id: `block-${text}`,
    type: 'paragraph',
    depth: 0,
    paragraph: {
      rich_text: [{ plain_text: text }],
    },
  } as unknown as BlockWithDepth;
}
