/** @type {import('tailwindcss').Config} */
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["Sora", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        // Escala neutra que cambia con el tema (claro / oscuro / océano).
        slate: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => [n, v(`s${n}`)])),
        brand: {
          50: "#eef6ff", 100: "#d9eaff", 200: "#b9d6ff", 300: "#8bbcff",
          400: "#4f93f5", 500: "#2b72e6", 600: "#1d5fd0", 700: "#174ca8",
          800: "#133b80", 900: "#0e2b5e", 950: "#081d42",
        },
        cyan2: { 300: "#7ee3ff", 400: "#38d0f7", 500: "#14b8e6" },
      },
      boxShadow: {
        soft: "0 1px 2px rgb(8 29 66 / .06), 0 8px 24px -12px rgb(8 29 66 / .18)",
        glow: "0 0 0 1px rgb(56 208 247 / .35), 0 8px 30px -8px rgb(56 208 247 / .45)",
      },
      keyframes: {
        rise: { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "none" } },
        pop: { "0%": { opacity: 0, transform: "scale(.94)" }, "100%": { opacity: 1, transform: "none" } },
      },
      animation: { rise: "rise .35s ease backwards", pop: "pop .18s ease both" },
    },
  },
  plugins: [],
}
