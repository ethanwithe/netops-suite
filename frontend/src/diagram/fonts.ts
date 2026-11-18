/** Tipos de letra del editor. Se ven igual en el PowerPoint (mismo nombre); en el PDF se usa la familia más parecida. */
export const FONTS: { name: string; css: string }[] = [
  { name: "Arial", css: "Arial, Helvetica, sans-serif" },
  { name: "Calibri", css: 'Calibri, Carlito, "Liberation Sans", Arial, sans-serif' },
  { name: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { name: "Trebuchet MS", css: '"Trebuchet MS", Tahoma, sans-serif' },
  { name: "Tahoma", css: "Tahoma, Geneva, sans-serif" },
  { name: "Impact", css: "Impact, Haettenschweiler, sans-serif" },
  { name: "Times New Roman", css: '"Times New Roman", Times, serif' },
  { name: "Georgia", css: "Georgia, serif" },
  { name: "Courier New", css: '"Courier New", Courier, monospace' },
  { name: "Consolas", css: "Consolas, Menlo, monospace" },
];
export const fontCss = (name?: string) => FONTS.find((f) => f.name === name)?.css ?? "Arial, Helvetica, sans-serif";

/** Estilos de texto rápidos (como «Título», «Subtítulo»… en Word). */
export const TEXT_PRESETS: { name: string; patch: { size: number; bold: boolean; italic: boolean; color: string; font?: string } }[] = [
  { name: "Título", patch: { size: 40, bold: true, italic: false, color: "#0B2A5B" } },
  { name: "Subtítulo", patch: { size: 28, bold: true, italic: false, color: "#1F4E9C" } },
  { name: "Cuerpo", patch: { size: 18, bold: false, italic: false, color: "#000000" } },
  { name: "Etiqueta", patch: { size: 14, bold: true, italic: false, color: "#333333" } },
  { name: "Nota", patch: { size: 12, bold: false, italic: true, color: "#666666" } },
];
