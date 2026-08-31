#!/usr/bin/env bun
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';

type JsonRecord = Record<string, unknown>;

interface WeekState extends JsonRecord {
  hash: string;
  marker: string;
  phase: string;
  updatedAt: string;
}

interface DayRequestState extends JsonRecord {
  day: number;
  phase: string;
  updatedAt: string;
}

interface InquiryState extends JsonRecord {
  kind: string;
  marker: string;
  phase: string;
  updatedAt: string;
}

interface WorkflowState extends JsonRecord {
  version: 1;
  dayRequests: Record<string, DayRequestState>;
  inquiries: Record<string, InquiryState>;
  week?: WeekState;
}

interface ExecutionOptions {
  stdin?: () => Promise<string>;
  stdout?: (value: string) => void;
  now?: () => string;
  lockWaitMs?: number;
}

const DEFAULT_LOCK_WAIT_MS = 5_000;

export async function executeWorkflowState(
  argv: string[],
  options: ExecutionOptions = {}
): Promise<void> {
  const stdin = options.stdin ?? (() => Bun.stdin.text());
  const stdout = options.stdout ?? console.log;
  const timestamp = options.now ?? (() => new Date().toISOString());
  const program = new Command()
    .name('workflow-state')
    .description('Atomic, duplicate-safe state transitions for the workout sheet workflow')
    .exitOverride();

  const runLocked = async (
    statePath: string,
    operation: (state: WorkflowState, path: string) => Promise<JsonRecord> | JsonRecord
  ): Promise<void> => {
    const path = resolveStatePath(statePath);
    const result = await withStateLock(path, async () => operation(loadState(path), path), {
      maxWaitMs: options.lockWaitMs,
    });
    stdout(stringifyJson(result));
  };

  program
    .command('observe-week')
    .requiredOption('--state <path>')
    .requiredOption('--sheet-id <id>')
    .requiredOption('--range <range>')
    .action(async (commandOptions: { state: string; sheetId: string; range: string }) => {
      await runLocked(commandOptions.state, async (state, path) => {
        const snapshot = normalizeSnapshot(await stdin());
        if (!snapshot || snapshot.startsWith('No workout plans found')) {
          return { status: 'empty' };
        }

        const hash = digest(snapshot);
        const marker = `wgs:${hash.slice(0, 12)}`;
        const week = state.week;
        if (!week) {
          state.week = {
            hash,
            marker,
            phase: 'baseline',
            sheetId: commandOptions.sheetId,
            range: commandOptions.range,
            updatedAt: timestamp(),
          };
          saveState(path, state);
          return { status: 'baseline', hash, marker };
        }

        if (week.hash === hash) {
          const status = ({
            baseline: 'unchanged',
            pending: 'notify',
            notified: 'awaiting-confirmation',
            creating: 'needs-review',
            created: 'unchanged',
            failed: 'needs-review',
          } as Record<string, string>)[week.phase] ?? 'needs-review';
          return { status, hash, marker, phase: week.phase };
        }

        if (week.phase === 'creating') {
          return {
            status: 'needs-review',
            reason: 'snapshot-changed-during-creation',
            hash,
            marker,
          };
        }

        state.week = {
          hash,
          marker,
          phase: 'pending',
          sheetId: commandOptions.sheetId,
          range: commandOptions.range,
          updatedAt: timestamp(),
        };
        saveState(path, state);
        return { status: 'notify', hash, marker };
      });
    });

  for (const transition of [
    { name: 'record-week-email', source: ['pending'], target: 'notified' },
    { name: 'complete-week', source: ['creating'], target: 'created' },
    { name: 'fail-week', source: ['creating'], target: 'failed', reason: true },
  ]) {
    const command = program
      .command(transition.name)
      .requiredOption('--state <path>')
      .requiredOption('--hash <hash>');
    if (transition.reason) {
      command.requiredOption('--reason <reason>');
    }
    command.action(async (commandOptions: { state: string; hash: string; reason?: string }) => {
      await runLocked(commandOptions.state, (state, path) => {
        const week = requireWeek(state, commandOptions.hash, new Set(transition.source));
        week.phase = transition.target;
        week.updatedAt = timestamp();
        if (commandOptions.reason) {
          week.failureReason = commandOptions.reason;
        }
        saveState(path, state);
        return { ok: true, phase: transition.target, hash: commandOptions.hash };
      });
    });
  }

  program
    .command('claim-week')
    .requiredOption('--state <path>')
    .requiredOption('--hash <hash>')
    .requiredOption('--confirmation-key <key>')
    .action(async (commandOptions: { state: string; hash: string; confirmationKey: string }) => {
      await runLocked(commandOptions.state, (state, path) => {
        if (state.week?.hash === commandOptions.hash && state.week.phase === 'creating') {
          return { claimed: false, phase: 'creating' };
        }
        const week = requireWeek(state, commandOptions.hash, new Set(['notified']));
        week.phase = 'creating';
        week.confirmationKeyHash = digest(commandOptions.confirmationKey);
        week.updatedAt = timestamp();
        saveState(path, state);
        return { claimed: true, phase: 'creating', hash: commandOptions.hash };
      });
    });

  program
    .command('claim-day')
    .requiredOption('--state <path>')
    .requiredOption('--request-key <key>')
    .requiredOption('--day <day>')
    .action(async (commandOptions: { state: string; requestKey: string; day: string }) => {
      await runLocked(commandOptions.state, (state, path) => {
        const day = Number(commandOptions.day);
        if (![1, 2, 3, 4].includes(day)) {
          throw new Error('Day must be 1, 2, 3, or 4');
        }
        const key = digest(commandOptions.requestKey);
        const existing = state.dayRequests[key];
        if (existing) {
          return { claimed: false, phase: existing.phase, day: existing.day };
        }
        state.dayRequests[key] = { day, phase: 'creating', updatedAt: timestamp() };
        saveState(path, state);
        return { claimed: true, phase: 'creating', day };
      });
    });

  for (const transition of [
    { name: 'complete-day', target: 'created' },
    { name: 'fail-day', target: 'failed', reason: true },
  ]) {
    const command = program
      .command(transition.name)
      .requiredOption('--state <path>')
      .requiredOption('--request-key <key>');
    if (transition.reason) {
      command.requiredOption('--reason <reason>');
    }
    command.action(async (commandOptions: { state: string; requestKey: string; reason?: string }) => {
      await runLocked(commandOptions.state, (state, path) => {
        const request = state.dayRequests[digest(commandOptions.requestKey)];
        if (!request || request.phase !== 'creating') {
          throw new Error('Day request state mismatch; manual review required');
        }
        request.phase = transition.target;
        request.updatedAt = timestamp();
        if (commandOptions.reason) {
          request.failureReason = commandOptions.reason;
        }
        saveState(path, state);
        return { ok: true, phase: transition.target, day: request.day };
      });
    });
  }

  program
    .command('claim-inquiry')
    .requiredOption('--state <path>')
    .requiredOption('--message-key <key>')
    .requiredOption('--kind <kind>')
    .action(async (commandOptions: { state: string; messageKey: string; kind: string }) => {
      await runLocked(commandOptions.state, (state, path) => {
        if (!['answer', 'clarification'].includes(commandOptions.kind)) {
          throw new Error('--kind must be answer or clarification');
        }
        const key = digest(commandOptions.messageKey);
        const marker = `wgs-inquiry:${key.slice(0, 12)}`;
        const existing = state.inquiries[key];
        if (existing) {
          return {
            claimed: false,
            phase: existing.phase,
            kind: existing.kind,
            marker: existing.marker || marker,
          };
        }
        state.inquiries[key] = {
          kind: commandOptions.kind,
          marker,
          phase: 'replying',
          updatedAt: timestamp(),
        };
        saveState(path, state);
        return { claimed: true, phase: 'replying', kind: commandOptions.kind, marker };
      });
    });

  for (const transition of [
    { name: 'complete-inquiry', target: 'answered' },
    { name: 'fail-inquiry', target: 'failed', reason: true },
  ]) {
    const command = program
      .command(transition.name)
      .requiredOption('--state <path>')
      .requiredOption('--message-key <key>');
    if (transition.reason) {
      command.requiredOption('--reason <reason>');
    }
    command.action(async (commandOptions: { state: string; messageKey: string; reason?: string }) => {
      await runLocked(commandOptions.state, (state, path) => {
        const inquiry = state.inquiries[digest(commandOptions.messageKey)];
        if (!inquiry || inquiry.phase !== 'replying') {
          throw new Error('Inquiry state mismatch; manual review required');
        }
        inquiry.phase = transition.target;
        inquiry.updatedAt = timestamp();
        if (commandOptions.reason) {
          inquiry.failureReason = commandOptions.reason;
        }
        saveState(path, state);
        return {
          ok: true,
          phase: transition.target,
          kind: inquiry.kind,
          marker: inquiry.marker,
        };
      });
    });
  }

  await program.parseAsync(['bun', 'workflow-state', ...argv]);
}

