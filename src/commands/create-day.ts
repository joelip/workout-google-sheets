import { GoogleSheetsAuth } from '../auth';
import { GoogleSheetsClient } from '../sheets';
import type { SheetValues } from '../sheets';
import { NotionClient } from '../notion';
import { formatWorkoutDatePageTitleFromDate } from '../notion-workout-pages';
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
  combine?: string;
  dryRun?: boolean;
  output?: 'text' | 'json';
}

const DAY_TO_CELL: Record<number, string> = {
  1: 'B2',
  2: 'C2',
  3: 'D2',
  4: 'E2',
};

const CELL_REFERENCE_PATTERN = /^[A-Z]+\d+$/;

async function loadConfig(): Promise<Config> {
  const configContent = await fs.readFile('config.json', 'utf8');
  return JSON.parse(configContent);
}

export function resolveCreateDayCells(options: Pick<CreateDayOptions, 'day' | 'sessionCell' | 'combine'>): string[] {
  if (options.combine) {
    if (options.day || options.sessionCell) {
      fail('Use only one of --combine, --day, or --session-cell.');
    }

    const cells = options.combine
      .split(',')
      .map((cell) => cell.trim().toUpperCase())
      .filter(Boolean);

    if (cells.length === 0) {
      fail('Missing cells for --combine. Use a comma-separated list such as B2,C3.');
    }

    for (const cell of cells) {
      if (!CELL_REFERENCE_PATTERN.test(cell)) {
        fail(`Invalid cell reference "${cell}" in --combine. Use references like B2 or C3.`);
      }
    }

    return cells;
  }

  if (options.sessionCell) {
    const sessionCell = options.sessionCell.trim().toUpperCase();

    if (!CELL_REFERENCE_PATTERN.test(sessionCell)) {
      fail(`Invalid --session-cell "${options.sessionCell}". Use a reference like B2.`);
    }

    return [sessionCell];
  }

  if (options.day) {
    const day = Number(options.day);
    if (!Number.isInteger(day) || !DAY_TO_CELL[day]) {
      fail('Invalid --day value. Supported days are: 1, 2, 3, 4.');
    }

    return [DAY_TO_CELL[day]];
  }

  return [];
}

function getFirstCellValue(cellData: SheetValues): string | null {
  const value = cellData[0]?.[0];

  if (value === undefined || value === null || value === '') {
    return null;
  }

  return String(value);
}

export async function runCreateDay(options: CreateDayOptions): Promise<void> {
  const config = await loadConfig();

  const sheetOwner = options.sheetOwner || config.defaults?.sheetOwner;
  const sheetTitle = options.sheetTitle || config.defaults?.sheetTitle;
  const sessionCells = resolveCreateDayCells(options);

  if (!sheetOwner || !sheetTitle || sessionCells.length === 0) {
    fail(
      'Missing required arguments. Please provide:\n'
      + '  --sheet-owner <email>     Google Sheets owner email\n'
      + '  --sheet-title <title>     Google Sheets document title\n'
      + '  --day <day>               Workout day number (1-4 maps to B2-E2)\n'
      + '  --session-cell <cell>     Single cell reference (e.g., B2)\n'
      + '  --combine <cells>         Comma-separated cells to combine (e.g., B2,C3)\n\n'
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

  console.log(`Extracting data from ${sessionCells.length === 1 ? 'cell' : 'cells'}: ${sessionCells.join(', ')}`);

  const cellContents: string[] = [];

  for (const cell of sessionCells) {
    const data = await sheetsClient.getCellRange(sheetInfo.id, cell);
    const cellContent = getFirstCellValue(data);

    if (!cellContent) {
      fail(`No data found in cell ${cell}`);
    }

    cellContents.push(cellContent);
  }

  console.log('Parsing workout data...');
  let session = WorkoutParser.mergeSessions(
    cellContents.map((cellContent) => WorkoutParser.parseSingleCell(cellContent))
  );

  // Resolve RM (rep max) references to actual weights
  session = await WorkoutParser.resolveRepMaxes(session);

  console.log(`Found workout session with ${session.sections.length} sections`);

  // Handle --output option
  if (options.output === 'text') {
    console.log('\n--- Workout Content ---\n');
    console.log(cellContents.join('\n\n'));
    console.log('\n--- End Workout Content ---\n');
  } else if (options.output === 'json') {
    const output = JSON.stringify({ sourceCells: sessionCells, rawContent: cellContents.join('\n\n'), parsed: session }, null, 2);
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
  const pageTitle = formatWorkoutDatePageTitleFromDate(today);
  console.log(`Creating Notion page: ${pageTitle}`);

  const pageId = await notionClient.createDayWorkoutPage(pageTitle, session);
  const notionUrl = `https://notion.so/${pageId.replace(/-/g, '')}`;
  console.log(`✅ Successfully created Notion page: ${pageId}`);
  console.log(`Notion URL: ${notionUrl}`);
}
