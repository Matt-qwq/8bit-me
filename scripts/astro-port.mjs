/**
 * 端口挑选器：避开 Windows 排除端口段与已占用端口。
 *
 * 背景：Hyper-V/WSL 会保留连续的动态端口段，且常为连片大段
 * （实测 4239–4738 五个 100 端口块首尾相接，吞掉 4321/4322），
 * 段内端口绑定返回 WSAEACCES（Node 报 EACCES 而非 EADDRINUSE），
 * 而 Vite/Astro 只对 EADDRINUSE 做"换端口重试"，EACCES 直接重抛导致 dev 硬崩。
 * 所以启动前先真实绑定一次挑端口，选中的端口传给 astro dev/preview。
 *
 * 用法：
 *   node scripts/astro-port.mjs [seed]      → 打印首个可绑定端口（先试 seed，失败则按 netsh 排除段跳段）
 *   node scripts/astro-port.mjs --check P   → 检查单个端口，可用退出 0
 * 另：`scanFreePort()`（绑定探测，单进程用）与 `deterministicFreePortFrom()`
 * （纯计算，多进程同值，playwright 配置用）均可被 TS/ESM import。
 */
import net from 'node:net';
import { execSync } from 'node:child_process';

const HOST = '127.0.0.1';

/** 尝试真实绑定 127.0.0.1:port 一次；返回 { ok, code }。绑定成功即销毁监听。 */
function tryBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => resolve({ ok: false, code: e.code }));
    srv.once('listening', () => srv.close(() => resolve({ ok: true })));
    srv.listen(port, HOST);
  });
}

/** 读 Windows TCP 排除段（Hyper-V/WSL 保留）。输出本地化但数字列不变，正则按数字对取。 */
function excludedRanges() {
  try {
    const out = execSync('netsh interface ipv4 show excludedportrange protocol=tcp', { encoding: 'utf8' });
    return [...out.matchAll(/^\s*(\d+)\s+(\d+)\s*$/gm)].map((m) => [Number(m[1]), Number(m[2])]);
  } catch {
    return [];
  }
}

/**
 * 从 seed 向后找首个可绑定端口（含 seed）。
 * 快路径直接试 seed；失败则按排除段跳段（一次跳几百端口），其余占用逐端口前进。扫不到返回 null。
 * 注意：绑定探测有副作用（探测端口瞬时占用），多进程并发扫描可能各自错位，
 * 多进程需要一致性时用 deterministicFreePortFrom()。
 */
export async function scanFreePort(seed, max = seed + 1000) {
  if ((await tryBind(seed)).ok) return seed;
  let p = deterministicFreePortFrom(seed + 1, max);
  while (p !== null && p <= max) {
    if ((await tryBind(p)).ok) return p;
    p = deterministicFreePortFrom(p + 1, max);
  }
  return null;
}

/**
 * 纯计算选端口（不绑定、无副作用）：从 seed 起取第一个不在排除段内的可用候选。
 * 同一时刻所有进程读到的 netsh 结果一致 → 返回同值，适合 playwright 配置在多 worker 进程里取同一端口。
 * 不保证未被实际占用（那要绑定才知道），只保证躲开排除段。
 */
export function deterministicFreePortFrom(seed, max = seed + 1000) {
  const spans = excludedRanges().sort((a, b) => a[0] - b[0]);
  let p = seed;
  while (p <= max) {
    const span = spans.find(([s, e]) => s <= p && p <= e);
    if (span) {
      p = span[1] + 1;
      continue;
    }
    return p;
  }
  return null;
}

/** 单个端口不可用的归因文案（EACCES=Windows 排除段，EADDRINUSE=被占用）。 */
export function explain(code, port) {
  if (code === 'EACCES') {
    return `端口 ${port} 落在 Windows 排除段（Hyper-V/WSL 端口保留），绑定被拒绝（EACCES）——需换端口`;
  }
  if (code === 'EADDRINUSE') {
    return `端口 ${port} 已被其它进程占用（EADDRINUSE）`;
  }
  return `端口 ${port} 绑定失败（${code}）`;
}

// CLI 入口（被 import 时跳过）
if (process.argv[1]?.split(/[\\/]/).pop() === 'astro-port.mjs') {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    const port = Number(args[1]);
    const r = await tryBind(port);
    console.log(r.ok ? `端口 ${port} 可用` : explain(r.code, port));
    process.exit(r.ok ? 0 : 1);
  }
  const seed = Number(args[0] || 4321);
  const port = await scanFreePort(seed);
  if (port === null) {
    console.error(`[astro-port] ${seed}~${seed + 1000} 均不可绑定，请用其它 seed。`);
    process.exit(1);
  }
  console.log(port);
}