export interface WorkoutContent {
  overallNotes: string;
  lowerBody: string;
  upperBody: string;
}

export interface CommentChunk {
  content: string;
  charCount: number;
  overSafeLimit: boolean;
  chunkNumber: number;
  chunkCount: number;
}

const MOVEMENT_HEADER_PATTERN = /^\s*(?:#{1,6}\s*)?[A-Z]\d*\.\s*/;
const HEADING_PATTERN = /^\s*#{1,6}\s+/;

export const GOOGLE_SHEETS_COMMENT_SAFE_CHARS = 1500;

function isMovementHeader(line: string): boolean {
  return MOVEMENT_HEADER_PATTERN.test(line.trim());
}

function isSectionHeading(line: string): boolean {
  return HEADING_PATTERN.test(line.trim());
}

/**
 * Split combined workout text into logical blocks.
 * A new block starts at each movement header (A., B1., C., etc.)
 * or section heading (### Lower Body:, etc.).
 */
function splitIntoBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let currentLines: string[] = [];

  const pushCurrent = () => {
    const block = currentLines.join('\n').trim();
    if (block) {
      blocks.push(block);
    }
    currentLines = [];
  };

  for (const line of lines) {
    if (isMovementHeader(line) || isSectionHeading(line)) {
      pushCurrent();
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }

  pushCurrent();
  return blocks;
}

export function buildGoogleSheetsCommentChunks(
  workoutContent: WorkoutContent,
  maxChars: number = GOOGLE_SHEETS_COMMENT_SAFE_CHARS,
): CommentChunk[] {
  const combined = [
    workoutContent.overallNotes,
    workoutContent.lowerBody,
    workoutContent.upperBody,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (!combined) {
    return [];
  }

  if (combined.length <= maxChars) {
    return [{
      content: combined,
      charCount: combined.length,
      overSafeLimit: false,
      chunkNumber: 1,
      chunkCount: 1,
    }];
  }

  const blocks = splitIntoBlocks(combined);
  const chunkContents: string[] = [];
  let currentBlocks: string[] = [];

  const renderCurrent = () => currentBlocks.join('\n\n');

  for (const block of blocks) {
    const candidate = currentBlocks.length > 0
      ? renderCurrent() + '\n\n' + block
      : block;

    if (candidate.length <= maxChars || currentBlocks.length === 0) {
      currentBlocks.push(block);

      // If this single block already exceeds, flush it
      if (renderCurrent().length > maxChars) {
        chunkContents.push(renderCurrent());
        currentBlocks = [];
      }
      continue;
    }

    // Flush current chunk, start new one with this block
    chunkContents.push(renderCurrent());
    currentBlocks = [block];

    if (renderCurrent().length > maxChars) {
      chunkContents.push(renderCurrent());
      currentBlocks = [];
    }
  }

  if (currentBlocks.length > 0) {
    chunkContents.push(renderCurrent());
  }

  if (chunkContents.length === 0) {
    chunkContents.push(combined);
  }

  const chunkCount = chunkContents.length;
  return chunkContents.map((content, index) => ({
    content,
    charCount: content.length,
    overSafeLimit: content.length > maxChars,
    chunkNumber: index + 1,
    chunkCount,
  }));
}
