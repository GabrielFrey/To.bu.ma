import { Platform } from 'react-native';

export const palette = {
  brand: '#7C5CFF',
  brandDark: '#5B3FD6',
  accent: '#FF5CA8',
  success: '#2ECC71',
  warning: '#F5A623',
  danger: '#FF4D4F',
} as const;

export interface Theme {
  dark: boolean;
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    border: string;
    text: string;
    textMuted: string;
    brand: string;
    brandText: string;
    accent: string;
    danger: string;
    success: string;
    warning: string;
    checkerLight: string;
    checkerDark: string;
  };
}

export const lightTheme: Theme = {
  dark: false,
  colors: {
    background: '#FFFFFF',
    surface: '#F5F5F8',
    surfaceElevated: '#FFFFFF',
    border: '#E4E4EC',
    text: '#12121A',
    textMuted: '#6B6B7B',
    brand: palette.brand,
    brandText: '#FFFFFF',
    accent: palette.accent,
    danger: palette.danger,
    success: palette.success,
    warning: palette.warning,
    checkerLight: '#FFFFFF',
    checkerDark: '#ECECF2',
  },
};

export const darkTheme: Theme = {
  dark: true,
  colors: {
    background: '#0B0B0F',
    surface: '#16161D',
    surfaceElevated: '#1E1E28',
    border: '#2A2A36',
    text: '#F5F5FA',
    textMuted: '#9A9AAE',
    brand: palette.brand,
    brandText: '#FFFFFF',
    accent: palette.accent,
    danger: '#FF6B6D',
    success: palette.success,
    warning: palette.warning,
    checkerLight: '#23232D',
    checkerDark: '#1A1A22',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

/** Minimum size for anything tappable, per the iOS Human Interface Guidelines. */
export const MIN_TOUCH_SIZE = 44;

export const typography = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.3 },
  title: { fontSize: 24, fontWeight: '700' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  callout: { fontSize: 15, fontWeight: '500' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  default: { elevation: 3 },
});
