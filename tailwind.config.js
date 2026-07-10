/** @type {import('tailwindcss').Config} */

export default {
  darkMode: ["class", '[data-theme="deep-space"]'],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
    },
    extend: {
      colors: {
        // 主题令牌均由 CSS 变量驱动（见 src/index.css），确保切换主题不影响业务数据
        bg: "rgb(var(--rss-bg) / <alpha-value>)",
        surface: "rgb(var(--rss-surface) / <alpha-value>)",
        border: "rgb(var(--rss-border) / <alpha-value>)",
        primary: "rgb(var(--rss-primary) / <alpha-value>)",
        "primary-fg": "rgb(var(--rss-primary-fg) / <alpha-value>)",
        accent: "rgb(var(--rss-accent) / <alpha-value>)",
        muted: "rgb(var(--rss-muted) / <alpha-value>)",
        fg: "rgb(var(--rss-fg) / <alpha-value>)",
        success: "rgb(var(--rss-success) / <alpha-value>)",
        warning: "rgb(var(--rss-warning) / <alpha-value>)",
        danger: "rgb(var(--rss-danger) / <alpha-value>)",
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: "8px",
      },
      boxShadow: {
        soft: "0 1px 3px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.05)",
      },
    },
  },
  plugins: [],
};
