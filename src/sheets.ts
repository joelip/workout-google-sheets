import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface SheetInfo {
  id: string;
  name: string;
  url: string;
}

export class GoogleSheetsClient {
  private sheets: any;
  private drive: any;

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
      return {
        id: file.id!,
        name: file.name!,
        url: file.webViewLink!,
      };
    } catch (error) {
      throw new Error(`Error searching for sheet: ${error}`);
    }
  }

  async getCellRange(spreadsheetId: string, range: string): Promise<any[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      return response.data.values || [];
    } catch (error) {
      throw new Error(`Error getting cell range ${range}: ${error}`);
    }
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