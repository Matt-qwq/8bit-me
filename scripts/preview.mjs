/**
 * preview 启动器：先挑端口（避开 Windows 排除段/占用，见 astro-port.mjs）再起 astro preview。
 * 端口规则：无 PORT 时从 4322 起向后扫；playwright webServer 会通过 env.PORT 注入同一端口（此时原样使用，不再重扫）。
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFreePort } from './astro-port.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = Number(process.env.PORT || 4322);
// playwright 已注入确定端口：直接用，避免扫描错位；否则自主扫描
const port = process.env.PORT ? seed : await scanFreePort(seed);
if (!port || port === null) {
  console.error(`[preview] ${seed}~${seed + 1000} 均不可用（被占用或 Windows 排除段），请用 PORT=<其他端口> 覆盖起点。`);
  process.exit(1);
}
console.log(`[preview] http://127.0.0.1:${port}${process.env.PORT ? '' : `（${seed} 不可用，已自动后移）`}`);
const astroCli = resolve(ROOT, 'node_modules/astro/bin/astro.mjs');
const r = spawnSync(
  process.execPath,
  [astroCli, 'preview', '--host', '127.0.0.1', '--port', String(port)],
  { stdio: 'inherit' }
);
process.exit(r.status ?? 1);