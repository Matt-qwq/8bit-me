/**
 * `pngjs` 的最小类型声明（2026-09-19）。
 *
 * 为什么自己写而不是装 `@types/pngjs`：`pngjs` 是 **playwright 的传递依赖**
 * （`node_modules/pngjs` 已在，故 `tests/e2e/text-veil.spec.ts` 直接 import 可用），
 * 它没有自带类型，而本站的规矩是**不为测试加直接依赖**（多一个 package.json 条目 =
 * 多一条要跟着 playwright 升级的版本线）。这里只声明我们实际用到的那一小块
 * （`PNG.sync.read` → 像素缓冲），够用且不会漂。
 *
 * 用途：`tests/e2e/text-veil.spec.ts` 要读**截图的真实像素**——这是「computed style
 * 说亮 ≠ 屏幕上亮」那条守线的判据（历史事故：文章页标题被装饰层压到 14% 亮度，
 * 而所有 computed-style 断言当时全绿）。
 */
declare module 'pngjs' {
  export interface PNGData {
    width: number;
    height: number;
    /** RGBA 每像素 4 字节 */
    data: Buffer;
  }
  export const PNG: {
    sync: {
      read(buffer: Buffer): PNGData;
      write(png: PNGData): Buffer;
    };
  };
}
