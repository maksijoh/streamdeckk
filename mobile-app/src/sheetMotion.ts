export const SHEET_FLING_VELOCITY = 0.42;

export function compactSheetHeight(availableHeight: number): number {
  if (availableHeight < 470) {
    return Math.min(availableHeight, Math.max(240, Math.round(availableHeight * 0.72)));
  }
  return Math.min(availableHeight, Math.max(470, Math.round(availableHeight * 0.72)));
}

export function clampSheetHeight(value: number, compactHeight: number, expandedHeight: number): number {
  return Math.max(compactHeight, Math.min(expandedHeight, value));
}

export function shouldExpandSheet(
  currentHeight: number,
  velocityY: number,
  compactHeight: number,
  expandedHeight: number,
): boolean {
  if (velocityY <= -SHEET_FLING_VELOCITY) return true;
  if (velocityY >= SHEET_FLING_VELOCITY) return false;
  return currentHeight >= compactHeight + (expandedHeight - compactHeight) / 2;
}
