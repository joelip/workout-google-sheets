export interface WorkoutContent {
  overallNotes: string;
  lowerBody: string;
  upperBody: string;
}

export interface CommentChunk {
  label: string;
  content: string;
  charCount: number;
  overSafeLimit: boolean;
  sectionName: string;
  sectionPart: number;
  sectionPartCount: number;
  chunkNumber: number;
  chunkCount: number;
}

interface SectionChunk {
  sectionName: string;
  content: string;
  sectionPart: number;
  sectionPartCount: number;
}

interface SectionBlock {
  text: string;
  isMovement: boolean;
}

const MOVEMENT_HEADER_PATTERN = /^\s*(?:#{1,6}\s*)?[A-Z]\d*\.\s*/;
const HEADING_PATTERN = /^\s*#{1,6}\s+/;

export const GOOGLE_SHEETS_COMMENT_SAFE_CHARS = 500;

function isMovementHeader(line: string): boolean {
  return MOVEMENT_HEADER_PATTERN.test(line.trim());
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length - 1;

  while (start <= end && lines[start]?.trim() === '') {
    start += 1;
  }

  while (end >= start && lines[end]?.trim() === '') {
    end -= 1;
  }

  return lines.slice(start, end + 1);
}

function splitNonMovementBlockBySentence(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length <= maxChars) {
    return trimmed ? [trimmed] : [];
  }

  const sentenceMatches = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentenceMatches || sentenceMatches.length <= 1) {
    return [trimmed];
  }

  const sentences = sentenceMatches.map(sentence => sentence.trim()).filter(Boolean);
  if (sentences.length <= 1) {
    return [trimmed];
  }

  const parts: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      parts.push(current);
    }

    if (sentence.length <= maxChars) {
      current = sentence;
    } else {
      parts.push(sentence);
      current = '';
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts.length > 0 ? parts : [trimmed];
}

function buildSectionHeaderAndBlocks(sectionContent: string, sectionName: string): { header: string; blocks: SectionBlock[] } {
  const trimmedSection = sectionContent.trim();
  if (!trimmedSection) {
    return { header: `### ${sectionName}:`, blocks: [] };
  }

  const lines = trimmedSection.split('\n');
  const firstLine = lines[0]?.trim() ?? '';
  const hasHeading = HEADING_PATTERN.test(firstLine);
  const header = hasHeading ? firstLine : `### ${sectionName}:`;
  const bodyLines = hasHeading ? lines.slice(1) : lines;
  const blocks: SectionBlock[] = [];

  let currentLines: string[] = [];
  let currentIsMovement = false;

  const pushCurrentBlock = () => {
    const normalizedLines = trimBlankLines(currentLines);
    const blockText = normalizedLines.join('\n').trim();
    if (blockText) {
      blocks.push({ text: blockText, isMovement: currentIsMovement });
    }
    currentLines = [];
  };

  for (const line of bodyLines) {
    if (isMovementHeader(line)) {
      pushCurrentBlock();
      currentLines = [line];
      currentIsMovement = true;
      continue;
    }

    if (currentLines.length === 0) {
      currentIsMovement = false;
    }
    currentLines.push(line);
  }

  pushCurrentBlock();

  return { header, blocks };
}

function renderSectionChunk(header: string, blockTexts: string[]): string {
  const body = blockTexts.map(text => text.trim()).filter(Boolean).join('\n\n').trim();
  if (!header) {
    return body;
  }
  if (!body) {
    return header.trim();
  }
  return `${header.trim()}\n${body}`;
}

function chunkSection(sectionName: string, sectionContent: string, maxChars: number): SectionChunk[] {
  const trimmedSection = sectionContent.trim();
  if (!trimmedSection) {
    return [];
  }

  if (trimmedSection.length <= maxChars) {
    return [{
      sectionName,
      content: trimmedSection,
      sectionPart: 1,
      sectionPartCount: 1,
    }];
  }

  const { header, blocks } = buildSectionHeaderAndBlocks(trimmedSection, sectionName);
  if (blocks.length === 0) {
    return [{
      sectionName,
      content: trimmedSection,
      sectionPart: 1,
      sectionPartCount: 1,
    }];
  }

  const preparedBlocks: SectionBlock[] = [];

  for (const block of blocks) {
    if (block.isMovement) {
      preparedBlocks.push(block);
      continue;
    }

    const splitBlocks = splitNonMovementBlockBySentence(block.text, maxChars);
    for (const splitBlock of splitBlocks) {
      preparedBlocks.push({ text: splitBlock, isMovement: false });
    }
  }

  const chunkContents: string[] = [];
  let currentChunkBlocks: string[] = [];

  for (const block of preparedBlocks) {
    const withCandidate = renderSectionChunk(header, [...currentChunkBlocks, block.text]);
    if (withCandidate.length <= maxChars || currentChunkBlocks.length === 0) {
      currentChunkBlocks.push(block.text);

      const singleBlockChunk = renderSectionChunk(header, currentChunkBlocks);
      if (singleBlockChunk.length > maxChars) {
        chunkContents.push(singleBlockChunk);
        currentChunkBlocks = [];
      }
      continue;
    }

    chunkContents.push(renderSectionChunk(header, currentChunkBlocks));
    currentChunkBlocks = [block.text];

    const singleBlockChunk = renderSectionChunk(header, currentChunkBlocks);
    if (singleBlockChunk.length > maxChars) {
      chunkContents.push(singleBlockChunk);
      currentChunkBlocks = [];
    }
  }

  if (currentChunkBlocks.length > 0) {
    chunkContents.push(renderSectionChunk(header, currentChunkBlocks));
  }

  if (chunkContents.length === 0) {
    chunkContents.push(trimmedSection);
  }

  return chunkContents.map((content, index) => ({
    sectionName,
    content,
    sectionPart: index + 1,
    sectionPartCount: chunkContents.length,
  }));
}

export function buildGoogleSheetsCommentChunks(
  workoutContent: WorkoutContent,
  maxChars: number = GOOGLE_SHEETS_COMMENT_SAFE_CHARS,
): CommentChunk[] {
  const sectionChunks: SectionChunk[] = [
    ...chunkSection('Overall Notes', workoutContent.overallNotes, maxChars),
    ...chunkSection('Lower Body', workoutContent.lowerBody, maxChars),
    ...chunkSection('Upper Body', workoutContent.upperBody, maxChars),
  ];

  const chunkCount = sectionChunks.length;

  return sectionChunks.map((chunk, index) => ({
    label: chunk.sectionPartCount > 1
      ? `${chunk.sectionName} (Part ${chunk.sectionPart}/${chunk.sectionPartCount})`
      : chunk.sectionName,
    content: chunk.content,
    charCount: chunk.content.length,
    overSafeLimit: chunk.content.length > maxChars,
    sectionName: chunk.sectionName,
    sectionPart: chunk.sectionPart,
    sectionPartCount: chunk.sectionPartCount,
    chunkNumber: index + 1,
    chunkCount,
  }));
}
