import { describe, expect, it } from 'vitest';
import { siteConfig } from '../../src/lib/config';
import {
  ICON_GRID,
  PIXEL_ICONS,
  SKILL_ICONS,
  iconFilledCount,
  iconRuns,
  iconSvgInner,
  type IconName,
} from '../../src/lib/pixel-icons';

const NAMES = Object.keys(PIXEL_ICONS) as IconName[];

describe('数据契约（15×15 矩阵形状）', () => {
  it('每枚图标：恰好 15 行 × 15 字符，charset 只有 # 与 .', () => {
    expect(PIXEL_ICONS.github).toHaveLength(ICON_GRID);
    for (const name of NAMES) {
      for (const row of PIXEL_ICONS[name]) {
        expect(row, `${name} 行宽必须 = ${ICON_GRID}`).toHaveLength(ICON_GRID);
        expect(row, `${name} 只允许 #/. 字符`).toMatch(/^[#.]+$/);
      }
    }
  });

  it('每枚图标既非空板也非满板（有形且有透空）', () => {
    for (const name of NAMES) {
      const filled = iconFilledCount(name);
      expect(filled, `${name} 实心过少`).toBeGreaterThanOrEqual(20);
      expect(filled, `${name} 实心过多（无透空 = 色块）`).toBeLessThan(
        ICON_GRID * ICON_GRID
      );
    }
  });
});

describe('iconRuns（行程合并纯函数）', () => {
  it('确定性：同名恒同输出（构建期可复现，禁随机）', () => {
    for (const name of NAMES) {
      expect(iconRuns(name)).toEqual(iconRuns(name));
    }
  });

  it('与逐格计数互证：runs 宽度和 = 矩阵 # 数；run 全在格内且整数', () => {
    for (const name of NAMES) {
      const fromRows = PIXEL_ICONS[name]
        .join('')
        .split('')
        .filter((c) => c === '#').length;
      const runs = iconRuns(name);
      expect(runs.reduce((s, r) => s + r.w, 0)).toBe(fromRows);
      for (const r of runs) {
        expect(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w)).toBe(
          true
        );
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(ICON_GRID);
        expect(r.y).toBeLessThan(ICON_GRID);
      }
    }
  });

  it('合并正确：同行相邻实心必须并成一个 run（不逐格成节点）', () => {
    // github 第 5 行（y=5）是整行实心：只能有 1 个 run，宽 15
    const fullRow = iconRuns('github').filter((r) => r.y === 5);
    expect(fullRow).toEqual([{ x: 0, y: 5, w: 15 }]);
  });

  it('斜线走阶梯：bilibili 天线斜率 ≈1（每行最多横移 1 格，不出长斜线）', () => {
    // 天线各行实心的左缘 x 逐行推进 ≤1（阶梯 = 像素语言的斜线）
    const rows = [1, 2, 3].map((y) => iconRuns('bilibili').find((r) => r.y === y)!);
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i]!.x - rows[i - 1]!.x)).toBeLessThanOrEqual(1);
    }
  });

  it('阶梯锁（B3 复用新增）：hexagon 外圈斜边 ±1/行', () => {
    // 外圈左缘从 y1 的 5 阶梯收到 y5 的 1：斜边必须逐行推进，不许出长斜线
    const lefts = [1, 2, 3, 4, 5].map(
      (y) => Math.min(...iconRuns('hexagon').filter((r) => r.y === y).map((r) => r.x))
    );
    expect(lefts).toEqual([5, 4, 3, 2, 1]);
  });

  it('阶梯锁（B3 复用新增）：rocket 鳍部斜边 ±1/行', () => {
    // 锥体扩宽段 y6→y9 左缘 5→2：火箭的「斜」也是阶梯，不是直线斜切
    const lefts = [6, 7, 8, 9].map(
      (y) => Math.min(...iconRuns('rocket').filter((r) => r.y === y).map((r) => r.x))
    );
    expect(lefts).toEqual([5, 4, 3, 2]);
  });
});

describe('iconSvgInner（SVG 生成）', () => {
  it('rect 数 = run 数，fill 原样带入，整数坐标', () => {
    for (const name of NAMES) {
      const svg = iconSvgInner(name, 'var(--c-accent)');
      const rects = [...svg.matchAll(/<rect /g)];
      expect(rects).toHaveLength(iconRuns(name).length);
      expect(svg).toContain('fill="var(--c-accent)"');
      // 无小数坐标（像素语言不收半像素）
      expect(svg).not.toMatch(/="\d+\.\d+"/);
    }
  });

  it('fill 参数换色时逐字跟随（主题 token 注入点）', () => {
    expect(iconSvgInner('email', '#fff')).toContain('fill="#fff"');
  });
});

describe('skills 行首映射（B3 复用，2026-10-02 作者指示）', () => {
  it('siteConfig.skills 每一项都有图标，且值是已登记的矩阵', () => {
    for (const skill of siteConfig.skills) {
      const icon = SKILL_ICONS[skill.name];
      expect(icon, `技能「${skill.name}」缺行首图标（SKILL_ICONS 漏登记）`).toBeTruthy();
      expect(
        PIXEL_ICONS[icon as IconName],
        `技能「${skill.name}」→ ${icon} 矩阵缺失`
      ).toBeTruthy();
    }
  });

  it('SKILL_ICONS 每个键都能在 siteConfig.skills 里找到（防改名后留下死键）', () => {
    const names = new Set(siteConfig.skills.map((s) => s.name));
    for (const key of Object.keys(SKILL_ICONS)) {
      expect(names.has(key), `SKILL_ICONS 的键「${key}」在 siteConfig.skills 里不存在`).toBe(
        true
      );
    }
  });

  it('九枚行首图标互不重图（每行一枚独立图形）', () => {
    const values = Object.values(SKILL_ICONS);
    expect(new Set(values).size).toBe(values.length);
  });
});
