import type { WorkoutSession, WorkoutSectionData } from './notion';
import { RMResolver, loadRMConfig } from './rm-resolver';
import type { SheetValues } from './sheets';
import { isPlusOnlyMarkerLine } from './text-cleaning';

const MINOR_SECTION_PATTERN = /^(?:plyo|plyo progression|deep tier plyo|run\/walk progression|conditioning|mixed conditioning):?$/i;

export class WorkoutParser {
  private static readonly SECTION_HEADER_PATTERN = /^[A-Z]\d*\./;
  private static readonly UPPER_LOWER_PATTERN = /^(upper body|lower body):?$/i;
  private static readonly YOUTUBE_URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
  private static readonly ASTERISK_PREFIX_PATTERN = /^\*{2,}/;

  static parseWorkoutData(cellData: SheetValues): WorkoutSession[] {
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
    const lines = cellContent.split('\n').map((line) => line.trim()).filter((line) => line);
    const sections: WorkoutSectionData[] = [];
    let currentSection: WorkoutSectionData | null = null;

    for (const line of lines) {
      if (this.isSectionHeader(line)) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          type: 'section',
          header: line.trim(),
          content: [],
          youtubeLinks: [],
        };
      } else if (this.isUpperLowerBody(line)) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          type: 'upper_lower',
          header: line.trim(),
          content: [],
          youtubeLinks: [],
        };
      } else if (this.isStandaloneParagraph(line)) {
        // Push current section first before adding standalone paragraph
        if (currentSection) {
          sections.push(currentSection);
          currentSection = null;
        }
        // Treat as standalone paragraph text, not nested in current section
        const youtubeLinks = this.extractYouTubeLinks(line);
        const cleanedLine = this.removeYouTubeLinks(line).trim();

        if ((cleanedLine && !isPlusOnlyMarkerLine(cleanedLine)) || youtubeLinks.length > 0) {
          sections.push({
            type: 'text',
            content: cleanedLine && !isPlusOnlyMarkerLine(cleanedLine) ? [cleanedLine] : [],
            youtubeLinks,
          });
        }
      } else if (currentSection) {
        const youtubeLinks = this.extractYouTubeLinks(line);
        if (youtubeLinks.length > 0) {
          currentSection.youtubeLinks.push(...youtubeLinks);
        }

        const cleanedLine = this.removeYouTubeLinks(line).trim();
        if (cleanedLine && !isPlusOnlyMarkerLine(cleanedLine)) {
          currentSection.content.push(cleanedLine);
        }
      } else {
        const youtubeLinks = this.extractYouTubeLinks(line);
        const cleanedLine = this.removeYouTubeLinks(line).trim();

        if ((cleanedLine && !isPlusOnlyMarkerLine(cleanedLine)) || youtubeLinks.length > 0) {
          sections.push({
            type: 'text',
            content: cleanedLine && !isPlusOnlyMarkerLine(cleanedLine) ? [cleanedLine] : [],
            youtubeLinks,
          });
        }
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return {
      sessionNumber,
      sections,
    };
  }

  private static isSectionHeader(line: string): boolean {
    return this.SECTION_HEADER_PATTERN.test(line.trim());
  }

  private static isUpperLowerBody(line: string): boolean {
    return this.UPPER_LOWER_PATTERN.test(line.trim());
  }

  private static isMinorSection(line: string): boolean {
    return MINOR_SECTION_PATTERN.test(line);
  }

  private static isAsteriskLine(line: string): boolean {
    return this.ASTERISK_PREFIX_PATTERN.test(line.trim());
  }

  private static isStandaloneParagraph(line: string): boolean {
    return this.isMinorSection(line) || this.isAsteriskLine(line);
  }

  private static extractYouTubeLinks(text: string): string[] {
    const matches = text.match(this.YOUTUBE_URL_PATTERN);
    if (!matches) return [];

    return matches.map((match) => {
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

  /**
   * Resolve RM (rep max) references in a parsed workout session.
   * Replaces percentage-based references with actual weights based on config.
   *
   * @param session - The parsed workout session
   * @param configPath - Path to config file (default: 'config.json')
   * @returns Session with RM references resolved to weights
   */
  static async resolveRepMaxes(session: WorkoutSession, configPath: string = 'config.json'): Promise<WorkoutSession> {
    const rmConfig = await loadRMConfig(configPath);

    if (!rmConfig) {
      // No RM config found, return session unchanged
      return session;
    }

    const resolver = new RMResolver(rmConfig);

    // Deep clone the session to avoid mutating the original
    const resolvedSession: WorkoutSession = {
      sessionNumber: session.sessionNumber,
      sections: session.sections.map((section) => ({
        ...section,
        header: section.header,
        content: [...section.content],
        youtubeLinks: [...section.youtubeLinks],
      })),
    };

    // Process each section
    for (const section of resolvedSession.sections) {
      // Use header as context for RM resolution (contains exercise name)
      const contextLine = section.header || '';

      // Resolve RM references in the header
      if (section.header) {
        section.header = resolver.resolveLine(section.header, contextLine);
      }

      // Resolve RM references in content lines
      section.content = section.content.map((line) =>
        resolver.resolveLine(line, contextLine)
      );
    }

    return resolvedSession;
  }
}
