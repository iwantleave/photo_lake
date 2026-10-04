// 选择与已编译 better-sqlite3 原生模块 ABI 匹配的 Node.js
// 用法: node pick-node.js   -> stdout 打印可用的 node.exe 绝对路径，全部失败则 exit 1
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname; // 本脚本位于项目根
const BINDING = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const MODULES_DIR = path.join(ROOT, 'node_modules', 'better-sqlite3');

// ---- 候选 Node 列表（优先级从高到低）----
const list = [];
const push = (p) => {
  if (p && !list.includes(p)) {
    // 允许目录形式，统一补 node.exe
    const exe = path.basename(p).toLowerCase() === 'node.exe' ? p : path.join(p, 'node.exe');
    if (fs.existsSync(exe)) list.push(exe);
  }
};

push(process.env.PHOTO_NODE);

// WorkBuddy 托管的 Node 22（当前项目已按它编译）
const wbBase = path.join(process.env.USERPROFILE || '', '.workbuddy', 'binaries', 'node', 'versions');
if (fs.existsSync(wbBase)) {
  for (const d of fs.readdirSync(wbBase).sort().reverse()) {
    if (/^22\./.test(d)) push(path.join(wbBase, d));
  }
}

// nvm4w / nvm-windows 多版本目录：优先 22.x
for (const home of [process.env.NVM_HOME, 'C:\\nvm', 'C:\\nvm4w'].filter(Boolean)) {
  if (!fs.existsSync(home)) continue;
  let dirs = [];
  try { dirs = fs.readdirSync(home); } catch { continue; }
  const v22 = dirs.filter((d) => /^v?22\./.test(d)).sort().reverse();
  for (const d of v22) push(path.join(home, d));
}

// 常见单版本安装位置
push('C:\\nvm4w\\nodejs');
push(path.join(process.env.ProgramFiles || '', 'nodejs'));
push(path.join(process.env['ProgramFiles(x86)'] || '', 'nodejs'));
push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'));
push(path.join(process.env.APPDATA || '', 'nvm'));

// 系统 PATH
try {
  const found = execFileSync('where', ['node'], { encoding: 'utf8', shell: true });
  found.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach(push);
} catch { /* ignore */ }

if (!list.length) process.exit(1);

// ---- 探测：必须真正 new Database() 才能触发原生模块加载 ----
const probe = path.join(ROOT, '.node_abi_probe.js');
fs.writeFileSync(probe, [
  'try {',
  '  const Database = require("./node_modules/better-sqlite3");',
  '  const db = new Database(":memory:");',
  '  db.close();',
  '  process.exit(0);',
  '} catch (e) { process.exit(1); }'
].join('\n'));

const cleanup = () => { try { fs.unlinkSync(probe); } catch { /* ignore */ } };

// 情况 A：没有预编译原生模块 —— 任何能跑的 node 都行，取第一个
if (!fs.existsSync(BINDING)) {
  for (const exe of list) {
    try {
      execFileSync(exe, ['-e', 'process.exit(0)'], { stdio: 'ignore', timeout: 15000 });
      cleanup();
      console.log(exe);
      process.exit(0);
    } catch { /* next */ }
  }
  cleanup();
  process.exit(1);
}

// 情况 B：已有原生模块 —— 逐个试探，谁能真正加载就用谁
for (const exe of list) {
  let ok = false;
  try {
    execFileSync(exe, [probe], { cwd: ROOT, stdio: 'ignore', timeout: 30000 });
    ok = true;
  } catch { ok = false; }
  if (ok) {
    cleanup();
    console.log(exe);
    process.exit(0);
  }
}

cleanup();
process.exit(1);
