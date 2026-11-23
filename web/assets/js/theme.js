const THEME_STORAGE_KEY = "dawasmart.theme";
const SUPPORTED_THEMES = new Set(["light", "dark"]);

export function loadTheme() {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return SUPPORTED_THEMES.has(storedTheme) ? storedTheme : "light";
}

export function applyTheme(theme) {
  if (!SUPPORTED_THEMES.has(theme)) {
    throw new Error("Choose a supported appearance theme.");
  }
  document.body.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#111915" : "#f5f8f6",
  );
}

export function saveTheme(theme) {
  if (!SUPPORTED_THEMES.has(theme)) {
    throw new Error("Choose a supported appearance theme.");
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}
