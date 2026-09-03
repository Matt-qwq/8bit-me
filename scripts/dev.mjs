/**
 * dev 启动器：先挑端口（避开 Windows 排除段/占用，见 astro-port.mjs）再起 astro dev。
 * 端口规则：默认从 4321 向后扫；PORT 环境变量覆盖起点。
 * 正常情形 <seed> 可用时 URL 仍是 http://localhost:4321，与文档一致。
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFreePort } from './astro-port.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = Number(process.env.PORT || 4321);
const port = await scanFreePort(seed);
if (port === null) {
  console.error(`[dev] ${seed}~${seed + 200} 均不可用（被占用或 Windows 排除段），请用 PORT=<其他端口> npm run dev 覆盖起点。`);
  process.exit(1);
}
console.log(
  port === seed
    ? `[dev] http://127.0.0.1:${port}`
    : `[dev] 端口 ${seed} 不可用（Windows 排除段或占用），已自动后移到 http://127.0.0.1:${port}`
);
const astroCli = resolve(ROOT, 'node_modules/astro/bin/astro.mjs');
const r = spawnSync(
  process.execPath,
  [astroCli, 'dev', '--host', '127.0.0.1', '--port', String(port)],
  { stdio: 'inherit' }
);
process.exit(r.status ?? 1);