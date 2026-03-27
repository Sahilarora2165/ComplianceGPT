/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#edf2f7",
        ink: "#0f172a",
        shell: "#081426",
        shellSoft: "#10233b",
        card: "#f8fafc",
        line: "#d6dee8",
        muted: "#5f6b7c",
        accent: "#0f766e",
        accentSoft: "#d9f3f0",
        danger: "#c2410c",
        dangerSoft: "#ffedd5",
        warning: "#a16207",
        warningSoft: "#fef3c7"
      },
      fontFamily: {
        headline: ["Manrope", "sans-serif"],
        body: ["Inter", "sans-serif"]
      },
      boxShadow: {
        panel: "0 18px 42px rgba(15, 23, 42, 0.08)"
      },
      backgroundImage: {
        hero:
          "radial-gradient(circle at top right, rgba(20,184,166,0.15), transparent 35%), linear-gradient(135deg, #0b1a2f 0%, #112747 48%, #153455 100%)"
      }
    }
  },
  plugins: []
};
