import { MINOR_SECTION_PATTERN } from './parser';

export interface WorkoutTextSections {
  overallNotes?: string;
  lowerBody?: string;
  upperBody?: string;
}

export const SHEETS_CHUNK_CHAR_LIMIT = 2048;
const UPPER_BODY_HEADER_PATTERN = /^###\s*upper body:\s*$/i;

export function renderWorkoutTextOutput(sections: WorkoutTextSections): string {
  return [sections.overallNotes, sections.lowerBody, sections.upperBody]
    .filter((section): section is string => Boolean(section && section.trim().length > 0))
    .join('\n\n')
    .trim();
}

export function splitWorkoutTextForSheets(
  text: string,
  maxChars: number = SHEETS_CHUNK_CHAR_LIMIT
): string[] {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return [];
  }

  const upperBodyStart = findUpperBodyStartIndex(normalizedText);
  const baseChunks =
    upperBodyStart > 0
      ? [
          normalizedText.slice(0, upperBodyStart).trimEnd(),
          normalizedText.slice(upperBodyStart).trimStart(),
        ].filter((chunk) => chunk.length > 0)
      : [normalizedText];

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
  let remaining = chunk.trim();

  while (remaining.length > maxChars) {
    let splitIndex = findMinorSectionSplitIndex(remaining, maxChars);

    if (splitIndex === -1) {
      splitIndex = findLineStartSplitIndex(remaining, maxChars);
    }

    if (splitIndex <= 0 || splitIndex >= remaining.length) {
      break;
    }

    const head = remaining.slice(0, splitIndex).trimEnd();
    const tail = remaining.slice(splitIndex).trimStart();

    if (!head || !tail) {
      break;
    }

    chunks.push(head);
    remaining = tail;
  }

  chunks.push(remaining);
  return chunks;
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
