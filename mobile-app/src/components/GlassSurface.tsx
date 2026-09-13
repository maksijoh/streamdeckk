import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { type AppearancePalette, withAlpha } from '../appearance';

type SurfaceProps = PropsWithChildren<{
  palette: AppearancePalette;
  style?: StyleProp<ViewStyle>;
  variant?: 'panel' | 'floating' | 'subtle';
}>;

export function GlassSurface({ children, palette, style, variant = 'panel' }: SurfaceProps) {
  const dark = palette.theme === 'dark';
  const opacity = variant === 'subtle' ? (dark ? 0.28 : 0.42) : variant === 'floating' ? (dark ? 0.7 : 0.78) : (dark ? 0.5 : 0.64);
  return <View style={[
    styles.surface,
    variant === 'floating' && styles.floating,
    {
      backgroundColor: withAlpha(palette.glass, opacity),
      borderColor: withAlpha(palette.buttonHighlight, dark ? 0.28 : 0.7),
      shadowColor: palette.shadow,
    },
    style,
  ]}>
    <View pointerEvents="none" style={[styles.topReflection, { backgroundColor: withAlpha(palette.buttonHighlight, dark ? 0.07 : 0.14) }]} />
    <View pointerEvents="none" style={[styles.innerEdge, { borderColor: withAlpha('#FFFFFF', dark ? 0.08 : 0.42) }]} />
    {children}
  </View>;
}

type ControlProps = {
  palette: AppearancePalette;
  title: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  compact?: boolean;
  selected?: boolean;
  leading?: ReactNode;
};

export function GlassControl({ palette, title, onPress, disabled = false, icon, compact = false, selected = false, leading }: ControlProps) {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={{ disabled, selected }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.control,
      compact && styles.compact,
      {
        backgroundColor: selected ? withAlpha(palette.accent, palette.theme === 'dark' ? 0.2 : 0.14) : withAlpha(palette.glass, palette.theme === 'dark' ? 0.45 : 0.66),
        borderColor: selected ? withAlpha(palette.accent, 0.72) : withAlpha(palette.buttonHighlight, palette.theme === 'dark' ? 0.24 : 0.58),
        shadowColor: palette.shadow,
      },
      pressed && styles.controlPressed,
      disabled && styles.disabled,
    ]}
  >
    {leading}
    {icon && <Feather name={icon} size={compact ? 18 : 17} color={selected ? palette.accent : palette.text} />}
    {!compact && <Text numberOfLines={1} style={[styles.controlText, { color: selected ? palette.accent : palette.text }]}>{title}</Text>}
  </Pressable>;
}

const styles = StyleSheet.create({
  surface: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
  },
  floating: {
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
  },
  topReflection: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    borderRadius: 1,
  },
  innerEdge: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 21,
  },
  control: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 4,
  },
  compact: {
    width: 44,
    minHeight: 44,
    paddingHorizontal: 0,
    borderRadius: 15,
  },
  controlPressed: {
    transform: [{ translateY: 2 }, { scale: 0.98 }],
    shadowOpacity: 0.04,
    elevation: 1,
  },
  controlText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  disabled: {
    opacity: 0.42,
  },
});
