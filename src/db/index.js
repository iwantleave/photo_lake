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

// 回填历史数据：把 topic 统一刷新为「文件夹全名」（修复旧库被截取日期前缀的主题名）；
// 同时补全缺失的 year / event_date / parent_path / alias（不覆盖已有合法值）。
(function backfillFolderMeta() {
  const dirconv = require('../util/dirconv');
  const rows = db.prepare('SELECT id, path, year, event_date, topic, parent_path, alias FROM folders').all();
  const stmt = db.prepare(
    'UPDATE folders SET year=?, topic=?, event_date=?, parent_path=?, alias=?, gmt_modified=? WHERE id=?'
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      const p = dirconv.parseFolderPath(r.path);
      const base = path.basename(r.path);
      const topic = base; // 主题 = 文件夹全名，不截取日期
      const year = r.year || p.year || null;
      const parent_path = r.parent_path || p.parent_path || null;
      const event_date = r.event_date || p.event_date || null;
      const alias = r.alias || (year ? `${year} / ${base}` : null);
      stmt.run(year, topic, event_date, parent_path, alias, new Date().toISOString(), r.id);
    }
  });
  tx();
})();

module.exports = db;
