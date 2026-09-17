import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      // Google's own advertising palette, mapped onto the slots this codebase
      // already uses rather than added alongside them. The point is that
      // `text-ink-500` and `bg-brand-600` keep meaning what they meant — the
      // secondary text colour and the primary action colour — so the whole app
      // moves together instead of screen by screen.
      colors: {
        brand: {
          50: "#e8f0fe", // the pale strip behind announcement banners
          100: "#d2e3fc",
          200: "#aecbfa",
          300: "#8ab4f8",
          400: "#669df6",
          500: "#4285f4",
          600: "#1a73e8", // primary CTA
          700: "#1967d2", // its hover
          800: "#185abc",
          900: "#174ea6",
          950: "#0d2f6b",
        },
        // Deliberately not a linear ramp. The values that carry meaning sit in
        // the slots the app reaches for most: 200 is the border grey, 500 the
        // secondary-text grey, 900 the headline near-black. A tidy ramp would
        // have put a 2.6:1 grey where every caption in the app is rendered.
        ink: {
          50: "#f8f9fa", // page background, row hover
          100: "#e8eaed", // hairlines inside cards
          200: "#dadce0", // control borders
          300: "#bdc1c6",
          400: "#80868b", // column headings, muted icons
          500: "#5f6368", // secondary text
          600: "#4a4e51",
          700: "#3c4043", // body text on controls
          800: "#2e3134",
          900: "#202124", // headlines
          950: "#17181a",
        },
        positive: "#1e8e3e",
        negative: "#d93025",
        caution: "#e37400",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(60,64,67,0.08), 0 1px 3px 1px rgba(60,64,67,0.06)",
        // Google raises a control on hover rather than darkening it much.
        lift: "0 1px 3px 0 rgba(60,64,67,0.30), 0 4px 8px 3px rgba(60,64,67,0.15)",
      },
    },
  },
  plugins: [],
};
export default config;
