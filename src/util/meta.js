const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const exifr = require('exifr');
const sharp = require('sharp');

// 流式计算文件 MD5（避免大视频一次性载入内存）
function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function computeMegapixel(w, h) {
  if (!w || !h) return null;
  return Math.round(((w * h) / 1e6) * 10) / 10;
}

// 快门速度数值 -> "1/250" 文本
function exposureToText(v) {
  if (v == null) return null;
  if (v >= 1) return String(Math.round(v * 100) / 100);
  const denom = Math.round(1 / v);
  return `1/${denom}`;
}

// "2026-08-20 14:32:05 +0800" / "2026-08-20T06:32:05Z" -> ISO 8601
function normalizeTakenAt(raw) {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (isNaN(t)) return null;
  return new Date(t).toISOString();
}

// ISO6709 "+30.1234+120.5678+015.2/" -> { gps_lat, gps_lon, gps_alt }
function parseIso6709(s) {
  if (!s) return {};
  const parts = s.match(/[+-][\d.]+/g);
  if (!parts) return {};
  const res = {};
  if (parts[0]) res.gps_lat = parseFloat(parts[0]);
  if (parts[1]) res.gps_lon = parseFloat(parts[1]);
  if (parts[2]) res.gps_alt = parseFloat(parts[2]);
  return res;
}

// 调用 ffprobe 返回 JSON
function ffprobeJson(filePath, ffprobePath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 30000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

// 解析 ffprobe 的 JSON 为结构化字段
function parseFfprobeJson(json) {
  const fmt = json.format || {};
  const streams = json.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video') || {};
  const tags = fmt.tags || {};

  const width = parseInt(videoStream.width, 10) || null;
  const height = parseInt(videoStream.height, 10) || null;
  const duration = fmt.duration
    ? parseFloat(fmt.duration)
    : videoStream.duration
    ? parseFloat(videoStream.duration)
    : null;
  const codec = videoStream.codec_name || null;

  // 拍摄时间：优先带时区的 creationdate
  const takenRaw =
    tags['com.apple.quicktime.creationdate'] || tags.creation_time || null;
  // GPS（ISO6709）
  const iso6709 =
    tags['com.apple.quicktime.location.ISO6709'] || tags.location || null;
  const gps = parseIso6709(iso6709);
  // 厂商/型号
  const camera_make = tags['com.apple.quicktime.make'] || tags.make || null;
  const camera_model = tags['com.apple.quicktime.model'] || tags.model || null;

  return {
    width,
    height,
    duration: duration != null ? Math.round(duration * 10) / 10 : null,
    codec,
    taken_at: normalizeTakenAt(takenRaw),
    takenSource: takenRaw ? 'ffprobe' : null,
    camera_make,
    camera_model,
    ...gps
  };
}

// 解析图片（含 HEIC）。ffprobeResolved: { ok, path }
async function parseImage(filePath, ffprobeResolved) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const isHeic = ext === 'heic' || ext === 'heif';

  let exif = {};
  let gps = {};
  let exifFull = {};
  try {
    exif = (await exifr.parse(filePath)) || {};
  } catch (e) {
    exif = {};
  }
  try {
    exifFull = (await exifr.parse(filePath, { silent: true })) || {};
  } catch (e) {
    exifFull = {};
  }
  try {
    gps = (await exifr.gps(filePath)) || {};
  } catch (e) {
    gps = {};
  }

  // 分辨率：非 HEIC 优先 sharp；HEIC sharp 不支持，回退 ffprobe
  let width = null;
  let height = null;
  let sharpError = null;
  if (!isHeic) {
    try {
      const m = await sharp(filePath).metadata();
      width = m.width || null;
      height = m.height || null;
    } catch (e) {
      sharpError = e.message;
    }
  }
  let ffprobeMerged = null;
  if ((width == null || height == null) && ffprobeResolved && ffprobeResolved.ok) {
    try {
      const fj = await ffprobeJson(filePath, ffprobeResolved.path);
      const p = parseFfprobeJson(fj);
      width = p.width;
      height = p.height;
      ffprobeMerged = fj;
    } catch (e) {
      /* 分辨率留空 */
    }
  }

  // 拍摄时间
  let taken_at = null;
  let taken_at_source = 'file_mtime';
  if (exif.DateTimeOriginal) {
    taken_at = normalizeTakenAt(exif.DateTimeOriginal);
    taken_at_source = 'exif';
  } else if (exif.CreateDate) {
    taken_at = normalizeTakenAt(exif.CreateDate);
    taken_at_source = 'exif';
  }

  // raw_metadata（HEIC 合并 ffprobe 输出，保证原始仓库完整）
  const raw = { exif: exifFull };
  if (sharpError) raw.sharpError = sharpError;
  if (ffprobeMerged) raw.ffprobe = ffprobeMerged;

  return {
    media_type: 'image',
    width,
    height,
    megapixel: computeMegapixel(width, height),
    taken_at,
    taken_at_source,
    camera_make: exif.Make || null,
    camera_model: exif.Model || null,
    lens_model: exif.LensModel || null,
    f_number: exif.FNumber != null ? Math.round(exif.FNumber * 100) / 100 : null,
    exposure_time: exposureToText(exif.ExposureTime),
    iso: exif.ISO || exif.ISOSpeedRatings || null,
    focal_length: exif.FocalLength != null ? Math.round(exif.FocalLength * 10) / 10 : null,
    orientation: exif.Orientation || null,
    gps_lat: gps.latitude != null ? gps.latitude : null,
    gps_lon: gps.longitude != null ? gps.longitude : null,
    gps_alt: gps.altitude != null ? gps.altitude : null,
    duration: null,
    codec: null,
    scan_status: 'ok',
    raw_metadata: JSON.stringify(raw)
  };
}

