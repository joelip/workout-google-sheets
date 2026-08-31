import { loadWorkoutPagesConfig, NotionWorkoutPageClient } from '../notion-workout-pages';
import {
  DEFAULT_HISTORY_PAGE_LIMIT,
  syncWorkoutHistory,
  WorkoutHistoryStore,
} from '../workout-history';
import {
  D1WorkoutHistoryClient,
  loadD1WorkoutHistoryConfig,
  syncWorkoutHistoryWithD1,
} from '../d1-workout-history';

interface HistorySyncOptions {
  state?: string;
  json?: boolean;
  limit?: string;
}

interface HistoryCloudSyncOptions extends HistorySyncOptions {
  config?: string;
}

export async function runHistorySync(options: HistorySyncOptions): Promise<void> {
  const config = await loadWorkoutPagesConfig();
  const notionClient = new NotionWorkoutPageClient(config);
  const store = new WorkoutHistoryStore(options.state);
  const maxPages = resolveHistoryLimit(options.limit);

  try {
    const summary = await syncWorkoutHistory({ store, notionClient, maxPages });
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log(`Workout history synced to ${summary.statePath}`);
    console.log(`Dated pages available in Notion: ${summary.discoveredPages}`);
    console.log(`Recent pages kept in the rolling index: ${summary.indexedPages}`);
    console.log(`Fetched new or changed pages: ${summary.fetchedPages}`);
    console.log(`Reused unchanged cached pages: ${summary.unchangedPages}`);
    console.log(`Removed stale cached pages: ${summary.removedPages}`);
  } finally {
    store.close();
  }
}

export async function runHistoryCloudSync(options: HistoryCloudSyncOptions): Promise<void> {
  const config = await loadD1WorkoutHistoryConfig(options.config);
  const cloudClient = new D1WorkoutHistoryClient(config);
  const store = new WorkoutHistoryStore(options.state);
  const limit = resolveHistoryLimit(options.limit);

  try {
    const summary = await syncWorkoutHistoryWithD1({ store, cloudClient, limit });
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log(`Workout history reconciled with Cloudflare D1`);
    console.log(`Local cache: ${summary.statePath}`);
    console.log(`Local pages before sync: ${summary.localPagesBefore}`);
    console.log(`Remote pages before sync: ${summary.remotePagesBefore}`);
    console.log(`Pages retained: ${summary.mergedPages}`);
    console.log(`Pages uploaded: ${summary.uploadedPages}`);
    console.log(`Pages downloaded: ${summary.downloadedPages}`);
    console.log(`Pages pruned outside the rolling window: ${summary.prunedPages}`);
  } finally {
    store.close();
  }
}

export function resolveHistoryLimit(rawLimit: string | undefined): number {
  if (rawLimit === undefined) {
    return DEFAULT_HISTORY_PAGE_LIMIT;
  }
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
    throw new Error('--limit must be a positive integer');
  }
  return Number(rawLimit);
}
