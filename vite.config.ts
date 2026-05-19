import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'



/**
 * Safety-net plugin for `figma:asset/` imports.
 *
 * The `figma:asset/…` virtual scheme only works inside Figma Make's dev
 * server. In production builds (Vercel, Railway, Netlify) Rollup cannot
 * resolve it and the build crashes.
 *
 * This plugin intercepts those imports and rewrites them to paths under
 * `/public/screenshots/` (served at `/screenshots/` by Vite).
 * If the referenced file doesn't exist the image simply won't load at
 * runtime — which is a soft failure instead of a hard build crash.
 */
function figmaAssetSafetyPlugin() {
  const FIGMA_PREFIX = 'figma:asset/';
  return {
    name: 'figma-asset-safety',
    enforce: 'pre' as const,
    resolveId(source: string) {
      if (source.startsWith(FIGMA_PREFIX)) {
        const filename = source.slice(FIGMA_PREFIX.length);
        return { id: `/screenshots/${filename}`, external: true };
      }
      return null;
    },
  };
}

/* 
 * netlifyRedirectsPlugin has been disabled (commented out) to fix the 
 * "no such file or directory, open dist/_redirects" error on Vercel.
 * This is safe because we are using Vercel (not Netlify) and already have 
 * vercel.json for SPA routing.
 */
function netlifyRedirectsPlugin() {
  return {
    name: 'netlify-redirects',
    enforce: 'post' as const,
    async closeBundle() {
      const fs = await import('fs');
      const outDir = path.resolve(__dirname, 'dist');
      const redirectsPath = path.resolve(outDir, '_redirects');

      try {
        const stat = fs.statSync(redirectsPath);
        if (stat.isDirectory()) {
          fs.rmSync(redirectsPath, { recursive: true, force: true });
        }
      } catch (_) {}

      fs.writeFileSync(redirectsPath, '/*    /index.html   200\n', 'utf-8');
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    figmaAssetSafetyPlugin(),
    react(),
    tailwindcss(),
    // netlifyRedirectsPlugin() ← DISABLED to fix build error
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '/utils': path.resolve(__dirname, './utils'),
      buffer: path.resolve(__dirname, 'node_modules/buffer/'),
    },
  },
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.browser': 'true',
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer', 'process', '@hashgraph/sdk', 'react-dom/client'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },

  build: {
    sourcemap: mode === 'production' ? 'hidden' : true,
    target: 'es2020',
    chunkSizeWarningLimit: 800,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('/@radix-ui/')) return 'vendor-radix';
          if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router/')) return 'vendor-react';
          if (id.includes('/@hashgraph/') || id.includes('/@hiero-ledger/') || id.includes('/long/')) return 'vendor-hedera';
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  assetsInclude: ['**/*.svg', '**/*.csv'],
}))