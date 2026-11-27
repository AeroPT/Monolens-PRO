/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        mono: {
          900: '#050505',
          800: '#121212',
          700: '#1f1f1f',
          600: '#333333',
          500: '#555555',
          400: '#888888',
          300: '#aaaaaa',
          100: '#e5e5e5',
          50: '#f5f5f5',
        },
        accent: '#ff3b30',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
