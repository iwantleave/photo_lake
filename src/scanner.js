const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const meta = require('./util/meta');

// jobId -> { cancelled: bool }
const runningJobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

// ---------- 递归遍历，收集图片/视频文件 ----------
function walk(dir, ignoreDirs, imageExts, videoExts, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (ignoreDirs.includes(e.name)) continue;
      walk(full, ignoreDirs, imageExts, videoExts, out);
    } else if (e.isFile()) {
      const ext = e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : '';
      if (imageExts.includes(ext)) out.push({ file: full, type: 'image', ext });
      else if (videoExts.includes(ext)) out.push({ file: full, type: 'video', ext });
    }
  }
}

// ---------- 预编译语句 ----------
const stmtGetExisting = db.prepare(
  'SELECT id, mtime, file_size, scan_status, is_missing FROM media WHERE file_path = ?'
);
const stmtInsert = db.prepare(`
  INSERT INTO media (folder_id, media_type, file_name, file_path, dir_path, md5, taken_at, taken_at_source,
    format, width, height, megapixel, camera_make, camera_model, lens_model, f_number, exposure_time, iso,
    focal_length, orientation, gps_lat, gps_lon, gps_alt, duration, codec, file_size, mtime, scan_status,
    is_missing, missing_since, is_livephoto, fail_reason, marked, raw_metadata, gmt_create, gmt_modified)
  VALUES (@folder_id,@media_type,@file_name,@file_path,@dir_path,@md5,@taken_at,@taken_at_source,
    @format,@width,@height,@megapixel,@camera_make,@camera_model,@lens_model,@f_number,@exposure_time,@iso,
    @focal_length,@orientation,@gps_lat,@gps_lon,@gps_alt,@duration,@codec,@file_size,@mtime,@scan_status,
    0,NULL,0,NULL,0,@raw_metadata,@gmt_create,@gmt_modified)
  ON CONFLICT(file_path) DO UPDATE SET
    folder_id=excluded.folder_id, media_type=excluded.media_type, file_name=excluded.file_name,
    dir_path=excluded.dir_path, md5=excluded.md5, taken_at=excluded.taken_at, taken_at_source=excluded.taken_at_source,
    format=excluded.format, width=excluded.width, height=excluded.height, megapixel=excluded.megapixel,
    camera_make=excluded.camera_make, camera_model=excluded.camera_model, lens_model=excluded.lens_model,
    f_number=excluded.f_number, exposure_time=excluded.exposure_time, iso=excluded.iso, focal_length=excluded.focal_length,
    orientation=excluded.orientation, gps_lat=excluded.gps_lat, gps_lon=excluded.gps_lon, gps_alt=excluded.gps_alt,
    duration=excluded.duration, codec=excluded.codec, file_size=excluded.file_size, mtime=excluded.mtime,
    scan_status=excluded.scan_status, is_missing=0, missing_since=NULL, fail_reason=excluded.fail_reason,
    raw_metadata=excluded.raw_metadata, gmt_modified=excluded.gmt_modified
`);
const stmtRecoverMissing = db.prepare(
  'UPDATE media SET is_missing=0, missing_since=NULL, gmt_modified=? WHERE id=?'
);
const stmtFailInsert = db.prepare(`
  INSERT INTO media (folder_id, media_type, file_name, file_path, dir_path, md5, taken_at, taken_at_source,
    format, file_size, mtime, scan_status, fail_reason, gmt_create, gmt_modified)
  VALUES (@folder_id,'image',@file_name,@file_path,@dir_path,NULL,NULL,'file_mtime',
    @format,@file_size,@mtime,'failed',@fail_reason,@gmt_create,@gmt_modified)
  ON CONFLICT(file_path) DO UPDATE SET
    scan_status='failed', fail_reason=excluded.fail_reason, file_size=excluded.file_size, mtime=excluded.mtime,
    is_missing=0, missing_since=NULL, gmt_modified=excluded.gmt_modified
`);
const stmtUpdateJob = db.prepare(
  'UPDATE scan_jobs SET processed=?, current_path=?, added=?, updated=?, failed=?, gmt_modified=? WHERE id=?'
);
const stmtUpdateFolder = db.prepare(
  'UPDATE folders SET scan_status=?, last_scan_at=?, image_count=?, video_count=?, livephoto_count=?, gmt_modified=? WHERE id=?'
);
const stmtSetLive = db.prepare('UPDATE media SET is_livephoto=? WHERE id=?');

