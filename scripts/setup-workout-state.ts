#!/usr/bin/env bun
import { chmod, readFile, writeFile } from 'node:fs/promises';
import {
  D1WorkoutHistoryClient,
  syncWorkoutHistoryWithD1,
} from '../src/d1-workout-history';
import { WorkoutHistoryStore } from '../src/workout-history';

const configPath = readOption('--config') ?? 'config.json';
const statePath = readOption('--state');
const databaseName = readOption('--database-name') ?? 'workout-google-sheets';
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!apiToken) {
  throw new Error('Set CLOUDFLARE_API_TOKEN to a token with Cloudflare D1 Write access');
}
if (!/^[A-Za-z0-9_-]+$/.test(apiToken)) {
  throw new Error('CLOUDFLARE_API_TOKEN contains unexpected characters');
}

const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  d1?: { accountId?: string; databaseId?: string };
  r2?: { accountId?: string };
  [key: string]: unknown;
};
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  ?? config.d1?.accountId
  ?? config.r2?.accountId;
if (!accountId) {
  throw new Error('Set CLOUDFLARE_ACCOUNT_ID or configure d1.accountId/r2.accountId');
}

let databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID ?? config.d1?.databaseId;
if (!databaseId) {
  databaseId = await createDatabase({ accountId, apiToken, databaseName });
  console.log(`Created D1 database ${databaseName}`);
} else {
  console.log(`Using configured D1 database ${databaseId}`);
}

if (config.d1?.accountId !== accountId || config.d1?.databaseId !== databaseId) {
  config.d1 = { accountId, databaseId };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  console.log(`Saved the non-secret D1 account and database IDs in ${configPath}`);
}

if (process.argv.includes('--persist-token')) {
  await persistEnvironmentValue('.env', 'CLOUDFLARE_API_TOKEN', apiToken);
  console.log('Saved the D1-only API token in gitignored .env with mode 0600');
}

const store = new WorkoutHistoryStore(statePath);
try {
  const cloudClient = new D1WorkoutHistoryClient({ accountId, databaseId, apiToken });
  const summary = await syncWorkoutHistoryWithD1({ store, cloudClient });
  console.log(`D1 schema is ready; ${summary.mergedPages} workout pages are synchronized`);
  console.log(`Uploaded ${summary.uploadedPages}; downloaded ${summary.downloadedPages}`);
} finally {
  store.close();
}

async function createDatabase(params: {
  accountId: string;
  apiToken: string;
  databaseName: string;
}): Promise<string> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(params.accountId)}/d1/database`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: params.databaseName,
        primary_location_hint: 'wnam',
      }),
    }
  );
  const payload = await response.json() as {
    success?: boolean;
    result?: { uuid?: string };
    errors?: Array<{ message?: string }>;
  };
  const databaseId = payload.result?.uuid;
  if (!response.ok || !payload.success || !databaseId) {
    const details = payload.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`Could not create D1 database${details ? `: ${details}` : ` (HTTP ${response.status})`}`);
  }
  return databaseId;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export async function persistEnvironmentValue(
  path: string,
  key: string,
  value: string
): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
  const line = `${key}=${value}`;
  const lines = existing.split(/\r?\n/).filter((entry) => entry.length > 0);
  const index = lines.findIndex((entry) => entry.startsWith(`${key}=`));
  if (index === -1) {
    lines.push(line);
  } else {
    lines[index] = line;
  }
  await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
