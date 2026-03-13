import { GoogleSheetsAuth } from '../auth';
import { GoogleSheetsClient } from '../sheets';
import { fail } from '../command-runtime';
import {
  renderWorkoutTextOutput,
  splitWorkoutTextForSheets,
} from '../post-workout-chunking';
import fs from 'fs/promises';
import { Client, isFullBlock } from '@notionhq/client';
import type { BlockObjectResponse, RichTextItemResponse } from '@notionhq/client';
import { OAuth2Client } from 'google-auth-library';
import { google, sheets_v4 } from 'googleapis';

interface Config {
  notion: {
    token: string;
    parentPageId: string;
  };
  defaults?: {
    sheetOwner?: string;
    sheetTitle?: string;
  };
}

interface WorkoutContent {
  overallNotes: string;
  lowerBody: string;
  upperBody: string;
}

interface PostWorkoutOptions {
  sessionCell?: string;
  notionPage?: string;
  sheetOwner?: string;
  sheetTitle?: string;
  text?: boolean;
  sheetsChunked?: boolean;
}

type BlockWithDepth = BlockObjectResponse & { depth: number };

interface PostWorkoutDefaults {
  sheetOwner?: string;
  sheetTitle?: string;
}

type ResolvedPostWorkoutOptions =
  | {
    sessionCell?: string;
    notionPageTitle: string;
    sheetOwner?: string;
    sheetTitle?: string;
    textMode: true;
  }
  | {
    sessionCell: string;
    notionPageTitle: string;
    sheetOwner: string;
    sheetTitle: string;
    textMode: false;
  };

async function loadConfig(): Promise<Config> {
  const configContent = await fs.readFile('config.json', 'utf8');
  return JSON.parse(configContent);
}

export function resolvePostWorkoutOptions(
  options: PostWorkoutOptions,
  defaults?: PostWorkoutDefaults
): ResolvedPostWorkoutOptions {
  const textMode = Boolean(options.text || options.sheetsChunked);
  const sessionCell = options.sessionCell;
  const sheetOwner = options.sheetOwner || defaults?.sheetOwner;
  const sheetTitle = options.sheetTitle || defaults?.sheetTitle;
  const notionPageTitle = options.notionPage;

  if (!notionPageTitle || (!textMode && (!sheetOwner || !sheetTitle || !sessionCell))) {
    fail(
      'Missing required arguments. Please provide:\n'
      + `${textMode ? '' : '  --session-cell <cell>     Cell reference (e.g., B2)\n'}`
      + '  --notion-page <title>     Title of nested Notion page\n'
      + `${textMode ? '' : '  --sheet-owner <email>     Google Sheets owner email\n'}`
      + `${textMode ? '' : '  --sheet-title <title>     Google Sheets document title\n\n'}`
      + `${textMode ? '' : 'Note: sheet-owner and sheet-title can be set as defaults in config.json\n'}`
      + 'Note: --session-cell is optional when --text or --sheets-chunked is provided'
    );
  }

  if (textMode) {
    return {
      sessionCell,
      notionPageTitle,
      sheetOwner,
      sheetTitle,
      textMode: true,
    };
  }

  const requiredSessionCell = sessionCell || fail('Missing --session-cell <cell> argument.');
  const requiredSheetOwner = sheetOwner || fail('Missing --sheet-owner <email> argument.');
  const requiredSheetTitle = sheetTitle || fail('Missing --sheet-title <title> argument.');

  return {
    sessionCell: requiredSessionCell,
    notionPageTitle,
    sheetOwner: requiredSheetOwner,
    sheetTitle: requiredSheetTitle,
    textMode: false,
  };
}

function getFirstPlainText(richText?: RichTextItemResponse[]): string | null {
  const first = richText?.[0];
  return first?.plain_text ?? null;
}

class PostWorkoutClient {
  private notion: Client;
  private parentPageId: string;

  constructor(config: Config) {
    this.notion = new Client({
      auth: config.notion.token,
    });
    this.parentPageId = config.notion.parentPageId;
  }

  async findNestedPage(pageTitle: string): Promise<string | null> {
    let hasMore = true;
    let nextCursor: string | undefined;

    while (hasMore) {
      const response = await this.notion.blocks.children.list({
        block_id: this.parentPageId,
        page_size: 100,
        start_cursor: nextCursor,
      });

      for (const block of response.results) {
        if (!isFullBlock(block)) {
          continue;
        }

        if (block.type === 'child_page' && block.child_page.title === pageTitle) {
          return block.id;
        }
      }

      hasMore = response.has_more;
      nextCursor = response.next_cursor || undefined;
    }

    return null;
  }

  async extractPageContent(pageId: string): Promise<BlockWithDepth[]> {
    return this.extractDescendants(pageId, 0);
  }

  private async listChildren(blockId: string): Promise<BlockObjectResponse[]> {
    const children: BlockObjectResponse[] = [];
    let hasMore = true;
    let nextCursor: string | undefined;

    while (hasMore) {
      const response = await this.notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: nextCursor,
      });

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

  convertBlocksToMarkdown(blocks: BlockWithDepth[]): string {
    const markdownLines: string[] = [];

    for (const block of blocks) {
      if (block.type === 'embed') {
        continue;
      }

      const indent = '  '.repeat(block.depth);

      switch (block.type) {
        case 'heading_1': {
          const text = getFirstPlainText(block.heading_1.rich_text);
          if (text) {
            markdownLines.push(`# ${text}`);
          }
          break;
        }
        case 'heading_2': {
          const text = getFirstPlainText(block.heading_2.rich_text);
          if (text) {
            markdownLines.push(`## ${text}`);
          }
          break;
        }
        case 'heading_3': {
          const text = getFirstPlainText(block.heading_3.rich_text);
          if (text) {
            markdownLines.push(`### ${text}`);
          }
          break;
        }
        case 'paragraph': {
          const text = getFirstPlainText(block.paragraph.rich_text);
          markdownLines.push(text ? `${indent}${text}` : '');
          break;
        }
        case 'bulleted_list_item': {
          const text = getFirstPlainText(block.bulleted_list_item.rich_text);
          if (text) {
            markdownLines.push(`${indent}- ${text}`);
          }
          break;
        }
        case 'numbered_list_item': {
          const text = getFirstPlainText(block.numbered_list_item.rich_text);
          if (text) {
            markdownLines.push(`${indent}1. ${text}`);
          }
          break;
        }
      }
    }

    return markdownLines.join('\n');
  }

