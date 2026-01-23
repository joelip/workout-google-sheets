import { Command } from 'commander';
import { GoogleSheetsAuth } from './auth';
import { GoogleSheetsClient } from './sheets';
import { NotionClient } from './notion';
import { WorkoutParser } from './parser';
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

export async function createDay(
  argv: string[] = process.argv,
  opts?: {
    now?: () => Date;
  }
): Promise<number> {
  const program = new Command();
  
  program
    .name('create-day')
    .description('Create a daily workout entry in Notion from a single Google Sheets cell')
    .option('--sheet-owner <email>', 'Google Sheets owner email')
    .option('--sheet-title <title>', 'Google Sheets document title')
    .option('--session-cell <cell>', 'Single cell reference (e.g., B2)')
    .option('--dry-run', 'Output parsed data to file instead of creating Notion page')
    .option('--dump-google-response', 'Dump Google Sheets API response body to file instead of creating Notion page')
    .parse(argv);

  const options = program.opts();
  
  try {
    const config = await loadConfig();
    
    const sheetOwner = options.sheetOwner || config.defaults?.sheetOwner;
    const sheetTitle = options.sheetTitle || config.defaults?.sheetTitle;
    const sessionCell = options.sessionCell;
    
    if (!sheetOwner || !sheetTitle || !sessionCell) {
      console.error('Missing required arguments. Please provide:\n');
      console.error('  --sheet-owner <email>     Google Sheets owner email');
      console.error('  --sheet-title <title>     Google Sheets document title');
      console.error('  --session-cell <cell>     Single cell reference (e.g., B2)\n');
      console.error('Note: sheet-owner and sheet-title can be set as defaults in config.json');
      return 1;
    }

    if (options.dryRun && options.dumpGoogleResponse) {
      console.error('Cannot use --dry-run and --dump-google-response together. Use at most one of these options.');
      return 1;
    }

    const auth = new GoogleSheetsAuth();
    console.log('Authenticating with Google Sheets API...');
    const oAuth2Client = await auth.authenticate();
    
    const sheetsClient = new GoogleSheetsClient(oAuth2Client);
    
    console.log(`Searching for sheet "${sheetTitle}" owned by ${sheetOwner}...`);
    const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(sheetOwner, sheetTitle);
    
    if (!sheetInfo) {
      console.log('Sheet not found');
      return 1;
    }
    
    console.log(`Found sheet: ${sheetInfo.name} (${sheetInfo.id})`);
    console.log(`URL: ${sheetInfo.url}`);
    
    console.log(`Extracting data from cell: ${sessionCell}`);

    if (options.dumpGoogleResponse) {
      const responseData = await sheetsClient.getCellRangeResponseData(sheetInfo.id, sessionCell);
      const output = JSON.stringify(responseData, null, 2);
      await fs.writeFile('create-day-google-response-output.json', output, 'utf8');
      console.log('Dump complete. Output written to create-day-google-response-output.json');
      return 0;
    }

    const data = await sheetsClient.getCellRange(sheetInfo.id, sessionCell);
    
    if (!data || data.length === 0 || !data[0] || !data[0][0]) {
      console.log('No data found in the specified cell');
      return 1;
    }
    
    const cellContent = data[0][0];
    console.log('Parsing workout data...');
    const session = WorkoutParser.parseSingleCell(cellContent);
    
    console.log(`Found workout session with ${session.sections.length} sections`);

    if (options.dryRun) {
      const output = JSON.stringify({ rawContent: cellContent, parsed: session }, null, 2);
      await fs.writeFile('dry-run-output.json', output, 'utf8');
      console.log('Dry run complete. Output written to dry-run-output.json');
      return 0;
    }

    console.log('Connecting to Notion...');
    const notionClient = await NotionClient.fromConfigFile();
    
    const today = (opts?.now ?? (() => new Date()))();
    const pageTitle = formatDateM_D_YYYY(today);
    console.log(`Creating Notion page: ${pageTitle}`);
    
    const pageId = await notionClient.createDayWorkoutPage(pageTitle, session);
    console.log(`✅ Successfully created Notion page: ${pageId}`);
    return 0;
  } catch (error) {
    console.error('Error:', error);
    return 1;
  }
}

if (import.meta.main) {
  createDay().then((exitCode) => process.exit(exitCode));
}
