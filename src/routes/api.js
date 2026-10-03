const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const scanner = require('../scanner');
const library = require('../library');
const dirconv = require('../util/dirconv');

function nowIso() {
  return new Date().toISOString();
}

function qmarks(n) {
  return new Array(n).fill('?').join(',');
}

// ---------------- 文件夹 ----------------
async function addFolder(req, reply) {
  const { path: p, alias, force } = req.body || {};
  if (!p || !p.trim()) return reply.code(400).send({ error: '路径不能为空' });
  const full = path.resolve(p.trim());
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory())
    return reply.code(400).send({ error: '路径不存在或不是目录' });

  const dup = db.prepare('SELECT id FROM folders WHERE path=?').get(full);
  if (dup) return reply.code(400).send({ error: '该文件夹已添加' });

  const all = db.prepare('SELECT id, path FROM folders').all();
  for (const f of all) {
    if (full.startsWith(f.path + path.sep) || full === f.path)
      return reply.code(400).send({ error: '该路径是已管理文件夹的子目录' });
    if (f.path.startsWith(full + path.sep)) {
      if (!force)
        return reply
          .code(409)
          .send({ error: '部分文件会被重复管理（已有父目录被管理）', confirm: true, parentId: f.id });
    }
  }

  // 按「年份 / YYYYMMDD+主题」约定解析元信息
  const parsed = dirconv.parseFolderPath(full);
  const ts = nowIso();
  const id = db
    .prepare(
      `INSERT INTO folders (path, alias, year, topic, event_date, parent_path, added_at, scan_status, gmt_create, gmt_modified)
       VALUES (?,?,?,?,?,?,?,'pending',?,?)`
    )
    .run(
      full,
      alias || (parsed.year ? `${parsed.year} / ${parsed.dir_name}` : parsed.dir_name),
      parsed.year,
      parsed.topic,
      parsed.event_date,
      parsed.parent_path,
      ts, ts, ts
    ).lastInsertRowid;

  const jobId = scanner.startScan(id);
  return { id, jobId };
}

async function listFolders(req, reply) {
  const rows = db
    .prepare('SELECT * FROM folders ORDER BY year DESC, event_date DESC, path')
    .all();
  return { folders: rows };
}

// ---------------- 按年份/主题约定的库导入 ----------------
async function inspectLibrary(req, reply) {
  const { path: p } = req.body || {};
  try {
    return library.inspect(p);
  } catch (e) {
    return reply.code(400).send({ error: e.message || String(e) });
  }
}

async function listTopicsApi(req, reply) {
  const { path: p } = req.body || {};
  try {
    const topics = library.listTopics(p);
    return {
      path: path.resolve(String(p)),
      year: dirconv.isYearName(path.basename(path.resolve(String(p)))) ? path.basename(path.resolve(String(p))) : null,
      topics
    };
  } catch (e) {
    return reply.code(400).send({ error: e.message || String(e) });
  }
}

async function importTopicsApi(req, reply) {
  try {
    return library.importTopics(req.body || {});
  } catch (e) {
    return reply.code(400).send({ error: e.message || String(e) });
  }
}

async function rescanYearApi(req, reply) {
  try {
    return library.rescanYear((req.body || {}).year);
  } catch (e) {
    return reply.code(400).send({ error: e.message || String(e) });
  }
}

async function removeFolder(req, reply) {
  const id = +req.params.id;
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(id);
  if (!f) return reply.code(404).send({ error: 'not found' });
  scanner.cancelByFolder(id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM media WHERE folder_id=?').run(id);
    db.prepare('DELETE FROM scan_jobs WHERE folder_id=?').run(id); // 先清任务，避免外键约束
    db.prepare('DELETE FROM folders WHERE id=?').run(id);
  });
  tx();
  return { ok: true };
}

async function rescanFolder(req, reply) {
  const id = +req.params.id;
  const f = db.prepare('SELECT * FROM folders WHERE id=?').get(id);
  if (!f) return reply.code(404).send({ error: 'not found' });
  const jobId = scanner.startScan(id);
  return { jobId };
}

