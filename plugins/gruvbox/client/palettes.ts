// Seed palettes from morhetz/gruvbox: bg0 and fg for the surfaces and text,
// bg1/bg2 for raised and control surfaces, fg4 for muted text, gray for the
// focus ring, and the bright yellow as accent.
export const palettes = {
  light: {
    background: "#fbf1c7",
    foreground: "#3c3836",
    raised: "#ebdbb2",
    control: "#d5c4a1",
    border: "#d5c4a1",
    accent: "#b57614",
    mutedForeground: "#7c6f64",
    ring: "#928374",
  },
  dark: {
    background: "#282828",
    foreground: "#ebdbb2",
    raised: "#3c3836",
    control: "#504945",
    border: "#504945",
    accent: "#fabd2f",
    mutedForeground: "#a89984",
    ring: "#928374",
  },
} as const;
