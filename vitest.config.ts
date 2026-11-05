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
      // ⚠️ **全局视口是手机宽**（414×896）：仓库里大量单测断言的是
      //    **窄屏**下的行为（表单塔成「一行一个字段」、侧栏让位等等）。
      //    把全局视口改成桌面宽会把这些覆盖**静默地**去掉。
      //
      //    需要**宽视口**的测试文件自己声明（`page.viewport(1440, 900)`），
      //    例如 AI 工作台的布局外壳（它要验「展开时 400px」，
      //    而侧栏带 `breakpoint="xl"`（1200px）⇒ 窄于它时 antd 会自动收起）。
      viewport: { width: 414, height: 896 },
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
