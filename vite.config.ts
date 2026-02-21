import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

/**
 * Custom Vite plugin to fix @dynamic-labs/ethereum internal import resolution.
 *
 * The package's `exports` field only exposes `"."` and `"./package.json"`, but
 * its internal `EthereumWalletConnectors.js` (re-exported from the barrel) does
 * a relative import to `./walletConnect/utils/getWalletConnectConnector.js`.
 * Vite 6's strict exports-map enforcement rejects this as a missing subpath,
 * even though the file physically exists on disk. This plugin intercepts that
 * specific resolution and returns the real file path.
 */
function dynamicLabsResolverPlugin() {
  return {
    name: 'fix-dynamic-labs-internal-imports',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      // Only intercept relative imports originating from within @dynamic-labs/ethereum
      if (
        importer &&
        importer.includes('@dynamic-labs/ethereum') &&
        source.includes('walletConnect/utils/getWalletConnectConnector')
      ) {
        return path.resolve(
          __dirname,
          'node_modules/@dynamic-labs/ethereum/src/walletConnect/utils/getWalletConnectConnector.js',
        );
      }
      return null;
    },
  };
}

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
        // Strip the virtual scheme and return a public-dir path
        // so Rollup treats it as resolved (external URL reference).
        const filename = source.slice(FIGMA_PREFIX.length);
        return { id: `/screenshots/${filename}`, external: true };
      }
      return null;
    },
  };
}

/**
 * Workaround for the /public/_redirects directory-vs-file conflict.
 *
 * In the Figma Make sandbox, /public/_redirects is stuck as a directory
 * (cannot be replaced with a flat file via the write_tool). Netlify
 * requires a flat _redirects file at the build root for SPA routing.
 *
 * This plugin writes the correct flat _redirects file into dist/ after
 * the bundle is emitted, overriding whatever Vite copied from /public/.
 */
function netlifyRedirectsPlugin() {
  return {
    name: 'netlify-redirects',
    enforce: 'post' as const,
    async closeBundle() {
      const fs = await import('fs');
      const outDir = path.resolve(__dirname, 'dist');
      const redirectsPath = path.resolve(outDir, '_redirects');

      // Remove the directory artifact if Vite copied it from /public/
      try {
        const stat = fs.statSync(redirectsPath);
        if (stat.isDirectory()) {
          fs.rmSync(redirectsPath, { recursive: true, force: true });
        }
      } catch (_) {
        // Doesn't exist yet — fine
      }

      // Write the flat SPA catch-all redirect file
      fs.writeFileSync(redirectsPath, '/*    /index.html   200\n', 'utf-8');
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // Resolve figma:asset/ imports to /public/screenshots/ paths
    figmaAssetSafetyPlugin(),
    // Fix @dynamic-labs/ethereum internal resolution BEFORE other plugins process it
    dynamicLabsResolverPlugin(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    // Write flat _redirects file for Netlify SPA routing (see plugin comment)
    netlifyRedirectsPlugin(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
      // Polyfill Node.js built-ins for browser compatibility
      // Required by @hashgraph/sdk and @walletconnect/sign-client
      // MUST use absolute path — 'buffer/' alone gets externalized by Vite 6
      buffer: path.resolve(__dirname, 'node_modules/buffer/'),
    },
  },
  define: {
    // Provide process.env for libraries that expect Node.js environment
    'process.env': '{}',
    // Tell Lit (used by @walletconnect/modal) to use production mode
    // More-specific keys take precedence over 'process.env' in Vite's define
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.browser': 'true',
    // Ensure global is available (some WalletConnect/HashConnect code references it)
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer', 'process'],
    esbuildOptions: {
      // Define global for esbuild pre-bundling
      define: {
        global: 'globalThis',
      },
    },
  },

  build: {
    // Production source maps for error tracking (hidden from browser devtools)
    sourcemap: mode === 'production' ? 'hidden' : true,

    // Target modern browsers for smaller output
    target: 'es2020',

    // Increase chunk size warning limit (crypto libs are large)
    chunkSizeWarningLimit: 800,

    // Minification settings
    minify: 'esbuild',

    rollupOptions: {
      output: {
        // Function form is safest — only called for modules Rollup has
        // already resolved into the graph, so no risk of referencing
        // unused or unresolvable packages.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // Radix UI primitives (statically imported across many components)
          if (id.includes('/@radix-ui/')) return 'vendor-radix';

          // Recharts (used in Dashboard, Trading, Wallet)
          if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';

          // React core
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router/')) return 'vendor-react';

          // NOTE: @hashgraph/sdk, @walletconnect/sign-client, and lightweight-charts
          // are already dynamically imported via `await import(...)` in the
          // source code, so Rollup automatically code-splits them into
          // separate async chunks. No need to list them here.
        },

        // Content-hash based filenames for long-term caching
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
}))