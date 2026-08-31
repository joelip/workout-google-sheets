import fs from 'fs/promises';
import {
  APIErrorCode,
  APIResponseError,
  Client,
  isFullBlock,
} from '@notionhq/client';
import type { BlockObjectResponse } from '@notionhq/client';
import type { R2Config } from './r2';
import type { BlockWithDepth } from './post-workout-rendering';
import { fail } from './command-runtime';

export interface WorkoutPagesConfig {
  notion: {
    token: string;
    parentPageId: string;
  };
  r2?: R2Config;
  defaults?: {
    sheetOwner?: string;
    sheetTitle?: string;
  };
}

export interface NestedWorkoutPage {
  id: string;
  title: string;
  createdTime: string;
  lastEditedTime: string;
}

export async function loadWorkoutPagesConfig(
  configPath: string = 'config.json'
): Promise<WorkoutPagesConfig> {
  const configContent = await fs.readFile(configPath, 'utf8');
  return JSON.parse(configContent);
}

export function parseWorkoutDateInput(dateInput: string): ParsedWorkoutDate | null {
  return parseWorkoutDate(dateInput.trim());
}

export function formatWorkoutISODate(dateInput: string): string {
  const parsedDate = parseWorkoutDateInput(dateInput);

  if (!parsedDate) {
    fail(
      `Invalid workout date "${dateInput}". Use YYYY-MM-DD or M/D/YYYY (for example, 2026-01-27 or 1/27/2026).`
    );
  }

  return [
    String(parsedDate.year).padStart(4, '0'),
    String(parsedDate.month).padStart(2, '0'),
    String(parsedDate.day).padStart(2, '0'),
  ].join('-');
}

export function formatWorkoutDatePageTitle(dateInput: string): string {
  const trimmed = dateInput.trim();
  const parsedDate = parseWorkoutDateInput(trimmed);

  if (!parsedDate) {
    fail(
      `Invalid workout date "${dateInput}". Use YYYY-MM-DD or M/D/YYYY (for example, 2026-01-27 or 1/27/2026).`
    );
  }

  return `${parsedDate.month}/${parsedDate.day}/${parsedDate.year}`;
}

export function formatWorkoutDatePageTitleFromDate(date: Date): string {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export class NotionWorkoutPageClient {
  private notion: Client;
  private parentPageId: string;
  private nextReadRequestAt = 0;
  private readQueue: Promise<void> = Promise.resolve();

  constructor(config: WorkoutPagesConfig) {
    this.notion = new Client({
      auth: config.notion.token,
    });
    this.parentPageId = config.notion.parentPageId;
  }

  async findNestedPage(pageTitle: string): Promise<string | null> {
    const pages = await this.listNestedPages();
    const page = pages.find((nestedPage) => nestedPage.title === pageTitle);
    return page?.id ?? null;
  }

  async listNestedPages(): Promise<NestedWorkoutPage[]> {
    const pages: NestedWorkoutPage[] = [];
    let hasMore = true;
    let nextCursor: string | undefined;

    while (hasMore) {
      const response = await this.scheduleRead(() =>
        this.notion.blocks.children.list({
          block_id: this.parentPageId,
          page_size: 100,
          start_cursor: nextCursor,
        })
      );

      for (const block of response.results) {
        if (!isFullBlock(block)) {
          continue;
        }

        if (block.type === 'child_page') {
          pages.push({
            id: block.id,
            title: block.child_page.title,
            createdTime: block.created_time,
            lastEditedTime: block.last_edited_time,
          });
        }
      }

      hasMore = response.has_more;
      nextCursor = response.next_cursor || undefined;
    }

    return pages;
  }

  async extractPageContent(pageId: string): Promise<BlockWithDepth[]> {
    return this.extractDescendants(pageId, 0);
  }

  async updateParagraphText(blockId: string, text: string): Promise<void> {
    await this.notion.blocks.update({
      block_id: blockId,
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: text },
        }],
      },
    });
  }

  private async listChildren(blockId: string): Promise<BlockObjectResponse[]> {
    const children: BlockObjectResponse[] = [];
    let hasMore = true;
    let nextCursor: string | undefined;

    while (hasMore) {
      const response = await this.scheduleRead(() =>
        this.notion.blocks.children.list({
          block_id: blockId,
          page_size: 100,
          start_cursor: nextCursor,
        })
      );

      for (const block of response.results) {
        if (isFullBlock(block)) {
          children.push(block);
        }
      }

      hasMore = response.has_more;
      nextCursor = response.next_cursor || undefined;
    }

    return children;
  }

  private async extractDescendants(blockId: string, depth: number): Promise<BlockWithDepth[]> {
    const descendants: BlockWithDepth[] = [];
    const children = await this.listChildren(blockId);

    for (const child of children) {
      descendants.push({
        ...child,
        depth,
      });

      if (child.has_children) {
        const childDescendants = await this.extractDescendants(child.id, depth + 1);
        descendants.push(...childDescendants);
      }
    }

    return descendants;
  }

  private scheduleRead<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.readQueue.then(async () => {
      const delayMs = Math.max(0, this.nextReadRequestAt - Date.now());
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      try {
        return await withNotionReadRetry(operation);
      } finally {
        this.nextReadRequestAt = Date.now() + 350;
      }
    });
    this.readQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }
}

export async function withNotionReadRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 4;
  const wait = options.sleep ?? sleep;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !APIResponseError.isAPIResponseError(error)
        || error.code !== APIErrorCode.RateLimited
        || attempt >= maxRetries
      ) {
        throw error;
      }

      const retryAfterMilliseconds = readRetryAfterMilliseconds(error.headers);
      const exponentialBackoffMilliseconds = 1_000 * (2 ** attempt);
      await wait(Math.max(retryAfterMilliseconds, exponentialBackoffMilliseconds));
    }
  }
}

export interface ParsedWorkoutDate {
  year: number;
  month: number;
  day: number;
}

function parseWorkoutDate(dateInput: string): ParsedWorkoutDate | null {
  const isoMatch = dateInput.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return validatedDate({
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    });
  }

  const slashMatch = dateInput.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const rawYear = Number(slashMatch[3]);
    return validatedDate({
      year: rawYear < 100 ? 2000 + rawYear : rawYear,
      month: Number(slashMatch[1]),
      day: Number(slashMatch[2]),
    });
  }

  return null;
}

function validatedDate(date: ParsedWorkoutDate): ParsedWorkoutDate | null {
  const candidate = new Date(date.year, date.month - 1, date.day);

  if (
    candidate.getFullYear() !== date.year
    || candidate.getMonth() !== date.month - 1
    || candidate.getDate() !== date.day
  ) {
    return null;
  }

  return date;
}

function readRetryAfterMilliseconds(headers: unknown): number {
  if (!headers || typeof headers !== 'object' || !('get' in headers)) {
    return 0;
  }
  const get = (headers as { get?: unknown }).get;
  if (typeof get !== 'function') {
    return 0;
  }
  const rawValue = get.call(headers, 'retry-after');
  const seconds = typeof rawValue === 'string' ? Number(rawValue) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
