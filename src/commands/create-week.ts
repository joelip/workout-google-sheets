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
    cellRange?: string;
  };
  data?: {
    currentWeekNumber?: number;
  };
}

interface CreateWeekOptions {
  sheetOwner?: string;
  sheetTitle?: string;
  cellRange?: string;
  dryRun?: boolean;
  dumpGoogleResponse?: boolean;
}

const CONFIG_FILE_PATH = 'config.json';

async function loadConfig(): Promise<Config> {
  const configContent = await fs.readFile(CONFIG_FILE_PATH, 'utf8');
  return JSON.parse(configContent);
}

async function saveConfig(config: Config): Promise<void> {
  const configJson = JSON.stringify(config, null, 2);
  await fs.writeFile(CONFIG_FILE_PATH, `${configJson}\n`, 'utf8');
}

export async function runCreateWeek(options: CreateWeekOptions): Promise<void> {
  const config = await loadConfig();

  const sheetOwner = options.sheetOwner || config.defaults?.sheetOwner;
  const sheetTitle = options.sheetTitle || config.defaults?.sheetTitle;
  const cellRange = options.cellRange || config.defaults?.cellRange;
  const currentWeekNumber = config.data?.currentWeekNumber;

  if (!sheetOwner || !sheetTitle || !cellRange) {
    fail(
      'Missing required arguments. Please provide:\n'
      + '  --sheet-owner <email>     Google Sheets owner email\n'
      + '  --sheet-title <title>     Google Sheets document title\n'
      + '  --cell-range <range>      Cell range to extract (e.g., B2:E5)\n\n'
      + 'Or set defaults in config.json'
    );
  }

  if (options.dryRun && options.dumpGoogleResponse) {
    fail('Cannot use --dry-run and --dump-google-response together. Use at most one of these options.');
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

  console.log(`Extracting data from range: ${cellRange}`);

  if (options.dumpGoogleResponse) {
    const responseData = await sheetsClient.getCellRangeResponseData(sheetInfo.id, cellRange);
    const output = JSON.stringify(responseData, null, 2);
    await fs.writeFile('create-week-google-response-output.json', output, 'utf8');
    console.log('Dump complete. Output written to create-week-google-response-output.json');
    return;
  }

  const data = await sheetsClient.getCellRange(sheetInfo.id, cellRange);

  console.log('Parsing workout data...');
  let sessions = WorkoutParser.parseWorkoutData(data);

  // Resolve RM (rep max) references to actual weights for each session
  sessions = await Promise.all(
    sessions.map((session) => WorkoutParser.resolveRepMaxes(session))
  );

  console.log(`Found ${sessions.length} workout sessions:`);
  sessions.forEach((session) => {
    console.log(`Session ${session.sessionNumber}: ${session.sections.length} sections`);
  });

  if (options.dryRun) {
    const output = JSON.stringify(sessions, null, 2);
    await fs.writeFile('dry-run-output.json', output, 'utf8');
    console.log('Dry run complete. Output written to dry-run-output.json');
    return;
  }

  if (typeof currentWeekNumber !== 'number') {
    fail('Missing "data.currentWeekNumber" in config.json (required when creating Notion pages)');
  }

  console.log('Connecting to Notion...');
  const notionClient = await NotionClient.fromConfigFile();

  const nextWeekNumber = currentWeekNumber + 1;
  const pageTitle = `Week ${nextWeekNumber} with Kyle Habdo`;

  // Get ones digit and map to emoji
  const onesDigit = nextWeekNumber % 10;
  const digitEmojis = ['🔟', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
  const pageIcon = digitEmojis[onesDigit];

  console.log(`Creating Notion page: ${pageTitle} with icon ${pageIcon}`);
  const pageId = await notionClient.createWorkoutPage(pageTitle, sessions, pageIcon);
  console.log(`✅ Successfully created Notion page: ${pageId}`);

  const updatedConfig: Config = {
    ...config,
    data: {
      ...config.data,
      currentWeekNumber: nextWeekNumber,
    },
  };

  await saveConfig(updatedConfig);
  console.log(`Updated config.json currentWeekNumber to ${nextWeekNumber}`);
}
