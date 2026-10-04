import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Chemins relatifs : les pages sont servies depuis chrome-extension://<id>/.
  base: '',
  plugins: [react()],
  build: {
    target: 'chrome116',
    // Le préchargement de modules de Vite touche à `document`, absent du service worker.
    modulePreload: false,
    rollupOptions: {
      input: {
        panel: at('./panel.html'),
        popup: at('./popup.html'),
        offscreen: at('./offscreen.html'),
        'service-worker': at('./src/background/service-worker.ts'),
      },
      output: {
        // Le manifest pointe sur un nom fixe pour le service worker.
        entryFileNames: (chunk) => (chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