// ---------- 处理单个文件 ----------
async function processFile(item, folderId, job, cfgObj, ffprobeResolved) {
  const { file, type, ext } = item;
  const dir = path.dirname(file);
  const file_name = path.basename(file);

  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    job.failed++;
    const ts = nowIso();
    stmtFailInsert.run({
      folder_id: folderId, file_name, file_path: file, dir_path: dir, format: ext,
      file_size: 0, mtime: ts, fail_reason: `无法读取文件: ${e.message}`, gmt_create: ts, gmt_modified: ts
    });
    return;
  }
  const mtime = st.mtime.toISOString();
  const file_size = st.size;
  const existing = stmtGetExisting.get(file);

  // 增量：未变化且非强制重扫 -> 跳过（仅恢复可能的 missing）
  let skip = false;
  if (existing) {
    const unchanged = existing.mtime === mtime && existing.file_size === file_size;
    const degradedForce =
      type === 'video' && existing.scan_status === 'degraded' && ffprobeResolved.ok;
    if (unchanged && !degradedForce) {
      if (existing.is_missing) {
        stmtRecoverMissing.run(nowIso(), existing.id);
        job.updated++;
      }
      skip = true;
    }
  }

  if (!skip) {
    let m;
    try {
      m = type === 'video' ? await meta.parseVideo(file, ffprobeResolved)
                           : await meta.parseImage(file, ffprobeResolved);
    } catch (e) {
      job.failed++;
      const ts = nowIso();
      stmtFailInsert.run({
        folder_id: folderId, file_name, file_path: file, dir_path: dir, format: ext,
        file_size, mtime, fail_reason: `解析异常: ${e.message}`, gmt_create: ts, gmt_modified: ts
      });
      return;
    }

    let md5 = null;
    const doMd5 = type === 'image' || cfgObj.videoMd5Enabled;
    if (doMd5) {
      try {
        md5 = await meta.md5File(file);
      } catch (e) {
        md5 = null;
      }
    }

    const ts = nowIso();
    stmtInsert.run({
      folder_id: folderId,
      media_type: m.media_type,
      file_name,
      file_path: file,
      dir_path: dir,
      md5,
      taken_at: m.taken_at,
      taken_at_source: m.taken_at_source,
      format: ext,
      width: m.width,
      height: m.height,
      megapixel: m.megapixel,
      camera_make: m.camera_make,
      camera_model: m.camera_model,
      lens_model: m.lens_model,
      f_number: m.f_number,
      exposure_time: m.exposure_time,
      iso: m.iso,
      focal_length: m.focal_length,
      orientation: m.orientation,
      gps_lat: m.gps_lat,
      gps_lon: m.gps_lon,
      gps_alt: m.gps_alt,
      duration: m.duration,
      codec: m.codec,
      file_size,
      mtime,
      scan_status: m.scan_status,
      fail_reason: m.fail_reason || null,
      raw_metadata: m.raw_metadata,
      gmt_create: ts,
      gmt_modified: ts
    });

    if (existing) job.updated++;
    else job.added++;
    if (m.scan_status === 'failed') job.failed++;
  }
}

// ---------- 并发池 ----------
async function runPool(items, limit, job, workerFn) {
  let i = 0;
  const workers = [];
  for (let w = 0; w < limit; w++) {
    workers.push(
      (async () => {
        while (!job.cancelled && i < items.length) {
          const idx = i++;
          await workerFn(items[idx]);
        }
      })()
    );
  }
  await Promise.all(workers);
}

// ---------- 实况照片按目录标记 ----------
function recomputeLivePhotos(folderId) {
  const rows = db
    .prepare('SELECT id, file_name, media_type, dir_path FROM media WHERE folder_id=? AND is_missing=0')
    .all(folderId);
  const byDir = {};
  for (const r of rows) {
    const base = r.file_name.replace(/\.[^.]+$/, '');
    if (!byDir[r.dir_path]) byDir[r.dir_path] = { images: new Set(), videos: new Set(), ids: {} };
    if (r.media_type === 'image') byDir[r.dir_path].images.add(base);
    else byDir[r.dir_path].videos.add(base);
    byDir[r.dir_path].ids[r.id] = base;
  }
  const tx = db.transaction(() => {
    for (const dir in byDir) {
      const d = byDir[dir];
      for (const id in d.ids) {
        const base = d.ids[id];
        const live = d.images.has(base) && d.videos.has(base) ? 1 : 0;
        stmtSetLive.run(live, id);
      }
    }
  });
  tx();
}

