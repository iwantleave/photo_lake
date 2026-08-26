const path = require('path');
const fastify = require('fastify')({ logger: { level: 'error' } });
const view = require('@fastify/view');
const fastifyStatic = require('@fastify/static');

const api = require('./routes/api');
const pages = require('./routes/pages');

// 视图引擎
fastify.register(view, {
  engine: { ejs: require('ejs') },
  templates: path.join(__dirname, '..', 'views')
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
