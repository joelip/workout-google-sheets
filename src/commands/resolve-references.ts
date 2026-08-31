import { fail } from '../command-runtime';
import {
  formatWorkoutDatePageTitleFromDate,
  formatWorkoutISODate,
  loadWorkoutPagesConfig,
  NotionWorkoutPageClient,
} from '../notion-workout-pages';
import {
  buildReferenceResolutionPlan,
  preflightReferenceApplication,
  verifyReferenceApplication,
} from '../workout-reference-resolver';
import type { ReferenceResolutionPlan } from '../workout-reference-resolver';
import { WorkoutHistoryStore } from '../workout-history';

interface ResolveReferencesOptions {
  date?: string;
  state?: string;
  json?: boolean;
  apply?: boolean;
  planHash?: string;
}

export async function runResolveReferences(options: ResolveReferencesOptions): Promise<void> {
  if (!options.date) {
    fail('Missing --date <date>. Use YYYY-MM-DD, M/D/YYYY, or today.');
  }

  const dateInput = options.date.toLowerCase() === 'today'
    ? formatWorkoutDatePageTitleFromDate(new Date())
    : options.date;
  const workoutDate = formatWorkoutISODate(dateInput);
  const store = new WorkoutHistoryStore(options.state, { readOnly: !options.apply });

  try {
    const targetPage = store.getPageByWorkoutDate(workoutDate);
    if (!targetPage) {
      fail(
        `Workout ${workoutDate} is not in the local history index. Run "./wgs history sync" first.`
      );
    }

    const plan = buildReferenceResolutionPlan({
      targetPage,
      previousPages: store.listPagesBefore(workoutDate),
    });

    if (!options.apply) {
      printResult({ mode: 'dry-run', plan }, options.json);
      return;
    }

    if (!options.planHash) {
      fail('Applying references requires --plan-hash from a reviewed dry run.');
    }
    if (options.planHash !== plan.planHash) {
      fail('Plan hash does not match the current cached preview. Run a new dry run and review it.');
    }
    if (plan.edits.length === 0) {
      printResult({ mode: 'apply', plan, appliedEdits: 0 }, options.json);
      return;
    }

    const appliedEdits = await applyReferenceResolutionPlan({ plan, store });
    printResult({ mode: 'apply', plan, appliedEdits }, options.json);
  } finally {
    store.close();
  }
}

async function applyReferenceResolutionPlan(params: {
  plan: ReferenceResolutionPlan;
  store: WorkoutHistoryStore;
}): Promise<number> {
  const config = await loadWorkoutPagesConfig();
  const notionClient = new NotionWorkoutPageClient(config);
  const matchingPages = (await notionClient.listNestedPages())
    .filter((page) => page.id === params.plan.target.pageId);

  if (matchingPages.length !== 1) {
    fail('Target Notion workout page is missing or duplicated; run history sync and review manually.');
  }

  const livePage = matchingPages[0]!;
  const liveBlocks = await notionClient.extractPageContent(livePage.id);
  preflightReferenceApplication({
    plan: params.plan,
    livePageLastEditedTime: livePage.lastEditedTime,
    liveBlocks,
  });

  let appliedEdits = 0;
  try {
    for (const edit of params.plan.edits) {
      await notionClient.updateParagraphText(edit.blockId, edit.after);
      appliedEdits += 1;
    }
  } catch (error) {
    throw new Error(
      `Reference apply stopped after ${appliedEdits}/${params.plan.edits.length} updates; manual review required: ${formatError(error)}`
    );
  }

  const verifiedBlocks = await notionClient.extractPageContent(livePage.id);
  verifyReferenceApplication(params.plan, verifiedBlocks);
  const refreshedPage = (await notionClient.listNestedPages())
    .find((page) => page.id === livePage.id);
  if (!refreshedPage) {
    throw new Error('Updated Notion page could not be found during cache refresh; manual review required');
  }
  params.store.upsertPage({
    page: refreshedPage,
    workoutDate: params.plan.target.workoutDate,
    rawBlocks: verifiedBlocks,
    syncedAt: new Date().toISOString(),
  });

  return appliedEdits;
}

function printResult(
  result: {
    mode: 'dry-run' | 'apply';
    plan: ReferenceResolutionPlan;
    appliedEdits?: number;
  },
  json: boolean | undefined
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`${result.mode === 'dry-run' ? 'Dry run' : 'Applied'}: ${result.plan.target.pageTitle}`);
  console.log(`Plan hash: ${result.plan.planHash}`);
  if (result.plan.edits.length === 0) {
    console.log('No resolvable earlier-workout references found.');
  }
  for (const edit of result.plan.edits) {
    console.log(`- ${edit.before}`);
    console.log(`  -> ${edit.after}`);
    console.log(`  source: ${edit.source.pageTitle} — ${edit.source.text}`);
  }
  for (const unresolved of result.plan.unresolved) {
    console.log(`- unresolved: ${unresolved.text} (${unresolved.reason})`);
  }
  if (result.mode === 'dry-run' && result.plan.edits.length > 0) {
    console.log('No Notion blocks were changed.');
    console.log(`To apply after review, rerun with --apply --plan-hash ${result.plan.planHash}`);
  } else if (result.mode === 'apply') {
    console.log(`Verified applied edits: ${result.appliedEdits ?? 0}`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
