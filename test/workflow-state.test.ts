import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeWorkflowState,
  loadState,
  withStateLock,
} from '../.agents/skills/workout-google-sheets/scripts/workflow-state';

let tempDirectory: string | undefined;

afterEach(() => {
  if (tempDirectory) {
    rmSync(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  }
});

describe('workflow state CLI', () => {
  test('preserves the baseline, notification, and duplicate-safe week workflow', async () => {
    const statePath = makeStatePath();
    const baseline = await run(
      ['observe-week', '--state', statePath, '--sheet-id', 'sheet', '--range', 'B2:E2'],
      '# Workout Plans:\nplan one  \n'
    );
    expect(baseline.status).toBe('baseline');
    expect(String(baseline.marker).startsWith('wgs:')).toBe(true);

    const unchanged = await run(
      ['observe-week', '--state', statePath, '--sheet-id', 'sheet', '--range', 'B2:E2'],
      '# Workout Plans:\nplan one\n'
    );
    expect(unchanged).toMatchObject({ status: 'unchanged', phase: 'baseline' });

    const changed = await run(
      ['observe-week', '--state', statePath, '--sheet-id', 'sheet', '--range', 'B2:E2'],
      '# Workout Plans:\nplan two\n'
    );
    expect(changed).toMatchObject({ status: 'notify' });
    const hash = String(changed.hash);

    await run(['record-week-email', '--state', statePath, '--hash', hash]);
    const claim = await run([
      'claim-week', '--state', statePath, '--hash', hash, '--confirmation-key', 'reply-1',
    ]);
    expect(claim).toMatchObject({ claimed: true, phase: 'creating' });
    const duplicate = await run([
      'claim-week', '--state', statePath, '--hash', hash, '--confirmation-key', 'reply-1',
    ]);
    expect(duplicate).toEqual({ claimed: false, phase: 'creating' });

    await run(['complete-week', '--state', statePath, '--hash', hash]);
    expect(loadState(statePath).week?.phase).toBe('created');
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
  });

  test('keeps day and inquiry claims idempotent', async () => {
    const statePath = makeStatePath();
    const day = await run([
      'claim-day', '--state', statePath, '--request-key', 'day-message', '--day', '3',
    ]);
    expect(day).toEqual({ claimed: true, day: 3, phase: 'creating' });
    expect(await run([
      'claim-day', '--state', statePath, '--request-key', 'day-message', '--day', '3',
    ])).toEqual({ claimed: false, day: 3, phase: 'creating' });
    await run(['complete-day', '--state', statePath, '--request-key', 'day-message']);

    const inquiry = await run([
      'claim-inquiry', '--state', statePath, '--message-key', 'mail-1', '--kind', 'answer',
    ]);
    expect(inquiry).toMatchObject({ claimed: true, kind: 'answer', phase: 'replying' });
    expect(await run([
      'claim-inquiry', '--state', statePath, '--message-key', 'mail-1', '--kind', 'answer',
    ])).toMatchObject({ claimed: false, kind: 'answer', phase: 'replying' });
    await run(['complete-inquiry', '--state', statePath, '--message-key', 'mail-1']);

    const state = loadState(statePath);
    expect(Object.values(state.dayRequests)[0]?.phase).toBe('created');
    expect(Object.values(state.inquiries)[0]?.phase).toBe('answered');
  });

  test('fails closed when another process holds the state lock', async () => {
    const statePath = makeStatePath();
    mkdirSync(`${statePath}.lockdir`, { recursive: true });
    await expect(withStateLock(statePath, () => undefined, {
      maxWaitMs: 0,
      retryMs: 1,
    })).rejects.toThrow('manual review required');
  });
});

async function run(argv: string[], stdin: string = ''): Promise<Record<string, unknown>> {
  const output: string[] = [];
  await executeWorkflowState(argv, {
    stdin: async () => stdin,
    stdout: (value) => output.push(value),
    now: () => '2026-08-31T00:00:00.000Z',
    lockWaitMs: 20,
  });
  expect(output).toHaveLength(1);
  return JSON.parse(output[0]!) as Record<string, unknown>;
}

function makeStatePath(): string {
  tempDirectory = mkdtempSync(join(tmpdir(), 'wgs-workflow-state-test-'));
  return join(tempDirectory, 'workflow.json');
}
