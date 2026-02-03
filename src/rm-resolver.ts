/**
 * RM (Rep Max) Resolver
 * 
 * Resolves percentage-based weight references in workout content to actual weights.
 * 
 * Patterns supported:
 * - "@75% 1RM" / "@75%1RM" / "@ 75% 1RM"
 * - "@75% <exercise>" (e.g., "@75% squat", "@80% bench")
 * - "75% of 1RM"
 * - Handles both with and without spaces
 */

export interface RepMax {
  exercise: string;      // Canonical exercise name (e.g., "squat", "bench press")
  weight: number;        // Weight in lbs
  aliases?: string[];    // Alternative names that match this exercise
}

export interface RMConfig {
  repMaxes: RepMax[];
  defaultUnit?: 'lbs' | 'kg';
}

// Pattern to match percentage references
// Captures: percentage, optional exercise name
const RM_PATTERNS = [
  // "@75% 1RM" or "@75%1RM" or "@ 75% 1RM"
  /@\s*(\d+(?:\.\d+)?)\s*%\s*1?\s*RM\b/gi,
  // "@75% squat" or "@80% bench press"
  /@\s*(\d+(?:\.\d+)?)\s*%\s+(\w[\w\s]*?)(?=,|\.|;|$|\s+@|\s+rest|\s+x\s*\d)/gi,
  // "75% of 1RM"
  /(\d+(?:\.\d+)?)\s*%\s+of\s+1?\s*RM\b/gi,
  // "75% of squat"
  /(\d+(?:\.\d+)?)\s*%\s+of\s+(\w[\w\s]*?)(?=,|\.|;|$|\s+@|\s+rest|\s+x\s*\d)/gi,
];

export class RMResolver {
  private repMaxes: Map<string, number> = new Map();
  private defaultUnit: 'lbs' | 'kg';

  constructor(config: RMConfig) {
    this.defaultUnit = config.defaultUnit || 'lbs';
    
    for (const rm of config.repMaxes) {
      // Store canonical name (lowercase)
      this.repMaxes.set(rm.exercise.toLowerCase(), rm.weight);
      
      // Store aliases
      if (rm.aliases) {
        for (const alias of rm.aliases) {
          this.repMaxes.set(alias.toLowerCase(), rm.weight);
        }
      }
    }
  }

  /**
   * Find the best matching rep max for an exercise name from context.
   * Prioritizes exact matches, then longest partial matches.
   */
  private findRepMax(exerciseName?: string, contextLine?: string): number | null {
    // If explicit exercise name provided, try to match it
    if (exerciseName) {
      const normalized = exerciseName.toLowerCase().trim();
      if (this.repMaxes.has(normalized)) {
        return this.repMaxes.get(normalized)!;
      }
      
      // Try partial matching - prefer longest match
      let bestMatch: { key: string; weight: number } | null = null;
      for (const [key, weight] of this.repMaxes) {
        if (normalized.includes(key) || key.includes(normalized)) {
          if (!bestMatch || key.length > bestMatch.key.length) {
            bestMatch = { key, weight };
          }
        }
      }
      if (bestMatch) {
        return bestMatch.weight;
      }
    }
    
    // Try to infer from context line (e.g., section header)
    if (contextLine) {
      const lineLower = contextLine.toLowerCase();
      
      // Find the longest matching key (most specific match)
      let bestMatch: { key: string; weight: number } | null = null;
      for (const [key, weight] of this.repMaxes) {
        if (lineLower.includes(key)) {
          if (!bestMatch || key.length > bestMatch.key.length) {
            bestMatch = { key, weight };
          }
        }
      }
      if (bestMatch) {
        return bestMatch.weight;
      }
    }
    
    return null;
  }

  /**
   * Calculate weight from percentage and 1RM
   */
  private calculateWeight(percentage: number, oneRM: number): number {
    return Math.round((percentage / 100) * oneRM);
  }

  /**
   * Resolve a single line of workout content
   * Returns the line with RM references replaced with actual weights
   */
  resolveLine(line: string, contextLine?: string): string {
    let result = line;
    
    // Pattern 1: @75% 1RM (generic, needs context)
    result = result.replace(/@\s*(\d+(?:\.\d+)?)\s*%\s*1?\s*RM\b/gi, (match, pct) => {
      const percentage = parseFloat(pct);
      const oneRM = this.findRepMax(undefined, contextLine);
      if (oneRM !== null) {
        const weight = this.calculateWeight(percentage, oneRM);
        return `${match} (${weight} ${this.defaultUnit})`;
      }
      return match; // Keep original if no match found
    });
    
    // Pattern 2: @75% squat (explicit exercise)
    result = result.replace(/@\s*(\d+(?:\.\d+)?)\s*%\s+(\w[\w\s]*?)(?=,|\.|;|$|\s+@|\s+rest|\s+x\s*\d|\))/gi, (match, pct, exercise) => {
      const percentage = parseFloat(pct);
      const oneRM = this.findRepMax(exercise.trim());
      if (oneRM !== null) {
        const weight = this.calculateWeight(percentage, oneRM);
        return `${match} (${weight} ${this.defaultUnit})`;
      }
      return match;
    });
    
    // Pattern 3: 75% of 1RM
    result = result.replace(/(\d+(?:\.\d+)?)\s*%\s+of\s+1?\s*RM\b/gi, (match, pct) => {
      const percentage = parseFloat(pct);
      const oneRM = this.findRepMax(undefined, contextLine);
      if (oneRM !== null) {
        const weight = this.calculateWeight(percentage, oneRM);
        return `${match} (${weight} ${this.defaultUnit})`;
      }
      return match;
    });
    
    // Pattern 4: 75% of squat
    result = result.replace(/(\d+(?:\.\d+)?)\s*%\s+of\s+(\w[\w\s]*?)(?=,|\.|;|$|\s+@|\s+rest|\s+x\s*\d)/gi, (match, pct, exercise) => {
      const percentage = parseFloat(pct);
      const oneRM = this.findRepMax(exercise.trim());
      if (oneRM !== null) {
        const weight = this.calculateWeight(percentage, oneRM);
        return `${match} (${weight} ${this.defaultUnit})`;
      }
      return match;
    });
    
    return result;
  }

  /**
   * Check if a line contains any RM references
   */
  hasRMReference(line: string): boolean {
    return /@\s*\d+(?:\.\d+)?\s*%/i.test(line) || 
           /\d+(?:\.\d+)?\s*%\s+of\s+/i.test(line);
  }
}

/**
 * Load RM config from the main config file
 */
export async function loadRMConfig(configPath: string = 'config.json'): Promise<RMConfig | null> {
  try {
    const fs = await import('fs/promises');
    const content = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(content);
    
    if (config.repMaxes && Array.isArray(config.repMaxes)) {
      return {
        repMaxes: config.repMaxes,
        defaultUnit: config.defaultUnit || 'lbs',
      };
    }
    
    return null;
  } catch {
    return null;
  }
}
