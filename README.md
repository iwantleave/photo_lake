# 照片世界 (Photo World)

> 本地照片 / 视频元数据管理与检索系统 —— 纯客户端、无云端、不依赖任何后端数据库服务。

照片世界是一款运行在你自己电脑上的照片 / 视频管理工具。它专注于**元数据管理、整理与多维检索**，不做缩略图、不把你的照片上传到任何地方。添加文件夹后，它会后台递归扫描，把文件名、MD5、拍摄时间、分辨率、EXIF、GPS、时长、编码等信息解析进本地 SQLite 数据库，让你能通过筛选、排序、重复检测、地图打点等方式快速找到任意一张。

English version: [README.en.md](./README.en.md)

---

## 特性

- **本地优先**：数据全部存在本机 `data/photo_world.db`（SQLite + WAL），不联网、不上云。
- **多格式解析**：
  - 图片：JPG / JPEG、HEIC（iPhone 实拍）、WEBP、PNG、TIFF 等（sharp 支持范围）。
  - 视频：MOV、MP4、AVI（经 ffprobe 提取时长 / 编码 / 分辨率 / GPS / 设备）。
- **iPhone 实况照片**：自动识别同目录同文件名的 HEIC + MOV 配对，标记为实况照片（`is_livephoto`）。
- **完整 EXIF / GPS**：相机厂商、型号、镜头、光圈、快门、ISO、焦距、方向、经纬度、海拔全部入库。
- **增量扫描**：按文件修改时间与大小跳过未变更文件，重复扫描秒级完成；支持中途取消。
- **缺失文件保留**：源文件被移动 / 删除后，记录保留并标记 `is_missing` + 丢失时间，便于追溯。
- **媒体列表 + 多维筛选**：按来源格式、拍摄时间、属性（实况照片 / 有 GPS / 已丢失 / 用户标记）等分组筛选，支持表头排序与翻页。
- **详情弹窗**：点任意一行查看该条的 37 个字段全貌，含 `raw_metadata` 原始元数据（JSON 美化）；有坐标时一键跳转地图。
- **重复项检测**：按文件 MD5 查重，视频也可参与（MD5 开关可配）。
- **地图打点**：基于 Leaflet + OpenStreetMap，把带 GPS 的照片 / 视频按地理位置打点、聚合，点击直接看详情。
- **仪表盘**：首页汇总统计；扫描任务页可查看每个文件夹的进度与状态。
- **设置页**：配置 ffmpeg / ffprobe 路径、并发数等。

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node.js 22+ |
| Web 框架 | Fastify 4 |
| 数据库 | better-sqlite3（WAL 模式，纯本地文件） |
| 图像解析 | sharp（分辨率）、exifr（EXIF / GPS） |
| 音视频解析 | ffmpeg / ffprobe（用户自备，路径可配置） |
| 模板 / 前端 | EJS + htmx + Alpine.js（无 SPA 框架） |
| 地图 | Leaflet 1.9.4 + leaflet.markercluster 1.5.3 + OpenStreetMap 瓦片（渲染库自托管，离线可用） |

## 目录结构

```
photo_lake/
├── src/
│   ├── server.js          # Fastify 入口，监听 127.0.0.1:3000
│   ├── db/                # SQLite schema 与连接（WAL）
│   ├── config/            # 配置读取（读 config/settings.json）
│   ├── routes/            # api.js（REST）、pages.js（页面路由）
│   ├── scanner.js         # 扫描引擎（递归 / 增量 / 流式 MD5 / 可取消）
│   └── util/meta.js       # 元数据解析流水线（图片 / 视频 / HEIC）
├── views/                 # EJS 页面与 partials（nav / foot）
├── public/                # app.js、styles.css（地图库自托管于 /vendor）
├── design/               # 页面原型（mockup / 无底图地图预览）
├── data/                 # 本地数据库（运行时生成，gitignore）
├── config/               # 本地配置 settings.json（gitignore）
├── photo_desc.md          # AI 照片描述功能设计方案（规划中）
├── design_prd.md          # 产品需求文档 v1.3
├── package.json
└── .gitignore
```

