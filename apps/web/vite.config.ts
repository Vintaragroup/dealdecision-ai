
  import { defineConfig } from 'vitest/config';
  import react from '@vitejs/plugin-react-swc';
  import path from 'path';
  import fs from 'fs';

  // ---------------------------------------------------------------------------
  // Build fingerprint — injected via Vite's standard VITE_* env injection.
  // Only reads env vars; no execSync / git CLI calls (brittle in CI containers).
  // Priority: VITE_BUILD_SHA env var > RENDER_GIT_COMMIT (Render auto-injects) > 'unknown'.
  // ---------------------------------------------------------------------------
  const _buildSha = (
    process.env.VITE_BUILD_SHA ??
    (process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : undefined) ??
    'unknown'
  ).trim();
  const _buildTime = (process.env.VITE_BUILD_TIME ?? 'unknown').trim();
  const _appEnv = (process.env.VITE_APP_ENV ?? process.env.NODE_ENV ?? 'development').trim();

  // Assign back so Vite picks them up through its normal VITE_* injection path.
  process.env.VITE_BUILD_SHA = _buildSha;
  process.env.VITE_BUILD_TIME = _buildTime;
  process.env.VITE_APP_ENV = _appEnv;

  const isDocker = fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
  if (isDocker && !process.env.BROWSER) {
    // Prevent Vite from trying to spawn xdg-open in containers.
    process.env.BROWSER = 'none';
  }

  const appBasenameRewritePlugin = () => ({
    name: 'dealdecision-app-basename-rewrite',
    configureServer(server: any) {
      server.middlewares.use((req: any, _res: any, next: any) => {
        const url = req.url ?? '';
        if (url === '/app' || url.startsWith('/app/')) {
          const hasExtension = /\.[a-zA-Z0-9]+($|\?)/.test(url);
          const isViteInternal = url.startsWith('/app/@') || url.startsWith('/app/__') || url.startsWith('/app/@fs');
          if (!hasExtension && !isViteInternal) {
            req.url = '/';
          }
        }
        next();
      });
    },
  });

  export default defineConfig({
    plugins: [appBasenameRewritePlugin(), react()],
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
      alias: {
        'vaul@1.1.2': 'vaul',
        'sonner@2.0.3': 'sonner',
        'recharts@2.15.2': 'recharts',
        'react-resizable-panels@2.1.7': 'react-resizable-panels',
        'react-hook-form@7.55.0': 'react-hook-form',
        'react-day-picker@8.10.1': 'react-day-picker',
        'next-themes@0.4.6': 'next-themes',
        'lucide-react@0.487.0': 'lucide-react',
        'input-otp@1.4.2': 'input-otp',
        'embla-carousel-react@8.6.0': 'embla-carousel-react',
        'cmdk@1.1.1': 'cmdk',
        'class-variance-authority@0.7.1': 'class-variance-authority',
        '@radix-ui/react-tooltip@1.1.8': '@radix-ui/react-tooltip',
        '@radix-ui/react-toggle@1.1.2': '@radix-ui/react-toggle',
        '@radix-ui/react-toggle-group@1.1.2': '@radix-ui/react-toggle-group',
        '@radix-ui/react-tabs@1.1.3': '@radix-ui/react-tabs',
        '@radix-ui/react-switch@1.1.3': '@radix-ui/react-switch',
        '@radix-ui/react-slot@1.1.2': '@radix-ui/react-slot',
        '@radix-ui/react-slider@1.2.3': '@radix-ui/react-slider',
        '@radix-ui/react-separator@1.1.2': '@radix-ui/react-separator',
        '@radix-ui/react-select@2.1.6': '@radix-ui/react-select',
        '@radix-ui/react-scroll-area@1.2.3': '@radix-ui/react-scroll-area',
        '@radix-ui/react-radio-group@1.2.3': '@radix-ui/react-radio-group',
        '@radix-ui/react-progress@1.1.2': '@radix-ui/react-progress',
        '@radix-ui/react-popover@1.1.6': '@radix-ui/react-popover',
        '@radix-ui/react-navigation-menu@1.2.5': '@radix-ui/react-navigation-menu',
        '@radix-ui/react-menubar@1.1.6': '@radix-ui/react-menubar',
        '@radix-ui/react-label@2.1.2': '@radix-ui/react-label',
        '@radix-ui/react-hover-card@1.1.6': '@radix-ui/react-hover-card',
        '@radix-ui/react-dropdown-menu@2.1.6': '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-dialog@1.1.6': '@radix-ui/react-dialog',
        '@radix-ui/react-context-menu@2.2.6': '@radix-ui/react-context-menu',
        '@radix-ui/react-collapsible@1.1.3': '@radix-ui/react-collapsible',
        '@radix-ui/react-checkbox@1.1.4': '@radix-ui/react-checkbox',
        '@radix-ui/react-avatar@1.1.3': '@radix-ui/react-avatar',
        '@radix-ui/react-aspect-ratio@1.1.2': '@radix-ui/react-aspect-ratio',
        '@radix-ui/react-alert-dialog@1.1.6': '@radix-ui/react-alert-dialog',
        '@radix-ui/react-accordion@1.2.3': '@radix-ui/react-accordion',
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      target: 'esnext',
      outDir: 'build',
    },
    server: {
      port: 5173,
      host: true,
      open: false,
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      globals: true,
    },
  });