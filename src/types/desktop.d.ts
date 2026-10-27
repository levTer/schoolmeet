interface Window {
  eduflowDesktop?: {
    isDesktop?: boolean;
    platform?: string;
    setTheme?: (themeColors: { backgroundColor: string; symbolColor: string }) => void;
  };
}
