import type { Config } from "tailwindcss";

const config: Config = {
  // Emil 规则：触屏设备点击后 hover 态会粘住。开启后 Tailwind 把所有 `hover:`
  // 变体编译进 @media (hover: hover)，一处配置覆盖全站 hover 样式。
  future: {
    hoverOnlyWhenSupported: true
  },
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}"
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1440px" }
    },
    extend: {
      colors: {
        border: "color-mix(in srgb, var(--semi-color-border) calc(<alpha-value> * 100%), transparent)",
        input: "color-mix(in srgb, var(--semi-color-border) calc(<alpha-value> * 100%), transparent)",
        ring: "color-mix(in srgb, var(--semi-color-primary) calc(<alpha-value> * 100%), transparent)",
        background: "color-mix(in srgb, var(--semi-color-fill-0) calc(<alpha-value> * 100%), transparent)",
        foreground: "color-mix(in srgb, var(--semi-color-text-0) calc(<alpha-value> * 100%), transparent)",
        primary: {
          DEFAULT: "color-mix(in srgb, var(--semi-color-primary) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--semi-color-white) calc(<alpha-value> * 100%), transparent)"
        },
        secondary: {
          DEFAULT: "color-mix(in srgb, var(--semi-color-fill-1) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--semi-color-text-0) calc(<alpha-value> * 100%), transparent)"
        },
        destructive: {
          DEFAULT: "color-mix(in srgb, var(--semi-color-danger) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--semi-color-white) calc(<alpha-value> * 100%), transparent)"
        },
        muted: {
          DEFAULT: "color-mix(in srgb, var(--semi-color-fill-0) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--semi-color-text-2) calc(<alpha-value> * 100%), transparent)"
        },
        accent: {
          DEFAULT: "color-mix(in srgb, var(--semi-color-primary-light-default) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--semi-color-primary-active) calc(<alpha-value> * 100%), transparent)"
        },
        popover: {
          DEFAULT: "color-mix(in srgb, var(--semi-color-bg-3) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--semi-color-text-0) calc(<alpha-value> * 100%), transparent)"
        },
        card: {
          DEFAULT: "color-mix(in srgb, var(--semi-color-bg-0) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--semi-color-text-0) calc(<alpha-value> * 100%), transparent)"
        },
        sidebar: "color-mix(in srgb, var(--semi-color-nav-bg) calc(<alpha-value> * 100%), transparent)",
        hairline: "color-mix(in srgb, var(--semi-color-border) calc(<alpha-value> * 100%), transparent)",
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)"
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["SF Mono", "JetBrains Mono", "ui-monospace", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        "ll-card": "0 1px 2px rgba(12,25,39,0.05), inset 0 1px 0 rgba(255,255,255,0.9)",
        "ll-hover": "0 6px 16px -4px rgba(12,25,39,0.10), 0 2px 4px rgba(12,25,39,0.04)",
        "ll-pop": "0 12px 32px -8px rgba(12,25,39,0.16), 0 4px 8px -2px rgba(12,25,39,0.06)",
        "ll-float": "0 24px 64px -12px rgba(12,25,39,0.24), 0 8px 20px -8px rgba(12,25,39,0.12)",
      }
    }
  }
};

export default config;
