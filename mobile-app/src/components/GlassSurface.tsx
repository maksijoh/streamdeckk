import { createContext, useContext, type PropsWithChildren, type ReactNode, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable, type GlassStyle } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import { type AppearancePalette, withAlpha } from '../appearance';

const androidVersion = typeof Platform.Version === 'number' ? Platform.Version : Number.parseInt(String(Platform.Version), 10);
const nativeBlurMethod = Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' as const : undefined;
const BlurTargetContext = createContext<RefObject<View | null> | undefined>(undefined);

export const nativeLiquidGlassAvailable = (() => {
  if (Platform.OS !== 'ios') return false;
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
})();

export function GlassBlurProvider({ children, target }: PropsWithChildren<{ target: RefObject<View | null> }>) {
  return <BlurTargetContext.Provider value={target}>{children}</BlurTargetContext.Provider>;
}

export function useGlassBlurTarget() {
  return useContext(BlurTargetContext);
}

type MaterialProps = {
  palette: AppearancePalette;
  intensity: number;
  effectStyle?: GlassStyle;
  interactive?: boolean;
  fallbackTint?: number;
  borderRadius?: number;
};

export function GlassMaterial({
  palette,
  intensity,
  effectStyle = 'regular',
  interactive = false,
  fallbackTint = 0.16,
  borderRadius = 22,
}: MaterialProps) {
  const blurTarget = useGlassBlurTarget();
  const dark = palette.theme === 'dark';
  const effectiveFallbackTint = Platform.OS === 'android' && androidVersion < 31
    ? Math.max(fallbackTint, 0.38)
    : fallbackTint;

  if (nativeLiquidGlassAvailable) {
    return <GlassView
      pointerEvents="none"
      colorScheme={dark ? 'dark' : 'light'}
      glassEffectStyle={effectStyle}
      isInteractive={interactive}
      tintColor={withAlpha(palette.glass, dark ? 0.24 : 0.14)}
      style={[StyleSheet.absoluteFill, { borderRadius }]}
    />;
  }

  return <>
    <BlurView
      pointerEvents="none"
      tint={dark ? 'dark' : 'light'}
      intensity={intensity}
      blurMethod={blurTarget ? nativeBlurMethod : undefined}
      blurTarget={blurTarget}
      blurReductionFactor={Platform.OS === 'android' ? 2 : 1}
      style={StyleSheet.absoluteFill}
    />
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(palette.glass, effectiveFallbackTint) }]} />
  </>;
}

type SurfaceProps = PropsWithChildren<{
  palette: AppearancePalette;
  style?: StyleProp<ViewStyle>;
  variant?: 'panel' | 'floating' | 'subtle';
}>;

export function GlassSurface({ children, palette, style, variant = 'panel' }: SurfaceProps) {
  const dark = palette.theme === 'dark';
  const opacity = variant === 'subtle' ? (dark ? 0.16 : 0.25) : variant === 'floating' ? (dark ? 0.38 : 0.46) : (dark ? 0.24 : 0.34);
  const intensity = variant === 'subtle' ? 32 : variant === 'floating' ? 62 : 46;
  return <View style={[
    styles.surface,
    variant === 'floating' && styles.floating,
    {
      backgroundColor: nativeLiquidGlassAvailable ? 'transparent' : withAlpha(palette.glass, opacity * 0.34),
      borderColor: nativeLiquidGlassAvailable ? 'transparent' : withAlpha(palette.buttonHighlight, dark ? 0.28 : 0.7),
      shadowColor: palette.shadow,
    },
    style,
  ]}>
    <GlassMaterial
      palette={palette}
      intensity={intensity}
      effectStyle={variant === 'subtle' ? 'clear' : 'regular'}
      fallbackTint={opacity}
      borderRadius={22}
    />
    {!nativeLiquidGlassAvailable && <LinearGradient
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
    />}
    {!nativeLiquidGlassAvailable && <LinearGradient
      pointerEvents="none"
      colors={['transparent', withAlpha(palette.glass, dark ? 0.16 : 0.22)]}
      locations={[0.38, 1]}
      style={StyleSheet.absoluteFill}
    />}
    {!nativeLiquidGlassAvailable && <View pointerEvents="none" style={[styles.topReflection, { backgroundColor: withAlpha(palette.buttonHighlight, dark ? 0.28 : 0.64) }]} />}
    {!nativeLiquidGlassAvailable && <View pointerEvents="none" style={[styles.innerEdge, { borderColor: withAlpha('#FFFFFF', dark ? 0.08 : 0.42) }]} />}
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
        backgroundColor: nativeLiquidGlassAvailable ? 'transparent' : selected ? withAlpha(palette.accent, palette.theme === 'dark' ? 0.18 : 0.12) : withAlpha(palette.glass, palette.theme === 'dark' ? 0.08 : 0.12),
        borderColor: nativeLiquidGlassAvailable ? 'transparent' : selected ? withAlpha(palette.accent, 0.72) : withAlpha(palette.buttonHighlight, palette.theme === 'dark' ? 0.24 : 0.58),
        shadowColor: palette.shadow,
      },
      pressed && styles.controlPressed,
      disabled && styles.disabled,
    ]}
  >
    <GlassMaterial palette={palette} intensity={36} interactive effectStyle="regular" fallbackTint={palette.theme === 'dark' ? 0.2 : 0.3} borderRadius={16} />
    {!nativeLiquidGlassAvailable && <LinearGradient
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
    />}
    {disabled && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(palette.background, 0.46) }]} />}
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
    shadowOpacity: 0.03,
    elevation: 0,
  },
});
