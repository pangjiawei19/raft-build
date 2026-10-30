export type MermaidRenderTheme = "light" | "dark";

// The opaque SVG document and PNG canvas cannot inherit app CSS variables, and
// Mermaid's colour parser only reads hex/rgb. Keep their literal palettes
// together, each value mirroring a Raft DS token in that mode: background =
// `code` (the diagram's code-block surface), surface = `surface-sunken` (node
// fills), foreground = `ink` (labels and edges), border = `ink-3` composited
// on the code surface (node edges).
export const MERMAID_PALETTES = {
  light: { background: "#ffffff", surface: "#f3f3f3", foreground: "#141111", border: "#6d6b6b" },
  dark: { background: "#0a0c10", surface: "#32322f", foreground: "#e5e5e2", border: "#9e9e9b" },
} as const;
