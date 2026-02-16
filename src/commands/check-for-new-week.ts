import { GoogleSheetsAuth } from '../auth';
import { GoogleSheetsClient } from '../sheets';
import type { SheetCellData } from '../sheets';
import { fail } from '../command-runtime';
import fs from 'fs/promises';

interface Config {
  defaults?: {
    sheetOwner?: string;
    sheetTitle?: string;
  };
}

interface CheckForNewWeekOptions {
  sheetOwner?: string;
  sheetTitle?: string;
  latestRange?: string;
  previousRange?: string;
  json?: boolean;
}

const CONFIG_FILE_PATH = 'config.json';

async function loadConfig(): Promise<Config> {
  const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf8');
  return JSON.parse(configContent);
}

function flattenCells(rows: SheetCellData[][]): SheetCellData[] {
  return rows.flatMap((row) => row);
}

function hasAnyFill(cells: SheetCellData[]): boolean {
  return cells.some((cell) => cell.hasFill);
}

function allCellsHaveFillAndNote(cells: SheetCellData[]): boolean {
  if (cells.length === 0) {
    return false;
  }

  return cells.every((cell) => cell.hasFill && cell.note.trim().length > 0);
}

function allCellsHaveFill(cells: SheetCellData[]): boolean {
  if (cells.length === 0) {
    return false;
  }

  return cells.every((cell) => cell.hasFill);
}

function allCellsHaveNotes(cells: SheetCellData[]): boolean {
  if (cells.length === 0) {
    return false;
  }

  return cells.every((cell) => cell.note.trim().length > 0);
}

export async function runCheckForNewWeek(options: CheckForNewWeekOptions): Promise<void> {
  const config = await loadConfig();

  const sheetOwner = options.sheetOwner || config.defaults?.sheetOwner;
  const sheetTitle = options.sheetTitle || config.defaults?.sheetTitle;
  const latestRange = options.latestRange || 'B2:E2';
  const previousRange = options.previousRange || 'B3:E3';

  if (!sheetOwner || !sheetTitle) {
    fail(
      'Missing required arguments. Please provide:\n'
      + '  --sheet-owner <email>     Google Sheets owner email\n'
      + '  --sheet-title <title>     Google Sheets document title\n\n'
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

  const latestRows = await sheetsClient.getCellDataRange(sheetInfo.id, latestRange);
  const previousRows = await sheetsClient.getCellDataRange(sheetInfo.id, previousRange);

  const latestCells = flattenCells(latestRows);
  const previousCells = flattenCells(previousRows);

  const latestHasAnyFill = hasAnyFill(latestCells);
  const previousAllFilled = allCellsHaveFill(previousCells);
  const previousAllHaveNotes = allCellsHaveNotes(previousCells);
  const previousHasFillAndComments = allCellsHaveFillAndNote(previousCells);
  const hasNewWeek = previousAllFilled;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          sheetId: sheetInfo.id,
          latestRange,
          previousRange,
          latestHasAnyFill,
          previousAllFilled,
          previousAllHaveNotes,
          previousHasFillAndComments,
          hasNewWeek,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Latest range (${latestRange}) has any fill: ${latestHasAnyFill ? 'yes' : 'no'}`);
  console.log(`Previous range (${previousRange}) all cells filled: ${previousAllFilled ? 'yes' : 'no'}`);
  console.log(`Previous range (${previousRange}) all cells have notes: ${previousAllHaveNotes ? 'yes' : 'no'}`);
  console.log(`Previous range (${previousRange}) has fill + note in all cells: ${previousHasFillAndComments ? 'yes' : 'no'}`);
  console.log('Heuristic: new week is detected when previous range is fully filled');
  console.log(`New week detected: ${hasNewWeek ? 'yes' : 'no'}`);
}
