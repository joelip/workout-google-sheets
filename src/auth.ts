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

    // Guard against deprecated OOB redirect URIs which cause Error 400: invalid_request
    const usesDeprecatedOob = Array.isArray(redirect_uris)
      && redirect_uris.some((u: string) => typeof u === 'string' && u.includes('urn:ietf:wg:oauth:2.0:oob'));
    if (usesDeprecatedOob) {
      throw new Error(
        'The OAuth client in credentials.json uses the deprecated OOB redirect URI (urn:ietf:wg:oauth:2.0:oob). '
        + 'Google blocks this with Error 400: invalid_request. Create a new OAuth client with Application type "Desktop app" '
        + 'so its redirect URIs are loopback (http://localhost). Download the new JSON and replace credentials.json, then re-run.'
      );
    }

    this.oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
      const token = await this.loadToken();
      this.oAuth2Client.setCredentials(token);

      // Set up automatic token refresh
      this.oAuth2Client.on('tokens', async (tokens) => {
        if (tokens.refresh_token) {
          // Store the new refresh token
          const existingToken = await this.loadToken().catch(() => ({}));
          await this.storeToken({ ...existingToken, ...tokens });
        } else {
          // Store just the access token update
          const existingToken = await this.loadToken().catch(() => ({}));
          await this.storeToken({ ...existingToken, access_token: tokens.access_token });
        }
      });

      // Test the token by making a simple request
      await this.validateToken();

      return this.oAuth2Client;
    } catch (error) {
      console.log('Token validation failed, getting new token...');
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
      prompt: 'consent',
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

  private async validateToken(): Promise<void> {
    if (!this.oAuth2Client) {
      throw new Error('OAuth2Client not initialized');
    }

    // Check if token is expired
    const now = Date.now();
    const expiry = this.oAuth2Client.credentials.expiry_date;

    if (expiry && now >= expiry) {
      // Token is expired, try to refresh it
      if (this.oAuth2Client.credentials.refresh_token) {
        try {
          await this.oAuth2Client.refreshAccessToken();
          return; // Token refreshed successfully
        } catch (error) {
          throw new Error(`Token refresh failed: ${error}`);
        }
      } else {
        throw new Error('Token expired and no refresh token available');
      }
    }

    try {
      // Try to get user info to validate the token
      await this.oAuth2Client.getTokenInfo(this.oAuth2Client.credentials.access_token!);
    } catch (error) {
      // If validation fails, try refreshing the token first
      if (this.oAuth2Client.credentials.refresh_token) {
        try {
          await this.oAuth2Client.refreshAccessToken();
          return; // Token refreshed successfully
        } catch (refreshError) {
          throw new Error(`Token validation and refresh failed: ${error}`);
        }
      } else {
        throw new Error(`Token validation failed: ${error}`);
      }
    }
  }
}
