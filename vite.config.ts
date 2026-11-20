/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // spessasynth_lib is only reached through a lazy import; pre-bundle it so the dev server
  // doesn't discover it mid-session and reload the page.
  optimizeDeps: { include: ['spessasynth_lib'] },
  test: { environment: 'node' },
});