// 解析视频（依赖 ffprobe）。ffprobe 不可用时降级
async function parseVideo(filePath, ffprobeResolved) {
  if (!ffprobeResolved || !ffprobeResolved.ok) {
    // 降级：仅基础信息，raw_metadata 为 NULL
    return {
      media_type: 'video',
      width: null,
      height: null,
      megapixel: null,
      taken_at: null,
      taken_at_source: 'file_mtime',
      camera_make: null,
      camera_model: null,
      lens_model: null,
      f_number: null,
      exposure_time: null,
      iso: null,
      focal_length: null,
      orientation: null,
      gps_lat: null,
      gps_lon: null,
      gps_alt: null,
      duration: null,
      codec: null,
      scan_status: 'degraded',
      raw_metadata: null
    };
  }
  try {
    const fj = await ffprobeJson(filePath, ffprobeResolved.path);
    const p = parseFfprobeJson(fj);
    return {
      media_type: 'video',
      width: p.width,
      height: p.height,
      megapixel: computeMegapixel(p.width, p.height),
      taken_at: p.taken_at,
      taken_at_source: p.takenSource || 'file_mtime',
      camera_make: p.camera_make,
      camera_model: p.camera_model,
      lens_model: null,
      f_number: null,
      exposure_time: null,
      iso: null,
      focal_length: null,
      orientation: null,
      gps_lat: p.gps_lat || null,
      gps_lon: p.gps_lon || null,
      gps_alt: p.gps_alt || null,
      duration: p.duration,
      codec: p.codec,
      scan_status: 'ok',
      raw_metadata: JSON.stringify(fj)
    };
  } catch (e) {
    return {
      media_type: 'video',
      width: null,
      height: null,
      megapixel: null,
      taken_at: null,
      taken_at_source: 'file_mtime',
      camera_make: null,
      camera_model: null,
      lens_model: null,
      f_number: null,
      exposure_time: null,
      iso: null,
      focal_length: null,
      orientation: null,
      gps_lat: null,
      gps_lon: null,
      gps_alt: null,
      duration: null,
      codec: null,
      scan_status: 'failed',
      fail_reason: `ffprobe 解析失败: ${e.message}`,
      raw_metadata: null
    };
  }
}

module.exports = {
  md5File,
  computeMegapixel,
  ffprobeJson,
  parseFfprobeJson,
  parseImage,
  parseVideo
};