// ---------- 主扫描流程 ----------
function startScan(folderId) {
  const folder = db.prepare('SELECT * FROM folders WHERE id=?').get(folderId);
  if (!folder) throw new Error('文件夹不存在');

  const cfgObj = config.load();
  const ffprobeResolved = config.resolveFfprobe();
  const imageExts = cfgObj.imageFormats;
  const videoExts = cfgObj.videoFormats;
  const ignoreDirs = cfgObj.ignoreDirs;

  const ts = nowIso();
  const jobId = db
    .prepare(
      `INSERT INTO scan_jobs (folder_id, status, started_at, total_count, processed, current_path, added, updated, failed, gmt_create, gmt_modified)
       VALUES (?, 'running', ?, 0, 0, NULL, 0, 0, 0, ?, ?)`
    )
    .run(folderId, ts, ts, ts).lastInsertRowid;

  db.prepare("UPDATE folders SET scan_status='scanning', gmt_modified=? WHERE id=?").run(ts, folderId);

  const job = {
    jobId,
    folderId,
    folderPath: folder.path,
    cancelled: false,
    processed: 0,
    added: 0,
    updated: 0,
    failed: 0,
    dirty: 0
  };
  runningJobs.set(jobId, job);

  // 异步执行，不阻塞调用方
  (async () => {
    try {
      const files = [];
      walk(job.folderPath, ignoreDirs, imageExts, videoExts, files);
      const total = files.length;
      db.prepare('UPDATE scan_jobs SET total_count=? WHERE id=?').run(total, jobId);

      const currentPaths = new Set(files.map((f) => f.file));

      const imageFiles = files.filter((f) => f.type === 'image');
      const videoFiles = files.filter((f) => f.type === 'video');

      const persist = () => {
        stmtUpdateJob.run(
          job.processed, job.folderPath, job.added, job.updated, job.failed, nowIso(), jobId
        );
      };

      // 图片池（sharp/exifr 并发）
      await runPool(imageFiles, cfgObj.imageConcurrency, job, async (item) => {
        if (job.cancelled) return;
        job.folderPath = item.file; // current_path 近似
        await processFile(item, folderId, job, cfgObj, ffprobeResolved);
        job.processed++;
        job.dirty++;
        if (job.dirty >= 50) { persist(); job.dirty = 0; }
      });

      // 视频池（ffprobe 并发）
      await runPool(videoFiles, cfgObj.ffprobeConcurrency, job, async (item) => {
        if (job.cancelled) return;
        job.folderPath = item.file;
        await processFile(item, folderId, job, cfgObj, ffprobeResolved);
        job.processed++;
        job.dirty++;
        if (job.dirty >= 50) { persist(); job.dirty = 0; }
      });

      if (job.cancelled) {
        db.prepare("UPDATE scan_jobs SET status='cancelled', finished_at=?, message=?, gmt_modified=? WHERE id=?")
          .run(nowIso(), '用户取消', nowIso(), jobId);
        db.prepare("UPDATE folders SET scan_status='failed', gmt_modified=? WHERE id=?").run(nowIso(), folderId);
        return;
      }

      // missing 检测：db 有但本次不存在
      const rows = db.prepare('SELECT id, file_path, is_missing, missing_since FROM media WHERE folder_id=?').all(folderId);
      const missTs = nowIso();
      const tx = db.transaction(() => {
        for (const r of rows) {
          if (!currentPaths.has(r.file_path) && !r.is_missing) {
            db.prepare('UPDATE media SET is_missing=1, missing_since=?, gmt_modified=? WHERE id=?')
              .run(r.missing_since || missTs, missTs, r.id);
          }
        }
      });
      tx();

      recomputeLivePhotos(folderId);

      // 文件夹统计
      const stats = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(media_type='image') AS images,
                  SUM(media_type='video') AS videos,
                  SUM(is_livephoto=1 AND media_type='image') AS live
           FROM media WHERE folder_id=? AND is_missing=0`
        )
        .get(folderId);

      const endTs = nowIso();
      persist();
      stmtUpdateFolder.run(
        'done', endTs, stats.images || 0, stats.videos || 0, stats.live || 0, endTs, folderId
      );
      db.prepare("UPDATE scan_jobs SET status='done', finished_at=?, gmt_modified=? WHERE id=?")
        .run(endTs, endTs, jobId);
    } catch (e) {
      const endTs = nowIso();
      db.prepare("UPDATE scan_jobs SET status='failed', finished_at=?, message=?, gmt_modified=? WHERE id=?")
        .run(endTs, String(e.message || e), endTs, jobId);
      db.prepare("UPDATE folders SET scan_status='failed', gmt_modified=? WHERE id=?").run(endTs, folderId);
    } finally {
      runningJobs.delete(jobId);
    }
  })();

  return jobId;
}

function cancelScan(jobId) {
  const job = runningJobs.get(jobId);
  if (job) {
    job.cancelled = true;
    return true;
  }
  return false;
}

function cancelByFolder(folderId) {
  for (const [, job] of runningJobs) {
    if (job.folderId === folderId) job.cancelled = true;
  }
}

module.exports = { startScan, cancelScan, cancelByFolder };
