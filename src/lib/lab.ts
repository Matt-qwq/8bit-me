/**
 * /lab 交互式图册 —— 数据层（纯数据，无 IO，故可直接单测）
 *
 * 与文章侧的分工（2026-09-11 更新，见 ADR-0019）：
 *   文章侧 = markdown 里直接写的 ```flow **字符逻辑图**，随主题变色、零 JS、可断言
 *   lab   = **构建期外的独立产物**（archify 交互式 viewer），带 pan/zoom/搜索/导出
 *
 * 两者不是替代关系：正文的图要「跟着论述走、读完即走」，lab 要「动手转一转」。
 * 同一份内容两种讲法，各自用对的媒介（见 ADR-0016）。
 *
 * 产物契约：每个 id 必须在 public/lab/<id>.html 真实存在。
 * 这条由 tests/unit/lab.spec.ts 用 node:fs 守——「引用指向不存在的东西」不需要浏览器。
 */
export interface LabDiagram {
  /** 同时是产物文件名：public/lab/<id>.html */
  id: string;
  /** 中文标题（图册是给人看的，标题用中文；图内术语保留英文） */
  title: string;
  /** 一句话说明「转什么、看什么」 */
  summary: string;
  /** 关联文章 slug（可空：纯工具类图没有对应文章） */
  post?: string;
  tags: string[];
}

export const LAB_DIAGRAMS: LabDiagram[] = [
  {
    id: 'warehouse-layers',
    title: '分层数仓 · 自下而上',
    summary:
      '源库到报表的五层管道：每层都能交代来历，重跑不改历史。可拖动、缩放、按层聚焦，看每条边上注明的「这一跳做了什么」。',
    post: '2026-09-04-immutable-data-warehouse',
    tags: ['data warehouse', 'pipeline', 'idempotent'],
  },
  {
    id: 'rpa-migration',
    title: '跨实例迁建 · 单向流水线',
    summary:
      '存量 xbot 流程到公共层的五段流水线，每段都标出它的产物与那条纪律（不重构 · 映射失败必抛错 · 快失败 · 要么对要么报错 · 固定提交顺序）。可拖动、缩放、按段聚焦。',
    post: '2026-08-29-rpa-migration-methodology',
    tags: ['RPA', 'migration', 'engineering discipline'],
  },
];

/** 按 id 取图；找不到返回 undefined（页面据此走 404，不静默渲染空壳） */
export function findLabDiagram(id: string): LabDiagram | undefined {
  return LAB_DIAGRAMS.find((d) => d.id === id);
}

/** 产物路径（生成站内链接用；调用方负责套 url() 拿 base） */
export function artifactPath(id: string): string {
  return `lab/${id}.html`;
}
