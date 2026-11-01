/** @type {import('tailwindcss').Config} */

// Finora design tokens. Flat and minimal: ink and grey surfaces, one solid iris accent, mint for
// gains and coral for losses. Dark by default; the light theme uses the same scales.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Manrope Variable"', '"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Iris: the brand accent. 500–700 for fills, 300 for text on dark, 600–700 for text on light.
        primary: {
          50: '#EEF0FF', 100: '#E0E3FF', 200: '#C7CAFF', 300: '#A6A8FD', 400: '#8B86F9',
          500: '#7466F1', 600: '#6249E3', 700: '#533AC8', 800: '#4530A2', 900: '#3A2C80', 950: '#231A4B',
        },
        // Ink neutrals with a hint of blue; 900/950 are the dark surfaces.
        neutral: {
          50: '#F6F6FA', 100: '#EDEDF3', 200: '#E0E0EA', 300: '#C8C8D6', 400: '#9A9AAD',
          500: '#707084', 600: '#525266', 700: '#353547', 800: '#1F1F2C', 900: '#14141D', 950: '#0B0B12',
        },
        success: {
          50: '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7', 400: '#3DDC97',
          500: '#1FC27E', 600: '#109E65', 700: '#0B7D51', 800: '#0A6342', 900: '#094F36', 950: '#032C1E',
        },
        error: {
          50: '#FFF1F1', 100: '#FFE0E0', 200: '#FFC5C5', 300: '#FF9D9D', 400: '#FF6B6B',
          500: '#F04A4A', 600: '#D63333', 700: '#B32626', 800: '#942323', 900: '#7A2222', 950: '#420D0D',
        },
        warning: {
          50: '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D', 400: '#FBBF24',
          500: '#F59E0B', 600: '#D97706', 700: '#B45309', 800: '#92400E', 900: '#78350F', 950: '#451A03',
        },
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        '4xl': '2rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(10,10,13,0.04), 0 10px 30px -14px rgba(10,10,13,0.18)',
        glow: '0 1px 2px rgba(16,16,24,0.12)',
        float: '0 20px 50px -18px rgba(0,0,0,0.65)',
      },
      animation: {
        'slide-up': 'slideUp 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fadeIn 0.25s ease-out',
        rise: 'rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'pop-in': 'popIn 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(24px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        rise: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        popIn: {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
