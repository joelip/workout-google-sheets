import { drive_v3, google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface SheetInfo {
  id: string;
  name: string;
  url: string;
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

  async getCellRange(spreadsheetId: string, range: string): Promise<any[][]> {
    const responseData = await this.fetchCellRange(spreadsheetId, range);
    return responseData.values || [];
  }

  async getCellRangeResponseData(spreadsheetId: string, range: string): Promise<sheets_v4.Schema$ValueRange> {
    return this.fetchCellRange(spreadsheetId, range);
  }

  async getSheetMetadata(spreadsheetId: string): Promise<any> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'properties,sheets.properties',
      });

      return response.data;
    } catch (error) {
      throw new Error(`Error getting sheet metadata: ${error}`);
    }
  }
}
