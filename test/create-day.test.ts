import { afterEach, beforeEach, expect, jest, mock, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const sheetInfo = {
  id: 'sheet-id',
  name: 'Client Sheet 2025',
  url: 'https://example.com/sheet',
};

const createDayFixtureUrl = new URL('./fixtures/create-day-google-response-output.json', import.meta.url);
const createDayFixtureText = await Bun.file(createDayFixtureUrl).text();
const createDayFixtureData = JSON.parse(createDayFixtureText);
const createDayCellContent: string = createDayFixtureData.values[0][0];

const mockAuthenticate = mock(async () => ({ accessToken: 'fake-access-token' }));
const mockFindSheetByOwnerAndTitle = mock(async () => sheetInfo);
const mockGetCellRange = mock(async () => [[createDayCellContent]]);
const mockGetCellRangeResponseData = mock(async () => createDayFixtureData);
const mockCreateDayWorkoutPage = mock(async () => 'notion-page-id');
const mockNotionFromConfigFile = mock(async () => ({
  createDayWorkoutPage: mockCreateDayWorkoutPage,
}));

mock.module('../src/auth', () => {
  return {
    GoogleSheetsAuth: class {
      authenticate = mockAuthenticate;
    },
  };
});

mock.module('../src/sheets', () => {
  return {
    GoogleSheetsClient: class {
      findSheetByOwnerAndTitle = mockFindSheetByOwnerAndTitle;
      getCellRange = mockGetCellRange;
      getCellRangeResponseData = mockGetCellRangeResponseData;

      constructor(_auth: unknown) {}
    },
  };
});

mock.module('../src/notion', () => {
  return {
    NotionClient: {
      fromConfigFile: mockNotionFromConfigFile,
    },
  };
});

const { createDay } = await import('../src/create-day');

async function withTempCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'workout-google-sheets-test-'));
  const prevCwd = process.cwd();
  process.chdir(dir);

  try {
    return await fn(dir);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

function configWithDefaults(overrides?: Record<string, unknown>) {
  return {
    notion: {
      token: 'notion-token',
      parentPageId: 'parent-page-id',
    },
    defaults: {
      sheetOwner: 'owner@example.com',
      sheetTitle: 'Client Sheet 2025',
    },
    ...overrides,
  };
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeEach(() => {
  jest.clearAllMocks();
  console.log = () => {};
  console.error = () => {};
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

test('returns exit code 1 when required args are missing', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createDay(['node', 'create-day']);
    expect(exitCode).toBe(1);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});

test('returns exit code 1 when --dry-run and --dump-google-response are both set', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createDay([
      'node',
      'create-day',
      '--session-cell',
      'E2',
      '--dry-run',
      '--dump-google-response',
    ]);

    expect(exitCode).toBe(1);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});

test('writes create-day-google-response-output.json for --dump-google-response', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createDay([
      'node',
      'create-day',
      '--session-cell',
      'E2',
      '--dump-google-response',
    ]);

    expect(exitCode).toBe(0);
    expect(mockGetCellRangeResponseData).toHaveBeenCalledWith(sheetInfo.id, 'E2');
    expect(mockGetCellRange).not.toHaveBeenCalled();
    expect(mockNotionFromConfigFile).not.toHaveBeenCalled();

    const outputText = await readFile('create-day-google-response-output.json', 'utf8');
    expect(outputText).toBe(createDayFixtureText);
  });
});

test('writes dry-run-output.json containing the raw cell content and parsed session', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createDay([
      'node',
      'create-day',
      '--session-cell',
      'E2',
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(mockGetCellRange).toHaveBeenCalledWith(sheetInfo.id, 'E2');
    expect(mockNotionFromConfigFile).not.toHaveBeenCalled();

    const outputData = JSON.parse(await readFile('dry-run-output.json', 'utf8'));
    expect(outputData.rawContent).toBe(createDayCellContent);
    expect(outputData.parsed.sessionNumber).toBe(1);

    const allYoutubeLinks: string[] = outputData.parsed.sections.flatMap((s: any) => s.youtubeLinks);
    expect(allYoutubeLinks).toContain('https://www.youtube.com/watch?v=1x_x97fRJiY');
    expect(allYoutubeLinks).toContain('https://www.youtube.com/watch?v=-T-CWoaF6B0');
  });
});

test('creates a Notion page with a deterministic date-based title', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createDay(
      ['node', 'create-day', '--session-cell', 'E2'],
      { now: () => new Date('2026-01-02T12:34:56.000Z') }
    );

    expect(exitCode).toBe(0);
    expect(mockNotionFromConfigFile).toHaveBeenCalledTimes(1);
    expect(mockCreateDayWorkoutPage).toHaveBeenCalledTimes(1);
    expect(mockCreateDayWorkoutPage).toHaveBeenCalledWith('1/2/2026', expect.anything());
  });
});
