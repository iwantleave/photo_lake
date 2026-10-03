// 目录命名约定解析：第一层 = 年份 YYYY，第二层 = YYYYMMDD + 主题
// 例：  D:\照片\2026\20260101-过年
//        ^^^^^^ 年份层        ^^^^^^^^^^^^^^^ 主题层（日期 20260101 + 主题"过年"）

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
// ok=false 表示不符合 YYYYMMDD 约定（仍返回整名作为 topic，保证不丢数据）
function parseTopicName(name) {
  if (!name) return { event_date: null, topic: null, ok: false };
  const m = TOPIC_RE.exec(name);
  if (!m) return { event_date: null, topic: name, ok: false };
  const [, y, mo, d, rest] = m;
  if (!isValidYmd(y, mo, d)) return { event_date: null, topic: name, ok: false };
  const topic = (rest || '').trim();
  return {
    event_date: `${y}-${mo}-${d}`,
    topic: topic || null,
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
