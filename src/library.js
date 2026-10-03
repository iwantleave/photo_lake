// 按「年份 / YYYYMMDD+主题」约定的目录库管理：
//   第一层：年份 YYYY          例 D:\照片\2026
//   第二层：YYYYMMDD+主题      例 D:\照片\2026\20260101-过年
// 一个第二层目录 = 一个受管理主题（folders 表一行），其下所有照片/视频归属该主题。

const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const dirconv = require('./util/dirconv');
const scanner = require('./scanner');

function nowIso() {
  return new Date().toISOString();
}

function mediaExts() {
  const c = config.load();
  return new Set([...c.imageFormats, ...c.videoFormats].map((x) => String(x).toLowerCase()));
}

function extOf(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}

// 递归统计目录下媒体文件数（带上限，避免超大目录卡住）
const COUNT_CAP = 20000;
function countMedia(dir, exts, ignoreDirs) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (!ignoreDirs.includes(e.name)) stack.push(path.join(d, e.name));
      } else if (e.isFile()) {
        if (exts.has(extOf(e.name))) {
          n++;
          if (n >= COUNT_CAP) return { count: n, truncated: true };
        }
      }
    }
  }
  return { count: n, truncated: false };
}

function managedMap() {
  const m = new Map();
  for (const f of db.prepare('SELECT id, path, scan_status FROM folders').all()) {
    m.set(dirconv.key(f.path), f);
  }
  return m;
}

function subDirs(dir, ignoreDirs) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  return ents
    .filter((e) => e.isDirectory() && !ignoreDirs.includes(e.name))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
}

// 列出某个年份目录下的所有主题（第二层）
function listTopics(yearPath) {
  const abs = path.resolve(yearPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory())
    throw new Error('路径不存在或不是目录');
  const cfg = config.load();
  const exts = mediaExts();
  const managed = managedMap();
  return subDirs(abs, cfg.ignoreDirs).map((p) => {
    const name = path.basename(p);
    const parsed = dirconv.parseTopicName(name);
    const exist = managed.get(dirconv.key(p));
    const c = countMedia(p, exts, cfg.ignoreDirs);
    return {
      path: p,
      dir_name: name,
      event_date: parsed.event_date,
      topic: parsed.topic,
      name_ok: parsed.ok,
      file_count: c.count,
      count_truncated: c.truncated,
      managed: !!exist,
      folder_id: exist ? exist.id : null,
      scan_status: exist ? exist.scan_status : null
    };
  });
}

// 解析输入路径：可能是库根目录（下面挂年份），也可能是年份目录本身
function inspect(inputPath) {
  if (!inputPath || !String(inputPath).trim()) throw new Error('路径不能为空');
  const abs = path.resolve(String(inputPath).trim());
  if (!fs.existsSync(abs)) throw new Error('路径不存在');
  if (!fs.statSync(abs).isDirectory()) throw new Error('不是一个目录');

  const cfg = config.load();
  const base = path.basename(abs);
  const managed = managedMap();

  // 输入本身就是年份层
  if (dirconv.isYearName(base)) {
    const topics = listTopics(abs);
    return {
      path: abs,
      mode: 'year',
      year: base,
      year_path: abs,
      years: [
        {
          year: base,
          path: abs,
          topic_count: topics.length,
          managed_count: topics.filter((t) => t.managed).length
        }
      ],
      topics
    };
  }

  // 否则视为库根：找出符合 YYYY 的第一层目录
  const yearDirs = subDirs(abs, cfg.ignoreDirs).filter((p) => dirconv.isYearName(path.basename(p)));
  if (yearDirs.length) {
    const years = yearDirs.map((p) => {
      const subs = subDirs(p, cfg.ignoreDirs);
      return {
        year: path.basename(p),
        path: p,
        topic_count: subs.length,
        managed_count: subs.filter((s) => managed.has(dirconv.key(s))).length
      };
    });
    return { path: abs, mode: 'root', year: null, year_path: null, years, topics: [] };
  }

  // 兜底：不符合约定，按普通目录处理（子目录当主题，年份留空）
  const topics = listTopics(abs);
  return { path: abs, mode: 'plain', year: null, year_path: abs, years: [], topics };
}

// 导入选中的主题目录并触发扫描
function importTopics(payload) {
  const { year, year_path, topics } = payload || {};
  const list = Array.isArray(topics) ? topics : [];
  if (!list.length) throw new Error('未选择任何主题目录');

  const managed = managedMap();
  const imported = [];
  const skipped = [];

  for (const raw of list) {
    const abs = path.resolve(String(raw));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      skipped.push({ path: abs, reason: '路径不存在或不是目录' });
      continue;
    }
    const exist = managed.get(dirconv.key(abs));
    if (exist) {
      skipped.push({ path: abs, reason: '已在库中', folder_id: exist.id });
      continue;
    }
    const p = dirconv.parseFolderPath(abs);
    const y = year || p.year || (path.basename(path.dirname(abs)) || null);
    const ts = nowIso();
    const id = db
      .prepare(
        `INSERT INTO folders (path, alias, year, topic, event_date, parent_path, added_at, scan_status,
           image_count, video_count, livephoto_count, gmt_create, gmt_modified)
         VALUES (?,?,?,?,?,?,?,'pending',0,0,0,?,?)`
      )
      .run(
        abs,
        y ? `${y} / ${p.dir_name}` : p.dir_name,
        y,
        p.topic,
        p.event_date,
        p.parent_path,
        ts,
        ts,
        ts
      ).lastInsertRowid;
    const jobId = scanner.startScan(id);
    imported.push({ id, path: abs, year: y, dir_name: p.dir_name, event_date: p.event_date, topic: p.topic, jobId });
    managed.set(dirconv.key(abs), { id, path: abs, scan_status: 'scanning' });
  }

  return { imported, skipped, year_path: year_path || null };
}

// 重扫某个年份下的全部主题
function rescanYear(year) {
  const y = String(year || '').trim();
  if (!y) throw new Error('年份不能为空');
  const rows = db.prepare('SELECT id, path FROM folders WHERE year=? ORDER BY event_date DESC, path').all(y);
  const jobs = rows.map((r) => ({ folder_id: r.id, path: r.path, jobId: scanner.startScan(r.id) }));
  return { year: y, count: jobs.length, jobs };
}

module.exports = { inspect, listTopics, importTopics, rescanYear, countMedia };
