import { Command } from 'commander';
import { GoogleSheetsAuth } from './auth';
import { GoogleSheetsClient } from './sheets';
import { NotionClient } from './notion';
import fs from 'fs/promises';
import { Client } from '@notionhq/client';
import { google } from 'googleapis';

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

async function loadConfig(): Promise<Config> {
  const configContent = await fs.readFile('config.json', 'utf8');
  return JSON.parse(configContent);
}

class PostWorkoutClient extends NotionClient {
  private notion: Client;
  private parentPageId: string;

  constructor(config: Config) {
    super(config);
    this.notion = new Client({
      auth: config.notion.token,
    });
    this.parentPageId = config.notion.parentPageId;
  }

  async findNestedPage(pageTitle: string): Promise<string | null> {
    try {
      let hasMore = true;
      let nextCursor: string | undefined;

      while (hasMore) {
        const response = await this.notion.blocks.children.list({
          block_id: this.parentPageId,
          page_size: 100,
          start_cursor: nextCursor,
        });

        for (const block of response.results) {
          if (block.type === 'child_page' && 'child_page' in block) {
            if (block.child_page.title === pageTitle) {
              return block.id;
            }
          }
        }

        hasMore = response.has_more;
        nextCursor = response.next_cursor || undefined;
      }

      return null;
    } catch (error) {
      throw new Error(`Error searching for nested page "${pageTitle}": ${error}`);
    }
  }

  async extractPageContent(pageId: string): Promise<any[]> {
    try {
      return await this.extractBlocksIteratively(pageId);
    } catch (error) {
      throw new Error(`Error extracting content from page ${pageId}: ${error}`);
    }
  }

  private async extractBlocksIteratively(rootBlockId: string): Promise<any[]> {
    const allBlocks: any[] = [];

    // Use a queue that stores parent block ID and depth
    // Process one parent at a time to maintain correct document order
    const queue: Array<{ blockId: string; depth: number }> = [
      { blockId: rootBlockId, depth: 0 }
    ];

    while (queue.length > 0) {
      const { blockId, depth } = queue.shift()!;

      // Fetch all children of this block
      const children: any[] = [];
      let hasMore = true;
      let nextCursor: string | undefined;

      while (hasMore) {
        const response = await this.notion.blocks.children.list({
          block_id: blockId,
          page_size: 100,
          start_cursor: nextCursor,
        });

        for (const block of response.results) {
          (block as any).depth = depth;
          children.push(block);
        }

        hasMore = response.has_more;
        nextCursor = response.next_cursor || undefined;
      }

      // For each child, add it to allBlocks and queue its children if any
      // We need to insert children immediately after their parent in the output
      // To do this correctly, we'll collect blocks with their children inline
      for (const child of children) {
        allBlocks.push(child);

        if (child.has_children) {
          // Recursively fetch and insert this child's descendants right here
          const descendants = await this.extractDescendants(child.id, depth + 1);
          allBlocks.push(...descendants);
        }
      }
    }

    return allBlocks;
  }

  private async extractDescendants(blockId: string, depth: number): Promise<any[]> {
    const descendants: any[] = [];

    let hasMore = true;
    let nextCursor: string | undefined;

    while (hasMore) {
      const response = await this.notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: nextCursor,
      });

      for (const block of response.results) {
        (block as any).depth = depth;
        descendants.push(block);

        if (block.has_children) {
          const childDescendants = await this.extractDescendants(block.id, depth + 1);
          descendants.push(...childDescendants);
        }
      }

      hasMore = response.has_more;
      nextCursor = response.next_cursor || undefined;
    }

    return descendants;
  }

  convertBlocksToMarkdown(blocks: any[]): string {
    const markdownLines: string[] = [];

    for (const block of blocks) {
      if (block.type === 'embed') {
        continue;
      }

      const depth = block.depth || 0;
      const indent = '  '.repeat(depth);

      switch (block.type) {
        case 'heading_1':
          if (block.heading_1?.rich_text?.[0]?.text?.content) {
            markdownLines.push(`# ${block.heading_1.rich_text[0].text.content}`);
          }
          break;

        case 'heading_2':
          if (block.heading_2?.rich_text?.[0]?.text?.content) {
            markdownLines.push(`## ${block.heading_2.rich_text[0].text.content}`);
          }
          break;

        case 'heading_3':
          if (block.heading_3?.rich_text?.[0]?.text?.content) {
            markdownLines.push(`### ${block.heading_3.rich_text[0].text.content}`);
          }
          break;

        case 'paragraph':
          if (block.paragraph?.rich_text?.[0]?.text?.content) {
            markdownLines.push(`${indent}${block.paragraph.rich_text[0].text.content}`);
          } else {
            markdownLines.push('');
          }
          break;

        case 'bulleted_list_item':
          if (block.bulleted_list_item?.rich_text?.[0]?.text?.content) {
            markdownLines.push(`${indent}- ${block.bulleted_list_item.rich_text[0].text.content}`);
          }
          break;

        case 'numbered_list_item':
          if (block.numbered_list_item?.rich_text?.[0]?.text?.content) {
            markdownLines.push(`${indent}1. ${block.numbered_list_item.rich_text[0].text.content}`);
          }
          break;
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
  private sheets: any;

  constructor(auth: any) {
    super(auth);
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async addCommentToCell(spreadsheetId: string, cellReference: string, comment: string): Promise<void> {
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              updateCells: {
                rows: [
                  {
                    values: [
                      {
                        note: comment
                      }
                    ]
                  }
                ],
                fields: 'note',
                range: {
                  sheetId: 0,
                  startRowIndex: this.getCellRowIndex(cellReference),
                  endRowIndex: this.getCellRowIndex(cellReference) + 1,
                  startColumnIndex: this.getCellColumnIndex(cellReference),
                  endColumnIndex: this.getCellColumnIndex(cellReference) + 1,
                }
              }
            }
          ],
        },
      });
    } catch (error) {
      throw new Error(`Error adding comment to cell ${cellReference}: ${error}`);
    }
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

