import { defineConfig } from 'vite';
import { resolve } from 'path';
import { glob } from 'glob';

export default defineConfig({
  root: '.',                        // project root
  publicDir: 'public',              // folder for static assets (CSS, images, data)
  build: {
    outDir: 'dist',                  // output folder
    rollupOptions: {
      // Multi‑page input: include index.html and all HTML files in pages/
      input: Object.fromEntries(
        glob.sync(['index.html', 'pages/**/*.html']).map(file => [
          // Create a unique name for each entry (replace slashes with hyphens)
          file.replace(/\.html$/, '').replace(/\//g, '-'),
          resolve(__dirname, file)
        ])
      ),
      output: {
        // Disable hashing to keep filenames predictable (service worker friendly)
        entryFileNames: 'scripts/[name].js',
        chunkFileNames: 'scripts/[name].js',
        assetFileNames: 'css/[name].[ext]'
      }
    },
  },
  server: {
    port: 3001,
    open: '/index.html',
  },
});