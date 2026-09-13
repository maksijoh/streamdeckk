import type { Button } from '../../shared/protocol.types';

export const DECK_COLUMNS = 4;
export const DECK_ROWS = 3;
export const DECK_SLOTS_PER_PAGE = DECK_COLUMNS * DECK_ROWS;

export type VisualButton = Button & { imageUri?: string };

export function paginateDeck(buttons: Button[]): (VisualButton | null)[][] {
  const pageCount = Math.max(1, Math.ceil(buttons.length / DECK_SLOTS_PER_PAGE));
  return Array.from({ length: pageCount }, (_, pageIndex) => Array.from({ length: DECK_SLOTS_PER_PAGE }, (_, slotIndex) => {
    return buttons[pageIndex * DECK_SLOTS_PER_PAGE + slotIndex] as VisualButton | undefined ?? null;
  }));
}
