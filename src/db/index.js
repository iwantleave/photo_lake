const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'photo_world.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 初始化表结构（schema.sql 内全部使用 IF NOT EXISTS，可重复执行）
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ---------- 轻量迁移：老库补列 ----------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    return true;
  }
  return false;
}

// 目录约定字段：第一层年份 / 第二层 YYYYMMDD+主题
ensureColumn('folders', 'year', 'TEXT');
ensureColumn('folders', 'topic', 'TEXT');
ensureColumn('folders', 'event_date', 'TEXT');
ensureColumn('folders', 'parent_path', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_folders_year  ON folders(year)');
db.exec('CREATE INDEX IF NOT EXISTS idx_folders_event ON folders(event_date)');

// 回填历史数据：按新约定解析路径（不覆盖已存在的合法值）
(function backfillFolderMeta() {
  const dirconv = require('../util/dirconv');
  const rows = db.prepare('SELECT id, path, year, event_date, topic, parent_path, alias FROM folders').all();
  const stmt = db.prepare(
    'UPDATE folders SET year=?, topic=?, event_date=?, parent_path=?, alias=?, gmt_modified=? WHERE id=?'
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (r.year && r.parent_path) continue;
      const p = dirconv.parseFolderPath(r.path);
      if (!p.year && !p.event_date) continue;
      const alias = r.alias || (p.year ? `${p.year} / ${p.dir_name}` : null);
      stmt.run(p.year, p.topic, p.event_date, p.parent_path, alias, new Date().toISOString(), r.id);
    }
  });
  tx();
})();

module.exports = db;