// ---------------- 设置 ----------------
async function getSettings(req, reply) {
  return { settings: config.load() };
}

async function saveSettings(req, reply) {
  const merged = config.save(req.body || {});
  return { ok: true, settings: merged };
}

async function testFfprobe(req, reply) {
  const { path: p } = req.body || {};
  return config.testBinary(p || '', 'ffprobe');
}

async function testFfmpeg(req, reply) {
  const { path: p } = req.body || {};
  return config.testBinary(p || '', 'ffmpeg');
}

async function rescanDegraded(req, reply) {
  const folders = db.prepare('SELECT id FROM folders').all();
  const jobIds = folders.map((f) => scanner.startScan(f.id));
  return { jobIds };
}

// ---------------- 媒体列表 ----------------
function buildMediaQuery(query) {
  const where = [];
  const params = [];
  const {
    media_type, folder_ids, formats, taken_from, taken_to,
    mp_min, mp_max, camera_makes, camera_models, has_gps,
    iso_min, focal_min,
    size_min, size_max, dur_min, dur_max, statuses,
    live_only, dup_only, no_time, q
  } = query;

  if (media_type) { where.push('media_type = ?'); params.push(media_type); }

  if (folder_ids) {
    const ids = String(folder_ids).split(',').map((x) => parseInt(x, 10)).filter((x) => !isNaN(x));
    if (ids.length) { where.push(`folder_id IN (${qmarks(ids.length)})`); params.push(...ids); }
  }
  if (formats) {
    const fs2 = String(formats).split(',').filter(Boolean);
    if (fs2.length) { where.push(`format IN (${qmarks(fs2.length)})`); params.push(...fs2); }
  }
  if (taken_from) { where.push('taken_at >= ?'); params.push(taken_from + 'T00:00:00.000Z'); }
  if (taken_to) { where.push('taken_at <= ?'); params.push(taken_to + 'T23:59:59.999Z'); }
  if (mp_min !== undefined && mp_min !== '' && !isNaN(mp_min)) { where.push('megapixel >= ?'); params.push(parseFloat(mp_min)); }
  if (mp_max !== undefined && mp_max !== '' && !isNaN(mp_max)) { where.push('megapixel <= ?'); params.push(parseFloat(mp_max)); }
  if (camera_makes) {
    const m = String(camera_makes).split(',').filter(Boolean);
    if (m.length) { where.push(`camera_make IN (${qmarks(m.length)})`); params.push(...m); }
  }
  if (camera_models) {
    const m = String(camera_models).split(',').filter(Boolean);
    if (m.length) { where.push(`camera_model IN (${qmarks(m.length)})`); params.push(...m); }
  }
  if (iso_min !== undefined && iso_min !== '' && !isNaN(iso_min)) { where.push('iso >= ?'); params.push(parseInt(iso_min, 10)); }
  if (focal_min !== undefined && focal_min !== '' && !isNaN(focal_min)) { where.push('focal_length >= ?'); params.push(parseFloat(focal_min)); }
  if (has_gps === '1') where.push('gps_lat IS NOT NULL');
  if (has_gps === '0') where.push('gps_lat IS NULL');
  if (size_min !== undefined && size_min !== '' && !isNaN(size_min)) { where.push('file_size >= ?'); params.push(parseInt(size_min, 10)); }
  if (size_max !== undefined && size_max !== '' && !isNaN(size_max)) { where.push('file_size <= ?'); params.push(parseInt(size_max, 10)); }
  if (dur_min !== undefined && dur_min !== '' && !isNaN(dur_min)) { where.push('duration >= ?'); params.push(parseFloat(dur_min)); }
  if (dur_max !== undefined && dur_max !== '' && !isNaN(dur_max)) { where.push('duration <= ?'); params.push(parseFloat(dur_max)); }
  if (live_only === '1') where.push('is_livephoto = 1');
  if (no_time === '1') where.push("taken_at_source = 'file_mtime'");
  if (dup_only === '1')
    where.push('md5 IS NOT NULL AND md5 IN (SELECT md5 FROM media WHERE md5 IS NOT NULL GROUP BY md5 HAVING COUNT(*) >= 2)');

  if (q) {
    if (q.startsWith('md5:')) { where.push('md5 = ?'); params.push(q.slice(4)); }
    else {
      where.push('(file_name LIKE ? OR file_path LIKE ? OR dir_path LIKE ?)');
      const lk = `%${q}%`;
      params.push(lk, lk, lk);
    }
  }

  // 状态处理（含 missing）
  if (statuses) {
    const st = String(statuses).split(',').filter(Boolean);
    const includeMissing = st.includes('missing');
    const scanSt = st.filter((s) => s !== 'missing');
    const conds = [];
    if (scanSt.length) { conds.push(`scan_status IN (${qmarks(scanSt.length)})`); params.push(...scanSt); }
    conds.push(includeMissing ? 'is_missing = 1' : 'is_missing = 0');
    where.push('(' + conds.join(' OR ') + ')');
  } else {
    where.push('is_missing = 0');
  }

  return { where, params };
}

