import { GoogleSheetsAuth } from '../auth';
import { GoogleSheetsClient } from '../sheets';
import { fail } from '../command-runtime';
import {
  renderWorkoutTextOutput,
  splitWorkoutTextForSheets,
} from '../post-workout-chunking';
import {
  renderBlocksToText,
  splitContentByWorkoutSections,
} from '../post-workout-rendering';
import { R2ImageUploader } from '../r2';
import {
  loadWorkoutPagesConfig,
  NotionWorkoutPageClient,
} from '../notion-workout-pages';
import { OAuth2Client } from 'google-auth-library';
import { google, sheets_v4 } from 'googleapis';
import { spawn } from 'child_process';

interface PostWorkoutOptions {
  sessionCell?: string;
  notionPage?: string;
  sheetOwner?: string;
  sheetTitle?: string;
  text?: boolean;
  sheetsChunked?: boolean;
  copy?: boolean;
}

interface PostWorkoutDefaults {
  sheetOwner?: string;
  sheetTitle?: string;
}

const CLIPBOARD_COPY_DELAY_MS = 750;

type ResolvedPostWorkoutOptions =
  | {
    sessionCell?: string;
    notionPageTitle: string;
    sheetOwner?: string;
    sheetTitle?: string;
    textMode: true;
    copyChunks: boolean;
  }
  | {
    sessionCell: string;
    notionPageTitle: string;
    sheetOwner: string;
    sheetTitle: string;
    textMode: false;
    copyChunks: false;
  };

export function resolvePostWorkoutOptions(
  options: PostWorkoutOptions,
  defaults?: PostWorkoutDefaults
): ResolvedPostWorkoutOptions {
  const textMode = Boolean(options.text || options.sheetsChunked);
  const sessionCell = options.sessionCell;
  const sheetOwner = options.sheetOwner || defaults?.sheetOwner;
  const sheetTitle = options.sheetTitle || defaults?.sheetTitle;
  const notionPageTitle = options.notionPage;
  const copyChunks = Boolean(options.copy);

  if (copyChunks && !options.sheetsChunked) {
    fail('--copy can only be used with --sheets-chunked.');
  }

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
      copyChunks,
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
    copyChunks: false,
  };
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
  const config = await loadWorkoutPagesConfig();
  const {
    sessionCell,
    notionPageTitle,
    sheetOwner,
    sheetTitle,
    textMode,
    copyChunks,
  } = resolvePostWorkoutOptions(options, config.defaults);

  console.log('Connecting to Notion...');
  const postWorkoutClient = new NotionWorkoutPageClient(config);

  console.log(`Searching for nested page: ${notionPageTitle}`);
  const pageId = await postWorkoutClient.findNestedPage(notionPageTitle);

  if (!pageId) {
    fail(`Notion page "${notionPageTitle}" not found in parent page`);
  }

  console.log(`Found page: ${pageId}`);
  console.log('Extracting page content...');
  const blocks = await postWorkoutClient.extractPageContent(pageId);

  console.log('Rendering blocks...');
  const imageUploader = config.r2 ? new R2ImageUploader(config.r2) : undefined;
  const renderedText = await renderBlocksToText(blocks, {
    pageId,
    imageUploader,
  });

  if (options.sheetsChunked) {
    console.log('Splitting content by workout sections for Sheets chunking...');
  } else {
    console.log('Preparing structured workout content...');
  }
  const workoutContent = splitContentByWorkoutSections(renderedText);

  if (textMode) {
    const textOutput = renderWorkoutTextOutput(workoutContent);

    if (options.sheetsChunked) {
      const chunks = splitWorkoutTextForSheets(textOutput);
      for (const [index, chunk] of chunks.entries()) {
        if (index > 0) {
          console.log('');
        }
        console.log(`--- Chunk ${index + 1}/${chunks.length} (${chunk.length} chars) ---`);
        console.log(chunk);
      }
      if (copyChunks) {
        await copyChunksToClipboard(chunks);
        console.log(`\nCopied ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} to clipboard.`);
      }
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

export async function copyChunksToClipboard(
  chunks: string[],
  copyText: (text: string) => Promise<void> = copyTextToClipboard,
  wait: (milliseconds: number) => Promise<void> = delay
): Promise<void> {
  for (const [index, chunk] of chunks.entries()) {
    await copyText(chunk);
    if (index < chunks.length - 1) {
      await wait(CLIPBOARD_COPY_DELAY_MS);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function copyTextToClipboard(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const process = spawn('pbcopy');

    process.on('error', (error) => {
      reject(new Error(`Unable to run pbcopy: ${error.message}`));
    });
    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pbcopy exited with code ${code}.`));
      }
    });

    process.stdin.end(text);
  });
}
