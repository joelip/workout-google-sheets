import { Client } from '@notionhq/client';
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

  async createWorkoutPage(title: string, sessions: WorkoutSession[]): Promise<string> {
    const allBlocks = await this.buildPageContent(sessions);

    const initialBlocks = allBlocks.slice(0, 100);
    const remainingBlocks = allBlocks.slice(100);

    const page = await this.notion.pages.create({
      parent: {
        type: 'page_id',
        page_id: this.parentPageId,
      },
      properties: {
        title: {
          title: [
            {
              text: {
                content: title,
              },
            },
          ],
        },
      },
      children: initialBlocks,
    });

    if (remainingBlocks.length > 0) {
      await this.appendBlocksInChunks(page.id, remainingBlocks);
    }

    return page.id;
  }

  async createDayWorkoutPage(title: string, session: WorkoutSession): Promise<string> {
    const blocks = await this.buildSingleSessionContent(session);
    
    const initialBlocks = blocks.slice(0, 100);
    const remainingBlocks = blocks.slice(100);

    const page = await this.notion.pages.create({
      parent: {
        type: 'page_id',
        page_id: this.parentPageId,
      },
      properties: {
        title: {
          title: [
            {
              text: {
                content: title,
              },
            },
          ],
        },
      },
      children: initialBlocks,
    });

    if (remainingBlocks.length > 0) {
      await this.appendBlocksInChunks(page.id, remainingBlocks);
    }

    return page.id;
  }

  private async buildPageContent(sessions: WorkoutSession[]): Promise<any[]> {
    const blocks: any[] = [];

    for (const session of sessions) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: `Session ${session.sessionNumber}`,
              },
            },
          ],
        },
      });

      for (const section of session.sections) {
        if (section.type === 'section' && section.header) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: section.header,
                  },
                },
              ],
            },
          });

          for (const item of section.content) {
            blocks.push({
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content: item,
                    },
                  },
                ],
              },
            });
          }
        } else if (section.type === 'upper_lower' && section.header) {
          blocks.push({
            object: 'block',
            type: 'heading_3',
            heading_3: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: section.header,
                  },
                },
              ],
            },
          });

          for (const item of section.content) {
            blocks.push({
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content: item,
                    },
                  },
                ],
              },
            });
          }
        } else if (section.type === 'text') {
          for (const item of section.content) {
            blocks.push({
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content: item,
                    },
                  },
                ],
              },
            });
          }
        }

        for (const youtubeUrl of section.youtubeLinks) {
          blocks.push({
            object: 'block',
            type: 'embed',
            embed: {
              url: youtubeUrl,
            },
          });
        }
      }
    }

    return blocks;
  }

  private async buildSingleSessionContent(session: WorkoutSession): Promise<any[]> {
    const blocks: any[] = [];

    for (const section of session.sections) {
      if (section.type === 'section' && section.header) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: section.header,
                },
              },
            ],
          },
        });
        
        for (const item of section.content) {
          blocks.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: item,
                  },
                },
              ],
            },
          });
        }
      } else if (section.type === 'upper_lower' && section.header) {
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: section.header,
                },
              },
            ],
          },
        });
        
        for (const item of section.content) {
          blocks.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: item,
                  },
                },
              ],
            },
          });
        }
      } else if (section.type === 'text') {
        for (const item of section.content) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: item,
                  },
                },
              ],
            },
          });
        }
      }

      for (const youtubeUrl of section.youtubeLinks) {
        blocks.push({
          object: 'block',
          type: 'embed',
          embed: {
            url: youtubeUrl,
          },
        });
      }
    }

    return blocks;
  }

  private async appendBlocksInChunks(pageId: string, blocks: any[]): Promise<void> {
    const chunkSize = 100;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const chunk = blocks.slice(i, i + chunkSize);
      await this.notion.blocks.children.append({
        block_id: pageId,
        children: chunk,
      });
    }
  }

  async appendBlocksToPage(pageId: string, blocks: any[]): Promise<void> {
    await this.appendBlocksInChunks(pageId, blocks);
  }
}