export async function withStateLock<T>(
  statePath: string,
  operation: () => Promise<T> | T,
  options: { maxWaitMs?: number; retryMs?: number } = {}
): Promise<T> {
  const lockPath = `${statePath}.lockdir`;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const retryMs = options.retryMs ?? 50;
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
      if (Date.now() - startedAt >= maxWaitMs) {
        throw new Error(`Workflow state is locked at ${lockPath}; manual review required`);
      }
      await Bun.sleep(retryMs);
    }
  }

  try {
    return await operation();
  } finally {
    rmdirSync(lockPath);
  }
}

export function loadState(path: string): WorkflowState {
  if (!existsSync(path)) {
    return { version: 1, dayRequests: {}, inquiries: {} };
  }
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.dayRequests)) {
    throw new Error('Unsupported or invalid workflow state; manual review required');
  }
  if (!isRecord(value.inquiries ?? {})) {
    throw new Error('Invalid inquiry state; manual review required');
  }
  return {
    ...value,
    version: 1,
    dayRequests: value.dayRequests as Record<string, DayRequestState>,
    inquiries: (value.inquiries ?? {}) as Record<string, InquiryState>,
    week: isRecord(value.week) ? value.week as WeekState : undefined,
  };
}

export function saveState(path: string, state: WorkflowState): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = resolve(directory, `.${basename(path)}.${process.pid}.${randomUUID()}`);
  let descriptor: number | undefined;
  try {
    writeFileSync(temporaryPath, `${stringifyJson(state, 2)}\n`, { mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    descriptor = openSync(temporaryPath, 'r');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath);
    }
  }
}

function requireWeek(state: WorkflowState, hash: string, phases: Set<string>): WeekState {
  const week = state.week;
  if (!week || week.hash !== hash || !phases.has(week.phase)) {
    throw new Error('Week state/hash mismatch; manual review required');
  }
  return week;
}

function resolveStatePath(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

function normalizeSnapshot(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stringifyJson(value: unknown, space?: number): string {
  return JSON.stringify(sortJson(value), null, space);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

if (import.meta.main) {
  executeWorkflowState(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') {
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
