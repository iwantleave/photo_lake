// 端口占用检测：直接尝试 bind，只有绑定失败才说明被占用
// 比 netstat 可靠（不依赖外部命令，也不需要网络请求）
// 用法: node portcheck.js 3000
// stdout: FREE | TAKEN | UNKNOWN
const net = require('net');

const port = Number(process.argv[2] || 3000);

const server = net.createServer();

server.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.stdout.write('TAKEN\n');
  } else if (err.code === 'EACCES') {
    // 端口被系统保留/占用，同样视为不可用
    process.stdout.write('TAKEN\n');
  } else {
    process.stdout.write('UNKNOWN\n');
  }
  process.exit(0);
});

server.once('listening', () => {
  server.close(() => {
    process.stdout.write('FREE\n');
    process.exit(0);
  });
});

server.listen(port, '127.0.0.1');
