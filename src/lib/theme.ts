export const THEME_STORAGE_KEY = "schoolmeet-theme";
export const DEFAULT_THEME = "emerald" as const;

export const THEME_OPTIONS = [
  {
    id: "emerald",
    label: "Изумрудный лес",
    accent: "#2EDB9C",
    background: "#061F17",
  },
  {
    id: "cyber",
    label: "Глубокий космос",
    accent: "#9A3E85",
    background: "#1B0773",
  },
  {
    id: "ocean",
    label: "Морской бриз",
    accent: "#25C4B4",
    background: "#837FB8",
  },
  {
    id: "mint",
    label: "Мятный сланец",
    accent: "#3BD2B1",
    background: "#436F67",
  },
] as const;

export type ThemeId = (typeof THEME_OPTIONS)[number]["id"];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_OPTIONS.some((theme) => theme.id === value);
}

export function getThemeOption(themeId: ThemeId) {
  return THEME_OPTIONS.find((theme) => theme.id === themeId) ?? THEME_OPTIONS[0];
}
