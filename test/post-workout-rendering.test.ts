import { describe, expect, test } from 'bun:test';
import { renderWorkoutTextOutput, splitWorkoutTextForSheets } from '../src/post-workout-chunking';
import {
  renderBlocksToText,
  splitContentByWorkoutSections,
} from '../src/post-workout-rendering';
import type { BlockWithDepth, ImageUploader } from '../src/post-workout-rendering';

describe('post-workout rendering', () => {
  test('renders a Notion-hosted image without a caption', async () => {
    const uploader: ImageUploader = {
      uploadNotionFileImage: async () => 'https://images.example.com/notion-images/page-1/image-1',
    };

    const text = await renderBlocksToText(
      [
        notionImageBlock({
          blockId: 'image-1',
          image: {
            type: 'file',
            file: { url: 'https://notion.example/image.png' },
            caption: [],
          },
        }),
      ],
      { pageId: 'page-1', imageUploader: uploader }
    );

    expect(text).toBe('Image: https://images.example.com/notion-images/page-1/image-1');
  });

  test('renders a Notion-hosted image with a caption', async () => {
    const uploader: ImageUploader = {
      uploadNotionFileImage: async () => 'https://images.example.com/notion-images/page-1/image-2',
    };

    const text = await renderBlocksToText(
      [
        notionImageBlock({
          blockId: 'image-2',
          image: {
            type: 'file',
            file: { url: 'https://notion.example/image.png' },
            caption: richText('Warm-up angle'),
          },
        }),
      ],
      { pageId: 'page-1', imageUploader: uploader }
    );

    expect(text).toBe(
      'Image (Warm-up angle): https://images.example.com/notion-images/page-1/image-2'
    );
  });

  test('passes through an external image without uploading it', async () => {
    let uploadCalled = false;
    const uploader: ImageUploader = {
      uploadNotionFileImage: async () => {
        uploadCalled = true;
        return 'https://images.example.com/notion-images/page-1/image-3';
      },
    };

    const text = await renderBlocksToText(
      [
        notionImageBlock({
          blockId: 'image-3',
          image: {
            type: 'external',
            external: { url: 'https://cdn.example.com/image.png' },
            caption: richText('Reference'),
          },
          depth: 1,
        }),
      ],
      { pageId: 'page-1', imageUploader: uploader }
    );

    expect(text).toBe('  Image (Reference): https://cdn.example.com/image.png');
    expect(uploadCalled).toBe(false);
  });

  test('preserves indentation for nested images', async () => {
    const uploader: ImageUploader = {
      uploadNotionFileImage: async () => 'https://images.example.com/notion-images/page-1/image-4',
    };

    const text = await renderBlocksToText(
      [
        notionImageBlock({
          blockId: 'image-4',
          image: {
            type: 'file',
            file: { url: 'https://notion.example/image.png' },
            caption: [],
          },
          depth: 2,
        }),
      ],
      { pageId: 'page-1', imageUploader: uploader }
    );

    expect(text).toBe('    Image: https://images.example.com/notion-images/page-1/image-4');
  });

  test('keeps image lines in the right workout section ordering and chunked output', async () => {
    const uploader: ImageUploader = {
      uploadNotionFileImage: async ({ blockId }) =>
        `https://images.example.com/notion-images/page-1/${blockId}`,
    };

    const renderedText = await renderBlocksToText(
      [
        heading3Block('Lower Body'),
        paragraphBlock('Start heavy'),
        notionImageBlock({
          blockId: 'lower-image',
          image: {
            type: 'file',
            file: { url: 'https://notion.example/lower.png' },
            caption: richText('Depth check'),
          },
        }),
        heading3Block('Upper Body'),
        paragraphBlock('Finish with rows'),
      ],
      { pageId: 'page-1', imageUploader: uploader }
    );

    const textOutput = renderWorkoutTextOutput(splitContentByWorkoutSections(renderedText));
    const chunks = splitWorkoutTextForSheets(textOutput, 60);

    expect(textOutput.indexOf('### Lower Body:')).toBeLessThan(
      textOutput.indexOf('Image (Depth check): https://images.example.com/notion-images/page-1/lower-image')
    );
    expect(textOutput.indexOf('Image (Depth check): https://images.example.com/notion-images/page-1/lower-image'))
      .toBeLessThan(textOutput.indexOf('### Upper Body:'));
    expect(chunks.join('\n')).toContain('Image (Depth check):');
    expect(chunks.join('\n')).toContain(
      'https://images.example.com/notion-images/page-1/lower-image'
    );
  });
});

function paragraphBlock(text: string): BlockWithDepth {
  return {
    id: `paragraph-${text}`,
    type: 'paragraph',
    depth: 0,
    paragraph: {
      rich_text: richText(text),
    },
  } as unknown as BlockWithDepth;
}

function heading3Block(text: string): BlockWithDepth {
  return {
    id: `heading-${text}`,
    type: 'heading_3',
    depth: 0,
    heading_3: {
      rich_text: richText(text),
    },
  } as unknown as BlockWithDepth;
}

function notionImageBlock({
  blockId,
  image,
  depth = 0,
}: {
  blockId: string;
  image:
    | { type: 'file'; file: { url: string }; caption: ReturnType<typeof richText> }
    | { type: 'external'; external: { url: string }; caption: ReturnType<typeof richText> };
  depth?: number;
}): BlockWithDepth {
  return {
    id: blockId,
    type: 'image',
    depth,
    image,
  } as unknown as BlockWithDepth;
}

function richText(text: string): Array<{ plain_text: string }> {
  return [{ plain_text: text }];
}