## 快速开始

```bash
git clone https://github.com/iwantleave/photo_lake.git
cd photo_lake
npm install
npm start
```

启动后浏览器打开 **http://127.0.0.1:3000** 即可使用。

> 提示：`npm start` 与 `npm run dev` 均直接运行 `node src/server.js`。

## 配置 ffmpeg / ffprobe

视频、HEIC 的分辨率与元数据解析依赖 `ffmpeg` / `ffprobe`。有两种方式启用：

1. **设置页（推荐）**：在应用「设置」页填入 `ffmpeg.exe` 与 `ffprobe.exe` 的完整路径，保存后立即生效，无需重启。
2. **配置文件**：编辑 `config/settings.json`（首次需手动创建）：

   ```json
   {
     "ffmpegPath": "D:/ffmpeg/bin/ffmpeg.exe",
     "ffprobePath": "D:/ffmpeg/bin/ffprobe.exe"
   }
   ```

若不配置，应用仍可运行，但视频 / HEIC 会走**降级模式**（仅解析能拿到的有限字段）。`ffprobe` / `ffmpeg` 在 PATH 中时也会自动探测到。

> 注意：`config/` 目录已被 `.gitignore` 排除，你的本地路径与密钥不会进入版本库。

## 支持的媒体格式

| 类型 | 格式 | 说明 |
|---|---|---|
| 图片 | JPG / JPEG | 完整 EXIF + 分辨率 |
| 图片 | HEIC | 需 ffprobe；EXIF 取自 exifr，分辨率取自 EXIF 真实像素 |
| 图片 | WEBP / PNG / TIFF 等 | sharp 支持范围 |
| 视频 | MOV / MP4 / AVI | 需 ffprobe；提取时长 / 编码 / 分辨率 / GPS / 设备 |

## 数据说明

- 所有扫描结果保存在本机 `data/photo_world.db`（better-sqlite3，WAL 模式），**不上传任何服务器**。
- `data/`、`config/`、`logs/`、`node_modules/`、`.workbuddy/` 均已被 `.gitignore` 排除，仓库只包含源码文档，不含你的照片数据或本地配置。
- 移除某个文件夹时，其产生的媒体记录会一并清理。

## 核心能力一览（部分字段）

每条媒体记录包含：文件名、路径、MD5、拍摄时间（及来源标记）、格式、类型（图片/视频）、分辨率、像素数、时长、编码、相机厂商 / 型号、镜头、光圈、快门、ISO、焦距、方向、GPS 经纬度 / 海拔、扫描状态、是否丢失、是否实况照片、用户标记、入库 / 更新时间，以及 `raw_metadata` 原始元数据存储。

完整数据库设计见 [design_prd.md](./design_prd.md)。

## 开发路线图（M2，规划中）

- **AI 照片描述**：对每张照片用多模态模型生成一段自然语言描述（方案见 [photo_desc.md](./photo_desc.md)）。
- 导出 CSV（当前筛选结果 / 全量）。
- 统计图表（按相机型号 / 年份 / 月份 / 地点分布）。
- 重复项一键清理（移动 / 删除）。
- 地图底图离线化（自托管瓦片，满足完全离线场景）。

## 合规说明

本项目面向美国客户，按美国法律合规。地图功能使用 OpenStreetMap 公共瓦片与 WGS-84 坐标系，iPhone 原始 GPS 直接打点，无需 GCJ-02 火星坐标转换。底图瓦片由前端浏览器直连 `tile.openstreetmap.org`，仅此一处联网；渲染库与聚合逻辑完全自托管、可离线运行。

## 许可证

本项目采用 [MIT 许可证](./LICENSE)。

- 任何人可免费使用、复制、修改、合并、发布、分发、再授权及销售本软件，须保留版权声明与许可声明。
- 软件按「原样」提供，作者不承担任何担保或责任。
- 版权归属：iwantleave（2026）。
