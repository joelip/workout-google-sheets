import {
  type CompletedWorkoutPageRef,
  getCompletedWorkoutDocumentForPage,
  listCompletedWorkoutPageRefs,
} from '../completed-workout-document';
import {
  loadWorkoutPagesConfig,
  NotionWorkoutPageClient,
} from '../notion-workout-pages';
import {
  type WorkoutDateRange,
  resolveWorkoutDateRangeOptions,
} from '../workout-date-ranges';

interface GetWorkoutsOptions {
  start?: string;
  end?: string;
  weekOf?: string;
  month?: string;
}

export async function runGetWorkouts(options: GetWorkoutsOptions): Promise<void> {
  const dateRange = resolveWorkoutDateRangeOptions(options);
  const config = await loadWorkoutPagesConfig();
  const notionClient = new NotionWorkoutPageClient(config);
  const pageRefs = await listCompletedWorkoutPageRefs({
    config,
    notionClient,
  });
  const matchingPageRefs = selectWorkoutPageRefsForDateRange(pageRefs, dateRange);

  if (matchingPageRefs.length === 0) {
    console.log(`No workouts found from ${dateRange.startDate} to ${dateRange.endDate}.`);
    return;
  }

  const renderedWorkouts: string[] = [];

  for (const pageRef of matchingPageRefs) {
    const document = await getCompletedWorkoutDocumentForPage({
      pageTitle: pageRef.title,
      pageId: pageRef.id,
      options: {
        config,
        notionClient,
      },
    });

    renderedWorkouts.push(
      [`## ${document.notionPageTitle}`, document.rawRenderedMarkdown]
        .filter(Boolean)
        .join('\n\n')
    );
  }

  const markdown = [
    `# Workouts: ${dateRange.label}`,
    ...renderedWorkouts,
  ].join('\n\n');

  console.log(markdown);
}

export function selectWorkoutPageRefsForDateRange(
  pageRefs: CompletedWorkoutPageRef[],
  dateRange: WorkoutDateRange
): CompletedWorkoutPageRef[] {
  return pageRefs
    .filter((pageRef) => (
      pageRef.workoutDate >= dateRange.startDate
      && pageRef.workoutDate <= dateRange.endDate
    ))
    .sort((left, right) => left.workoutDate.localeCompare(right.workoutDate));
}
