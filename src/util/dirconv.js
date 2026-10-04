// 目录命名约定解析：
//   第一层（年份层）= 年份 YYYY，用于分组/归档，例 D:\照片\2026
//   第二层（主题层）= 文件夹「全名」即主题，例 D:\照片\2026\20260101-过年
//   约定变更：主题名 = 文件夹全名，不再截取/剥离日期前缀；日期仅解析为 event_date 作排序用。

const path = require('path');

const YEAR_RE = /^(19|20)\d{2}$/;
// 20260101-过年 / 20260101过年 / 20260101_过年 / 20260101 过年
const TOPIC_RE = /^((?:19|20)\d{2})(\d{2})(\d{2})(?:[-_·.\s]+)?(.*)$/;

function isYearName(name) {
  return typeof name === 'string' && YEAR_RE.test(name);
}

function isValidYmd(y, m, d) {
  const yi = parseInt(y, 10), mi = parseInt(m, 10), di = parseInt(d, 10);
  if (mi < 1 || mi > 12) return false;
  if (di < 1 || di > 31) return false;
  const dim = new Date(Date.UTC(yi, mi, 0)).getUTCDate();
  return di <= dim && yi >= 1900 && yi <= 2200;
}

// 解析第二层目录名 -> { event_date, topic, ok }
// 关键约定变更：topic 一律使用「文件夹全名」，不再从名称中剥离/截取日期前缀。
//   - 例：目录 "20260101-过年" 的 topic = "20260101-过年"（整名），event_date 仍解析为 2026-01-01 仅用于排序。
//   - 目录名不带日期前缀时（如 "旅行"），topic = 整名，event_date = null。
// ok=true 仅表示目录名带有合法 YYYYMMDD 前缀（内部排序降级用），不再用于截断名称或弹出警告。
function parseTopicName(name) {
  if (!name) return { event_date: null, topic: null, ok: false };
  const m = TOPIC_RE.exec(name);
  if (!m) return { event_date: null, topic: name, ok: false };
  const [, y, mo, d] = m;
  if (!isValidYmd(y, mo, d)) return { event_date: null, topic: name, ok: false };
  // 使用文件夹全名作为主题；日期仅作为可选排序元数据，不再从名称中剥离
  return {
    event_date: `${y}-${mo}-${d}`,
    topic: name,
    ok: true
  };
}

// 解析主题层绝对路径 -> { year, parent_path, event_date, topic, ok }
function parseFolderPath(p) {
  const abs = path.resolve(p);
  const parent = path.dirname(abs);
  const base = path.basename(abs);
  const parsed = parseTopicName(base);
  const parentName = path.basename(parent);
  const year = isYearName(parentName) ? parentName : (parseTopicName(base).event_date || '').slice(0, 4) || null;
  return {
    path: abs,
    parent_path: parent,
    dir_name: base,
    year,
    event_date: parsed.event_date,
    topic: parsed.topic,
    ok: parsed.ok
  };
}

// 路径比较键（Windows 下盘符/大小写不敏感）
function key(p) {
  return path.resolve(p).toLowerCase();
}

module.exports = { YEAR_RE, TOPIC_RE, isYearName, isValidYmd, parseTopicName, parseFolderPath, key };
