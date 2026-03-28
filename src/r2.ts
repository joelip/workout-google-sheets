import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export interface UploadNotionFileImageParams {
  pageId: string;
  blockId: string;
  sourceUrl: string;
}

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface StorageClient {
  send(command: PutObjectCommand): Promise<unknown>;
}

export interface R2ImageUploaderDependencies {
  fetchImpl?: FetchImpl;
  storageClient?: StorageClient;
}

export function buildNotionImageObjectKey(pageId: string, blockId: string): string {
  return `notion-images/${sanitizePathSegment(pageId)}/${sanitizePathSegment(blockId)}`;
}

export function buildPublicObjectUrl(publicBaseUrl: string, objectKey: string): string {
  const normalizedBaseUrl = publicBaseUrl.replace(/\/+$/, '');
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${normalizedBaseUrl}/${encodedKey}`;
}

export class R2ImageUploader {
  private readonly fetchImpl: FetchImpl;
  private readonly storageClient: StorageClient;

  constructor(
    private readonly config: R2Config,
    dependencies: R2ImageUploaderDependencies = {}
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.storageClient =
      dependencies.storageClient
      ?? new S3Client({
        region: 'auto',
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  async uploadNotionFileImage({
    pageId,
    blockId,
    sourceUrl,
  }: UploadNotionFileImageParams): Promise<string> {
    const objectKey = buildNotionImageObjectKey(pageId, blockId);
    const response = await this.fetchImpl(sourceUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to download Notion image for block ${blockId}: `
        + `${response.status} ${response.statusText}`
      );
    }

    const body = new Uint8Array(await response.arrayBuffer());

    if (body.byteLength === 0) {
      throw new Error(`Downloaded empty Notion image body for block ${blockId}`);
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

    try {
      await this.storageClient.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
          Body: body,
          ContentDisposition: 'inline',
          ContentType: contentType,
        })
      );
    } catch (error) {
      throw new Error(
        `Failed to upload image block ${blockId} to R2: ${formatErrorMessage(error)}`
      );
    }

    return buildPublicObjectUrl(this.config.publicBaseUrl, objectKey);
  }
}

function sanitizePathSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
