-- 受管理文件夹
CREATE TABLE IF NOT EXISTS folders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  path            TEXT NOT NULL UNIQUE,           -- 第二层主题目录绝对路径
  alias           TEXT,                           -- 显示名，默认 "YYYY / 目录名"
  year            TEXT,                           -- 第一层年份 YYYY
  topic           TEXT,                           -- 主题 = 文件夹全名（不再截取 YYYYMMDD 前缀）
  event_date      TEXT,                           -- YYYY-MM-DD，由目录名 YYYYMMDD 解析
  parent_path     TEXT,                           -- 第一层（年份）目录绝对路径
  added_at        TEXT NOT NULL,
  last_scan_at    TEXT,
  scan_status     TEXT NOT NULL DEFAULT 'pending', -- pending | scanning | done | failed
  image_count     INTEGER NOT NULL DEFAULT 0,
  video_count     INTEGER NOT NULL DEFAULT 0,
  livephoto_count INTEGER NOT NULL DEFAULT 0,
  gmt_create      TEXT NOT NULL,
  gmt_modified    TEXT NOT NULL
);
-- 媒体文件记录（照片 + 视频）
CREATE TABLE IF NOT EXISTS media (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id      INTEGER NOT NULL REFERENCES folders(id),
  media_type     TEXT NOT NULL,               -- image | video
  file_name      TEXT NOT NULL,
  file_path      TEXT NOT NULL UNIQUE,        -- 绝对路径，唯一
  dir_path       TEXT NOT NULL,
  md5            TEXT,                        -- 内容 MD5；视频 MD5 开关关闭时为 NULL（不参与查重）
  taken_at       TEXT,                       -- ISO 8601
  taken_at_source TEXT NOT NULL DEFAULT 'exif', -- exif | ffprobe | file_mtime
  format         TEXT NOT NULL,              -- jpg/png/.../mov/mp4/m4v/avi
  width          INTEGER,
  height         INTEGER,
  megapixel      REAL,
  camera_make    TEXT,
  camera_model   TEXT,
  lens_model     TEXT,
  f_number       REAL,
  exposure_time  TEXT,
  iso            INTEGER,
  focal_length   REAL,
  orientation    INTEGER,
  gps_lat        REAL,
  gps_lon        REAL,
  gps_alt        REAL,
  duration       REAL,                       -- 视频时长（秒），图片为 NULL
  codec          TEXT,                       -- 视频编码，图片为 NULL
  file_size      INTEGER NOT NULL,           -- 字节
  mtime          TEXT NOT NULL,
  scan_status    TEXT NOT NULL DEFAULT 'ok', -- ok | failed | degraded
  is_missing     INTEGER NOT NULL DEFAULT 0, -- 磁盘文件已不存在
  missing_since  TEXT,                       -- 首次发现丢失的扫描时间
  is_livephoto   INTEGER NOT NULL DEFAULT 0, -- 实况照片标记
  fail_reason    TEXT,
  marked         INTEGER NOT NULL DEFAULT 0, -- 用户标记（重复清理预留）
  raw_metadata   TEXT,                       -- 原始元数据 JSON 全文（列表查询禁止 SELECT 此列）
  gmt_create     TEXT NOT NULL,
  gmt_modified   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_taken_at   ON media(taken_at);
CREATE INDEX IF NOT EXISTS idx_media_format     ON media(format);
CREATE INDEX IF NOT EXISTS idx_media_type       ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_folder     ON media(folder_id);
CREATE INDEX IF NOT EXISTS idx_media_md5        ON media(md5);
CREATE INDEX IF NOT EXISTS idx_media_file_size  ON media(file_size);
CREATE INDEX IF NOT EXISTS idx_media_megapixel  ON media(megapixel);
CREATE INDEX IF NOT EXISTS idx_media_duration   ON media(duration);
CREATE INDEX IF NOT EXISTS idx_media_name       ON media(file_name);
CREATE INDEX IF NOT EXISTS idx_media_live       ON media(is_livephoto);
CREATE INDEX IF NOT EXISTS idx_media_make       ON media(camera_make);
CREATE INDEX IF NOT EXISTS idx_media_model      ON media(camera_model);
CREATE INDEX IF NOT EXISTS idx_media_iso        ON media(iso);
CREATE INDEX IF NOT EXISTS idx_media_focal      ON media(focal_length);

-- 扫描任务
CREATE TABLE IF NOT EXISTS scan_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id     INTEGER NOT NULL REFERENCES folders(id),
  status        TEXT NOT NULL,               -- running | done | cancelled | failed
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  total_count   INTEGER DEFAULT 0,           -- 预估总数
  processed     INTEGER DEFAULT 0,
  current_path  TEXT,                        -- 当前正在扫描的目录
  added         INTEGER DEFAULT 0,
  updated       INTEGER DEFAULT 0,
  failed        INTEGER DEFAULT 0,
  message       TEXT,                        -- 失败/取消原因
  gmt_create    TEXT NOT NULL,
  gmt_modified  TEXT NOT NULL
);
