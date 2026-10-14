import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: {
  // Bound concurrent PGlite/DOM workers to avoid CPU and memory starvation on Windows.
  maxWorkers: 3,
  include: ['tests/**/*.test.{js,jsx}'],
  // Local tests must never connect to a configured production Supabase project.
  env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
} });
