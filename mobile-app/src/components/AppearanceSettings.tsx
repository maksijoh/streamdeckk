import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
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
import { GlassControl, GlassSurface } from './GlassSurface';

type Props = {
  visible: boolean;
  preferences: AppearancePreferences;
  palette: AppearancePalette;
  onChange: (preferences: AppearancePreferences) => void;
  onClose: () => void;
};

export function AppearanceSettings({ visible, preferences, palette, onChange, onClose }: Props) {
  const [selectedColor, setSelectedColor] = useState<CustomColorName>('accent');
  const [hex, setHex] = useState(palette.accent);
  const activeControl = COLOR_CONTROLS.find(control => control.key === selectedColor)!;
  const currentValue = preferences.overrides[preferences.theme][selectedColor] ?? (
    selectedColor === 'backgroundTint' ? palette.background :
      selectedColor === 'glassTint' ? palette.glass : palette[selectedColor]
  );

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

  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close appearance settings" style={StyleSheet.absoluteFill} onPress={onClose} />
      <GlassSurface palette={palette} variant="floating" style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headingRow}>
          <View style={styles.headingText}>
            <Text style={[styles.eyebrow, { color: palette.accent }]}>LIQUID GLASS</Text>
            <Text style={[styles.title, { color: palette.text }]}>Appearance</Text>
          </View>
          <GlassControl palette={palette} title="Close" icon="x" compact onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Theme</Text>
          <View style={[styles.segment, { backgroundColor: withAlpha(palette.background, 0.5), borderColor: withAlpha(palette.buttonHighlight, 0.24) }]}>
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
                  backgroundColor: selectedColor === control.key ? withAlpha(palette.accent, 0.14) : withAlpha(palette.glass, 0.28),
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
            <View style={[styles.inputShell, { backgroundColor: withAlpha(palette.background, 0.42), borderColor: validHex ? withAlpha(palette.buttonHighlight, 0.38) : withAlpha(palette.danger, 0.7) }]}>
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
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: 12, backgroundColor: 'rgba(1, 5, 11, 0.54)' },
  sheet: { maxHeight: '88%', paddingTop: 10, paddingHorizontal: 18, paddingBottom: Platform.OS === 'ios' ? 22 : 14 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(150, 165, 185, 0.42)', marginBottom: 12 },
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
