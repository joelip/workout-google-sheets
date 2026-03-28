const PLUS_ONLY_MARKER_PATTERN = /^(?:[-*]\s*)?\+$/;
const LETTERED_SECTION_PATTERN = /^[A-Z](?:\d+)?\./;

export function isPlusOnlyMarkerLine(line: string): boolean {
  return PLUS_ONLY_MARKER_PATTERN.test(line.trim());
}

export function removePlusOnlyMarkerLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isPlusOnlyMarkerLine(line))
    .join('\n');
}

export function addSpacingBeforeLetteredSections(text: string): string {
  const formattedLines: string[] = [];

  for (const line of text.split('\n')) {
    const trimmedLine = line.trim();
    const previousLine = formattedLines[formattedLines.length - 1] ?? '';

    if (
      LETTERED_SECTION_PATTERN.test(trimmedLine)
      && formattedLines.length > 0
      && previousLine.trim() !== ''
    ) {
      formattedLines.push('');
    }

    formattedLines.push(line);
  }

  return formattedLines.join('\n');
}