const SORT_WHITELIST = new Set([
  'file_name', 'taken_at', 'format', 'width', 'height', 'megapixel',
  'file_size', 'duration', 'media_type', 'camera_make', 'camera_model',
  'iso', 'focal_length', 'scan_status'
]);

async function listMedia(req, reply) {
  const cfg = config.load();
  const q = req.query || {};
  const { where, params } = buildMediaQuery(q);

  const page = Math.max(1, parseInt(q.page, 10) || 1);
  let pageSize = parseInt(q.pageSize, 10) || cfg.pageSize;
  if (![20, 50, 100, 200].includes(pageSize)) pageSize = cfg.pageSize;
  const offset = (page - 1) * pageSize;

  let sort = SORT_WHITELIST.has(q.sort) ? q.sort : 'taken_at';
  let order = q.order === 'asc' ? 'ASC' : 'DESC';

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM media ${whereSql}`).get(...params).c;

  const rows = db
    .prepare(
      `SELECT id, folder_id, media_type, file_name, file_path, dir_path, md5, taken_at, taken_at_source,
              format, width, height, megapixel, camera_make, camera_model, lens_model, f_number,
              exposure_time, iso, focal_length, orientation, gps_lat, gps_lon, gps_alt, duration, codec,
              file_size, mtime, scan_status, is_missing, missing_since, is_livephoto, marked
       FROM media ${whereSql} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset);

  return { rows, total, page, pageSize, sort, order };
}

// 单条媒体详情（含 raw_metadata 全文，仅详情页使用）
async function getMediaDetail(req, reply) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return reply.code(400).send({ error: 'invalid id' });
  const media = db.prepare('SELECT * FROM media WHERE id=?').get(id);
  if (!media) return reply.code(404).send({ error: 'not found' });
  const folder = db.prepare('SELECT id, path, alias FROM folders WHERE id=?').get(media.folder_id);
  return { media, folder: folder || null };
}

// 地图点位：返回有 GPS 的媒体（id/lat/lon/type/name/标记），供前端打点/聚合
// 支持 folder_ids（csv）、media_type、include_missing 过滤；点数多时前端用 markercluster 聚合
async function mediaPoints(req, reply) {
  const { folder_ids, media_type, include_missing } = req.query;
  const where = ['gps_lat IS NOT NULL', 'gps_lon IS NOT NULL'];
  const params = [];
  if (folder_ids) {
    const ids = folder_ids.split(',').map((x) => parseInt(x, 10)).filter((x) => !isNaN(x));
    if (ids.length) {
      where.push('folder_id IN (' + ids.map(() => '?').join(',') + ')');
      params.push(...ids);
    }
  }
  if (media_type === 'image' || media_type === 'video') {
    where.push('media_type=?');
    params.push(media_type);
  }
  if (!include_missing) where.push('is_missing=0');
  const rows = db
    .prepare(
      `SELECT id, gps_lat, gps_lon, media_type, file_name, format, is_livephoto, is_missing, taken_at, folder_id
       FROM media WHERE ${where.join(' AND ')}`
    )
    .all(...params);
  return { count: rows.length, points: rows };
}

