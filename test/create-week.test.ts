import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const sheetInfo = {
  id: 'sheet-id',
  name: 'Client Sheet 2025',
  url: 'https://example.com/sheet',
};

const createWeekFixtureUrl = new URL('./fixtures/create-week-google-response-output.json', import.meta.url);
const createWeekFixtureText = await Bun.file(createWeekFixtureUrl).text();
const createWeekFixtureData = JSON.parse(createWeekFixtureText);
const createWeekCellData: any[][] = createWeekFixtureData.values;

const mockAuthenticate = mock(async () => ({ accessToken: 'fake-access-token' }));
const mockFindSheetByOwnerAndTitle = mock(async () => sheetInfo);
const mockGetCellRange = mock(async () => createWeekCellData);
const mockGetCellRangeResponseData = mock(async () => createWeekFixtureData);
const mockCreateWorkoutPage = mock(async () => 'notion-page-id');
const mockNotionFromConfigFile = mock(async () => ({
  createWorkoutPage: mockCreateWorkoutPage,
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

const { createWeek } = await import('../src/create-week');

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
      cellRange: 'B2:E2',
    },
    ...overrides,
  };
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeEach(() => {
  mockAuthenticate.mockClear();
  mockFindSheetByOwnerAndTitle.mockClear();
  mockGetCellRange.mockClear();
  mockGetCellRangeResponseData.mockClear();
  mockCreateWorkoutPage.mockClear();
  mockNotionFromConfigFile.mockClear();
  console.log = () => {};
  console.error = () => {};
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

test('returns exit code 1 when required args are missing', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify({ notion: configWithDefaults().notion }), 'utf8');

    const exitCode = await createWeek(['node', 'create-week']);
    expect(exitCode).toBe(1);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});

test('returns exit code 1 when --dry-run and --dump-google-response are both set', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createWeek([
      'node',
      'create-week',
      '--dry-run',
      '--dump-google-response',
    ]);

    expect(exitCode).toBe(1);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});

test('writes create-week-google-response-output.json for --dump-google-response', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createWeek(['node', 'create-week', '--dump-google-response']);

    expect(exitCode).toBe(0);
    expect(mockGetCellRangeResponseData).toHaveBeenCalledWith(sheetInfo.id, 'B2:E2');
    expect(mockGetCellRange).not.toHaveBeenCalled();
    expect(mockNotionFromConfigFile).not.toHaveBeenCalled();

    const outputText = await readFile('create-week-google-response-output.json', 'utf8');
    expect(outputText).toBe(createWeekFixtureText);
  });
});

test('returns exit code 1 when the Google Sheet cannot be found', async () => {
  mockFindSheetByOwnerAndTitle.mockResolvedValueOnce(null as any);

  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createWeek(['node', 'create-week']);
    expect(exitCode).toBe(1);
    expect(mockGetCellRange).not.toHaveBeenCalled();
    expect(mockNotionFromConfigFile).not.toHaveBeenCalled();
  });
});

test('writes dry-run-output.json containing parsed sessions', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createWeek(['node', 'create-week', '--dry-run']);

    expect(exitCode).toBe(0);
    expect(mockGetCellRange).toHaveBeenCalledWith(sheetInfo.id, 'B2:E2');
    expect(mockNotionFromConfigFile).not.toHaveBeenCalled();

    const outputSessions = JSON.parse(await readFile('dry-run-output.json', 'utf8'));
    expect(outputSessions).toHaveLength(4);
    expect(outputSessions.map((s: any) => s.sessionNumber)).toEqual([1, 2, 3, 4]);

    const allYoutubeLinks: string[] = outputSessions.flatMap((session: any) =>
      session.sections.flatMap((section: any) => section.youtubeLinks)
    );
    expect(allYoutubeLinks).toContain('https://www.youtube.com/watch?v=1x_x97fRJiY');
    expect(allYoutubeLinks).toContain('https://www.youtube.com/watch?v=DwkgG0QFxbQ');
  });
});

test('returns exit code 1 when creating Notion pages without data.currentWeekNumber', async () => {
  await withTempCwd(async () => {
    await writeFile('config.json', JSON.stringify(configWithDefaults()), 'utf8');

    const exitCode = await createWeek(['node', 'create-week']);
    expect(exitCode).toBe(1);
    expect(mockNotionFromConfigFile).not.toHaveBeenCalled();
  });
});

test('increments currentWeekNumber and creates a Notion page with the expected title and icon', async () => {
  await withTempCwd(async () => {
    await writeFile(
      'config.json',
      JSON.stringify(
        configWithDefaults({
          data: {
            currentWeekNumber: 10,
          },
        })
      ),
      'utf8'
    );

    const exitCode = await createWeek(['node', 'create-week']);
    expect(exitCode).toBe(0);
    expect(mockNotionFromConfigFile).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkoutPage).toHaveBeenCalledTimes(1);

    expect(mockCreateWorkoutPage).toHaveBeenCalledWith('Week 11 with Kyle Habdo', expect.any(Array), '1️⃣');

    const calls = mockCreateWorkoutPage.mock.calls as unknown as any[][];
    const sessions = calls[0]?.[1];
    expect(sessions).toHaveLength(4);

    const updatedConfigText = await readFile('config.json', 'utf8');
    expect(updatedConfigText.endsWith('\n')).toBe(true);
    const updatedConfig = JSON.parse(updatedConfigText);
    expect(updatedConfig.data.currentWeekNumber).toBe(11);
  });
});
