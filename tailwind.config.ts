import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          DEFAULT: "#4A7C59",
          dark: "#3D6849",
          soft: "#E6EFE8",
        },
        cream: {
          DEFAULT: "#F5EFE0",
          dark: "#EBE3CF",
        },
      },
    },
  },
  plugins: [],
};
export default config;
