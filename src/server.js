const fs = require('fs');
const path = require('path');
const fastify = require('fastify')({ logger: { level: 'error' } });
const view = require('@fastify/view');
const fastifyStatic = require('@fastify/static');

const api = require('./routes/api');
const pages = require('./routes/pages');

// 静态资源缓存刷新戳：用 CSS 文件 mtime 生成，每次 CSS/JS 更新重启服务即可自动生效
function getAssetVersion(file) {
  try {
    return fs.statSync(file).mtime.toISOString().replace(/[:.]/g, '-');
  } catch {
    return String(Date.now());
  }
}
const assetVersion = getAssetVersion(path.join(__dirname, '..', 'public', 'styles.css'));

// 视图引擎
fastify.register(view, {
  engine: { ejs: require('ejs') },
  templates: path.join(__dirname, '..', 'views'),
  defaultContext: { assetVersion }
});

// 静态资源（public）
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/'
});

// 本地 vendor：htmx / alpine（从 node_modules 提供，离线可用）
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'node_modules', 'htmx.org', 'dist'),
  prefix: '/vendor/htmx/',
  decorateReply: false
});
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'node_modules', 'alpinejs', 'dist'),
  prefix: '/vendor/alpine/',
  decorateReply: false
});
// 本地 vendor：Leaflet / markercluster（从 node_modules 提供，离线可用）
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist'),
  prefix: '/vendor/leaflet/',
  decorateReply: false
});
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'node_modules', 'leaflet.markercluster', 'dist'),
  prefix: '/vendor/leaflet-markercluster/',
  decorateReply: false
});

fastify.register(api.registerApi);
fastify.register(pages.registerPages);

const PORT = process.env.PORT || 3000;
fastify.listen({ port: PORT, host: '127.0.0.1' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Photo World 运行于 http://127.0.0.1:${PORT}`);
});
