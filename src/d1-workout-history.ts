import { createHash } from 'node:crypto';
import {
  createWorkoutContentHash,
  type CachedWorkoutPage,
} from './workout-history';
import { DEFAULT_HISTORY_PAGE_LIMIT, WorkoutHistoryStore } from './workout-history';

export interface D1WorkoutHistoryConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

interface D1QueryResult<Row> {
  success?: boolean;
  results?: Row[];
}

interface CloudflareResponse<Row> {
  success: boolean;
  result?: D1QueryResult<Row>[];
  errors?: Array<{ message?: string }>;
}

interface D1WorkoutPageRow {
  id: string;
  title: string;
  workout_date: string;
  created_time: string;
  last_edited_time: string;
  content_hash: string;
  content_json: string;
  synced_at: string;
}

export interface WorkoutHistoryCloudClient {
  ensureSchema(): Promise<void>;
  listPages(): Promise<CachedWorkoutPage[]>;
  replacePages(pages: CachedWorkoutPage[]): Promise<void>;
}

export interface WorkoutHistoryCloudSyncSummary {
  statePath: string;
  localPagesBefore: number;
  remotePagesBefore: number;
  mergedPages: number;
  uploadedPages: number;
  downloadedPages: number;
  prunedPages: number;
  syncedAt: string;
}

export interface ReconciledWorkoutHistory {
  pages: CachedWorkoutPage[];
  uploadedPages: number;
  downloadedPages: number;
  prunedPages: number;
}

export class D1WorkoutHistoryClient implements WorkoutHistoryCloudClient {
  private readonly endpoint: string;

  constructor(
    private readonly config: D1WorkoutHistoryConfig,
    private readonly request: typeof fetch = fetch
  ) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/d1/database/${encodeURIComponent(config.databaseId)}/query`;
  }

  async ensureSchema(): Promise<void> {
    await this.query([
      {
        sql: `CREATE TABLE IF NOT EXISTS workout_pages (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          workout_date TEXT NOT NULL,
          created_time TEXT NOT NULL,
          last_edited_time TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          content_json TEXT NOT NULL,
          synced_at TEXT NOT NULL
        )`,
      },
      {
        sql: 'CREATE INDEX IF NOT EXISTS workout_pages_date_idx ON workout_pages(workout_date DESC)',
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS history_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
      },
    ]);
  }

  async listPages(): Promise<CachedWorkoutPage[]> {
    const [result] = await this.query<D1WorkoutPageRow>([{
      sql: 'SELECT * FROM workout_pages ORDER BY workout_date DESC, last_edited_time DESC, id ASC',
    }]);
    return (result?.results ?? []).map(pageFromD1Row);
  }

  async replacePages(pages: CachedWorkoutPage[]): Promise<void> {
    const statements: Array<{ sql: string; params?: string[] }> = [];
    if (pages.length > 0) {
      for (const pageBatch of chunkPages(pages, 10)) {
        const placeholders = pageBatch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        statements.push({
          sql: `INSERT INTO workout_pages (
            id, title, workout_date, created_time, last_edited_time,
            content_hash, content_json, synced_at
          ) VALUES ${placeholders}
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            workout_date = excluded.workout_date,
            created_time = excluded.created_time,
            last_edited_time = excluded.last_edited_time,
            content_hash = excluded.content_hash,
            content_json = excluded.content_json,
            synced_at = excluded.synced_at
          WHERE excluded.last_edited_time > workout_pages.last_edited_time
            OR (
              excluded.last_edited_time = workout_pages.last_edited_time
              AND excluded.content_hash = workout_pages.content_hash
              AND (
                excluded.title != workout_pages.title
                OR excluded.workout_date != workout_pages.workout_date
                OR excluded.synced_at != workout_pages.synced_at
              )
            )`,
          params: pageBatch.flatMap((page) => [
            page.id,
            page.title,
            page.workoutDate,
            page.createdTime,
            page.lastEditedTime,
            page.contentHash,
            JSON.stringify(page.rawBlocks),
            page.syncedAt,
          ]),
        });
      }
      statements.push({
        sql: `DELETE FROM workout_pages WHERE id IN (
          SELECT id FROM workout_pages
          ORDER BY workout_date DESC, last_edited_time DESC, id ASC
          LIMIT -1 OFFSET ?
        )`,
        params: [String(pages.length)],
      });
    }
    statements.push({
      sql: `INSERT INTO history_metadata (key, value) VALUES ('lastCloudSyncAt', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      params: [new Date().toISOString()],
    });
    await this.query(statements);
  }

  private async query<Row = unknown>(
    batch: Array<{ sql: string; params?: string[] }>
  ): Promise<D1QueryResult<Row>[]> {
    const response = await this.request(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch }),
    });
    const payload = await response.json() as CloudflareResponse<Row>;
    if (!response.ok || !payload.success || payload.result?.some((result) => result.success === false)) {
      const details = payload.errors?.map((error) => error.message).filter(Boolean).join('; ');
      throw new Error(`Cloudflare D1 query failed${details ? `: ${details}` : ` (HTTP ${response.status})`}`);
    }
    return payload.result ?? [];
  }
}

