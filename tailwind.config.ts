import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        "border-2": "var(--border-2)",
        text: "var(--text)",
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
        gold: "var(--gold)",
        "gold-dim": "var(--gold-dim)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        shimmer: "shimmer 1.5s infinite",
        "pulse-gold": "pulse-gold 2s infinite",
        "slide-in": "slide-in-right 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
