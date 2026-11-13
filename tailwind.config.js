/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ['"Segoe UI"', "system-ui", "-apple-system", "Roboto", "sans-serif"] },
      colors: {
        brand: { 50: "#eef6f8", 100: "#d5e8ed", 500: "#2b7a8c", 600: "#1f6373", 700: "#184f5c", 900: "#0f323b" },
      },
    },
  },
  plugins: [],
};
