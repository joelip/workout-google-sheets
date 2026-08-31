import { createHash } from 'node:crypto';
import type { RichTextItemResponse } from '@notionhq/client';
import type { BlockWithDepth } from './post-workout-rendering';
import type { CachedWorkoutPage } from './workout-history';

export type PaceModality = 'bike-erg' | 'row' | 'ski-erg';

export interface ReferenceSource {
  pageId: string;
  pageTitle: string;
  workoutDate: string;
  blockId: string;
  text: string;
  valueSeconds: number;
  formattedValue: string;
  unit: '/1000m' | '/500m';
}

export interface ReferenceResolutionEdit {
  blockId: string;
  rule: 'seven-minute-pace' | 'faster-than-seven-minute-pace';
  modality: PaceModality;
  before: string;
  after: string;
  source: ReferenceSource;
  confidence: 'high';
}

export interface UnresolvedReference {
  blockId: string;
  text: string;
  modality: PaceModality;
  reason: 'no-prior-seven-minute-pace';
}

export interface ReferenceResolutionPlan {
  target: {
    pageId: string;
    pageTitle: string;
    workoutDate: string;
    lastEditedTime: string;
    contentHash: string;
  };
  edits: ReferenceResolutionEdit[];
  unresolved: UnresolvedReference[];
  planHash: string;
}

interface PaceFact extends ReferenceSource {
  modality: PaceModality;
  blockIndex: number;
}

interface ParsedTargetReference {
  rule: ReferenceResolutionEdit['rule'];
  modality: PaceModality;
  fasterMinimumSeconds?: number;
  fasterMaximumSeconds?: number;
}

const MODALITY_UNITS: Record<PaceModality, ReferenceSource['unit']> = {
  'bike-erg': '/1000m',
  row: '/500m',
  'ski-erg': '/500m',
};

export function buildReferenceResolutionPlan(params: {
  targetPage: CachedWorkoutPage;
  previousPages: CachedWorkoutPage[];
}): ReferenceResolutionPlan {
  const facts = params.previousPages
    .flatMap(extractSevenMinutePaceFacts)
    .sort((left, right) => {
      const dateOrder = right.workoutDate.localeCompare(left.workoutDate);
      return dateOrder !== 0 ? dateOrder : right.blockIndex - left.blockIndex;
    });
  const edits: ReferenceResolutionEdit[] = [];
  const unresolved: UnresolvedReference[] = [];

  for (const block of params.targetPage.rawBlocks) {
    const text = getParagraphText(block);
    if (text === null) {
      continue;
    }

    const reference = parseTargetReference(text);
    if (!reference) {
      continue;
    }

    const source = facts.find((fact) => fact.modality === reference.modality);
    if (!source) {
      unresolved.push({
        blockId: block.id,
        text,
        modality: reference.modality,
        reason: 'no-prior-seven-minute-pace',
      });
      continue;
    }

    edits.push({
      blockId: block.id,
      rule: reference.rule,
      modality: reference.modality,
      before: text,
      after: formatReplacement(text, reference, source),
      source: {
        pageId: source.pageId,
        pageTitle: source.pageTitle,
        workoutDate: source.workoutDate,
        blockId: source.blockId,
        text: source.text,
        valueSeconds: source.valueSeconds,
        formattedValue: source.formattedValue,
        unit: source.unit,
      },
      confidence: 'high',
    });
  }

  const target = {
    pageId: params.targetPage.id,
    pageTitle: params.targetPage.title,
    workoutDate: params.targetPage.workoutDate,
    lastEditedTime: params.targetPage.lastEditedTime,
    contentHash: params.targetPage.contentHash,
  };
  const planHash = createHash('sha256')
    .update(JSON.stringify({ target, edits, unresolved }))
    .digest('hex');

  return { target, edits, unresolved, planHash };
}

export function preflightReferenceApplication(params: {
  plan: ReferenceResolutionPlan;
  livePageLastEditedTime: string;
  liveBlocks: BlockWithDepth[];
}): void {
  if (params.livePageLastEditedTime !== params.plan.target.lastEditedTime) {
    throw new Error('Target Notion page changed after history sync; run history sync and preview again');
  }

  const blocksById = new Map(params.liveBlocks.map((block) => [block.id, block]));
  for (const edit of params.plan.edits) {
    const block = blocksById.get(edit.blockId);
    if (!block) {
      throw new Error(`Target Notion block ${edit.blockId} no longer exists`);
    }
    const currentText = getParagraphText(block);
    if (currentText !== edit.before) {
      throw new Error(`Target Notion block ${edit.blockId} changed after preview`);
    }
    if (!isPlainParagraph(block)) {
      throw new Error(`Target Notion block ${edit.blockId} has formatting that cannot be safely preserved`);
    }
  }
}

