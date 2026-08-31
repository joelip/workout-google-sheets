import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { BlockWithDepth } from './post-workout-rendering';
import {
  formatWorkoutISODate,
  parseWorkoutDateInput,
} from './notion-workout-pages';
import type { NestedWorkoutPage } from './notion-workout-pages';

const DEFAULT_HISTORY_PATH = '~/.codex/state/workout-google-sheets/history.sqlite';
export const DEFAULT_HISTORY_WEEK_LIMIT = 12;
export const DEFAULT_WORKOUTS_PER_WEEK = 4;
export const DEFAULT_HISTORY_PAGE_LIMIT =
  DEFAULT_HISTORY_WEEK_LIMIT * DEFAULT_WORKOUTS_PER_WEEK;

export interface CachedWorkoutPage {
  id: string;
  title: string;
  workoutDate: string;
  createdTime: string;
  lastEditedTime: string;
  contentHash: string;
  rawBlocks: BlockWithDepth[];
  syncedAt: string;
}

export interface WorkoutHistorySyncClient {
  listNestedPages(): Promise<NestedWorkoutPage[]>;
  extractPageContent(pageId: string): Promise<BlockWithDepth[]>;
}

export interface WorkoutHistorySyncSummary {
  statePath: string;
  discoveredPages: number;
  indexedPages: number;
  fetchedPages: number;
  unchangedPages: number;
  removedPages: number;
  syncedAt: string;
}

interface WorkoutPageRow {
  id: string;
  title: string;
  workout_date: string;
  created_time: string;
  last_edited_time: string;
  content_hash: string;
  content_json: string;
  synced_at: string;
}

export class WorkoutHistoryStore {
  readonly path: string;
  private readonly database: Database;

  constructor(
    path: string = DEFAULT_HISTORY_PATH,
    options: { readOnly?: boolean } = {}
  ) {
    this.path = resolveHistoryPath(path);
    if (options.readOnly) {
      this.database = new Database(this.path, { readonly: true });
      return;
    }

    mkdirSync(dirname(this.path), { recursive: true });
    this.database = new Database(this.path, { create: true });
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workout_pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workout_date TEXT NOT NULL,
        created_time TEXT NOT NULL,
        last_edited_time TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content_json TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workout_pages_date_idx
        ON workout_pages(workout_date DESC);
      CREATE TABLE IF NOT EXISTS history_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    chmodSync(this.path, 0o600);
  }

  close(): void {
    this.database.close();
  }

  getPage(id: string): CachedWorkoutPage | null {
    const row = this.database
      .query<WorkoutPageRow, [string]>('SELECT * FROM workout_pages WHERE id = ?')
      .get(id);
    return row ? pageFromRow(row) : null;
  }

  getPageByWorkoutDate(workoutDate: string): CachedWorkoutPage | null {
    const rows = this.database
      .query<WorkoutPageRow, [string]>(
        'SELECT * FROM workout_pages WHERE workout_date = ? ORDER BY last_edited_time DESC'
      )
      .all(workoutDate);

    if (rows.length > 1) {
      throw new Error(`Multiple cached Notion workout pages found for ${workoutDate}`);
    }

    const row = rows[0];
    return row ? pageFromRow(row) : null;
  }

  listPagesBefore(workoutDate: string): CachedWorkoutPage[] {
    return this.database
      .query<WorkoutPageRow, [string]>(
        'SELECT * FROM workout_pages WHERE workout_date < ? ORDER BY workout_date DESC'
      )
      .all(workoutDate)
      .map(pageFromRow);
  }

  listPages(): CachedWorkoutPage[] {
    return this.database
      .query<WorkoutPageRow, []>(
        'SELECT * FROM workout_pages ORDER BY workout_date DESC, last_edited_time DESC, id ASC'
      )
      .all()
      .map(pageFromRow);
  }

  listPageMetadata(): Map<string, Pick<CachedWorkoutPage, 'title' | 'workoutDate' | 'lastEditedTime'>> {
    const rows = this.database
      .query<Pick<WorkoutPageRow, 'id' | 'title' | 'workout_date' | 'last_edited_time'>, []>(
        'SELECT id, title, workout_date, last_edited_time FROM workout_pages'
      )
      .all();

    return new Map(rows.map((row) => [row.id, {
      title: row.title,
      workoutDate: row.workout_date,
      lastEditedTime: row.last_edited_time,
    }]));
  }

  upsertPage(params: {
    page: NestedWorkoutPage;
    workoutDate: string;
    rawBlocks: BlockWithDepth[];
    syncedAt: string;
  }): void {
    const contentJson = JSON.stringify(params.rawBlocks);
    const contentHash = createHash('sha256').update(contentJson).digest('hex');
    this.database.query(`
      INSERT INTO workout_pages (
        id, title, workout_date, created_time, last_edited_time,
        content_hash, content_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        workout_date = excluded.workout_date,
        created_time = excluded.created_time,
        last_edited_time = excluded.last_edited_time,
        content_hash = excluded.content_hash,
        content_json = excluded.content_json,
        synced_at = excluded.synced_at
    `).run(
      params.page.id,
      params.page.title,
      params.workoutDate,
      params.page.createdTime,
      params.page.lastEditedTime,
      contentHash,
      contentJson,
      params.syncedAt
    );
  }

