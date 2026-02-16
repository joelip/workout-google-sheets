import { Client } from '@notionhq/client';
import type { BlockObjectRequest, CreatePageParameters } from '@notionhq/client';
import fs from 'fs/promises';

interface Config {
  notion: {
    token: string;
    parentPageId: string;
  };
}

export interface WorkoutSession {
  sessionNumber: number;
  sections: WorkoutSectionData[];
}

export interface WorkoutSectionData {
  type: 'section' | 'upper_lower' | 'text';
  header?: string;
  content: string[];
  youtubeLinks: string[];
}

const NOTION_MAX_CHILDREN_PER_REQUEST = 100;

export class NotionClient {
  private notion: Client;
  private parentPageId: string;

  constructor(config: Config) {
    this.notion = new Client({
      auth: config.notion.token,
    });
    this.parentPageId = config.notion.parentPageId;
  }

  static async fromConfigFile(configPath: string = 'config.json'): Promise<NotionClient> {
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configContent);
    return new NotionClient(config);
  }

  async createWorkoutPage(title: string, sessions: WorkoutSession[], icon?: string): Promise<string> {
    const allBlocks = this.buildPageContent(sessions);
    return this.createPageWithChildren(title, allBlocks, icon);
  }

  async createDayWorkoutPage(title: string, session: WorkoutSession): Promise<string> {
    const blocks = this.buildSingleSessionContent(session);
    return this.createPageWithChildren(title, blocks);
  }

  async appendBlocksToPage(pageId: string, blocks: BlockObjectRequest[]): Promise<void> {
    await this.appendBlocksInChunks(pageId, blocks);
  }

  private async createPageWithChildren(
    title: string,
    blocks: BlockObjectRequest[],
    icon?: string
  ): Promise<string> {
    const initialBlocks = blocks.slice(0, NOTION_MAX_CHILDREN_PER_REQUEST);
    const remainingBlocks = blocks.slice(NOTION_MAX_CHILDREN_PER_REQUEST);

    const page = await this.notion.pages.create(this.buildCreatePagePayload(title, initialBlocks, icon));

    if (remainingBlocks.length > 0) {
      await this.appendBlocksInChunks(page.id, remainingBlocks);
    }

    return page.id;
  }

  private buildCreatePagePayload(
    title: string,
    children: BlockObjectRequest[],
    icon?: string
  ): CreatePageParameters {
    const pageData: CreatePageParameters = {
      parent: {
        type: 'page_id',
        page_id: this.parentPageId,
      },
      properties: {
        title: {
          title: [this.textRichText(title)],
        },
      },
      children,
    };

    if (icon) {
      pageData.icon = {
        type: 'emoji',
        emoji: icon,
      } as NonNullable<CreatePageParameters['icon']>;
    }

    return pageData;
  }

  private buildPageContent(sessions: WorkoutSession[]): BlockObjectRequest[] {
    const blocks: BlockObjectRequest[] = [];

    for (const session of sessions) {
      blocks.push(this.heading2Block(`Session ${session.sessionNumber}`));
      blocks.push(...this.buildSectionsContent(session.sections));
    }

    return blocks;
  }

  private buildSingleSessionContent(session: WorkoutSession): BlockObjectRequest[] {
    return this.buildSectionsContent(session.sections);
  }

  private buildSectionsContent(sections: WorkoutSectionData[]): BlockObjectRequest[] {
    const blocks: BlockObjectRequest[] = [];

    for (const section of sections) {
      if (section.type === 'section' && section.header) {
        blocks.push(this.paragraphBlock(section.header));
        blocks.push(...section.content.map((item) => this.bulletedListItemBlock(item)));
      } else if (section.type === 'upper_lower' && section.header) {
        blocks.push(this.heading3Block(section.header));
        blocks.push(...section.content.map((item) => this.bulletedListItemBlock(item)));
      } else if (section.type === 'text') {
        blocks.push(...section.content.map((item) => this.paragraphBlock(item)));
      }

      blocks.push(...section.youtubeLinks.map((youtubeUrl) => this.embedBlock(youtubeUrl)));
    }

    return blocks;
  }

  private textRichText(content: string): { type: 'text'; text: { content: string } } {
    return {
      type: 'text',
      text: {
        content,
      },
    };
  }

  private paragraphBlock(content: string): BlockObjectRequest {
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [this.textRichText(content)],
      },
    };
  }

  private bulletedListItemBlock(content: string): BlockObjectRequest {
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [this.textRichText(content)],
      },
    };
  }

  private heading2Block(content: string): BlockObjectRequest {
    return {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [this.textRichText(content)],
      },
    };
  }

  private heading3Block(content: string): BlockObjectRequest {
    return {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [this.textRichText(content)],
      },
    };
  }

  private embedBlock(url: string): BlockObjectRequest {
    return {
      object: 'block',
      type: 'embed',
      embed: {
        url,
      },
    };
  }

  private async appendBlocksInChunks(pageId: string, blocks: BlockObjectRequest[]): Promise<void> {
    for (let i = 0; i < blocks.length; i += NOTION_MAX_CHILDREN_PER_REQUEST) {
      const chunk = blocks.slice(i, i + NOTION_MAX_CHILDREN_PER_REQUEST);
      await this.notion.blocks.children.append({
        block_id: pageId,
        children: chunk,
      });
    }
  }
}