export async function loadD1WorkoutHistoryConfig(
  configPath: string = 'config.json',
  environment: Record<string, string | undefined> = process.env
): Promise<D1WorkoutHistoryConfig> {
  const config = await Bun.file(configPath).json() as {
    d1?: { accountId?: string; databaseId?: string; apiToken?: string };
    r2?: { accountId?: string };
  };
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID
    ?? config.d1?.accountId
    ?? config.r2?.accountId;
  const databaseId = environment.CLOUDFLARE_D1_DATABASE_ID ?? config.d1?.databaseId;
  const apiToken = environment.CLOUDFLARE_API_TOKEN ?? config.d1?.apiToken;
  const missing = [
    !accountId && 'CLOUDFLARE_ACCOUNT_ID or d1.accountId',
    !databaseId && 'CLOUDFLARE_D1_DATABASE_ID or d1.databaseId',
    !apiToken && 'CLOUDFLARE_API_TOKEN or d1.apiToken',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing D1 configuration: ${missing.join(', ')}`);
  }
  return { accountId: accountId!, databaseId: databaseId!, apiToken: apiToken! };
}

export function reconcileWorkoutHistory(
  localPages: CachedWorkoutPage[],
  remotePages: CachedWorkoutPage[],
  limit: number = DEFAULT_HISTORY_PAGE_LIMIT
): ReconciledWorkoutHistory {
  const local = new Map(localPages.map((page) => [page.id, page]));
  const remote = new Map(remotePages.map((page) => [page.id, page]));
  const ids = new Set([...local.keys(), ...remote.keys()]);
  const merged: CachedWorkoutPage[] = [];

  for (const id of ids) {
    const localPage = local.get(id);
    const remotePage = remote.get(id);
    if (!localPage) {
      merged.push(remotePage!);
      continue;
    }
    if (!remotePage) {
      merged.push(localPage);
      continue;
    }
    if (
      localPage.lastEditedTime === remotePage.lastEditedTime
      && localPage.contentHash !== remotePage.contentHash
    ) {
      throw new Error(
        `D1 sync conflict for workout page ${id}: identical Notion edit times have different content hashes`
      );
    }
    merged.push(
      localPage.lastEditedTime >= remotePage.lastEditedTime ? localPage : remotePage
    );
  }

  const pages = merged
    .sort((left, right) =>
      right.workoutDate.localeCompare(left.workoutDate)
      || right.lastEditedTime.localeCompare(left.lastEditedTime)
      || left.id.localeCompare(right.id)
    )
    .slice(0, limit);
  const selectedIds = new Set(pages.map((page) => page.id));
  const uploadedPages = pages.filter((page) => !samePage(remote.get(page.id), page)).length;
  const downloadedPages = pages.filter((page) => !samePage(local.get(page.id), page)).length;

  return {
    pages,
    uploadedPages,
    downloadedPages,
    prunedPages: ids.size - selectedIds.size,
  };
}

export async function syncWorkoutHistoryWithD1(params: {
  store: WorkoutHistoryStore;
  cloudClient: WorkoutHistoryCloudClient;
  limit?: number;
  now?: () => string;
}): Promise<WorkoutHistoryCloudSyncSummary> {
  await params.cloudClient.ensureSchema();
  const localPages = params.store.listPages();
  const remotePages = await params.cloudClient.listPages();
  const reconciliation = reconcileWorkoutHistory(
    localPages,
    remotePages,
    params.limit ?? DEFAULT_HISTORY_PAGE_LIMIT
  );
  await params.cloudClient.replacePages(reconciliation.pages);
  params.store.replacePages(reconciliation.pages);
  const syncedAt = params.now?.() ?? new Date().toISOString();
  params.store.setMetadata('lastCloudSyncAt', syncedAt);
  return {
    statePath: params.store.path,
    localPagesBefore: localPages.length,
    remotePagesBefore: remotePages.length,
    mergedPages: reconciliation.pages.length,
    uploadedPages: reconciliation.uploadedPages,
    downloadedPages: reconciliation.downloadedPages,
    prunedPages: reconciliation.prunedPages,
    syncedAt,
  };
}

function pageFromD1Row(row: D1WorkoutPageRow): CachedWorkoutPage {
  const rawBlocks = JSON.parse(row.content_json) as CachedWorkoutPage['rawBlocks'];
  const normalizedHash = createWorkoutContentHash(rawBlocks);
  const legacyHash = createHash('sha256').update(row.content_json).digest('hex');
  if (row.content_hash !== normalizedHash && row.content_hash !== legacyHash) {
    throw new Error(`D1 workout history content hash mismatch for page ${row.id}`);
  }
  return {
    id: row.id,
    title: row.title,
    workoutDate: row.workout_date,
    createdTime: row.created_time,
    lastEditedTime: row.last_edited_time,
    contentHash: normalizedHash,
    rawBlocks,
    syncedAt: row.synced_at,
  };
}

function samePage(left: CachedWorkoutPage | undefined, right: CachedWorkoutPage): boolean {
  return Boolean(
    left
    && left.title === right.title
    && left.workoutDate === right.workoutDate
    && left.createdTime === right.createdTime
    && left.lastEditedTime === right.lastEditedTime
    && left.contentHash === right.contentHash
  );
}

function chunkPages(pages: CachedWorkoutPage[], size: number): CachedWorkoutPage[][] {
  const chunks: CachedWorkoutPage[][] = [];
  for (let index = 0; index < pages.length; index += size) {
    chunks.push(pages.slice(index, index + size));
  }
  return chunks;
}
