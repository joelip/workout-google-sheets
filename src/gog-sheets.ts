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

  async findSheetByOwnerAndTitle(ownerEmail: string, title: string): Promise<SheetInfo | null> {
    try {
      // Search for spreadsheets with the given title
      // gog drive search uses simple text search, then we filter results
      const result = await $`gog drive search ${title} --max 20 --json --account ${ownerEmail} --no-input`.json();
      
      if (!result || !Array.isArray(result) || result.length === 0) {
        return null;
      }

      // Find a spreadsheet with matching title
      const file = result.find((f: any) => 
        f.name === title && 
        f.mimeType === 'application/vnd.google-apps.spreadsheet'
      );

      if (!file) {
        return null;
      }

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
      const accountFlags = this.account ? ['--account', this.account] : [];
      const result = await $`gog sheets get ${spreadsheetId} ${range} --json --no-input ${accountFlags}`.json();
      
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
      const accountFlags = this.account ? ['--account', this.account] : [];
      const result = await $`gog sheets get ${spreadsheetId} ${range} --json --no-input ${accountFlags}`.json();
      return result;
    } catch (error) {
      throw new Error(`Error getting cell range response data ${range}: ${error}`);
    }
  }

  async getSheetMetadata(spreadsheetId: string): Promise<any> {
    try {
      const accountFlags = this.account ? ['--account', this.account] : [];
      const result = await $`gog sheets metadata ${spreadsheetId} --json --no-input ${accountFlags}`.json();
      return result;
    } catch (error) {
      throw new Error(`Error getting sheet metadata: ${error}`);
    }
  }
}
