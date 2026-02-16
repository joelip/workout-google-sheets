const PLUS_ONLY_MARKER_PATTERN = /^(?:[-*]\s*)?\+$/;

export function isPlusOnlyMarkerLine(line: string): boolean {
  return PLUS_ONLY_MARKER_PATTERN.test(line.trim());
}

export function removePlusOnlyMarkerLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isPlusOnlyMarkerLine(line))
    .join('\n');
}
