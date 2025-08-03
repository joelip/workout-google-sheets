import type { WorkoutSession } from './notion';

export class WorkoutParser {
  private static readonly SECTION_HEADER_PATTERN = /^[A-Z]\d*\./;
  private static readonly UPPER_LOWER_PATTERN = /^(upper body|lower body):$/i;
  private static readonly YOUTUBE_URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;

  static parseWorkoutData(cellData: any[][]): WorkoutSession[] {
    const sessions: WorkoutSession[] = [];

    cellData.forEach((row, sessionIndex) => {
      row.forEach((cell, cellIndex) => {
        if (cell && typeof cell === 'string') {
          const sessionNumber = sessionIndex * row.length + cellIndex + 1;
          const session = this.parseCellData(cell, sessionNumber);
          if (session.sections.length > 0) {
            sessions.push(session);
          }
        }
      });
    });

    return sessions;
  }

  static parseSingleCell(cellContent: string): WorkoutSession {
    return this.parseCellData(cellContent, 1);
  }

  private static parseCellData(cellContent: string, sessionNumber: number): WorkoutSession {
    const lines = cellContent.split('\n').map(line => line.trim()).filter(line => line);
    const sections: any[] = [];
    let currentSection: any = null;

    for (const line of lines) {
      if (this.isSectionHeader(line)) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          type: 'section',
          header: line.trim(),
          content: [],
          youtubeLinks: []
        };
      } else if (this.isUpperLowerBody(line)) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          type: 'upper_lower',
          header: line.trim(),
          content: [],
          youtubeLinks: []
        };
      } else if (currentSection) {
        const youtubeLinks = this.extractYouTubeLinks(line);
        if (youtubeLinks.length > 0) {
          currentSection.youtubeLinks.push(...youtubeLinks);
        }

        const cleanedLine = this.removeYouTubeLinks(line).trim();
        if (cleanedLine) {
          currentSection.content.push(cleanedLine);
        }
      } else {
        const youtubeLinks = this.extractYouTubeLinks(line);
        const cleanedLine = this.removeYouTubeLinks(line).trim();

        if (cleanedLine || youtubeLinks.length > 0) {
          sections.push({
            type: 'text',
            content: cleanedLine ? [cleanedLine] : [],
            youtubeLinks: youtubeLinks
          });
        }
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return {
      sessionNumber,
      sections
    };
  }

  private static isSectionHeader(line: string): boolean {
    return this.SECTION_HEADER_PATTERN.test(line.trim());
  }

  private static isUpperLowerBody(line: string): boolean {
    return this.UPPER_LOWER_PATTERN.test(line.trim());
  }

  private static extractYouTubeLinks(text: string): string[] {
    const matches = text.match(this.YOUTUBE_URL_PATTERN);
    if (!matches) return [];

    return matches.map(match => {
      const fullUrl = match.startsWith('http') ? match : `https://${match}`;
      return this.normalizeYouTubeUrl(fullUrl);
    });
  }

  private static normalizeYouTubeUrl(url: string): string {
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (videoIdMatch && videoIdMatch[1]) {
      return `https://www.youtube.com/watch?v=${videoIdMatch[1]}`;
    }
    return url;
  }

  private static removeYouTubeLinks(text: string): string {
    return text.replace(this.YOUTUBE_URL_PATTERN, '').trim();
  }

  static generatePageTitle(ownerEmail: string, sheetTitle: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `${sheetTitle} - ${date}`;
  }
}
