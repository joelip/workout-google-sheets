import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.metadata.readonly'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

export class GoogleSheetsAuth {
  private oAuth2Client: OAuth2Client | null = null;

  async authenticate(): Promise<OAuth2Client> {
    const credentials = await this.loadCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    this.oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
      const token = await this.loadToken();
      this.oAuth2Client.setCredentials(token);
      return this.oAuth2Client;
    } catch (error) {
      return await this.getNewToken();
    }
  }

  private async loadCredentials(): Promise<any> {
    try {
      const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Error loading credentials from ${CREDENTIALS_PATH}: ${error}`);
    }
  }

  private async loadToken(): Promise<any> {
    const content = await fs.readFile(TOKEN_PATH, 'utf8');
    return JSON.parse(content);
  }

  private async getNewToken(): Promise<OAuth2Client> {
    if (!this.oAuth2Client) {
      throw new Error('OAuth2Client not initialized');
    }

    const authUrl = this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    console.log('Authorize this app by visiting this url:', authUrl);
    console.log('Enter the code from that page here:');

    return new Promise((resolve, reject) => {
      process.stdin.once('data', async (data) => {
        const code = data.toString().trim();
        try {
          const { tokens } = await this.oAuth2Client!.getToken(code);
          this.oAuth2Client!.setCredentials(tokens);
          await this.storeToken(tokens);
          resolve(this.oAuth2Client!);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async storeToken(token: any): Promise<void> {
    await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
    console.log('Token stored to', TOKEN_PATH);
  }
}