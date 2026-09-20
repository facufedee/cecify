import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Pila tipografica del sistema, la misma que usa Instagram en la web
        ig: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        // Paleta del muro (estilo Instagram) para que resulte familiar
        ig: {
          text: '#262626',
          muted: '#737373',
          border: '#dbdbdb',
          soft: '#efefef',
          link: '#0095f6',
          like: '#ff3040',
        },
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