  splitContentByWorkoutSections(markdownContent: string): WorkoutContent {
    const lines = markdownContent.split('\n');
    const overallLines: string[] = [];
    const lowerBodyLines: string[] = [];
    const upperBodyLines: string[] = [];
    let currentSection: 'none' | 'overall' | 'lower' | 'upper' = 'none';

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.match(/^#{1,6}\s*overall/i) || trimmedLine.match(/^overall\b/i)) {
        currentSection = 'overall';
        if (overallLines.length === 0) {
          overallLines.push('### Overall Notes:');
        }
        continue;
      }

      if (/^###\s*lower body\b/i.test(trimmedLine)) {
        currentSection = 'lower';
        lowerBodyLines.push('### Lower Body:');
        continue;
      } else if (/^###\s*upper body\b/i.test(trimmedLine)) {
        currentSection = 'upper';
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
      }
    }

    return {
      overallNotes: overallLines.join('\n').trim(),
      lowerBody: lowerBodyLines.join('\n').trim(),
      upperBody: upperBodyLines.join('\n').trim(),
    };
  }
}

class ExtendedGoogleSheetsClient extends GoogleSheetsClient {
  private rawSheets: sheets_v4.Sheets;

  constructor(auth: OAuth2Client) {
    super(auth);
    this.rawSheets = google.sheets({ version: 'v4', auth });
  }

  async addCommentToCell(spreadsheetId: string, cellReference: string, comment: string): Promise<void> {
    await this.rawSheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateCells: {
              rows: [
                {
                  values: [
                    {
                      note: comment,
                    },
                  ],
                },
              ],
              fields: 'note',
              range: {
                sheetId: 0,
                startRowIndex: this.getCellRowIndex(cellReference),
                endRowIndex: this.getCellRowIndex(cellReference) + 1,
                startColumnIndex: this.getCellColumnIndex(cellReference),
                endColumnIndex: this.getCellColumnIndex(cellReference) + 1,
              },
            },
          },
        ],
      },
    });
  }

  private getCellRowIndex(cellReference: string): number {
    const match = cellReference.match(/\d+/);
    return match ? parseInt(match[0]) - 1 : 0;
  }

  private getCellColumnIndex(cellReference: string): number {
    const match = cellReference.match(/[A-Z]+/);
    if (!match) return 0;

    const letters = match[0];
    let result = 0;

    for (let i = 0; i < letters.length; i++) {
      result = result * 26 + (letters.charCodeAt(i) - 64);
    }

    return result - 1;
  }
}

export async function runPostWorkout(options: PostWorkoutOptions): Promise<void> {
  const config = await loadConfig();
  const {
    sessionCell,
    notionPageTitle,
    sheetOwner,
    sheetTitle,
    textMode,
  } = resolvePostWorkoutOptions(options, config.defaults);

  console.log('Connecting to Notion...');
  const postWorkoutClient = new PostWorkoutClient(config);

  console.log(`Searching for nested page: ${notionPageTitle}`);
  const pageId = await postWorkoutClient.findNestedPage(notionPageTitle);

  if (!pageId) {
    fail(`Notion page "${notionPageTitle}" not found in parent page`);
  }

  console.log(`Found page: ${pageId}`);
  console.log('Extracting page content...');
  const blocks = await postWorkoutClient.extractPageContent(pageId);

  console.log('Converting blocks to markdown...');
  const markdown = postWorkoutClient.convertBlocksToMarkdown(blocks);

  if (options.sheetsChunked) {
    console.log('Splitting content by workout sections for Sheets chunking...');
  } else {
    console.log('Preparing structured workout content...');
  }
  const workoutContent = postWorkoutClient.splitContentByWorkoutSections(markdown);

  if (textMode) {
    const textOutput = renderWorkoutTextOutput(workoutContent);

    if (options.sheetsChunked) {
      const chunks = splitWorkoutTextForSheets(textOutput);
      chunks.forEach((chunk, index) => {
        if (index > 0) {
          console.log('');
        }
        console.log(`--- Chunk ${index + 1}/${chunks.length} (${chunk.length} chars) ---`);
        console.log(chunk);
      });
    } else if (textOutput) {
      console.log(`\n${textOutput}`);
    }

    return;
  }

  console.log('Authenticating with Google Sheets API...');
  const auth = new GoogleSheetsAuth();
  const oAuth2Client = await auth.authenticate();

  const sheetsClient = new ExtendedGoogleSheetsClient(oAuth2Client);

  console.log(`Searching for sheet "${sheetTitle}" owned by ${sheetOwner}...`);
  const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(sheetOwner, sheetTitle);

  if (!sheetInfo) {
    fail('Sheet not found');
  }

  console.log(`Found sheet: ${sheetInfo.name} (${sheetInfo.id})`);

  const combinedComment = renderWorkoutTextOutput(workoutContent);

  console.log(`Adding workout comment to cell ${sessionCell}...`);
  await sheetsClient.addCommentToCell(sheetInfo.id, sessionCell, combinedComment);

  console.log('✅ Successfully posted workout content as comments');
}