  upsertCachedPage(page: CachedWorkoutPage): void {
    const contentJson = JSON.stringify(page.rawBlocks);
    const contentHash = createHash('sha256').update(contentJson).digest('hex');
    if (contentHash !== page.contentHash) {
      throw new Error(`Workout history content hash mismatch for page ${page.id}`);
    }

    this.database.query(`
      INSERT INTO workout_pages (
        id, title, workout_date, created_time, last_edited_time,
        content_hash, content_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        workout_date = excluded.workout_date,
        created_time = excluded.created_time,
        last_edited_time = excluded.last_edited_time,
        content_hash = excluded.content_hash,
        content_json = excluded.content_json,
        synced_at = excluded.synced_at
    `).run(
      page.id,
      page.title,
      page.workoutDate,
      page.createdTime,
      page.lastEditedTime,
      page.contentHash,
      contentJson,
      page.syncedAt
    );
  }

  replacePages(pages: CachedWorkoutPage[]): number {
    const transaction = this.database.transaction((replacementPages: CachedWorkoutPage[]) => {
      for (const page of replacementPages) {
        this.upsertCachedPage(page);
      }
      return this.deletePagesExcept(new Set(replacementPages.map((page) => page.id)));
    });
    return transaction(pages);
  }

  deletePagesExcept(pageIds: Set<string>): number {
    const existingIds = this.database
      .query<{ id: string }, []>('SELECT id FROM workout_pages')
      .all()
      .map((row) => row.id);
    const deletedIds = existingIds.filter((id) => !pageIds.has(id));
    const remove = this.database.query('DELETE FROM workout_pages WHERE id = ?');
    const transaction = this.database.transaction((ids: string[]) => {
      for (const id of ids) {
        remove.run(id);
      }
    });
    transaction(deletedIds);
    return deletedIds.length;
  }

  setMetadata(key: string, value: string): void {
    this.database.query(`
      INSERT INTO history_metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  getMetadata(key: string): string | null {
    return this.database
      .query<{ value: string }, [string]>('SELECT value FROM history_metadata WHERE key = ?')
      .get(key)?.value ?? null;
  }
}

export async function syncWorkoutHistory(params: {
  store: WorkoutHistoryStore;
  notionClient: WorkoutHistorySyncClient;
  concurrency?: number;
  maxPages?: number;
  now?: () => string;
}): Promise<WorkoutHistorySyncSummary> {
  const syncedAt = params.now?.() ?? new Date().toISOString();
  const nestedPages = await params.notionClient.listNestedPages();
  const datedPages = nestedPages.flatMap((page) => {
    if (!parseWorkoutDateInput(page.title)) {
      return [];
    }

    return [{ page, workoutDate: formatWorkoutISODate(page.title) }];
  });
  const indexedPages = datedPages
    .sort((left, right) => right.workoutDate.localeCompare(left.workoutDate))
    .slice(0, params.maxPages ?? DEFAULT_HISTORY_PAGE_LIMIT);
  const cachedMetadata = params.store.listPageMetadata();
  const changedPages = indexedPages.filter(({ page, workoutDate }) => {
    const cached = cachedMetadata.get(page.id);
    return !cached
      || cached.title !== page.title
      || cached.workoutDate !== workoutDate
      || cached.lastEditedTime !== page.lastEditedTime;
  });

  await mapWithConcurrency(
    changedPages,
    params.concurrency ?? 3,
    async ({ page, workoutDate }) => {
      const rawBlocks = await params.notionClient.extractPageContent(page.id);
      params.store.upsertPage({ page, workoutDate, rawBlocks, syncedAt });
    }
  );

  const removedPages = params.store.deletePagesExcept(
    new Set(indexedPages.map(({ page }) => page.id))
  );
  params.store.setMetadata('lastFullSyncAt', syncedAt);

  return {
    statePath: params.store.path,
    discoveredPages: datedPages.length,
    indexedPages: indexedPages.length,
    fetchedPages: changedPages.length,
    unchangedPages: indexedPages.length - changedPages.length,
    removedPages,
    syncedAt,
  };
}

export function resolveHistoryPath(path: string | undefined): string {
  const selectedPath = path || DEFAULT_HISTORY_PATH;
  if (selectedPath === '~') {
    return homedir();
  }
  if (selectedPath.startsWith('~/')) {
    return resolve(homedir(), selectedPath.slice(2));
  }
  return resolve(selectedPath);
}

function pageFromRow(row: WorkoutPageRow): CachedWorkoutPage {
  return {
    id: row.id,
    title: row.title,
    workoutDate: row.workout_date,
    createdTime: row.created_time,
    lastEditedTime: row.last_edited_time,
    contentHash: row.content_hash,
    rawBlocks: JSON.parse(row.content_json) as BlockWithDepth[],
    syncedAt: row.synced_at,
  };
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>
): Promise<void> {
  const queue = [...values];
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const value = queue.shift();
      if (value !== undefined) {
        await operation(value);
      }
    }
  }));
}
