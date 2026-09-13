import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APPEARANCE, normalizeHex, paletteFor, parseAppearance } from '../src/appearance.ts';
import { DECK_COLUMNS, DECK_ROWS, DECK_SLOTS_PER_PAGE, paginateDeck } from '../src/deckLayout.ts';
import { clampSheetHeight, compactSheetHeight, shouldExpandSheet } from '../src/sheetMotion.ts';

const buttons = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `button_${index}`, label: `Button ${index}` }));

test('deck layout is permanently four by three with padded pages', () => {
  assert.equal(DECK_COLUMNS, 4);
  assert.equal(DECK_ROWS, 3);
  assert.equal(DECK_SLOTS_PER_PAGE, 12);
  for (const count of [0, 1, 11, 12, 13, 24, 25, 256]) {
    const pages = paginateDeck(buttons(count));
    assert.equal(pages.length, Math.max(1, Math.ceil(count / 12)));
    assert.ok(pages.every(page => page.length === 12));
    assert.equal(pages.flat().filter(Boolean).length, count);
  }
});

test('deck pages preserve server ordering and pad only their tail', () => {
  const pages = paginateDeck(buttons(14));
  assert.deepEqual(pages[0].map(button => button?.id), buttons(12).map(button => button.id));
  assert.deepEqual(pages[1].slice(0, 2).map(button => button?.id), ['button_12', 'button_13']);
  assert.ok(pages[1].slice(2).every(button => button === null));
});

test('appearance parsing accepts exactly light/dark and sanitizes custom colors', () => {
  assert.equal(parseAppearance(JSON.stringify({ theme: 'sepia', overrides: {} })), DEFAULT_APPEARANCE);
  const parsed = parseAppearance(JSON.stringify({
    theme: 'light',
    overrides: {
      light: { accent: '#a1b2c3', backgroundTint: 'bad', glassTint: '#fff' },
      dark: { buttonHighlight: '#010203', unknown: '#FFFFFF' },
    },
  }));
  assert.deepEqual(parsed, {
    theme: 'light',
    overrides: { light: { accent: '#A1B2C3', glassTint: '#FFFFFF' }, dark: { buttonHighlight: '#010203' } },
  });
  assert.equal(paletteFor(parsed).accent, '#A1B2C3');
});

test('custom hex normalization supports shorthand and rejects unsafe values', () => {
  assert.equal(normalizeHex('#7bf'), '#77BBFF');
  assert.equal(normalizeHex(' #12abEF '), '#12ABEF');
  for (const value of ['', '#12', '#1234', '12ABEF', '#GG0000', '#12345678']) assert.equal(normalizeHex(value), null);
});

test('appearance sheet keeps useful compact and full-screen detents', () => {
  assert.equal(compactSheetHeight(800), 576);
  assert.equal(compactSheetHeight(500), 470);
  assert.equal(compactSheetHeight(420), 420);
  assert.equal(clampSheetHeight(300, 470, 700), 470);
  assert.equal(clampSheetHeight(900, 470, 700), 700);
});

test('appearance sheet settles by drag midpoint or fling direction', () => {
  assert.equal(shouldExpandSheet(590, 0, 470, 700), true);
  assert.equal(shouldExpandSheet(580, 0, 470, 700), false);
  assert.equal(shouldExpandSheet(480, -0.5, 470, 700), true);
  assert.equal(shouldExpandSheet(690, 0.5, 470, 700), false);
});
