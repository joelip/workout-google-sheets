export class CommandError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = 1) {
    super(message);
    this.name = 'CommandError';
    this.exitCode = exitCode;
  }
}

export function fail(message: string, exitCode: number = 1): never {
  throw new CommandError(message, exitCode);
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
