import fs from 'fs/promises';
import { GoogleSheetsAuth } from '../auth';
import { fail } from '../command-runtime';
import { resolveCreateDayCells } from './create-day';
import { GoogleSheetsClient } from '../sheets';
import type { SheetValues } from '../sheets';

interface GetWorkoutPlanConfig {
  defaults?: {
    sheetOwner?: string;
    sheetTitle?: string;
    cellRange?: string;
  };
}

interface GetWorkoutPlanOptions {
  sheetOwner?: string;
  sheetTitle?: string;
  day?: string;
  sessionCell?: string;
  combine?: string;
}

interface GetWorkoutPlansOptions {
  sheetOwner?: string;
  sheetTitle?: string;
  cellRange?: string;
}

interface ResolvedGetWorkoutPlanOptions {
  sheetOwner: string;
  sheetTitle: string;
  sourceCells: string[];
}

interface ResolvedGetWorkoutPlansOptions {
  sheetOwner: string;
  sheetTitle: string;
  cellRange: string;
}

export function resolveGetWorkoutPlanOptions(
  options: GetWorkoutPlanOptions,
  defaults?: GetWorkoutPlanConfig['defaults']
): ResolvedGetWorkoutPlanOptions {
  const sheetOwner = options.sheetOwner || defaults?.sheetOwner;
  const sheetTitle = options.sheetTitle || defaults?.sheetTitle;
  const sourceCells = resolveCreateDayCells(options);

  if (!sheetOwner || !sheetTitle || sourceCells.length === 0) {
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

  return {
    sheetOwner,
    sheetTitle,
    sourceCells,
  };
}

export function resolveGetWorkoutPlansOptions(
  options: GetWorkoutPlansOptions,
  defaults?: GetWorkoutPlanConfig['defaults']
): ResolvedGetWorkoutPlansOptions {
  const sheetOwner = options.sheetOwner || defaults?.sheetOwner;
  const sheetTitle = options.sheetTitle || defaults?.sheetTitle;
  const cellRange = options.cellRange || defaults?.cellRange;

  if (!sheetOwner || !sheetTitle || !cellRange) {
    fail(
      'Missing required arguments. Please provide:\n'
      + '  --sheet-owner <email>     Google Sheets owner email\n'
      + '  --sheet-title <title>     Google Sheets document title\n'
      + '  --cell-range <range>      Cell range to extract (e.g., B2:E5)\n\n'
      + 'Note: sheet-owner, sheet-title, and cellRange can be set as defaults in config.json'
    );
  }

  return {
    sheetOwner,
    sheetTitle,
    cellRange,
  };
}

export function renderWorkoutPlan(
  sourceCells: string[],
  cellContents: string[]
): string {
  const sourceLabel = sourceCells.join(',');

  if (cellContents.length === 1) {
    return [`# Workout Plan: ${sourceLabel}`, cellContents[0]].join('\n\n');
  }

  return [
    `# Workout Plan: ${sourceLabel}`,
    ...cellContents.map((cellContent, index) => (
      [`## ${sourceCells[index]}`, cellContent].join('\n\n')
    )),
  ].join('\n\n');
}

export function renderWorkoutPlans(cellRange: string, cellData: SheetValues): string {
  const cellContents = cellData.flatMap((row) =>
    row.flatMap((cell) => {
      if (cell === undefined || cell === null || cell === '') {
        return [];
      }

      return [String(cell)];
    })
  );

  if (cellContents.length === 0) {
    return `No workout plans found in range ${cellRange}.`;
  }

  return [
    `# Workout Plans: ${cellRange}`,
    ...cellContents.map((cellContent, index) => (
      [`## Session ${index + 1}`, cellContent].join('\n\n')
    )),
  ].join('\n\n');
}

export async function runGetWorkoutPlan(options: GetWorkoutPlanOptions): Promise<void> {
  const config = await loadConfig();
  const resolvedOptions = resolveGetWorkoutPlanOptions(options, config.defaults);
  const sheetsClient = await createSheetsClient();
  const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(
    resolvedOptions.sheetOwner,
    resolvedOptions.sheetTitle
  );

  if (!sheetInfo) {
    fail('Sheet not found');
  }

  const cellContents: string[] = [];

  for (const cell of resolvedOptions.sourceCells) {
    const data = await sheetsClient.getCellRange(sheetInfo.id, cell);
    const cellContent = getFirstCellValue(data);

    if (!cellContent) {
      fail(`No data found in cell ${cell}`);
    }

    cellContents.push(cellContent);
  }

  console.log(renderWorkoutPlan(resolvedOptions.sourceCells, cellContents));
}

export async function runGetWorkoutPlans(options: GetWorkoutPlansOptions): Promise<void> {
  const config = await loadConfig();
  const resolvedOptions = resolveGetWorkoutPlansOptions(options, config.defaults);
  const sheetsClient = await createSheetsClient();
  const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(
    resolvedOptions.sheetOwner,
    resolvedOptions.sheetTitle
  );

  if (!sheetInfo) {
    fail('Sheet not found');
  }

  const cellData = await sheetsClient.getCellRange(sheetInfo.id, resolvedOptions.cellRange);
  console.log(renderWorkoutPlans(resolvedOptions.cellRange, cellData));
}

async function loadConfig(): Promise<GetWorkoutPlanConfig> {
  const configContent = await fs.readFile('config.json', 'utf8');
  return JSON.parse(configContent);
}

async function createSheetsClient(): Promise<GoogleSheetsClient> {
  const auth = new GoogleSheetsAuth();
  const oAuth2Client = await auth.authenticate();
  return new GoogleSheetsClient(oAuth2Client);
}

function getFirstCellValue(cellData: SheetValues): string | null {
  const value = cellData[0]?.[0];

  if (value === undefined || value === null || value === '') {
    return null;
  }

  return String(value);
}
