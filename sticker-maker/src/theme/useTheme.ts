import { useColorScheme } from 'react-native';

import { usePreferences } from '../store/preferences';

import { darkTheme, lightTheme, type Theme } from './index';

export function useTheme(): Theme {
  const preference = usePreferences((state) => state.theme);
  const systemScheme = useColorScheme();
  const dark = preference === 'system' ? systemScheme === 'dark' : preference === 'dark';
  return dark ? darkTheme : lightTheme;
}
