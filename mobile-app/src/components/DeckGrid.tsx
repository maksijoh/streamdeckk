import { useMemo, useRef, useState } from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, View } from 'react-native';
import type { Button } from '../../../shared/protocol.types';
import { type AppearancePalette, withAlpha } from '../appearance';
import { DECK_COLUMNS, paginateDeck, type VisualButton } from '../deckLayout';
import { GlassButton } from './GlassButton';

const GAP = 9;

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
  const heightBudget = Math.max(120, viewportHeight - 235);
  const heightBoundWidth = Math.floor((heightBudget - GAP * 2) / 3) * DECK_COLUMNS + GAP * (DECK_COLUMNS - 1);
  const deckWidth = Math.max(156, Math.min(420, viewportWidth - 28, heightBoundWidth));
  const keySize = Math.floor((deckWidth - GAP * (DECK_COLUMNS - 1)) / DECK_COLUMNS);
  const actualDeckWidth = keySize * DECK_COLUMNS + GAP * (DECK_COLUMNS - 1);

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
      renderItem={({ item, index: pageIndex }) => <View style={[styles.page, { width: viewportWidth }]}>
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
    <View style={styles.pageFooter}>
      <Text style={[styles.pageLabel, { color: palette.muted }]}>PAGE {visiblePage + 1} / {pages.length}</Text>
      <View style={styles.dots}>
        {pages.map((_, index) => <View key={index} style={[
          styles.dot,
          { backgroundColor: index === visiblePage ? palette.accent : withAlpha(palette.muted, 0.28) },
          index === visiblePage && styles.activeDot,
        ]} />)}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  page: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  deck: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  pageFooter: { height: 22, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  pageLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  activeDot: { width: 14 },
});
