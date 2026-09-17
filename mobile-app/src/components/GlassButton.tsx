import { memo, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import { type AppearancePalette, withAlpha } from '../appearance';
import type { VisualButton } from '../deckLayout';
import { GlassMaterial, nativeLiquidGlassAvailable } from './GlassSurface';

type Props = {
  button: VisualButton | null;
  connected: boolean;
  palette: AppearancePalette;
  size: number;
  onPress: (buttonId: string) => void;
};

function validImageUri(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^(https?:|file:|content:|data:image\/)/i.test(value) ? value : undefined;
}

function GlassButtonComponent({ button, connected, palette, size, onPress }: Props) {
  const [pressDepth] = useState(() => new Animated.Value(0));
  const [pressed, setPressed] = useState(false);
  const [failedImageUri, setFailedImageUri] = useState<string | undefined>();
  const disabled = !button || !connected;
  const dark = palette.theme === 'dark';
  const requestedImageUri = validImageUri(button?.imageUri);
  const imageUri = failedImageUri === requestedImageUri ? undefined : requestedImageUri;
  const icon = button?.icon && Object.hasOwn(Feather.glyphMap, button.icon)
    ? button.icon as keyof typeof Feather.glyphMap
    : 'grid';

  const pressIn = () => {
    setPressed(true);
    pressDepth.stopAnimation();
    Animated.timing(pressDepth, { toValue: 1, duration: 68, useNativeDriver: true }).start();
  };
  const pressOut = () => {
    pressDepth.stopAnimation();
    Animated.spring(pressDepth, { toValue: 0, speed: 28, bounciness: 7, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setPressed(false);
    });
  };

  return <Animated.View style={[
    styles.keyShadow,
    {
      width: size,
      height: size,
      shadowColor: palette.shadow,
      shadowOpacity: pressed ? 0.07 : dark ? 0.48 : 0.24,
      shadowRadius: pressed ? 3 : 9,
      shadowOffset: { width: 0, height: pressed ? 2 : 8 },
      elevation: pressed ? 1 : 8,
      transform: [
        { translateY: pressDepth.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }) },
        { scale: pressDepth.interpolate({ inputRange: [0, 1], outputRange: [1, 0.955] }) },
      ],
    },
  ]}>
    <Pressable
      accessibilityRole={button ? 'button' : undefined}
      accessibilityLabel={button?.label}
      accessibilityState={button ? { disabled: !connected } : undefined}
      accessibilityElementsHidden={!button}
      importantForAccessibility={button ? 'auto' : 'no-hide-descendants'}
      disabled={disabled}
      onPress={() => { if (button) onPress(button.id); }}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={[
        styles.key,
        {
          borderColor: nativeLiquidGlassAvailable ? 'transparent' : withAlpha(palette.buttonHighlight, button ? (dark ? 0.46 : 0.88) : (dark ? 0.14 : 0.38)),
          backgroundColor: nativeLiquidGlassAvailable ? 'transparent' : withAlpha(palette.glass, button ? (dark ? 0.08 : 0.12) : (dark ? 0.04 : 0.08)),
        },
        !button && styles.empty,
        button && !connected && styles.disabled,
      ]}
    >
      {imageUri && <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.image} onError={() => setFailedImageUri(imageUri)} />}
      <GlassMaterial
        palette={palette}
        intensity={button ? 44 : 24}
        effectStyle={button ? 'regular' : 'clear'}
        interactive={!!button}
        fallbackTint={button ? (dark ? 0.28 : 0.36) : (dark ? 0.1 : 0.2)}
        borderRadius={19}
      />
      {!nativeLiquidGlassAvailable && <LinearGradient
        pointerEvents="none"
        colors={[
          withAlpha(palette.buttonHighlight, button ? (dark ? 0.2 : 0.42) : 0.08),
          withAlpha(palette.glass, dark ? 0.05 : 0.1),
          withAlpha(palette.accent, button ? (dark ? 0.07 : 0.045) : 0.02),
        ]}
        locations={[0, 0.46, 1]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={StyleSheet.absoluteFill}
      />}
      {!imageUri && button ? <>
        <View style={[styles.iconHalo, { backgroundColor: withAlpha(palette.accent, dark ? 0.12 : 0.09) }]}>
          <Feather name={icon} size={Math.max(21, Math.min(31, size * 0.31))} color={palette.accent} />
        </View>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.78} style={[styles.label, { color: palette.text, fontSize: Math.max(10, Math.min(13, size * 0.14)) }]}>{button.label}</Text>
      </> : !imageUri && <View style={[styles.emptyMark, { backgroundColor: withAlpha(palette.buttonHighlight, dark ? 0.12 : 0.3) }]} />}

      {imageUri && <View style={[styles.imageLabel, { backgroundColor: withAlpha(dark ? '#050910' : '#FFFFFF', 0.68) }]}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.label, { color: palette.text, fontSize: Math.max(10, Math.min(13, size * 0.14)) }]}>{button?.label}</Text>
      </View>}

      {!nativeLiquidGlassAvailable && <LinearGradient
        pointerEvents="none"
        colors={[
          withAlpha('#FFFFFF', dark ? 0.12 : 0.26),
          'transparent',
          withAlpha(palette.buttonHighlight, dark ? 0.045 : 0.08),
        ]}
        locations={[0, 0.34, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.86 }}
        style={StyleSheet.absoluteFill}
      />}

      {!nativeLiquidGlassAvailable && <Animated.View pointerEvents="none" style={[
        styles.topHighlight,
        {
          backgroundColor: withAlpha(palette.buttonHighlight, dark ? 0.3 : 0.62),
          opacity: pressDepth.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }),
        },
      ]} />}
      {!nativeLiquidGlassAvailable && <View pointerEvents="none" style={[styles.sideReflection, { borderColor: withAlpha('#FFFFFF', dark ? 0.1 : 0.48) }]} />}
      {button && !connected && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(palette.background, 0.48) }]} />}
      <Animated.View pointerEvents="none" style={[
        StyleSheet.absoluteFill,
        styles.recess,
        {
          backgroundColor: dark ? '#000000' : '#53667B',
          opacity: pressDepth.interpolate({ inputRange: [0, 1], outputRange: [0, dark ? 0.2 : 0.1] }),
        },
      ]} />
    </Pressable>
  </Animated.View>;
}

export const GlassButton = memo(GlassButtonComponent);

const styles = StyleSheet.create({
  keyShadow: { borderRadius: 19 },
  key: {
    flex: 1,
    borderRadius: 19,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 7,
    gap: 5,
  },
  empty: { borderStyle: 'solid' },
  disabled: { shadowOpacity: 0.02 },
  image: { position: 'absolute', top: 5, right: 5, bottom: 5, left: 5, borderRadius: 14 },
  iconHalo: { width: '57%', aspectRatio: 1, maxWidth: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  label: { fontWeight: '700', lineHeight: 16, textAlign: 'center', letterSpacing: -0.15 },
  imageLabel: { position: 'absolute', left: 5, right: 5, bottom: 5, minHeight: 23, borderRadius: 9, paddingHorizontal: 5, paddingVertical: 3, justifyContent: 'center' },
  topHighlight: { position: 'absolute', top: 3, left: 12, right: 12, height: 2, borderRadius: 2 },
  sideReflection: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth, borderRadius: 18 },
  recess: { borderRadius: 18 },
  emptyMark: { width: 5, height: 5, borderRadius: 3 },
});
