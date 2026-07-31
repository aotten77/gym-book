/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      screens: {
        // iPhone SE der ersten Generation ist 320px breit - dort passen sechs
        // beschriftete Tabs nicht nebeneinander.
        xs: '360px',
      },
      colors: {
        // Flaechen. Vorher existierten zwoelf Varianten von "Karte auf dunklem
        // Grund" (bg-zinc-950/35 bis /55, bg-white/[0.04] bis [0.07]) - das
        // hier sind die drei, die es tatsaechlich braucht.
        surface: {
          sunken: "rgb(9 9 11 / 0.55)",
          DEFAULT: "rgb(9 9 11 / 0.45)",
          raised: "rgb(255 255 255 / 0.05)",
          hover: "rgb(255 255 255 / 0.09)",
          // Leisten, die über dem Inhalt kleben (Bottom-Nav, Pausentimer,
          // Fokus-Streifen). Deckend genug, dass Text darauf lesbar bleibt,
          // wenn eine Karte darunter durchscrollt.
          overlay: "rgb(9 9 11 / 0.92)",
          // Dieselben Leisten, wenn sie bis an den Geräterand laufen und der
          // Inhalt sichtbar darunter durchscrollen soll: die Deckkraft gibt
          // dem `backdrop-blur` überhaupt erst etwas zu tun, ohne dass Text
          // darauf an Kontrast verliert.
          glass: "rgb(9 9 11 / 0.75)",
        },
        line: {
          DEFAULT: "rgb(255 255 255 / 0.1)",
          strong: "rgb(255 255 255 / 0.18)",
        },
        content: {
          DEFAULT: "#fafafa",
          secondary: "#d4d4d8",
          // zinc-400 statt des bisherigen zinc-500: 6,91:1 auf Karten statt
          // 3,67:1 - erst damit ist WCAG AA (4,5:1) erfuellt.
          muted: "#a1a1aa",
        },
        accent: {
          DEFAULT: "#bef264",
          soft: "rgb(190 242 100 / 0.12)",
          border: "rgb(190 242 100 / 0.3)",
          contrast: "#09090b",
        },
        danger: {
          DEFAULT: "#fda4af",
          soft: "rgb(253 164 175 / 0.1)",
          border: "rgb(253 164 175 / 0.25)",
        },
        warning: {
          DEFAULT: "#fcd34d",
          soft: "rgb(252 211 77 / 0.12)",
        },
      },
      borderRadius: {
        // Eine Skala statt fuenf zufaelliger Werte (24px, 16px, 28px, 32px).
        card: "28px",
        panel: "22px",
        control: "16px",
      },
      minHeight: {
        // Apple HIG und WCAG 2.2: Touch-Ziele mindestens 44x44px.
        touch: "44px",
      },
      minWidth: {
        touch: "44px",
      },
      boxShadow: {
        soft: "0 12px 30px rgb(0 0 0 / 0.28), inset 0 1px 0 rgb(255 255 255 / 0.04)",
      },
    },
  },
  plugins: [],
};
