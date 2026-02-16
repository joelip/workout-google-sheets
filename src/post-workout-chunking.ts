import { removePlusOnlyMarkerLines } from './text-cleaning';

export interface WorkoutTextSections {
  overallNotes?: string;
  lowerBody?: string;
  upperBody?: string;
}

export const SHEETS_CHUNK_CHAR_LIMIT = 2048;
const UPPER_BODY_HEADER_PATTERN = /^###\s*upper body:\s*$/i;
const MINOR_SECTION_PATTERN = /^(?:plyo progression|deep tier plyo|run\/walk progression|conditioning):?$/i;

export function renderWorkoutTextOutput(sections: WorkoutTextSections): string {
  const combined = [sections.overallNotes, sections.lowerBody, sections.upperBody]
    .filter((section): section is string => Boolean(section && section.trim().length > 0))
    .join('\n\n');

  return removePlusOnlyMarkerLines(combined).trim();
}

export function splitWorkoutTextForSheets(
  text: string,
  maxChars: number = SHEETS_CHUNK_CHAR_LIMIT
): string[] {
  if (!text.trim()) {
    return [];
  }

  const upperBodyStart = findUpperBodyStartIndex(text);
  const baseChunks =
    upperBodyStart > 0
      ? [
          text.slice(0, upperBodyStart),
          text.slice(upperBodyStart),
        ].filter((chunk) => chunk.length > 0)
      : [text];

  return baseChunks.flatMap((chunk) => splitChunkByPreferredBoundaries(chunk, maxChars));
}

function findUpperBodyStartIndex(text: string): number {
  const lines = text.split('\n');
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    if (UPPER_BODY_HEADER_PATTERN.test(lines[i].trim())) {
      return index;
    }
    index += lines[i].length + 1;
  }

  return -1;
}

function splitChunkByPreferredBoundaries(chunk: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = chunk;

  while (remaining.length > maxChars) {
    let splitIndex = findMinorSectionSplitIndex(remaining, maxChars + 1);

    if (splitIndex === -1) {
      splitIndex = findLineStartSplitIndex(remaining, maxChars + 1);
    }

    if (splitIndex <= 0 || splitIndex > maxChars || splitIndex >= remaining.length) {
      splitIndex = findWhitespaceSplitIndex(remaining, maxChars);
    }

    if (splitIndex <= 0 || splitIndex > maxChars || splitIndex >= remaining.length) {
      splitIndex = maxChars;
    }

    const head = remaining.slice(0, splitIndex);
    const tail = remaining.slice(splitIndex);

    chunks.push(head);
    remaining = tail;
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks.filter((part) => part.trim().length > 0);
}

function findMinorSectionSplitIndex(text: string, maxChars: number): number {
  const lines = text.split('\n');
  let index = 0;
  let bestIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (i > 0 && index <= maxChars && MINOR_SECTION_PATTERN.test(line)) {
      bestIndex = index;
    }

    index += lines[i].length + 1;
  }

  return bestIndex;
}

function findLineStartSplitIndex(text: string, maxChars: number): number {
  const lines = text.split('\n');
  let index = 0;
  let bestIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && index <= maxChars) {
      bestIndex = index;
    }

    index += lines[i].length + 1;
  }

  return bestIndex;
}

function findWhitespaceSplitIndex(text: string, maxChars: number): number {
  for (let i = maxChars; i > 0; i--) {
    if (/\s/.test(text[i])) {
      return i;
    }
  }

  return -1;
}
