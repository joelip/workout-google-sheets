import { describe, expect, test } from 'bun:test';
import {
  getCompletedWorkoutDocument,
  listCompletedWorkoutPageRefs,
} from '../src/completed-workout-document';
import type { BlockWithDepth } from '../src/post-workout-rendering';
import type { NestedWorkoutPage, WorkoutPagesConfig } from '../src/notion-workout-pages';

const config: WorkoutPagesConfig = {
  notion: {
    token: 'test-token',
    parentPageId: 'parent-page',
  },
};

describe('completed workout documents', () => {
  test('renders completed workout content with structured sections', async () => {
    const document = await getCompletedWorkoutDocument('2026-01-27', {
      config,
      notionClient: {
        findNestedPage: async (pageTitle) => pageTitle === '1/27/2026' ? 'page-1' : null,
        extractPageContent: async () => [
          heading3Block('Overall Notes'),
          paragraphBlock('Felt strong.'),
          heading3Block('Lower Body'),
          paragraphBlock('A. Split Squat: 3 x 8'),
          paragraphBlock('- Used 35lb dumbbells'),
          heading3Block('Upper Body'),
          paragraphBlock('A. Pull-up: 5 x 3'),
        ],
      },
    });

    expect(document.workoutDate).toBe('2026-01-27');
    expect(document.notionPageTitle).toBe('1/27/2026');
    expect(document.notionPageId).toBe('page-1');
    expect(document.sections.overallNotes).toBe('### Overall Notes:\nFelt strong.');
    expect(document.completedText).toContain('### Lower Body:\nA. Split Squat: 3 x 8');
    expect(document.completedText).toContain('### Upper Body:\nA. Pull-up: 5 x 3');
  });

  test('lists only dated nested pages as completed workout refs', async () => {
    const refs = await listCompletedWorkoutPageRefs({
      config,
      notionClient: {
        listNestedPages: async () => [
          nestedPage({ id: 'page-1', title: '1/27/2026' }),
          nestedPage({ id: 'page-2', title: 'Notes' }),
          nestedPage({ id: 'page-3', title: '2026-02-01' }),
        ],
      },
    });

    expect(refs.map((ref) => ref.workoutDate)).toEqual(['2026-01-27', '2026-02-01']);
    expect(refs.map((ref) => ref.title)).toEqual(['1/27/2026', '2026-02-01']);
  });
});

function nestedPage(params: { id: string; title: string }): NestedWorkoutPage {
  return {
    ...params,
    createdTime: '2026-01-01T00:00:00.000Z',
    lastEditedTime: '2026-01-02T00:00:00.000Z',
  };
}

function paragraphBlock(text: string): BlockWithDepth {
  return {
    id: `paragraph-${text}`,
    type: 'paragraph',
    depth: 0,
    paragraph: {
      rich_text: [{ plain_text: text }],
    },
  } as unknown as BlockWithDepth;
}

function heading3Block(text: string): BlockWithDepth {
  return {
    id: `heading-${text}`,
    type: 'heading_3',
    depth: 0,
    heading_3: {
      rich_text: [{ plain_text: text }],
    },
  } as unknown as BlockWithDepth;
}
