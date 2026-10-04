// 依赖安装器：不依赖 PATH 中的 npm，直接定位 npm-cli.js 执行。
// 被 start.cmd 调用；也支持直接 `node install_deps.js` 运行。
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = __dirname;
const MIRROR = 'https://registry.npmmirror.com';

const candidates = [
  'C:\\nvm4w\\nodejs',
  path.join(process.env.ProgramFiles || '', 'nodejs'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'nodejs'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
  path.join(process.env.APPDATA || '', 'nvm'),
  'C:\\nvm'
].filter(Boolean);

let npmCli = null;
for (const dir of candidates) {
  const p = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(p)) { npmCli = p; break; }
}

if (!npmCli) {
  console.log('[i] 未找到 npm-cli.js，尝试用 npx 兜底...');
  const r = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
  if (r.error) {
    console.error('[X] 无法执行 node，请重装 Node.js');
    process.exit(1);
  }
}

const args = npmCli
  ? [npmCli, 'install', '--registry=' + MIRROR]
  : null;

console.log('[i] 安装依赖，镜像源: ' + MIRROR);
console.log('[i] 这可能需要几分钟，请勿关闭窗口...\n');

let code = 1;
if (args) {
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    code = 0;
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 1;
  }
} else {
  console.error('[X] 找不到 npm，请安装 Node.js 后重试');
  code = 1;
}

// 安装后自检
const checks = [
  path.join(ROOT, 'node_modules', 'fastify', 'package.json'),
  path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
];
const missing = checks.filter((p) => !fs.existsSync(p));

if (missing.length) {
  console.error('\n[X] 安装后仍缺少以下文件：');
  missing.forEach((p) => console.error('    ' + p));
  code = 1;
} else if (code === 0) {
  console.log('\n[√] 依赖安装完成');
}

process.exit(code);
