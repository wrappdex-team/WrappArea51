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

  // ────────────────────────────────────────────────────────────────────────────
  // Development-only CSP relaxation
  // This header is ONLY injected by `npm run dev` (Vite dev server).
  // The production <meta http-equiv="Content-Security-Policy"> in index.html
  // remains strict forever and contains ZERO localhost / http entries.
  // When you deploy a real resolver (https://resolver.yourdomain.com), add its
  // origin to the meta tag in index.html and remove the localhost lines below.
  // ────────────────────────────────────────────────────────────────────────────
  server: mode === 'development' ? {
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://changenow.io https://quantifycrypto.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://app.dynamic.xyz",
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:",
        "img-src 'self' data: blob: https://t2.gstatic.com https://ehmlclowiedoqncymegi.supabase.co https://assets.coingecko.com https://coin-images.coingecko.com https://www.saucerswap.finance https://tokens.1inch.io https://s2.coinmarketcap.com https://changenow.io https://app.dynamic.xyz https://iconic.dynamic-static-assets.com https://dynamic-static-assets.com https://quantifycrypto.com https://www.quantifycrypto.com https://*.quantifycrypto.com https://lcw.nyc3.cdn.digitaloceanspaces.com https://*.digitaloceanspaces.com https://*.livecoinwatch.com https://explorer-api.walletconnect.com https://explorer.walletconnect.com https://images.unsplash.com https://avatars.githubusercontent.com https://www.google.com https://altlantis.io",
        "connect-src 'self' http://localhost:4000 ws://localhost:4000 http://127.0.0.1:4000 ws://127.0.0.1:4000 https://wrapparea51-production.up.railway.app https://ehmlclowiedoqncymegi.supabase.co https://api.saucerswap.finance https://api.alternative.me https://api.coingecko.com https://api.coincap.io https://rest.coincap.io https://api.binance.com https://mainnet-data-staging.bonzo.finance https://mainnet-public.mirrornode.hedera.com https://testnet.mirrornode.hedera.com https://mainnet.hashio.io https://testnet.hashio.io https://mainnet.mirror.hedera.com https://testnet.mirror.hedera.com https://testnet.hgraph.io https://*.hgraph.io https://testnet.hedera.api.hgraph.io https://ethereum-rpc.publicnode.com https://rpc.ankr.com https://cloudflare-eth.com https://eth.llamarpc.com https://1rpc.io https://polygon-rpc.com https://bsc-dataseed1.binance.org https://arb1.arbitrum.io wss://relay.walletconnect.org https://relay.walletconnect.org wss://relay.walletconnect.com https://relay.walletconnect.com https://echo.walletconnect.com https://pulse.walletconnect.com https://rpc.walletconnect.org https://verify.walletconnect.com https://verify.walletconnect.com https://explorer-api.walletconnect.com https://app.dynamic.xyz https://app.dynamicauth.com https://dynamic-static-assets.com https://iconic.dynamic-static-assets.com https://relay.farcaster.xyz https://quantifycrypto.com https://*.quantifycrypto.com https://api.dexscreener.com https://api.etherscan.io https://api-goerli.etherscan.io https://api-sepolia.etherscan.io https://api.polygonscan.com https://api.bscscan.com https://api.basescan.org https://api.arbiscan.io",
        "frame-src https://changenow.io https://app.hashport.network https://studio.squidrouter.com https://verify.walletconnect.com",
        "worker-src blob:"
      ].join('; ') + ';'
    }
  } : undefined,

  assetsInclude: ['**/*.svg', '**/*.csv'],
}))