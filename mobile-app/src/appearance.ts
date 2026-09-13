import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeName = 'light' | 'dark';
export type CustomColorName = 'accent' | 'backgroundTint' | 'glassTint' | 'buttonHighlight';
export type ColorOverrides = Partial<Record<CustomColorName, string>>;

export type AppearancePreferences = {
  theme: ThemeName;
  overrides: Record<ThemeName, ColorOverrides>;
};

export type AppearancePalette = {
  theme: ThemeName;
  background: string;
  accent: string;
  glass: string;
  buttonHighlight: string;
  text: string;
  muted: string;
  danger: string;
  success: string;
  shadow: string;
};

const appearanceKey = 'deckremote.appearance.v1';
const hexPattern = /^#[0-9A-F]{6}$/;
let appearanceQueue: Promise<unknown> = Promise.resolve();

const defaults: Record<ThemeName, Omit<AppearancePalette, 'theme'>> = {
  light: {
    background: '#E8F0F7',
    accent: '#246BFD',
    glass: '#F8FCFF',
    buttonHighlight: '#A9D8FF',
    text: '#14243A',
    muted: '#64758A',
    danger: '#C23C58',
    success: '#16846A',
    shadow: '#60748B',
  },
  dark: {
    background: '#09101B',
    accent: '#70B7FF',
    glass: '#172438',
    buttonHighlight: '#B6DFFF',
    text: '#F3F7FF',
    muted: '#99A9BF',
    danger: '#FF8FA0',
    success: '#63E2BE',
    shadow: '#000000',
  },
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme: 'dark',
  overrides: { light: {}, dark: {} },
};

export const COLOR_PRESETS = [
  '#246BFD', '#70B7FF', '#8B7CFF', '#C471ED', '#FF6B8A',
  '#FF9D57', '#E8C65A', '#55D6BE', '#31B68A', '#F4F7FC',
] as const;

export const COLOR_CONTROLS: readonly { key: CustomColorName; label: string; description: string }[] = [
  { key: 'accent', label: 'Accent', description: 'Status, icons, and active controls' },
  { key: 'backgroundTint', label: 'Background', description: 'The ambient canvas tint' },
  { key: 'glassTint', label: 'Glass', description: 'Panels and key surfaces' },
  { key: 'buttonHighlight', label: 'Highlight', description: 'Reflections along glass edges' },
];

export function normalizeHex(value: string): string | null {
  const compact = value.trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(compact)) {
    return `#${compact.slice(1).split('').map(character => character.repeat(2)).join('')}`;
  }
  return hexPattern.test(compact) ? compact : null;
}

export function withAlpha(hex: string, alpha: number): string {
  const normalized = normalizeHex(hex) ?? '#000000';
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function paletteFor(preferences: AppearancePreferences): AppearancePalette {
  const theme = preferences.theme;
  const override = preferences.overrides[theme];
  const base = defaults[theme];
  return {
    ...base,
    theme,
    background: override.backgroundTint ?? base.background,
    glass: override.glassTint ?? base.glass,
    accent: override.accent ?? base.accent,
    buttonHighlight: override.buttonHighlight ?? base.buttonHighlight,
  };
}

function readOverrides(value: unknown): ColorOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: ColorOverrides = {};
  for (const key of COLOR_CONTROLS.map(control => control.key)) {
    const candidate = source[key];
    if (typeof candidate === 'string') {
      const normalized = normalizeHex(candidate);
      if (normalized) result[key] = normalized;
    }
  }
  return result;
}

export function parseAppearance(raw: string | null): AppearancePreferences {
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_APPEARANCE;
    const source = value as Record<string, unknown>;
    if (source.theme !== 'light' && source.theme !== 'dark') return DEFAULT_APPEARANCE;
    const storedOverrides = source.overrides && typeof source.overrides === 'object' && !Array.isArray(source.overrides)
      ? source.overrides as Record<string, unknown>
      : {};
    return {
      theme: source.theme,
      overrides: {
        light: readOverrides(storedOverrides.light),
        dark: readOverrides(storedOverrides.dark),
      },
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export async function loadAppearance(): Promise<AppearancePreferences> {
  return parseAppearance(await AsyncStorage.getItem(appearanceKey));
}

export async function saveAppearance(preferences: AppearancePreferences): Promise<void> {
  const serialized = JSON.stringify(preferences);
  const next = appearanceQueue.then(() => AsyncStorage.setItem(appearanceKey, serialized));
  appearanceQueue = next.catch(() => undefined);
  await next;
}