export function verifyReferenceApplication(
  plan: ReferenceResolutionPlan,
  liveBlocks: BlockWithDepth[]
): void {
  const blocksById = new Map(liveBlocks.map((block) => [block.id, block]));
  for (const edit of plan.edits) {
    const block = blocksById.get(edit.blockId);
    if (!block || getParagraphText(block) !== edit.after) {
      throw new Error(`Could not verify updated Notion block ${edit.blockId}; manual review required`);
    }
  }
}

export function getParagraphText(block: BlockWithDepth): string | null {
  if (block.type !== 'paragraph') {
    return null;
  }
  return richTextPlainText(block.paragraph.rich_text);
}

function extractSevenMinutePaceFacts(page: CachedWorkoutPage): PaceFact[] {
  const facts: PaceFact[] = [];
  let currentModality: PaceModality | null = null;

  page.rawBlocks.forEach((block, blockIndex) => {
    const text = blockRichText(block);
    if (!text) {
      return;
    }

    currentModality = modalityFromText(text) ?? currentModality;
    if (!currentModality) {
      return;
    }

    const paceMatch = text.match(/\b7\s*(?:min(?:ute)?|minute)\s*pace\s*:?\s*(\d{1,2}):(\d{2})\b/i);
    if (!paceMatch) {
      return;
    }

    const minutes = Number(paceMatch[1]);
    const seconds = Number(paceMatch[2]);
    if (seconds >= 60) {
      return;
    }

    const valueSeconds = minutes * 60 + seconds;
    facts.push({
      modality: currentModality,
      pageId: page.id,
      pageTitle: page.title,
      workoutDate: page.workoutDate,
      blockId: block.id,
      blockIndex,
      text,
      valueSeconds,
      formattedValue: formatPace(valueSeconds),
      unit: MODALITY_UNITS[currentModality],
    });
  });

  return facts;
}

function parseTargetReference(text: string): ParsedTargetReference | null {
  const fasterMatch = text.match(
    /^\d+\s+Minute\s+(Bike Erg|Row|Ski Erg)\s+@\s+(\d+)[-–](\d+)s faster than 7 minute pace$/i
  );
  if (fasterMatch) {
    return {
      rule: 'faster-than-seven-minute-pace',
      modality: modalityFromLabel(fasterMatch[1]!),
      fasterMinimumSeconds: Number(fasterMatch[2]),
      fasterMaximumSeconds: Number(fasterMatch[3]),
    };
  }

  const baseMatch = text.match(
    /^\d+\s+Minute\s+(Bike Erg|Row|Ski Erg)\s+@\s+7 minute pace$/i
  );
  if (baseMatch) {
    return {
      rule: 'seven-minute-pace',
      modality: modalityFromLabel(baseMatch[1]!),
    };
  }

  return null;
}

function formatReplacement(
  original: string,
  reference: ParsedTargetReference,
  source: PaceFact
): string {
  const prefix = original.slice(0, original.indexOf('@')).trimEnd();
  const unit = MODALITY_UNITS[reference.modality];
  if (reference.rule === 'seven-minute-pace') {
    return `${prefix} @ ${source.formattedValue}${unit} (7 minute pace)`;
  }

  const minimum = reference.fasterMinimumSeconds!;
  const maximum = reference.fasterMaximumSeconds!;
  const fasterPace = formatPace(source.valueSeconds - maximum);
  const slowerPace = formatPace(source.valueSeconds - minimum);
  return `${prefix} @ ${fasterPace}–${slowerPace}${unit} (${minimum}–${maximum}s faster than 7 minute pace)`;
}

function modalityFromText(text: string): PaceModality | null {
  if (/\bBike Erg\b/i.test(text)) {
    return 'bike-erg';
  }
  if (/\bSki Erg\b/i.test(text)) {
    return 'ski-erg';
  }
  if (/\bRow\b/i.test(text)) {
    return 'row';
  }
  return null;
}

function modalityFromLabel(label: string): PaceModality {
  const modality = modalityFromText(label);
  if (!modality) {
    throw new Error(`Unsupported workout modality: ${label}`);
  }
  return modality;
}

function blockRichText(block: BlockWithDepth): string | null {
  switch (block.type) {
    case 'paragraph':
      return richTextPlainText(block.paragraph.rich_text);
    case 'bulleted_list_item':
      return richTextPlainText(block.bulleted_list_item.rich_text);
    case 'numbered_list_item':
      return richTextPlainText(block.numbered_list_item.rich_text);
    default:
      return null;
  }
}

function richTextPlainText(richText: RichTextItemResponse[]): string {
  return richText.map((item) => item.plain_text).join('').trim();
}

function isPlainParagraph(block: BlockWithDepth): boolean {
  if (block.type !== 'paragraph' || block.paragraph.rich_text.length !== 1) {
    return false;
  }
  const item = block.paragraph.rich_text[0];
  return item?.type === 'text'
    && item.text.link === null
    && item.annotations.bold === false
    && item.annotations.italic === false
    && item.annotations.strikethrough === false
    && item.annotations.underline === false
    && item.annotations.code === false
    && item.annotations.color === 'default';
}

function formatPace(totalSeconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
