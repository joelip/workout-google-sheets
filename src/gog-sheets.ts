import { $ } from 'bun';

export interface SheetInfo {
  id: string;
  name: string;
  url: string;
}

/**
 * Google Sheets client using the `gog` CLI instead of the googleapis library.
 * Drop-in replacement for GoogleSheetsClient with the same interface.
 */
export class GogSheetsClient {
  private account?: string;

  constructor(account?: string) {
    this.account = account;
  }

  private getAccountFlag(): string[] {
    return this.account ? ['--account', this.account] : [];
  }

  async findSheetByOwnerAndTitle(ownerEmail: string, title: string): Promise<SheetInfo | null> {
    try {
      // Search for spreadsheets with the given title owned by the specified email
      const query = `name='${title}' and '${ownerEmail}' in owners and mimeType='application/vnd.google-apps.spreadsheet'`;
      
      const result = await $`gog drive search ${query} --max 1 --json ${this.getAccountFlag()}`.json();
      
      if (!result || !Array.isArray(result) || result.length === 0) {
        return null;
      }

      const file = result[0];
      return {
        id: file.id,
        name: file.name,
        url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`,
      };
    } catch (error) {
      throw new Error(`Error searching for sheet: ${error}`);
    }
  }

  async getCellRange(spreadsheetId: string, range: string): Promise<any[][]> {
    try {
      const result = await $`gog sheets get ${spreadsheetId} ${range} --json ${this.getAccountFlag()}`.json();
      
      // gog sheets get returns { values: [[...], [...]] } or similar structure
      if (result && result.values) {
        return result.values;
      }
      
      // If result is already an array of arrays
      if (Array.isArray(result) && (result.length === 0 || Array.isArray(result[0]))) {
        return result;
      }

      return [];
    } catch (error) {
      throw new Error(`Error getting cell range ${range}: ${error}`);
    }
  }

  async getCellRangeResponseData(spreadsheetId: string, range: string): Promise<any> {
    try {
      const result = await $`gog sheets get ${spreadsheetId} ${range} --json ${this.getAccountFlag()}`.json();
      return result;
    } catch (error) {
      throw new Error(`Error getting cell range response data ${range}: ${error}`);
    }
  }

  async getSheetMetadata(spreadsheetId: string): Promise<any> {
    try {
      const result = await $`gog sheets metadata ${spreadsheetId} --json ${this.getAccountFlag()}`.json();
      return result;
    } catch (error) {
      throw new Error(`Error getting sheet metadata: ${error}`);
    }
  }
}