async function main() {
  const program = new Command();

  program
    .name('post-workout')
    .description('Post workout content from Notion page to Google Sheets as comments')
    .option('--session-cell <cell>', 'Cell reference (e.g., B2)')
    .option('--notion-page <title>', 'Title of the nested Notion page')
    .option('--test', 'Test mode - output content without posting to sheets')
    .option('--sheet-owner <email>', 'Google Sheets owner email')
    .option('--sheet-title <title>', 'Google Sheets document title')
    .parse();

  const options = program.opts();
  const cellId = options.sessionCell;

  try {
    const config = await loadConfig();

    const sheetOwner = options.sheetOwner || config.defaults?.sheetOwner;
    const sheetTitle = options.sheetTitle || config.defaults?.sheetTitle;
    const notionPageTitle = options.notionPage;

    if (!sheetOwner || !sheetTitle || !notionPageTitle || !cellId) {
      console.error('Missing required arguments. Please provide:\n');
      console.error('  --session-cell <cell>     Cell reference (e.g., B2)');
      console.error('  --notion-page <title>     Title of nested Notion page');
      console.error('  --sheet-owner <email>     Google Sheets owner email');
      console.error('  --sheet-title <title>     Google Sheets document title\n');
      console.error('Note: sheet-owner and sheet-title can be set as defaults in config.json');
      process.exit(1);
    }

    console.log('Connecting to Notion...');
    const postWorkoutClient = new PostWorkoutClient(config);

    console.log(`Searching for nested page: ${notionPageTitle}`);
    const pageId = await postWorkoutClient.findNestedPage(notionPageTitle);

    if (!pageId) {
      console.error(`Notion page "${notionPageTitle}" not found in parent page`);
      process.exit(1);
    }

    console.log(`Found page: ${pageId}`);
    console.log('Extracting page content...');
    const blocks = await postWorkoutClient.extractPageContent(pageId);

    console.log('Converting blocks to markdown...');
    const markdown = postWorkoutClient.convertBlocksToMarkdown(blocks);

    console.log('Splitting content by workout sections...');
    const workoutContent = postWorkoutClient.splitContentByWorkoutSections(markdown);

    if (options.test) {
      console.log('\n=== TEST MODE OUTPUT ===');
      if (workoutContent.overallNotes) {
        console.log(`\n${workoutContent.overallNotes}`);
      }
      if (workoutContent.lowerBody) {
        console.log(`\n${workoutContent.lowerBody}`);
      }
      if (workoutContent.upperBody) {
        console.log(`\n${workoutContent.upperBody}`);
      }
      console.log('\n=== End Test Output ===');
      return;
    }

    console.log('Authenticating with Google Sheets API...');
    const auth = new GoogleSheetsAuth();
    const oAuth2Client = await auth.authenticate();

    const sheetsClient = new ExtendedGoogleSheetsClient(oAuth2Client);

    console.log(`Searching for sheet "${sheetTitle}" owned by ${sheetOwner}...`);
    const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(sheetOwner, sheetTitle);

    if (!sheetInfo) {
      console.error('Sheet not found');
      process.exit(1);
    }

    console.log(`Found sheet: ${sheetInfo.name} (${sheetInfo.id})`);

    const combinedComment = [
      workoutContent.overallNotes,
      workoutContent.lowerBody,
      workoutContent.upperBody,
    ]
      .filter(Boolean)
      .join('\n\n');

    console.log(`Adding workout comment to cell ${cellId}...`);
    await sheetsClient.addCommentToCell(sheetInfo.id, cellId, combinedComment);

    console.log('✅ Successfully posted workout content as comments');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
