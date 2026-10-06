const path = require('path');
const db = require('../db');
const config = require('../config');

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = Math.floor(Math.log(bytes) / Math.log(1024));
  i = Math.min(i, u.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}

async function registerPages(fastify) {
  fastify.get('/', async (req, reply) => {
    const stats = db
      .prepare(
        `SELECT COUNT(*) total,
                SUM(media_type='image') images,
                SUM(media_type='video') videos,
                SUM(is_livephoto=1 AND media_type='image') live,
                SUM(file_size) size,
                SUM(is_missing=1) missing
         FROM media`
      )
      .get();
    const dupWaste =
      db
        .prepare(
          `SELECT COALESCE(SUM(waste),0) waste FROM (
             SELECT md5, SUM(file_size) - MIN(file_size) AS waste
             FROM media WHERE md5 IS NOT NULL GROUP BY md5 HAVING COUNT(*) >= 2
           )`
        )
        .get().waste || 0;
    const folders = db
      .prepare('SELECT * FROM folders ORDER BY year DESC, event_date DESC, path')
      .all()
      .map((f) => ({ ...f, dir_name: path.basename(f.path) }));
    const recentJobs = db.prepare('SELECT * FROM scan_jobs ORDER BY started_at DESC LIMIT 5').all();
    return reply.view('index', {
      stats: {
        ...stats,
        sizeHR: fmtSize(stats.size || 0),
        dupWasteHR: fmtSize(dupWaste)
      },
      folders,
      recentJobs
    });
  });

  fastify.get('/folders', async (req, reply) => {
    const rows = db.prepare('SELECT * FROM folders ORDER BY year DESC, event_date DESC, path').all();
    // 按年份分组（无年份的归入"未分类"）
    const order = [];
    const map = new Map();
    for (const f of rows) {
      const y = f.year || '未分类';
      if (!map.has(y)) {
        map.set(y, { year: y, folders: [], images: 0, videos: 0, live: 0 });
        order.push(y);
      }
      const g = map.get(y);
      g.folders.push({
        ...f,
        dir_name: path.basename(f.path),
        last_scan: f.last_scan_at ? f.last_scan_at.slice(0, 19).replace('T', ' ') : '-'
      });
      g.images += f.image_count || 0;
      g.videos += f.video_count || 0;
      g.live += f.livephoto_count || 0;
    }
    const groups = order.map((y) => map.get(y));
    return reply.view('folders', { groups, total: rows.length });
  });

  fastify.get('/media', async (req, reply) => {
    return reply.view('media', {});
  });

  fastify.get('/media/duplicates', async (req, reply) => {
    return reply.view('duplicates', {});
  });

  fastify.get('/map', async (req, reply) => {
    const folders = db.prepare('SELECT id, alias, path FROM folders ORDER BY added_at DESC').all();
    return reply.view('map', { folders });
  });

  fastify.get('/jobs', async (req, reply) => {
    return reply.view('jobs', {});
  });

  fastify.get('/guide', async (req, reply) => {
    return reply.view('guide', {});
  });

  fastify.get('/settings', async (req, reply) => {
    const settings = config.load();
    const ffprobe = config.resolveFfprobe();
    const ffmpeg = config.resolveFfmpeg();
    const degradedCount = db.prepare("SELECT COUNT(*) c FROM media WHERE scan_status='degraded'").get().c;
    return reply.view('settings', { settings, ffprobe, ffmpeg, degradedCount });
  });
}

module.exports = { registerPages };
