import { createContext, useContext, type PropsWithChildren, type ReactNode, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { type AppearancePalette, withAlpha } from '../appearance';

const nativeBlurMethod = Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' as const : undefined;
const BlurTargetContext = createContext<RefObject<View | null> | undefined>(undefined);

export function GlassBlurProvider({ children, target }: PropsWithChildren<{ target: RefObject<View | null> }>) {
  return <BlurTargetContext.Provider value={target}>{children}</BlurTargetContext.Provider>;
}

export function useGlassBlurTarget() {
  return useContext(BlurTargetContext);
}

type SurfaceProps = PropsWithChildren<{
  palette: AppearancePalette;
  style?: StyleProp<ViewStyle>;
  variant?: 'panel' | 'floating' | 'subtle';
}>;

export function GlassSurface({ children, palette, style, variant = 'panel' }: SurfaceProps) {
  const blurTarget = useGlassBlurTarget();
  const dark = palette.theme === 'dark';
  const opacity = variant === 'subtle' ? (dark ? 0.16 : 0.25) : variant === 'floating' ? (dark ? 0.38 : 0.46) : (dark ? 0.24 : 0.34);
  const intensity = variant === 'subtle' ? 32 : variant === 'floating' ? 62 : 46;
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
    <BlurView
      pointerEvents="none"
      tint={dark ? 'dark' : 'light'}
      intensity={intensity}
      blurMethod={blurTarget ? nativeBlurMethod : undefined}
      blurTarget={blurTarget}
      blurReductionFactor={2.5}
      style={StyleSheet.absoluteFill}
    />
    <LinearGradient
      pointerEvents="none"
      colors={[
        withAlpha(palette.buttonHighlight, dark ? 0.2 : 0.38),
        withAlpha(palette.glass, dark ? 0.07 : 0.12),
        withAlpha(palette.accent, dark ? 0.055 : 0.04),
      ]}
      locations={[0, 0.42, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <LinearGradient
      pointerEvents="none"
      colors={['transparent', withAlpha(palette.glass, dark ? 0.16 : 0.22)]}
      locations={[0.38, 1]}
      style={StyleSheet.absoluteFill}
    />
    <View pointerEvents="none" style={[styles.topReflection, { backgroundColor: withAlpha(palette.buttonHighlight, dark ? 0.28 : 0.64) }]} />
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
  const blurTarget = useGlassBlurTarget();
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
        backgroundColor: selected ? withAlpha(palette.accent, palette.theme === 'dark' ? 0.18 : 0.12) : withAlpha(palette.glass, palette.theme === 'dark' ? 0.2 : 0.3),
        borderColor: selected ? withAlpha(palette.accent, 0.72) : withAlpha(palette.buttonHighlight, palette.theme === 'dark' ? 0.24 : 0.58),
        shadowColor: palette.shadow,
      },
      pressed && styles.controlPressed,
      disabled && styles.disabled,
    ]}
  >
    <BlurView
      pointerEvents="none"
      tint={palette.theme === 'dark' ? 'dark' : 'light'}
      intensity={30}
      blurMethod={blurTarget ? nativeBlurMethod : undefined}
      blurTarget={blurTarget}
      blurReductionFactor={2.5}
      style={StyleSheet.absoluteFill}
    />
    <LinearGradient
      pointerEvents="none"
      colors={[
        withAlpha(palette.buttonHighlight, palette.theme === 'dark' ? 0.16 : 0.32),
        'transparent',
        withAlpha(palette.accent, selected ? 0.12 : 0.035),
      ]}
      locations={[0, 0.5, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
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
    overflow: 'hidden',
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
