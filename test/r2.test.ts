import { describe, expect, test } from 'bun:test';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  buildNotionImageObjectKey,
  buildPublicObjectUrl,
  R2ImageUploader,
  type R2Config,
} from '../src/r2';

describe('R2ImageUploader', () => {
  test('uploads a Notion image and returns the public URL', async () => {
    const storageClient = new RecordingStorageClient();
    const uploader = new R2ImageUploader(baseConfig(), {
      fetchImpl: async () =>
        new Response('image-bytes', {
          status: 200,
          headers: {
            'content-type': 'image/png',
          },
        }),
      storageClient,
    });

    const publicUrl = await uploader.uploadNotionFileImage({
      pageId: 'page-1',
      blockId: 'image-1',
      sourceUrl: 'https://notion.example/image.png',
    });

    expect(publicUrl).toBe('https://images.example.com/notion-images/page-1/image-1');
    expect(storageClient.commands).toHaveLength(1);
    const firstCommand = storageClient.commands[0];
    expect(firstCommand).toBeInstanceOf(PutObjectCommand);
    expect(firstCommand?.input).toMatchObject({
      Bucket: 'workout-images',
      Key: 'notion-images/page-1/image-1',
      ContentDisposition: 'inline',
      ContentType: 'image/png',
    });
  });

  test('re-runs upload to the same deterministic key', async () => {
    const storageClient = new RecordingStorageClient();
    const uploader = new R2ImageUploader(baseConfig(), {
      fetchImpl: async () =>
        new Response('image-bytes', {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
          },
        }),
      storageClient,
    });

    await uploader.uploadNotionFileImage({
      pageId: 'page-1',
      blockId: 'image-1',
      sourceUrl: 'https://notion.example/image-a.jpg',
    });
    await uploader.uploadNotionFileImage({
      pageId: 'page-1',
      blockId: 'image-1',
      sourceUrl: 'https://notion.example/image-b.jpg',
    });

    expect(storageClient.commands).toHaveLength(2);
    expect(storageClient.commands[0]?.input.Key).toBe('notion-images/page-1/image-1');
    expect(storageClient.commands[1]?.input.Key).toBe('notion-images/page-1/image-1');
  });

  test('wraps upload failures with block context', async () => {
    const uploader = new R2ImageUploader(baseConfig(), {
      fetchImpl: async () =>
        new Response('image-bytes', {
          status: 200,
          headers: {
            'content-type': 'image/png',
          },
        }),
      storageClient: {
        send: async () => {
          throw new Error('R2 unavailable');
        },
      },
    });

    expect(
      uploader.uploadNotionFileImage({
        pageId: 'page-1',
        blockId: 'image-9',
        sourceUrl: 'https://notion.example/image.png',
      })
    ).rejects.toThrow('Failed to upload image block image-9 to R2: R2 unavailable');
  });
});

describe('R2 helpers', () => {
  test('builds stable object keys and public URLs', () => {
    const objectKey = buildNotionImageObjectKey('page 1', 'image/1');
    const publicUrl = buildPublicObjectUrl('https://images.example.com/', objectKey);

    expect(objectKey).toBe('notion-images/page-1/image-1');
    expect(publicUrl).toBe('https://images.example.com/notion-images/page-1/image-1');
  });
});

class RecordingStorageClient {
  commands: PutObjectCommand[] = [];

  async send(command: PutObjectCommand): Promise<unknown> {
    this.commands.push(command);
    return {};
  }
}

function baseConfig(): R2Config {
  return {
    accountId: 'account-id',
    accessKeyId: 'access-key-id',
    secretAccessKey: 'secret-access-key',
    bucket: 'workout-images',
    publicBaseUrl: 'https://images.example.com',
  };
}
