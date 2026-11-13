import type { Page } from '@playwright/test';

/**
 * Open-Meteo mock（ADR-0020「窗外」）：
 * - 主站唯一运行时外部请求必须在 e2e 里拦截——①离线/CI 可跑；②网络失败的
 *   resource error 会打进 console，毒化所有「零报错」断言；③天气码确定性
 *   （想测雨就喂 61，想测雪就喂 71）。
 * - sunrise/sunset 动态取「今天本地 6:12/18:28」（Open-Meteo timezone=auto 的
 *   返回格式就是无 tz 后缀的本地时间），保证 sunAlt 落在真实日弧内。
 */
export async function mockWeather(
  page: Page,
  code = 0,
  isDay = 1,
  /** 覆盖日期（YYYY-MM-DD）——钉假时钟的用例必须与页面时钟同日，否则 sunAlt 会落到夜弧 */
  dayOverride?: string
): Promise<void> {
  const d = new Date();
  const day =
    dayOverride ??
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  await page.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        current: { weather_code: code, is_day: isDay },
        daily: { sunrise: [`${day}T06:12`], sunset: [`${day}T18:28`] },
      }),
    })
  );
}
