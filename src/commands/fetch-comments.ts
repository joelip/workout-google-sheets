import fs from 'fs/promises';
import { drive_v3, google } from 'googleapis';
import { GoogleSheetsAuth } from '../auth';
import { GoogleSheetsClient } from '../sheets';

interface Config {
  defaults?: {
    sheetOwner?: string;
    sheetTitle?: string;
  };
}

interface FetchCommentsOptions {
  sheetOwner?: string;
  sheetTitle?: string;
  since?: string;
}

interface RowCol {
  row: number;
  col: number;
}

const DAY_BY_COLUMN: Record<string, number> = {
  B: 1,
  C: 2,
  D: 3,
  E: 4,
};

async function loadConfig(): Promise<Config> {
  const configContent = await fs.readFile('config.json', 'utf8');
  return JSON.parse(configContent);
}

function parseSinceToStartModifiedTime(since: string | undefined): string {
  const value = (since || '24h').trim().toLowerCase();
  const match = value.match(/^(\d+)\s*([hdw])$/i);

  if (!match) {
    throw new Error('Invalid --since value. Use formats like 24h, 7d, or 2w.');
  }

  const amount = Number(match[1]);
  const unit = match[2] || '';

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid --since value. Amount must be a positive integer.');
  }

  const msByUnit: Record<string, number> = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  const unitMs = msByUnit[unit];
  if (!unitMs) {
    throw new Error('Invalid --since value. Unit must be h, d, or w.');
  }

  const startMs = Date.now() - (amount * unitMs);
  return new Date(startMs).toISOString();
}

function columnIndexToLetters(index: number): string {
  let n = index + 1;
  let letters = '';

  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }

  return letters;
}

function rowColToA1(row: number, col: number): string | null {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
    return null;
  }

  return `${columnIndexToLetters(col)}${row + 1}`;
}

function rowColToA1FromAnchor(row: number, col: number): string | null {
  const zeroBased = rowColToA1(row, col);
  const oneBased = rowColToA1(row - 1, col - 1);

  const zeroBasedDay = dayFromCell(zeroBased);
  if (zeroBasedDay) {
    return zeroBased;
  }

  const oneBasedDay = dayFromCell(oneBased);
  if (oneBasedDay) {
    return oneBased;
  }

  return zeroBased || oneBased;
}

function findA1InText(text: string): string | null {
  const match = text.toUpperCase().match(/\b([A-Z]{1,3}[1-9][0-9]*)\b/);
  return match?.[1] || null;
}

function extractRowColFromObject(value: unknown): RowCol | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractRowColFromObject(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const rowCandidates = ['row', 'startRow', 'rowIndex', 'r'];
  const colCandidates = ['column', 'startColumn', 'columnIndex', 'col', 'c'];

  for (const rowKey of rowCandidates) {
    for (const colKey of colCandidates) {
      const rowValue = obj[rowKey];
      const colValue = obj[colKey];
      if (typeof rowValue === 'number' && typeof colValue === 'number') {
        return { row: rowValue, col: colValue };
      }
    }
  }

  for (const nestedValue of Object.values(obj)) {
    const found = extractRowColFromObject(nestedValue);
    if (found) {
      return found;
    }
  }

  return null;
}

function parseAnchorCellReference(anchor: string | null | undefined): string | null {
  if (!anchor) {
    return null;
  }

  const decodedAnchor = (() => {
    try {
      return decodeURIComponent(anchor);
    } catch {
      return anchor;
    }
  })();

  const directA1 = findA1InText(decodedAnchor);
  if (directA1) {
    return directA1;
  }

  try {
    const parsed = JSON.parse(decodedAnchor);
    const rowCol = extractRowColFromObject(parsed);
    if (rowCol) {
      return rowColToA1FromAnchor(rowCol.row, rowCol.col);
    }
  } catch {
    // Fall through to regex-based extraction.
  }

  const rowMatch = decodedAnchor.match(/"(?:row|startRow|rowIndex|r)"\s*:\s*(\d+)/i);
  const colMatch = decodedAnchor.match(/"(?:column|startColumn|columnIndex|col|c)"\s*:\s*(\d+)/i);
  if (rowMatch?.[1] && colMatch?.[1]) {
    const row = Number(rowMatch[1]);
    const col = Number(colMatch[1]);
    return rowColToA1FromAnchor(row, col);
  }

  return null;
}

function dayFromCell(cellReference: string | null): number | null {
  if (!cellReference) {
    return null;
  }

  const column = cellReference.match(/^[A-Z]+/)?.[0];
  if (!column) {
    return null;
  }

  return DAY_BY_COLUMN[column] || null;
}

export async function runFetchComments(options: FetchCommentsOptions): Promise<void> {
  try {
    const config = await loadConfig();

    const sheetOwner = options.sheetOwner || config.defaults?.sheetOwner;
    const sheetTitle = options.sheetTitle || config.defaults?.sheetTitle;
    const authorEmail = (config.defaults?.sheetOwner || sheetOwner || '').toLowerCase();

    if (!sheetOwner || !sheetTitle) {
      console.error('Missing required arguments. Please provide:\n');
      console.error('  --sheet-owner <email>     Google Sheets owner email');
      console.error('  --sheet-title <title>     Google Sheets document title\n');
      console.error('Note: sheet-owner and sheet-title can be set as defaults in config.json');
      process.exit(1);
    }

    if (!authorEmail) {
      console.error('Missing defaults.sheetOwner in config.json (required to filter comment author).');
      process.exit(1);
    }

    const startModifiedTime = parseSinceToStartModifiedTime(options.since);

    const auth = new GoogleSheetsAuth();
    console.log('Authenticating with Google APIs...');
    const oAuth2Client = await auth.authenticate();

    const sheetsClient = new GoogleSheetsClient(oAuth2Client);
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    console.log(`Searching for sheet "${sheetTitle}" owned by ${sheetOwner}...`);
    const sheetInfo = await sheetsClient.findSheetByOwnerAndTitle(sheetOwner, sheetTitle);

    if (!sheetInfo) {
      console.error('Sheet not found');
      process.exit(1);
    }

    console.log(`Found sheet: ${sheetInfo.name} (${sheetInfo.id})`);
    console.log(`Fetching comments modified since ${startModifiedTime}...`);

    const comments: drive_v3.Schema$Comment[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.comments.list({
        fileId: sheetInfo.id,
        startModifiedTime,
        pageSize: 100,
        pageToken,
        fields: 'comments(id,anchor,content,htmlContent,modifiedTime,author(displayName,emailAddress),deleted),nextPageToken',
      });

      if (response.data.comments) {
        comments.push(...response.data.comments);
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    const filtered = comments.filter((comment: drive_v3.Schema$Comment) => {
      if (comment.deleted) {
        return false;
      }
      const commentAuthorEmail = comment.author?.emailAddress?.toLowerCase();
      return commentAuthorEmail === authorEmail;
    });

    if (filtered.length === 0) {
      console.log(`No comments found from ${authorEmail} in the selected time window.`);
      return;
    }

    console.log(`Found ${filtered.length} matching comment(s):\n`);

    for (const comment of filtered) {
      const cellReference = parseAnchorCellReference(comment.anchor);
      const day = dayFromCell(cellReference);
      const content = (comment.content || '').trim() || '[no content]';
      const modifiedTime = comment.modifiedTime || 'unknown-time';

      const locationParts = [
        cellReference ? `Cell ${cellReference}` : 'Cell unknown',
        day ? `Day ${day}` : 'Day unknown',
      ];

      console.log(`[${locationParts.join(' | ')}] ${modifiedTime}`);
      console.log(content);
      console.log('');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}
