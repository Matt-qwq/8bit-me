import { defineConfig } from '@playwright/test';
import { deterministicFreePortFrom } from './scripts/astro-port.mjs';

/**
 * e2e 冒烟（方案：docs/specs/automated-testing-v1.md）
 * - 测试对象 = dist 产物（npm run preview），最贴近上线物
 * - channel: 'chrome' = 复用系统 Chrome，免下载浏览器（本机路径已确认存在）
 * - 端口 4322 起自动后移（避开作者常在跑的 dev server 与 Windows 排除端口段，
 *   见 scripts/astro-port.mjs —— 4321/4322 曾落在 Hyper-V 保留段导致 EACCES 硬崩）
 * - `npm test` = `npm run build && playwright test`（build 前置复用现有门禁）
 */
// 端口用「纯计算」而非绑定探测：playwright 会在主进程+每个 worker 进程各加载一次配置，
// 探测有副作用（探测端口瞬时占用）会让各进程错位，纯计算则同值（2026-09-03 实踩 4739/4740/4741 错位）。
// baseURL / webServer.url / webServer.env.PORT 必须三处一致；preview.mjs 收到显式 PORT 时原样使用不再重扫。
const PREVIEW_PORT = deterministicFreePortFrom(4322) ?? 4322;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // 限流到 2：默认按 CPU 核数开 worker 会把 astro preview 打到
  // "insufficient memory" 崩掉（bgfx 用例每个主题各起一个 canvas 页），
  // 崩后全量报 ERR_CONNECTION_REFUSED，是非代码问题却让 npm test 变红。
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    channel: 'chrome',
    headless: true,
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    // 失败留证：断言失败时自动留存 trace 与截图（成功时零开销）
    // 2026-08-29 起：此前失败只有一句断言文本 + locator 超时，定位成本高
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    env: { PORT: String(PREVIEW_PORT) },
    // 必须 127.0.0.1 而非 localhost：preview 只绑 IPv4，而 Windows 上 localhost 先解析为 ::1，
    // Chrome 不回退 → ECONNREFUSED（2026-09-03 实踩）
    url: `http://127.0.0.1:${PREVIEW_PORT}`,
    timeout: 30_000,
    reuseExistingServer: false,
  },
});