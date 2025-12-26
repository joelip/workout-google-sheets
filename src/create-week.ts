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
    cellRange?: string;
  };
  data?: {
    currentWeekNumber?: number;
  };
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

async function main() {
  const program = new Command();

  program
    .name('create-week')
    .description('Create a weekly workout plan in Notion from Google Sheets')
    .option('--sheet-owner <email>', 'Google Sheets owner email')
    .option('--sheet-title <title>', 'Google Sheets document title')
    .option('--cell-range <range>', 'Cell range to extract (e.g., B2:E5)')
    .option('--dry-run', 'Output parsed data to file instead of creating Notion page')
    .parse();

  const options = program.opts();

  try {
    const config = await loadConfig();

    const sheetOwner = options.sheetOwner || config.defaults?.sheetOwner;
    const sheetTitle = options.sheetTitle || config.defaults?.sheetTitle;
    const cellRange = options.cellRange || config.defaults?.cellRange;
    const currentWeekNumber = config.data?.currentWeekNumber;

    if (!sheetOwner || !sheetTitle || !cellRange) {
      console.error('Missing required arguments. Please provide:\n');
      console.error('  --sheet-owner <email>     Google Sheets owner email');
      console.error('  --sheet-title <title>     Google Sheets document title');
      console.error('  --cell-range <range>      Cell range to extract (e.g., B2:E5)\n');
      console.error('Or set defaults in config.json');
      process.exit(1);
    }

    if (typeof currentWeekNumber !== 'number') {
      console.error('Missing "data.currentWeekNumber" in config.json');
      process.exit(1);
    }

    const auth = new GoogleSheetsAuth();
    console.log('Authenticating with Google Sheets API...');
    const oAuth2Client = await auth.authenticate();

    const sheetsClient = new GoogleSheetsClient(oAuth2Client);

    console.log(`Searching for sheet "${sheetTitle}" owned by ${sheetOwner}...`);
    const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(sheetOwner, sheetTitle);

    if (!sheetInfo) {
      console.log('Sheet not found');
      process.exit(1);
    }

    console.log(`Found sheet: ${sheetInfo.name} (${sheetInfo.id})`);
    console.log(`URL: ${sheetInfo.url}`);

    console.log(`Extracting data from range: ${cellRange}`);
    const data = await sheetsClient.getCellRange(sheetInfo.id, cellRange);

    console.log('Parsing workout data...');
    const sessions = WorkoutParser.parseWorkoutData(data);

    console.log(`Found ${sessions.length} workout sessions:`);
    sessions.forEach((session) => {
      console.log(`Session ${session.sessionNumber}: ${session.sections.length} sections`);
    });

    if (options.dryRun) {
      const output = JSON.stringify(sessions, null, 2);
      await fs.writeFile('dry-run-output.json', output, 'utf8');
      console.log('Dry run complete. Output written to dry-run-output.json');
      process.exit(0);
    }

    console.log('Connecting to Notion...');
    const notionClient = await NotionClient.fromConfigFile();

    const nextWeekNumber = currentWeekNumber + 1;

    const updatedConfig: Config = {
      ...config,
      data: {
        ...config.data,
        currentWeekNumber: nextWeekNumber,
      },
    };

    await saveConfig(updatedConfig);
    console.log(`Updated config.json currentWeekNumber to ${nextWeekNumber}`);

    const pageTitle = `Week ${nextWeekNumber} with Kyle Habdo`;

    // Get ones digit and map to emoji
    const onesDigit = nextWeekNumber % 10;
    const digitEmojis = ['🔟', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
    const pageIcon = digitEmojis[onesDigit];

    console.log(`Creating Notion page: ${pageTitle} with icon ${pageIcon}`);

    const pageId = await notionClient.createWorkoutPage(pageTitle, sessions, pageIcon);
    console.log(`✅ Successfully created Notion page: ${pageId}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
