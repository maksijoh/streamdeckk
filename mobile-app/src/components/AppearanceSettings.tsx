import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  COLOR_CONTROLS,
  COLOR_PRESETS,
  type AppearancePalette,
  type AppearancePreferences,
  type CustomColorName,
  normalizeHex,
  paletteFor,
  withAlpha,
} from '../appearance';
import { clampSheetHeight, compactSheetHeight, shouldExpandSheet } from '../sheetMotion';
import { GlassControl, GlassSurface, useGlassBlurTarget } from './GlassSurface';

const nativeBlurMethod = Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' as const : undefined;

type Props = {
  preferences: AppearancePreferences;
  palette: AppearancePalette;
  onChange: (preferences: AppearancePreferences) => void;
  onClose: () => void;
};

export function AppearanceSettings({ preferences, palette, onChange, onClose }: Props) {
  const { height: viewportHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const blurTarget = useGlassBlurTarget();
  const availableHeight = Math.max(1, viewportHeight - insets.top - Math.max(insets.bottom, 8) - 8);
  const compactHeight = compactSheetHeight(availableHeight);
  const sheetRange = Math.max(1, availableHeight - compactHeight);
  const [sheetProgress] = useState(() => new Animated.Value(0));
  const sheetHeight = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [compactHeight, availableHeight],
  });
  const [expanded, setExpanded] = useState(false);
  const dragStart = useRef(0);
  const closing = useRef(false);
  const [selectedColor, setSelectedColor] = useState<CustomColorName>('accent');
  const [hex, setHex] = useState(palette.accent);
  const activeControl = COLOR_CONTROLS.find(control => control.key === selectedColor)!;
  const currentValue = preferences.overrides[preferences.theme][selectedColor] ?? (
    selectedColor === 'backgroundTint' ? palette.background :
      selectedColor === 'glassTint' ? palette.glass : palette[selectedColor]
  );

  const closeOnce = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeOnce();
      return true;
    });
    return () => subscription.remove();
  }, [closeOnce]);

  const animateSheet = useCallback((nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    Animated.spring(sheetProgress, {
      toValue: nextExpanded ? 1 : 0,
      speed: 24,
      bounciness: 4,
      useNativeDriver: false,
    }).start();
  }, [sheetProgress]);

  // PanResponder callbacks execute after render; refs keep gesture state mutable without rerenders.
  // eslint-disable-next-line react-hooks/refs
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      sheetProgress.stopAnimation(value => { dragStart.current = compactHeight + value * sheetRange; });
    },
    onPanResponderMove: (_, gesture) => {
      const nextHeight = clampSheetHeight(dragStart.current - gesture.dy, compactHeight, availableHeight);
      sheetProgress.setValue((nextHeight - compactHeight) / sheetRange);
    },
    onPanResponderRelease: (_, gesture) => {
      const releasedHeight = clampSheetHeight(dragStart.current - gesture.dy, compactHeight, availableHeight);
      animateSheet(shouldExpandSheet(releasedHeight, gesture.vy, compactHeight, availableHeight));
    },
    onPanResponderTerminate: () => animateSheet(expanded),
  }), [animateSheet, availableHeight, compactHeight, expanded, sheetProgress, sheetRange]);

  const updateColor = (value: string) => {
    const normalized = normalizeHex(value);
    if (!normalized) return;
    onChange({
      ...preferences,
      overrides: {
        ...preferences.overrides,
        [preferences.theme]: { ...preferences.overrides[preferences.theme], [selectedColor]: normalized },
      },
    });
  };

  const switchTheme = (theme: 'light' | 'dark') => {
    const next = { ...preferences, theme };
    onChange(next);
    const nextPalette = paletteFor(next);
    setHex(selectedColor === 'backgroundTint' ? nextPalette.background : selectedColor === 'glassTint' ? nextPalette.glass : nextPalette[selectedColor]);
  };

  const validHex = normalizeHex(hex);

  return <View
    accessibilityViewIsModal
    style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 8) }]}
  >
    <BlurView
      pointerEvents="none"
      tint={palette.theme === 'dark' ? 'dark' : 'light'}
      intensity={24}
      blurMethod={blurTarget ? nativeBlurMethod : undefined}
      blurTarget={blurTarget}
      blurReductionFactor={2.5}
      style={StyleSheet.absoluteFill}
    />
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close appearance settings"
      style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha('#01050B', palette.theme === 'dark' ? 0.38 : 0.22) }]}
      onPressIn={closeOnce}
      onPress={closeOnce}
    />

    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetHost}>
      <Animated.View style={[styles.sheetMotion, { height: sheetHeight }]}>
        <GlassSurface palette={palette} variant="floating" style={styles.sheet}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse appearance settings' : 'Expand appearance settings'}
            accessibilityHint="Tap or drag the handle vertically"
            accessibilityState={{ expanded }}
            onPress={() => animateSheet(!expanded)}
            style={styles.handleTouch}
            {...panResponder.panHandlers}
          >
            <View style={[styles.handle, { backgroundColor: withAlpha(palette.buttonHighlight, 0.58) }]} />
            <Feather name={expanded ? 'chevron-down' : 'chevron-up'} size={15} color={palette.muted} />
          </Pressable>

          <View style={styles.headingRow}>
            <View style={styles.headingText}>
              <Text style={[styles.eyebrow, { color: palette.accent }]}>LIQUID GLASS</Text>
              <Text style={[styles.title, { color: palette.text }]}>Appearance</Text>
            </View>
            <GlassControl palette={palette} title="Close" icon="x" compact onPress={closeOnce} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.sectionTitle, { color: palette.text }]}>Theme</Text>
            <View style={[styles.segment, { backgroundColor: withAlpha(palette.background, 0.28), borderColor: withAlpha(palette.buttonHighlight, 0.24) }]}>
              {(['light', 'dark'] as const).map(theme => <Pressable
                key={theme}
                accessibilityRole="button"
                accessibilityState={{ selected: preferences.theme === theme }}
                onPress={() => switchTheme(theme)}
                style={[
                  styles.segmentButton,
                  preferences.theme === theme && { backgroundColor: withAlpha(palette.accent, palette.theme === 'dark' ? 0.2 : 0.14), borderColor: withAlpha(palette.accent, 0.65) },
                ]}
              >
                <Feather name={theme === 'light' ? 'sun' : 'moon'} size={16} color={preferences.theme === theme ? palette.accent : palette.muted} />
                <Text style={[styles.segmentLabel, { color: preferences.theme === theme ? palette.accent : palette.muted }]}>{theme === 'light' ? 'Light' : 'Dark'}</Text>
              </Pressable>)}
            </View>

            <Text style={[styles.sectionTitle, { color: palette.text }]}>Color studio</Text>
            <View style={styles.roleGrid}>
              {COLOR_CONTROLS.map(control => <Pressable
                key={control.key}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedColor === control.key }}
                onPress={() => {
                  setSelectedColor(control.key);
                  setHex(preferences.overrides[preferences.theme][control.key] ?? (
                    control.key === 'backgroundTint' ? palette.background :
                      control.key === 'glassTint' ? palette.glass : palette[control.key]
                  ));
                }}
                style={[
                  styles.role,
                  {
                    backgroundColor: selectedColor === control.key ? withAlpha(palette.accent, 0.14) : withAlpha(palette.glass, 0.18),
                    borderColor: selectedColor === control.key ? withAlpha(palette.accent, 0.72) : withAlpha(palette.buttonHighlight, 0.2),
                  },
                ]}
              >
                <View style={[styles.roleSwatch, { backgroundColor: control.key === 'backgroundTint' ? palette.background : control.key === 'glassTint' ? palette.glass : palette[control.key] }]} />
                <Text style={[styles.roleText, { color: selectedColor === control.key ? palette.accent : palette.text }]}>{control.label}</Text>
              </Pressable>)}
            </View>

            <Text style={[styles.helper, { color: palette.muted }]}>{activeControl.description}</Text>
            <View style={styles.palette}>
              {COLOR_PRESETS.map(color => <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={`Set ${activeControl.label.toLowerCase()} to ${color}`}
                accessibilityState={{ selected: currentValue === color }}
                onPress={() => { setHex(color); updateColor(color); }}
                style={[
                  styles.swatchShell,
                  { borderColor: currentValue === color ? palette.text : withAlpha(palette.buttonHighlight, 0.2) },
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: color }]} />
              </Pressable>)}
            </View>

            <View style={styles.hexRow}>
              <View style={[styles.inputShell, { backgroundColor: withAlpha(palette.background, 0.25), borderColor: validHex ? withAlpha(palette.buttonHighlight, 0.38) : withAlpha(palette.danger, 0.7) }]}>
                <TextInput
                  accessibilityLabel={`Custom ${activeControl.label.toLowerCase()} hex color`}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={7}
                  value={hex}
                  onChangeText={setHex}
                  onSubmitEditing={() => { if (validHex) updateColor(validHex); }}
                  placeholder="#70B7FF"
                  placeholderTextColor={palette.muted}
                  selectionColor={palette.accent}
                  style={[styles.input, { color: palette.text }]}
                />
              </View>
              <GlassControl palette={palette} title="Apply" icon="check" disabled={!validHex} onPress={() => { if (validHex) updateColor(validHex); }} />
            </View>

            <GlassControl
              palette={palette}
              title="Reset this theme"
              icon="rotate-ccw"
              onPress={() => {
                const next = { ...preferences, overrides: { ...preferences.overrides, [preferences.theme]: {} } };
                const nextPalette = paletteFor(next);
                setHex(selectedColor === 'backgroundTint' ? nextPalette.background : selectedColor === 'glassTint' ? nextPalette.glass : nextPalette[selectedColor]);
                onChange(next);
              }}
            />
          </ScrollView>
        </GlassSurface>
      </Animated.View>
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, elevation: 100, paddingHorizontal: 12 },
  sheetHost: { flex: 1, justifyContent: 'flex-end' },
  sheetMotion: { width: '100%' },
  sheet: { flex: 1, paddingHorizontal: 18, paddingBottom: Platform.OS === 'ios' ? 18 : 14 },
  handleTouch: { alignSelf: 'center', width: 88, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  handle: { width: 42, height: 5, borderRadius: 3 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headingText: { gap: 2 },
  eyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.7 },
  title: { fontSize: 25, fontWeight: '800', letterSpacing: -0.7 },
  content: { gap: 12, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800', marginTop: 2 },
  segment: { flexDirection: 'row', gap: 6, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 4 },
  segmentButton: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  segmentLabel: { fontSize: 14, fontWeight: '800' },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  role: { width: '48%', flexGrow: 1, minHeight: 44, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
  roleSwatch: { width: 16, height: 16, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.55)' },
  roleText: { fontSize: 12, fontWeight: '700' },
  helper: { fontSize: 12, marginTop: -4 },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  swatchShell: { width: 44, height: 44, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 32, height: 32, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.66)' },
  hexRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  inputShell: { flex: 1, height: 45, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  input: { paddingHorizontal: 14, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
});
