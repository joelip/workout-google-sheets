import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  D1WorkoutHistoryClient,
  loadD1WorkoutHistoryConfig,
  reconcileWorkoutHistory,
  syncWorkoutHistoryWithD1,
  type WorkoutHistoryCloudClient,
} from '../src/d1-workout-history';
import type { CachedWorkoutPage } from '../src/workout-history';
import { WorkoutHistoryStore } from '../src/workout-history';

let tempDirectory: string | undefined;

afterEach(() => {
  if (tempDirectory) {
    rmSync(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  }
});

describe('reconcileWorkoutHistory', () => {
  test('merges pages by Notion edit time and reports both directions', () => {
    const localOnly = cachedPage('local', '2026-08-30', '2026-08-30T10:00:00Z', 'local');
    const remoteOnly = cachedPage('remote', '2026-08-29', '2026-08-29T10:00:00Z', 'remote');
    const localOlder = cachedPage('shared', '2026-08-28', '2026-08-28T10:00:00Z', 'old');
    const remoteNewer = cachedPage('shared', '2026-08-28', '2026-08-28T11:00:00Z', 'new');

    const result = reconcileWorkoutHistory(
      [localOnly, localOlder],
      [remoteOnly, remoteNewer]
    );

    expect(result.pages.map((page) => page.id)).toEqual(['local', 'remote', 'shared']);
    expect(result.pages.find((page) => page.id === 'shared')?.rawBlocks[0]?.id).toBe('new');
    expect(result.uploadedPages).toBe(1);
    expect(result.downloadedPages).toBe(2);
  });

  test('stops on equal edit timestamps with different content', () => {
    const local = cachedPage('shared', '2026-08-28', 'same-time', 'local');
    const remote = cachedPage('shared', '2026-08-28', 'same-time', 'remote');
    expect(() => reconcileWorkoutHistory([local], [remote])).toThrow('sync conflict');
  });

  test('prunes the merged result to the rolling window', () => {
    const pages = Array.from({ length: 50 }, (_, index) =>
      cachedPage(`page-${index}`, `2026-08-${String(index + 1).padStart(2, '0')}`, `edit-${index}`, `${index}`)
    );
    const result = reconcileWorkoutHistory(pages, [], 48);
    expect(result.pages).toHaveLength(48);
    expect(result.prunedPages).toBe(2);
  });
});

describe('D1WorkoutHistoryClient', () => {
  test('uses the authenticated D1 batch query API and validates downloaded hashes', async () => {
    const page = cachedPage('page-1', '2026-08-30', 'edit-1', 'block-1');
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const request = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input: String(input), init });
      const body = JSON.parse(String(init?.body));
      const isSelect = body.batch[0].sql.startsWith('SELECT');
      return Response.json({
        success: true,
        result: [{
          success: true,
          results: isSelect ? [{
            id: page.id,
            title: page.title,
            workout_date: page.workoutDate,
            created_time: page.createdTime,
            last_edited_time: page.lastEditedTime,
            content_hash: page.contentHash,
            content_json: JSON.stringify(page.rawBlocks),
            synced_at: page.syncedAt,
          }] : [],
        }],
      });
    }) as typeof fetch;
    const client = new D1WorkoutHistoryClient({
      accountId: 'account', databaseId: 'database', apiToken: 'token',
    }, request);

    await client.ensureSchema();
    expect(await client.listPages()).toEqual([page]);
    await client.replacePages([page]);

    expect(requests[0]?.input).toContain('/accounts/account/d1/database/database/query');
    expect((requests[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
    const writeBatch = JSON.parse(String(requests[2]?.init?.body)).batch;
    expect(writeBatch).toHaveLength(3);
    expect(writeBatch[0].params).toContain(page.contentHash);
  });

  test('batches page upserts below D1 SQL variable limits', async () => {
    let writeBatch: Array<{ sql: string; params?: string[] }> = [];
    const request = (async (_input: string | URL | Request, init?: RequestInit) => {
      writeBatch = JSON.parse(String(init?.body)).batch;
      return Response.json({
        success: true,
        result: writeBatch.map(() => ({ success: true, results: [] })),
      });
    }) as typeof fetch;
    const client = new D1WorkoutHistoryClient({
      accountId: 'account', databaseId: 'database', apiToken: 'token',
    }, request);

    await client.replacePages(Array.from({ length: 48 }, (_, index) =>
      cachedPage(`page-${index}`, `2026-08-${index}`, `edit-${index}`, `block-${index}`)
    ));

    const upserts = writeBatch.filter((statement) => statement.sql.includes('INSERT INTO workout_pages'));
    expect(upserts).toHaveLength(5);
    expect(Math.max(...upserts.map((statement) => statement.params?.length ?? 0))).toBe(80);
  });
});

describe('syncWorkoutHistoryWithD1', () => {
  test('replaces local and remote mirrors with the reconciled set', async () => {
    const store = makeStore();
    store.upsertCachedPage(cachedPage('local', '2026-08-30', 'edit-2', 'local'));
    const cloud = new FakeCloudClient([
      cachedPage('remote', '2026-08-29', 'edit-1', 'remote'),
    ]);

    const summary = await syncWorkoutHistoryWithD1({
      store,
      cloudClient: cloud,
      now: () => 'sync-time',
    });

    expect(cloud.schemaReady).toBe(true);
    expect(cloud.pages.map((page) => page.id)).toEqual(['local', 'remote']);
    expect(store.listPages().map((page) => page.id)).toEqual(['local', 'remote']);
    expect(summary).toMatchObject({ uploadedPages: 1, downloadedPages: 1, mergedPages: 2 });
    expect(store.getMetadata('lastCloudSyncAt')).toBe('sync-time');
    store.close();
  });
});

describe('loadD1WorkoutHistoryConfig', () => {
  test('uses environment secrets and falls back to the existing R2 account ID', async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'wgs-d1-config-test-'));
    const path = join(tempDirectory, 'config.json');
    await Bun.write(path, JSON.stringify({ r2: { accountId: 'account' }, d1: { databaseId: 'database' } }));
    const config = await loadD1WorkoutHistoryConfig(path, { CLOUDFLARE_API_TOKEN: 'token' });
    expect(config).toEqual({ accountId: 'account', databaseId: 'database', apiToken: 'token' });
  });
});

class FakeCloudClient implements WorkoutHistoryCloudClient {
  schemaReady = false;

  constructor(public pages: CachedWorkoutPage[]) {}

  async ensureSchema(): Promise<void> {
    this.schemaReady = true;
  }

  async listPages(): Promise<CachedWorkoutPage[]> {
    return this.pages;
  }

  async replacePages(pages: CachedWorkoutPage[]): Promise<void> {
    this.pages = pages;
  }
}

function makeStore(): WorkoutHistoryStore {
  tempDirectory = mkdtempSync(join(tmpdir(), 'wgs-d1-history-test-'));
  return new WorkoutHistoryStore(join(tempDirectory, 'history.sqlite'));
}

function cachedPage(
  id: string,
  workoutDate: string,
  lastEditedTime: string,
  blockId: string
): CachedWorkoutPage {
  const rawBlocks = [{ id: blockId, type: 'paragraph', depth: 0 }] as CachedWorkoutPage['rawBlocks'];
  const contentJson = JSON.stringify(rawBlocks);
  return {
    id,
    title: workoutDate,
    workoutDate,
    createdTime: 'created',
    lastEditedTime,
    contentHash: createHash('sha256').update(contentJson).digest('hex'),
    rawBlocks,
    syncedAt: 'synced',
  };
}
