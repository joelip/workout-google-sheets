import type { BlockObjectResponse, RichTextItemResponse } from '@notionhq/client';
import { CommandError } from './command-runtime';

export interface WorkoutContent {
  overallNotes: string;
  lowerBody: string;
  upperBody: string;
}

export type BlockWithDepth = BlockObjectResponse & { depth: number };

export interface ImageUploader {
  uploadNotionFileImage(params: {
    pageId: string;
    blockId: string;
    sourceUrl: string;
  }): Promise<string>;
}

interface RenderBlocksOptions {
  pageId: string;
  imageUploader?: ImageUploader;
}

export async function renderBlocksToText(
  blocks: BlockWithDepth[],
  options: RenderBlocksOptions
): Promise<string> {
  const renderedLines: string[] = [];

  for (const block of blocks) {
    if (block.type === 'embed') {
      continue;
    }

    const indent = '  '.repeat(block.depth);

    switch (block.type) {
      case 'heading_1': {
        const text = getPlainText(block.heading_1.rich_text);
        if (text) {
          renderedLines.push(`# ${text}`);
        }
        break;
      }
      case 'heading_2': {
        const text = getPlainText(block.heading_2.rich_text);
        if (text) {
          renderedLines.push(`## ${text}`);
        }
        break;
      }
      case 'heading_3': {
        const text = getPlainText(block.heading_3.rich_text);
        if (text) {
          renderedLines.push(`### ${text}`);
        }
        break;
      }
      case 'paragraph': {
        const text = getPlainText(block.paragraph.rich_text);
        renderedLines.push(text ? `${indent}${text}` : '');
        break;
      }
      case 'bulleted_list_item': {
        const text = getPlainText(block.bulleted_list_item.rich_text);
        if (text) {
          renderedLines.push(`${indent}- ${text}`);
        }
        break;
      }
      case 'numbered_list_item': {
        const text = getPlainText(block.numbered_list_item.rich_text);
        if (text) {
          renderedLines.push(`${indent}1. ${text}`);
        }
        break;
      }
      case 'image': {
        renderedLines.push(await renderImageBlock(block, indent, options));
        break;
      }
    }
  }

  return renderedLines.join('\n');
}

export function splitContentByWorkoutSections(markdownContent: string): WorkoutContent {
  const lines = markdownContent.split('\n');
  const overallLines: string[] = [];
  const lowerBodyLines: string[] = [];
  const upperBodyLines: string[] = [];
  const pendingWorkoutLines: string[] = [];
  let currentSection: 'none' | 'overall' | 'lower' | 'upper' = 'none';

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (isWorkoutSectionHeader(trimmedLine, 'overall')) {
      currentSection = 'overall';
      if (overallLines.length === 0) {
        overallLines.push('### Overall Notes:');
      }
      continue;
    }

    if (isWorkoutSectionHeader(trimmedLine, 'lower body')) {
      currentSection = 'lower';
      if (lowerBodyLines.length === 0) {
        lowerBodyLines.push('### Lower Body:');
      }
      appendPendingWorkoutLines(lowerBodyLines, pendingWorkoutLines);
      continue;
    } else if (isWorkoutSectionHeader(trimmedLine, 'upper body')) {
      currentSection = 'upper';
      appendPendingWorkoutLines(lowerBodyLines, pendingWorkoutLines);
      upperBodyLines.push('### Upper Body:');
      continue;
    }

    switch (currentSection) {
      case 'overall':
        overallLines.push(line);
        break;
      case 'lower':
        lowerBodyLines.push(line);
        break;
      case 'upper':
        upperBodyLines.push(line);
        break;
      case 'none':
        if (trimmedLine.length > 0 || pendingWorkoutLines.length > 0) {
          pendingWorkoutLines.push(line);
        }
        break;
    }
  }

  if (currentSection === 'none') {
    appendPendingWorkoutLines(lowerBodyLines, pendingWorkoutLines);
  }

  return {
    overallNotes: overallLines.join('\n').trim(),
    lowerBody: lowerBodyLines.join('\n').trim(),
    upperBody: upperBodyLines.join('\n').trim(),
  };
}

function isWorkoutSectionHeader(
  line: string,
  section: 'overall' | 'lower body' | 'upper body'
): boolean {
  const escapedSection = section.replace(' ', '\\s+');
  return new RegExp(`^(?:#{1,6}\\s*)?${escapedSection}(?:\\s+notes?)?:?\\s*$`, 'i')
    .test(line);
}

function appendPendingWorkoutLines(
  sectionLines: string[],
  pendingWorkoutLines: string[]
): void {
  if (pendingWorkoutLines.length === 0) {
    return;
  }

  sectionLines.push(...pendingWorkoutLines);
  pendingWorkoutLines.length = 0;
}

async function renderImageBlock(
  block: Extract<BlockObjectResponse, { type: 'image' }> & { depth: number },
  indent: string,
  options: RenderBlocksOptions
): Promise<string> {
  const caption = getPlainText(block.image.caption);

  if (block.image.type === 'external') {
    return `${indent}${formatImageLabel(caption, block.image.external.url)}`;
  }

  if (!options.imageUploader) {
    throw new CommandError(
      'Encountered a Notion-hosted image block, but "r2" is missing from config.json.'
    );
  }

  const publicUrl = await options.imageUploader.uploadNotionFileImage({
    pageId: options.pageId,
    blockId: block.id,
    sourceUrl: block.image.file.url,
  });

  return `${indent}${formatImageLabel(caption, publicUrl)}`;
}

function getPlainText(richText?: RichTextItemResponse[]): string {
  return richText
    ?.map((item) => item.plain_text)
    .join('')
    .trim() ?? '';
}

function formatImageLabel(caption: string, url: string): string {
  return caption ? `Image (${caption}): ${url}` : `Image: ${url}`;
}
