export type AppearanceMode = 'system' | 'light' | 'dark';
export type CanvasColorMode = 'light' | 'dark';

export interface VelaPreferences {
  appearance: AppearanceMode;
  canvas: CanvasColorMode;
}

const STORAGE_KEY = 'v-mnh.preferences.v1';

export const DEFAULT_VELA_PREFERENCES: VelaPreferences = {
  appearance: 'system',
  canvas: 'light'
};

export const loadVelaPreferences = (): VelaPreferences => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<VelaPreferences>;
    return {
      appearance: ['system', 'light', 'dark'].includes(parsed.appearance || '')
        ? parsed.appearance as AppearanceMode
        : DEFAULT_VELA_PREFERENCES.appearance,
      canvas: ['light', 'dark'].includes(parsed.canvas || '')
        ? parsed.canvas as CanvasColorMode
        : DEFAULT_VELA_PREFERENCES.canvas
    };
  } catch {
    return DEFAULT_VELA_PREFERENCES;
  }
};

export const saveVelaPreferences = (preferences: VelaPreferences) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
};

export const resolveAppearance = (mode: AppearanceMode, prefersDark: boolean): 'light' | 'dark' =>
  mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
