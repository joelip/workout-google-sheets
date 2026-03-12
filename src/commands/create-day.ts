import { GoogleSheetsAuth } from '../auth';
import { GoogleSheetsClient } from '../sheets';
import { NotionClient } from '../notion';
import { WorkoutParser } from '../parser';
import { fail } from '../command-runtime';
import fs from 'fs/promises';

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

interface CreateDayOptions {
  sheetOwner?: string;
  sheetTitle?: string;
  day?: string;
  sessionCell?: string;
  dryRun?: boolean;
  output?: 'text' | 'json';
}

const DAY_TO_CELL: Record<number, string> = {
  1: 'B2',
  2: 'C2',
  3: 'D2',
  4: 'E2',
};

async function loadConfig(): Promise<Config> {
  const configContent = await fs.readFile('config.json', 'utf8');
  return JSON.parse(configContent);
}

function formatDateM_D_YYYY(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

export async function runCreateDay(options: CreateDayOptions): Promise<void> {
  const config = await loadConfig();

  const sheetOwner = options.sheetOwner || config.defaults?.sheetOwner;
  const sheetTitle = options.sheetTitle || config.defaults?.sheetTitle;
  let sessionCell = options.sessionCell;

  if (!sessionCell && options.day) {
    const day = Number(options.day);
    if (!Number.isInteger(day) || !DAY_TO_CELL[day]) {
      fail('Invalid --day value. Supported days are: 1, 2, 3, 4.');
    }
    sessionCell = DAY_TO_CELL[day];
  }

  if (!sheetOwner || !sheetTitle || !sessionCell) {
    fail(
      'Missing required arguments. Please provide:\n'
      + '  --sheet-owner <email>     Google Sheets owner email\n'
      + '  --sheet-title <title>     Google Sheets document title\n'
      + '  --day <day>               Workout day number (1-4 maps to B2-E2)\n'
      + '  --session-cell <cell>     Single cell reference (e.g., B2)\n\n'
      + 'Note: sheet-owner and sheet-title can be set as defaults in config.json'
    );
  }

  const auth = new GoogleSheetsAuth();
  console.log('Authenticating with Google Sheets API...');
  const oAuth2Client = await auth.authenticate();

  const sheetsClient = new GoogleSheetsClient(oAuth2Client);

  console.log(`Searching for sheet "${sheetTitle}" owned by ${sheetOwner}...`);
  const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(sheetOwner, sheetTitle);

  if (!sheetInfo) {
    fail('Sheet not found');
  }

  console.log(`Found sheet: ${sheetInfo.name} (${sheetInfo.id})`);
  console.log(`URL: ${sheetInfo.url}`);

  console.log(`Extracting data from cell: ${sessionCell}`);

  const data = await sheetsClient.getCellRange(sheetInfo.id, sessionCell);

  if (!data || data.length === 0 || !data[0] || !data[0][0]) {
    fail('No data found in the specified cell');
  }

  const cellContent = String(data[0][0]);

  console.log('Parsing workout data...');
  let session = WorkoutParser.parseSingleCell(cellContent);

  // Resolve RM (rep max) references to actual weights
  session = await WorkoutParser.resolveRepMaxes(session);

  console.log(`Found workout session with ${session.sections.length} sections`);

  // Handle --output option
  if (options.output === 'text') {
    console.log('\n--- Workout Content ---\n');
    console.log(cellContent);
    console.log('\n--- End Workout Content ---\n');
  } else if (options.output === 'json') {
    const output = JSON.stringify({ rawContent: cellContent, parsed: session }, null, 2);
    await fs.writeFile('workout-output.json', output, 'utf8');
    console.log('JSON output written to workout-output.json');
  }

  // If dry-run, exit without creating Notion page
  if (options.dryRun) {
    console.log('Dry run complete. Skipping Notion page creation.');
    return;
  }

  console.log('Connecting to Notion...');
  const notionClient = await NotionClient.fromConfigFile();

  const today = new Date();
  const pageTitle = formatDateM_D_YYYY(today);
  console.log(`Creating Notion page: ${pageTitle}`);

  const pageId = await notionClient.createDayWorkoutPage(pageTitle, session);
  const notionUrl = `https://notion.so/${pageId.replace(/-/g, '')}`;
  console.log(`✅ Successfully created Notion page: ${pageId}`);
  console.log(`Notion URL: ${notionUrl}`);
}
