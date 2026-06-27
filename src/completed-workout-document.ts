import { CommandError } from './command-runtime';
import {
  formatWorkoutDatePageTitle,
  formatWorkoutISODate,
  loadWorkoutPagesConfig,
  NotionWorkoutPageClient,
  parseWorkoutDateInput,
} from './notion-workout-pages';
import type {
  NestedWorkoutPage,
  WorkoutPagesConfig,
} from './notion-workout-pages';
import { renderWorkoutTextOutput } from './post-workout-chunking';
import {
  renderBlocksToText,
  splitContentByWorkoutSections,
} from './post-workout-rendering';
import type {
  BlockWithDepth,
  ImageUploader,
  WorkoutContent,
} from './post-workout-rendering';
import { R2ImageUploader } from './r2';

export interface CompletedWorkoutDocument {
  workoutDate: string;
  notionPageTitle: string;
  notionPageId: string;
  completedText: string;
  sections: WorkoutContent;
  rawRenderedMarkdown: string;
  rawBlocks: BlockWithDepth[];
}

export interface CompletedWorkoutPageRef extends NestedWorkoutPage {
  workoutDate: string;
}

export interface CompletedWorkoutDocumentOptions {
  configPath?: string;
  config?: WorkoutPagesConfig;
  notionClient?: Pick<NotionWorkoutPageClient, 'findNestedPage' | 'extractPageContent'>;
  imageUploader?: ImageUploader;
}

export interface CompletedWorkoutPageDocumentOptions {
  configPath?: string;
  config?: WorkoutPagesConfig;
  notionClient?: Pick<NotionWorkoutPageClient, 'extractPageContent'>;
  imageUploader?: ImageUploader;
}

export async function getCompletedWorkoutDocument(
  dateInput: string,
  options: CompletedWorkoutDocumentOptions = {}
): Promise<CompletedWorkoutDocument> {
  const pageTitle = formatWorkoutDatePageTitle(dateInput);
  const config = await getConfig(options);
  const notionClient = options.notionClient ?? new NotionWorkoutPageClient(config);
  const pageId = await notionClient.findNestedPage(pageTitle);

  if (!pageId) {
    throw new CommandError(`Notion page "${pageTitle}" not found in parent page`);
  }

  return getCompletedWorkoutDocumentForPage({
    pageTitle,
    pageId,
    options: {
      ...options,
      config,
      notionClient,
    },
  });
}

export async function getCompletedWorkoutDocumentForPage(params: {
  pageTitle: string;
  pageId: string;
  options?: CompletedWorkoutPageDocumentOptions;
}): Promise<CompletedWorkoutDocument> {
  const options = params.options ?? {};
  const workoutDate = formatWorkoutISODate(params.pageTitle);
  const config = await getConfig(options);
  const notionClient = options.notionClient ?? new NotionWorkoutPageClient(config);
  const imageUploader = options.imageUploader ?? getImageUploader(config);
  const blocks = await notionClient.extractPageContent(params.pageId);
  const rawRenderedMarkdown = await renderBlocksToText(blocks, {
    pageId: params.pageId,
    imageUploader,
  });
  const sections = splitContentByWorkoutSections(rawRenderedMarkdown);
  const completedText = renderWorkoutTextOutput(sections);

  return {
    workoutDate,
    notionPageTitle: params.pageTitle,
    notionPageId: params.pageId,
    completedText,
    sections,
    rawRenderedMarkdown,
    rawBlocks: blocks,
  };
}

export async function listCompletedWorkoutPageRefs(
  options: {
    configPath?: string;
    config?: WorkoutPagesConfig;
    notionClient?: Pick<NotionWorkoutPageClient, 'listNestedPages'>;
  } = {}
): Promise<CompletedWorkoutPageRef[]> {
  const config = await getConfig(options);
  const notionClient = options.notionClient ?? new NotionWorkoutPageClient(config);
  const nestedPages = await notionClient.listNestedPages();

  return nestedPages.flatMap((page) => {
    if (!parseWorkoutDateInput(page.title)) {
      return [];
    }

    return [{
      ...page,
      workoutDate: formatWorkoutISODate(page.title),
    }];
  });
}

async function getConfig(options: {
  configPath?: string;
  config?: WorkoutPagesConfig;
}): Promise<WorkoutPagesConfig> {
  return options.config ?? loadWorkoutPagesConfig(options.configPath);
}

function getImageUploader(config: WorkoutPagesConfig): ImageUploader | undefined {
  return config.r2 ? new R2ImageUploader(config.r2) : undefined;
}
