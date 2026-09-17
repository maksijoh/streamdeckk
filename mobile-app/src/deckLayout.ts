import type { Button } from '../../shared/protocol.types';

export const DECK_COLUMNS = 4;
export const DECK_ROWS = 3;
export const DECK_SLOTS_PER_PAGE = DECK_COLUMNS * DECK_ROWS;
export const DECK_GAP = 9;
export const DECK_INDICATOR_HEIGHT = 16;

export type VisualButton = Button & { imageUri?: string };

export function deckKeySize(viewportWidth: number, viewportHeight: number): number {
  const usableWidth = Math.max(1, viewportWidth - 16);
  const usableHeight = Math.max(1, viewportHeight - DECK_INDICATOR_HEIGHT - 8);
  const widthBound = Math.floor((usableWidth - DECK_GAP * (DECK_COLUMNS - 1)) / DECK_COLUMNS);
  const heightBound = Math.floor((usableHeight - DECK_GAP * (DECK_ROWS - 1)) / DECK_ROWS);
  return Math.max(36, Math.min(124, widthBound, heightBound));
}

export function paginateDeck(buttons: Button[]): (VisualButton | null)[][] {
  const pageCount = Math.max(1, Math.ceil(buttons.length / DECK_SLOTS_PER_PAGE));
  return Array.from({ length: pageCount }, (_, pageIndex) => Array.from({ length: DECK_SLOTS_PER_PAGE }, (_, slotIndex) => {
    return buttons[pageIndex * DECK_SLOTS_PER_PAGE + slotIndex] as VisualButton | undefined ?? null;
  }));
}
