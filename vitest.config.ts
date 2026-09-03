import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    // config.ts 的 url()/base 读取 import.meta.env.BASE_URL（Astro 构建时注入）；
    // node 环境无注入，钉为根路径，保证 config.spec 可测
    'import.meta.env.BASE_URL': '"/"',
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
  },
});