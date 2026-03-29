import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#1a1a1e",
          secondary: "#212125",
          card: "#28282e",
          hover: "#323238",
        },
        accent: {
          DEFAULT: "#a0a0ab",    // silver — matches logo bar
          light: "#c8c8d0",
          blue: "#6b8afd",       // softer blue for interactive states
          green: "#34d399",
          amber: "#fbbf24",
          red: "#f87171",
        },
        border: {
          DEFAULT: "#3a3a42",
          hover: "#4a4a54",
        },
        brand: {
          bar: "#8c8c96",        // the vertical bar from logo
          white: "#ffffff",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        heading: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "card-gradient": "linear-gradient(180deg, #28282e 0%, #212125 100%)",
      },
      boxShadow: {
        "card": "0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.4)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
