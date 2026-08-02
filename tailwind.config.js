/** @type {import('tailwindcss').Config} */

export default {
  // Kein darkMode: die App hat genau ein Erscheinungsbild und keine einzige
  // `dark:`-Variante. Der Schalter suggerierte eine Umschaltung, die es nie gab.
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
      fontFamily: {
        // Nur fuer Ueberschriften und Zahlen, siehe index.css. Der Fliesstext
        // bleibt bei der Systemschrift: die rendert auf iOS besser und kostet
        // nichts.
        display: ['Archivo Variable', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        /*
         * Feldgruen.
         *
         * Drei Farben tragen Bedeutung und duerfen deshalb nirgends dekorativ
         * auftauchen: Limette heisst "jetzt dran", Waldgruen heisst "erledigt",
         * Rot heisst "ausgelassen oder geloescht". Alles andere ist Papier,
         * Tinte und Linie.
         */

        // Der Seitengrund. Frueher lag hier ein Verlauf im Body und `bg-app`
        // war eine Klasse ohne Definition - jetzt gibt es den Ton wirklich.
        app: "#f2f2ef",

        // Flaechen, von eingesenkt bis erhaben. Auf hellem Grund heisst
        // "raised" dunkler getoent, nicht heller - der Name meint die Ebene,
        // nicht die Helligkeit.
        surface: {
          sunken: "#eceded",
          DEFAULT: "#ffffff",
          raised: "#e6e8e4",
          hover: "#dcdfd9",
          // Leisten, die über dem Inhalt kleben (Bottom-Nav, Pausentimer).
          overlay: "rgb(242 242 239 / 0.96)",
          // Dieselben Leisten, wenn der Inhalt sichtbar darunter durchscrollt.
          glass: "rgb(242 242 239 / 0.82)",
        },
        line: {
          DEFAULT: "rgb(12 18 16 / 0.13)",
          strong: "rgb(12 18 16 / 0.22)",
        },
        content: {
          DEFAULT: "#0c1210",
          secondary: "#3b4340",
          // Dunkler als es auf dunklem Grund noetig war: 5,1:1 auf der
          // hellsten Karte, 5,6:1 auf dem Seitengrund.
          muted: "#5c625f",
        },

        /*
         * Die betonte Interaktionsfarbe ist die Tinte, nicht die Limette.
         *
         * Limette funktioniert auf hellem Grund ausschliesslich als Flaeche -
         * als Textfarbe liegt sie bei 1,3:1 und ist schlicht unlesbar. `accent`
         * bleibt deshalb das, was es war (Knopf, Fokusring, Hervorhebung) und
         * wechselt nur den Ton; fuer "jetzt dran" gibt es `highlight`.
         */
        accent: {
          DEFAULT: "#0c1210",
          soft: "#ebedea",
          border: "rgb(12 18 16 / 0.22)",
          contrast: "#f2f2ef",
        },

        // "Jetzt dran". Immer Flaeche, niemals Text.
        highlight: {
          DEFAULT: "#dcf25a",
          soft: "#f1f8cd",
          border: "rgb(29 75 58 / 0.28)",
          contrast: "#0c1210",
        },

        // "Erledigt" - und "Pause abgelaufen, du kannst".
        success: {
          DEFAULT: "#1d4b3a",
          soft: "#e4ede9",
          border: "rgb(29 75 58 / 0.28)",
          contrast: "#eef7f2",
        },

        danger: {
          DEFAULT: "#a52a1d",
          soft: "#f8eae8",
          border: "rgb(165 42 29 / 0.28)",
        },
        warning: {
          DEFAULT: "#8a5200",
          soft: "#f7efe1",
          border: "rgb(138 82 0 / 0.28)",
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
        // Auf hellem Grund traegt ein Schatten die Karte, nicht ein Rahmen.
        soft: "0 10px 26px -16px rgb(12 18 16 / 0.4), 0 1px 0 rgb(255 255 255 / 0.6) inset",
      },
    },
  },
  plugins: [],
};
