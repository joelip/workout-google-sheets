import { fail } from '../command-runtime';
import {
  type CompletedWorkoutPageRef,
  listCompletedWorkoutPageRefs,
} from '../completed-workout-document';
import {
  loadWorkoutPagesConfig,
  NotionWorkoutPageClient,
} from '../notion-workout-pages';

interface GetWorkoutDatesOptions {
  limit?: string;
}

export async function runGetWorkoutDates(options: GetWorkoutDatesOptions): Promise<void> {
  const limit = resolveWorkoutDateLimit(options.limit);
  const config = await loadWorkoutPagesConfig();
  const notionClient = new NotionWorkoutPageClient(config);
  const pageRefs = await listCompletedWorkoutPageRefs({
    config,
    notionClient,
  });

  const latestPageRefs = selectLatestWorkoutPageRefs(pageRefs, limit);
  if (latestPageRefs.length > 0) {
    console.log(latestPageRefs.map((pageRef) => pageRef.title).join('\n'));
  }
}

export function resolveWorkoutDateLimit(value: string | undefined): number {
  if (value === undefined) {
    fail('Missing --limit <count> argument.');
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    fail('--limit must be a positive integer.');
  }

  return limit;
}

export function selectLatestWorkoutPageRefs(
  pageRefs: CompletedWorkoutPageRef[],
  limit: number
): CompletedWorkoutPageRef[] {
  return [...pageRefs]
    .sort((left, right) => right.workoutDate.localeCompare(left.workoutDate))
    .slice(0, limit);
}
