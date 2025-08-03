import { GoogleSheetsAuth } from './src/auth';
import { GoogleSheetsClient } from './src/sheets';
import { NotionClient } from './src/notion';
import { WorkoutParser } from './src/parser';

async function main() {
  try {
    const auth = new GoogleSheetsAuth();
    console.log('Authenticating with Google Sheets API...');
    const oAuth2Client = await auth.authenticate();
    
    const sheetsClient = new GoogleSheetsClient(oAuth2Client);
    
    const ownerEmail = process.argv[2];
    const sheetTitle = process.argv[3];
    const cellRange = process.argv[4];
    
    if (!ownerEmail || !sheetTitle || !cellRange) {
      console.log('Usage: bun run index.ts <owner-email> <sheet-title> <cell-range>');
      console.log('Example: bun run index.ts user@gmail.com "My Workout Sheet" "B2:E5"');
      process.exit(1);
    }
    
    console.log(`Searching for sheet "${sheetTitle}" owned by ${ownerEmail}...`);
    const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(ownerEmail, sheetTitle);
    
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
    
    console.log('Connecting to Notion...');
    const notionClient = await NotionClient.fromConfigFile();
    
    const pageTitle = WorkoutParser.generatePageTitle(ownerEmail, sheetTitle);
    console.log(`Creating Notion page: ${pageTitle}`);
    
    const pageId = await notionClient.createWorkoutPage(pageTitle, sessions);
    console.log(`✅ Successfully created Notion page: ${pageId}`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();