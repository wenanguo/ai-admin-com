import { join } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'vitest-md-raw-loader',
      transform(code, id) {
        if (!id.endsWith('.md')) {
          return null;
        }
        return {
          code: `export default ${JSON.stringify(String(code))};`,
          map: null,
        };
      },
    },
  ],
  resolve: {
    alias: {
      '@': join(__dirname, 'src'),
      '@root': join(__dirname),
      '@@': join(__dirname, 'src', '.umi'),
    },
  },
  // 与 config/config.ts 的 define 对齐：浏览器里没有 process，
  // 构建期（umi）与测试期（vitest）都把它替换成字面量。
  define: {
    'process.env.AI_API_BASE_URL': JSON.stringify(
      process.env.AI_API_BASE_URL || '/ai-api',
    ),
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
      // ⚠️ 视口要按**桌面宽**来（默认是 414x896 的手机宽）：
      //    AI 工作台的侧栏带 `breakpoint="xl"`（1200px）⇒ 窄于它时侧栏会自动收起。
      //    单测要验的是「展开时 400px / 折叠时 40px」，
      //    用手机宽跑的话侧栏一挂上就自己折起来了，测不到展开态。
      viewport: { width: 1440, height: 900 },
    },
    globals: true,
    setupFiles: ['./tests/setupTests.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.umi'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/.umi/**',
        'src/.umi-test/**',
        'src/.umi-production/**',
        'src/services/demo/**',
        'src/**/*.d.ts',
        'src/**/index.style.ts',
      ],
    },
    passWithNoTests: true,
    testTimeout: 15000,
  },
});
