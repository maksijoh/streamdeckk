import { useMemo, useRef, useState } from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, View } from 'react-native';
import type { Button } from '../../../shared/protocol.types';
import { type AppearancePalette, withAlpha } from '../appearance';
import { DECK_COLUMNS, DECK_GAP, DECK_INDICATOR_HEIGHT, deckKeySize, paginateDeck, type VisualButton } from '../deckLayout';
import { GlassButton } from './GlassButton';

type Props = {
  buttons: Button[];
  connected: boolean;
  palette: AppearancePalette;
  viewportWidth: number;
  viewportHeight: number;
  onPress: (buttonId: string) => void;
};

export function DeckGrid({ buttons, connected, palette, viewportWidth, viewportHeight, onPress }: Props) {
  const pages = useMemo(() => paginateDeck(buttons), [buttons]);
  const [page, setPage] = useState(0);
  const list = useRef<FlatList<(VisualButton | null)[]>>(null);
  const keySize = deckKeySize(viewportWidth, viewportHeight);
  const actualDeckWidth = keySize * DECK_COLUMNS + DECK_GAP * (DECK_COLUMNS - 1);

  const visiblePage = Math.min(page, pages.length - 1);

  const scrolled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.max(0, Math.min(pages.length - 1, Math.round(event.nativeEvent.contentOffset.x / viewportWidth))));
  };

  return <View style={styles.container}>
    <FlatList
      key={`deck-width-${Math.round(viewportWidth)}`}
      ref={list}
      horizontal
      pagingEnabled
      scrollEnabled={pages.length > 1}
      showsHorizontalScrollIndicator={false}
      bounces={pages.length > 1}
      data={pages}
      initialScrollIndex={visiblePage}
      keyExtractor={(_, index) => `deck-page-${index}`}
      getItemLayout={(_, index) => ({ length: viewportWidth, offset: viewportWidth * index, index })}
      onContentSizeChange={() => {
        if (page >= pages.length) {
          setPage(0);
          list.current?.scrollToOffset({ offset: 0, animated: false });
        }
      }}
      onMomentumScrollEnd={scrolled}
      renderItem={({ item, index: pageIndex }) => <View style={[styles.page, { width: viewportWidth, height: Math.max(1, viewportHeight - DECK_INDICATOR_HEIGHT) }]}>
        <View accessibilityLabel={`Deck page ${pageIndex + 1} of ${pages.length}, four columns by three rows`} style={[styles.deck, { width: actualDeckWidth }]}>
          {item.map((button, slotIndex) => <GlassButton
            key={button?.id ?? `empty-${pageIndex}-${slotIndex}`}
            button={button}
            connected={connected}
            palette={palette}
            size={keySize}
            onPress={onPress}
          />)}
        </View>
      </View>}
    />
    {pages.length > 1 && <View accessible style={styles.pageFooter} accessibilityLabel={`Page ${visiblePage + 1} of ${pages.length}`}>
      <View style={styles.dots}>
        {pages.map((_, index) => <View key={index} style={[
          styles.dot,
          { backgroundColor: index === visiblePage ? palette.accent : withAlpha(palette.muted, 0.28) },
          index === visiblePage && styles.activeDot,
        ]} />)}
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', height: '100%' },
  page: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  deck: { flexDirection: 'row', flexWrap: 'wrap', gap: DECK_GAP },
  pageFooter: { position: 'absolute', height: DECK_INDICATOR_HEIGHT, left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  activeDot: { width: 14 },
});
