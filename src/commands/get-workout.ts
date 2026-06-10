import { fail } from '../command-runtime';
import {
  formatWorkoutDatePageTitle,
  loadWorkoutPagesConfig,
  NotionWorkoutPageClient,
} from '../notion-workout-pages';
import { renderBlocksToText } from '../post-workout-rendering';
import { R2ImageUploader } from '../r2';

export async function runGetWorkout(dateInput: string): Promise<void> {
  const pageTitle = formatWorkoutDatePageTitle(dateInput);
  const config = await loadWorkoutPagesConfig();
  const notionClient = new NotionWorkoutPageClient(config);
  const pageId = await notionClient.findNestedPage(pageTitle);

  if (!pageId) {
    fail(`Notion page "${pageTitle}" not found in parent page`);
  }

  const blocks = await notionClient.extractPageContent(pageId);
  const imageUploader = config.r2 ? new R2ImageUploader(config.r2) : undefined;
  const renderedBlocks = await renderBlocksToText(blocks, {
    pageId,
    imageUploader,
  });
  const markdown = [`# ${pageTitle}`, renderedBlocks].filter(Boolean).join('\n\n');

  console.log(markdown);
}