// 下拉选项（相机厂商/型号/格式）用于筛选
async function mediaFacets(req, reply) {
  const makes = db.prepare('SELECT DISTINCT camera_make FROM media WHERE camera_make IS NOT NULL ORDER BY camera_make').all().map(r => r.camera_make);
  const models = db.prepare('SELECT DISTINCT camera_model FROM media WHERE camera_model IS NOT NULL ORDER BY camera_model').all().map(r => r.camera_model);
  const formats = db.prepare('SELECT DISTINCT format FROM media WHERE format IS NOT NULL ORDER BY format').all().map(r => r.format);
  const folders = db.prepare('SELECT id, alias, path FROM folders ORDER BY added_at DESC').all();
  return { makes, models, formats, folders };
}

// ---------------- 重复 ----------------
async function listDuplicates(req, reply) {
  const groups = db
    .prepare(
      `SELECT md5, COUNT(*) AS cnt, SUM(file_size) AS total_size
       FROM media WHERE md5 IS NOT NULL GROUP BY md5 HAVING cnt >= 2 ORDER BY total_size DESC`
    )
    .all();
  for (const g of groups) {
    g.members = db
      .prepare(
        'SELECT id, file_name, file_path, dir_path, format, file_size, taken_at, media_type, is_missing FROM media WHERE md5=? ORDER BY file_path LIMIT 50'
      )
      .all(g.md5);
  }
  return { groups };
}

// ---------------- 任务 ----------------
async function listJobs(req, reply) {
  const rows = db.prepare('SELECT * FROM scan_jobs ORDER BY started_at DESC LIMIT 50').all();
  return { jobs: rows, queue: scanner.queueState() };
}
async function getJob(req, reply) {
  const id = +req.params.id;
  const job = db.prepare('SELECT * FROM scan_jobs WHERE id=?').get(id);
  if (!job) return reply.code(404).send({ error: 'not found' });
  return { job };
}
async function cancelJob(req, reply) {
  const id = +req.params.id;
  const ok = scanner.cancelScan(id);
  return { ok };
}
async function markMedia(req, reply) {
  const id = +req.params.id;
  const { marked } = req.body || {};
  db.prepare('UPDATE media SET marked=?, gmt_modified=? WHERE id=?').run(marked ? 1 : 0, nowIso(), id);
  return { ok: true };
}

async function registerApi(fastify) {
  fastify.get('/api/folders', listFolders);
  fastify.post('/api/folders', addFolder);
  fastify.delete('/api/folders/:id', removeFolder);
  fastify.post('/api/folders/:id/rescan', rescanFolder);

  // 目录约定导入：第一层年份 / 第二层 YYYYMMDD+主题
  fastify.post('/api/library/inspect', inspectLibrary);
  fastify.post('/api/library/topics', listTopicsApi);
  fastify.post('/api/library/import', importTopicsApi);
  fastify.post('/api/library/rescan-year', rescanYearApi);

  fastify.get('/api/settings', getSettings);
  fastify.post('/api/settings', saveSettings);
  fastify.post('/api/settings/test-ffprobe', testFfprobe);
  fastify.post('/api/settings/test-ffmpeg', testFfmpeg);
  fastify.post('/api/settings/rescan-degraded', rescanDegraded);

  fastify.get('/api/media', listMedia);
  fastify.get('/api/media/points', mediaPoints);
  fastify.get('/api/media/facets', mediaFacets);
  fastify.post('/api/media/:id/mark', markMedia);

  fastify.get('/api/media/duplicates', listDuplicates);

  // 注意：必须放在 /api/media/facets、/api/media/duplicates 之后，确保静态路由优先命中
  fastify.get('/api/media/:id', getMediaDetail);

  fastify.get('/api/jobs', listJobs);
  fastify.get('/api/jobs/:id', getJob);
  fastify.post('/api/jobs/:id/cancel', cancelJob);
}

module.exports = { registerApi };
