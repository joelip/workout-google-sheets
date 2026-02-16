import { drive_v3, google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface SheetInfo {
  id: string;
  name: string;
  url: string;
}

export interface SheetCellData {
  value: string;
  note: string;
  hasFill: boolean;
}

export type SheetCellValue = string | number | boolean;
export type SheetValues = SheetCellValue[][];

function isWhiteColor(color?: sheets_v4.Schema$Color | null): boolean {
  if (!color) {
    return false;
  }

  const red = color.red ?? 0;
  const green = color.green ?? 0;
  const blue = color.blue ?? 0;

  return red >= 0.98 && green >= 0.98 && blue >= 0.98;
}

function hasNonWhiteStyleFill(style?: sheets_v4.Schema$ColorStyle | null): boolean {
  if (!style) {
    return false;
  }

  if (style.themeColor && !style.rgbColor) {
    return true;
  }

  return !isWhiteColor(style.rgbColor);
}

function detectCellFill(cell: sheets_v4.Schema$CellData): boolean {
  if (hasNonWhiteStyleFill(cell.userEnteredFormat?.backgroundColorStyle)) {
    return true;
  }

  if (cell.userEnteredFormat?.backgroundColor && !isWhiteColor(cell.userEnteredFormat.backgroundColor)) {
    return true;
  }

  if (hasNonWhiteStyleFill(cell.effectiveFormat?.backgroundColorStyle)) {
    return true;
  }

  if (cell.effectiveFormat?.backgroundColor && !isWhiteColor(cell.effectiveFormat.backgroundColor)) {
    return true;
  }

  return false;
}

export class GoogleSheetsClient {
  private sheets: sheets_v4.Sheets;
  private drive: drive_v3.Drive;

  constructor(auth: OAuth2Client) {
    this.sheets = google.sheets({ version: 'v4', auth });
    this.drive = google.drive({ version: 'v3', auth });
  }

  async findSheetByOwnerAndTitle(ownerEmail: string, title: string): Promise<SheetInfo | null> {
    try {
      const query = `name='${title}' and '${ownerEmail}' in owners and mimeType='application/vnd.google-apps.spreadsheet'`;
      
      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name, webViewLink)',
      });

      const files = response.data.files;
      if (!files || files.length === 0) {
        return null;
      }

      const file = files[0];
      if (!file) {
        return null;
      }
      return {
        id: file.id!,
        name: file.name!,
        url: file.webViewLink!,
      };
    } catch (error) {
      throw new Error(`Error searching for sheet: ${error}`);
    }
  }

  private async fetchCellRange(spreadsheetId: string, range: string): Promise<sheets_v4.Schema$ValueRange> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      return response.data as sheets_v4.Schema$ValueRange;
    } catch (error) {
      throw new Error(`Error getting cell range ${range}: ${error}`);
    }
  }

  async getCellRange(spreadsheetId: string, range: string): Promise<SheetValues> {
    const responseData = await this.fetchCellRange(spreadsheetId, range);
    return (responseData.values as SheetValues | undefined) || [];
  }

  async getCellRangeResponseData(spreadsheetId: string, range: string): Promise<sheets_v4.Schema$ValueRange> {
    return this.fetchCellRange(spreadsheetId, range);
  }

  async getSheetMetadata(spreadsheetId: string): Promise<sheets_v4.Schema$Spreadsheet> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'properties,sheets.properties',
      });

      return response.data as sheets_v4.Schema$Spreadsheet;
    } catch (error) {
      throw new Error(`Error getting sheet metadata: ${error}`);
    }
  }

  async getCellDataRange(spreadsheetId: string, range: string): Promise<SheetCellData[][]> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
        ranges: [range],
        includeGridData: true,
        fields: 'sheets(data(rowData(values(formattedValue,note,userEnteredFormat(backgroundColor,backgroundColorStyle),effectiveFormat(backgroundColor,backgroundColorStyle)))))',
      });

      const rowData = response.data.sheets?.[0]?.data?.[0]?.rowData || [];
      return rowData.map((row) =>
        (row.values || []).map((cell) => ({
          value: cell.formattedValue || '',
          note: cell.note || '',
          hasFill: detectCellFill(cell),
        }))
      );
    } catch (error) {
      throw new Error(`Error getting cell data range ${range}: ${error}`);
    }
  }
}
