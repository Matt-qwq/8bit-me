export type SocialLinkType = 'email' | 'url';

export interface SocialLink {
  /** email → mailto:；url → 直接外链（新标签页） */
  type: SocialLinkType;
  /** 展示名 */
  label: string;
  /** value 留空则不在页面渲染 */
  value: string;
}

/**
 * 站点配置（config-driven）
 * - 站外链接留空即隐藏（GitHub / Email 已配置，bilibili 为默认值）
 * - 文案中文为主，专业术语保留英文（CONTEXT.md 语言约定）
 */
export const siteConfig = {
  title: '8bit-me',
  tagline: '自动化与数据工程的实践记录',
  description:
    '8bit-me —— Matt 的工程化方法论作品集：AI 辅助的 RPA 迁移 / Python 数据管道 / 黑盒逆向实战，配一个纯像素 8-bit 实验场。',
  author: 'Matt',

  /** 站外链接（social links）：value 留空则不在页面渲染 */
  social: [
    { type: 'url', label: 'GitHub', value: 'https://github.com/Matt-qwq' },
    { type: 'email', label: 'Email', value: '2986108228@qq.com' },
    {
      type: 'url',
      label: 'bilibili',
      value: 'https://space.bilibili.com/408078794',
    },
  ] satisfies SocialLink[],

  /** 首页五个 section 的锚点导航 */
  nav: [
    { label: '首页', href: '#window' },
    { label: '关于', href: '#about' },
    { label: '作品', href: '#projects' },
    { label: '技能', href: '#skills' },
    { label: '联系', href: '#contact' },
  ],

  /** 作品集（projects）数据 */
  projects: [
    {
      name: 'RPA 迁移方法论',
      description:
        '跨多实例存量流程从无代码平台迁到自研 Python 体系的工程方法论：HAR 协议为唯一事实源、保存后反查、Fast Failed、公共层收敛重复、统一构建 CLI。',
      tags: ['RPA', 'Python', '方法论'],
      url: '/blog/2026-08-29-rpa-migration-methodology',
    },
    {
      name: '数据管道平台',
      description:
        '跨投放平台数据管道的核心防线：三层风控把「像人」拆成身份、行为、算法三层攻防，只增不改的分层数仓守住数据可信。取数与节奏等环节的深度拆解见博客数据管道系列。',
      tags: ['Python', '反爬', '风控', '数据管道'],
      url: '/blog/2026-08-31-anti-scraping-risk-control',
    },
    {
      name: '黑盒逆向工具链',
      description:
        '授权范围内无文档内部系统的逆向打法——接口与协议还原：前端 JS 静态解剖、运行时双层探针、HAR 全量对账、本地 OCR/VLM 视觉兜底——把黑盒变成可写可验的体系。',
      tags: ['逆向工程', 'HAR', 'OCR', 'VLM'],
      url: '/blog/2026-08-29-reversing-unknown-internal-systems',
    },
    {
      name: 'plasma wallpaper engine',
      description:
        'KDE Plasma 6 视频壁纸插件：byte-level 逆向 Steam 创意工坊场景包（PKGV 容器 + 纹理链），QtMultimedia / QtWebEngine / 自研 QSGRenderNode 三条渲染管线，Python 离线烘焙 + C++ 消费的渲染契约。',
      tags: ['C++', 'Qt', '逆向工程', 'KDE'],
      url: '/blog/2026-08-29-plasma-wallpaper-engine-reversing',
    },
    {
      name: '8bit-me',
      description:
        '本站 —— Astro + TypeScript 静态站点，GB 绿 palette 贯穿全站；整体工程复盘见博客长文。',
      tags: ['Astro', 'TypeScript', '8-bit'],
      url: '/blog/2026-08-27-8bit-me-v2-refactor-notes',
    },
    {
      name: 'v2 experiments',
      description:
        '8-bit 实验二期：hero canvas 背景动画（bg-fx 六模式 + 音画脉冲）与游戏化彩蛋（Konami 作弊码 / 404 迷你游戏）——本页即 demo。',
      tags: ['canvas', 'Web Audio', 'easter egg'],
      url: '',
    },
  ],

  /** 技能履历（skills）—— 像素条按 0-5 档展示 */
  skills: [
    { name: 'Python', level: 4 },
    { name: 'UI 自动化（RPA）', level: 4 },
    { name: 'AI 辅助开发', level: 3 },
    { name: 'TypeScript', level: 4 },
    { name: 'Astro', level: 4 },
    { name: 'Node.js', level: 3 },
    { name: 'Web Audio API', level: 3 },
    { name: 'Git', level: 4 },
    { name: 'CI', level: 3 },
  ],
};

/** base 感知路径：兼容 GitHub Pages 子路径部署（astro.config 的 base） */
export const base = import.meta.env.BASE_URL;
export const url = (path: string) => `${base}${path.replace(/^\/+/, '')}`;

/**
 * 「窗外」世界的天气城市（ADR-0020）：全世界访客看到的都是**作者窗外**。
 * 广州塔（海珠区，珠江南岸）坐标；搬家改这一处即可。
 * - timezone: 'auto' = Open-Meteo 按坐标自动判时区（API 参数）
 * - tz: hero 实况读数行显示用的 IANA 时区
 */
export const siteWeather = {
  lat: 23.1066,
  lon: 113.3245,
  label: 'GUANGZHOU',
  timezone: 'auto',
  tz: 'Asia/Shanghai',
} as const;