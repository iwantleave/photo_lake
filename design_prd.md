# Photo World（照片世界）产品需求文档（PRD）

| 项目   | 内容                                |
| ---- | --------------------------------- |
| 产品名称 | Photo World（照片世界）— 本地照片/视频管理与检索系统 |
| 文档版本 | v1.3                              |
| 文档状态 | 定稿                               |
| 编写日期 | 2026-08-26                        |
| 目标读者 | 开发（本人）、产品（本人）                     |

---

## 1. 产品概述

### 1.1 产品定位

Photo World 是一款**运行在本地的照片/视频管理与检索软件**。用户将自己电脑上的文件夹添加进系统，系统扫描并解析每个照片/视频文件的元数据（文件名、MD5、拍摄时间、所在目录、格式、分辨率、文件大小、视频时长等），统一存入本地数据库，随后提供以**表格为核心**的媒体文件列表展示、筛选与检索能力。

产品聚焦「**管数据，不管展示**」：v1 版本**不生成、不显示缩略图**（视频亦不做预览/截帧），不做图片美化或在线相册，所有能力围绕元数据的管理、整理、查询、搜索展开。

### 1.2 解决的问题

- 照片和视频散落在多个文件夹中，无法统一查看"我到底有多少照片/视频、都在哪、什么格式、多大"。
- 重复文件（内容相同、文件名不同）无法识别，占用磁盘空间。
- 想按拍摄时间、格式、分辨率、大小等条件快速筛选照片时，资源管理器力不从心。
- 拍摄时间混乱（无 EXIF、时间错误）的照片难以按时间线整理；视频拍摄时间无法直接查看。

### 1.3 目标用户与规模假设

| 项       | 假设                                                |
| ------- | ------------------------------------------------- |
| 用户      | 单人使用，本机部署（Windows 优先）                             |
| 单文件夹照片数 | 数百张                                               |
| 全库照片总量  | 数万张（按 5 万张设计余量）                                   |
| 单张照片大小  | 普通 JPEG/HEIC/PNG，几 MB 级                           |
| 单个视频大小  | mov/mp4 通常数十 MB 至数 GB 级（iPhone 录制的 mov 可达 1~4 GB） |
| 视频数量占比  | 预估占全库 5%~20%                                      |
| 文件夹数量   | 数十个                                               |

---

## 2. 范围界定

### 2.1 v1 包含（In Scope）

1. **文件夹管理**：添加、查看、移除（逻辑移除，不删源文件）受管理的文件夹。
2. **后台扫描**：递归扫描文件夹下所有受支持格式的**照片与视频**文件（mov/mp4/avi），解析元数据并入库。
3. **媒体列表**：以表格形式展示所有照片/视频的元数据，支持分页、排序。
4. **筛选与搜索**：按媒体类型（图片/视频）、文件夹、格式、拍摄时间范围、分辨率、相机厂商/型号、拍摄参数（光圈/快门/ISO/焦距）、有无地理位置、文件大小范围、视频时长筛选；按文件名、MD5 等字段关键字搜索。
5. **重复文件识别**：基于 MD5 标记内容重复的文件组（照片与视频统一规则）。
6. **扫描任务管理**：查看扫描进度、状态，支持手动重新扫描。
7. **系统设置页面**：ffmpeg/ffprobe 路径配置与测试、扫描并发度、格式白名单、忽略目录等。
8. **实况照片支持**：自动识别同目录同主文件名的 HEIC+MOV 成对文件并标记 `is_livephoto`（只做文件名匹配，不记录配对引用），列表展示与筛选。

### 2.2 v1 明确不包含（Out of Scope）

- ❌ **缩略图**：列表不显示任何缩略图/预览图，不生成缩略图缓存；视频不做截帧预览、不做在线播放。
- ❌ 人脸识别、场景识别、AI 打标。
- ❌ WebDAV / NAS 直连，仅支持本机磁盘路径。
- ❌ 移动端 App / 响应式移动适配。
- ❌ 照片/视频编辑、转码、导出、在线相册分享。
- ❌ 多用户、权限体系。
- ❌ 删除/移动源文件（v1 只读源文件，最大程度保证数据安全）。
- ❌ mov/mp4/avi 之外的其他视频容器格式（mkv/wmv/flv 等列入 v1.5+ 候选，可通过配置扩展后缀白名单）。

---

## 3. 技术架构约定（已定）

| 层       | 选型                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 运行时     | Node.js 22+                                                                                                                        |
| 后端框架    | Fastify                                                                                                                            |
| 数据库     | better-sqlite3，开启 WAL 模式，数据库文件存本地                                                                                                  |
| 图像解析    | sharp（分辨率、格式、尺寸等）；exifr（EXIF 拍摄时间等元数据）                                                                                             |
| HEIC 解析 | **硬性要求，必须支持**。策略：exifr 解析 HEIC 容器内的 EXIF（拍摄时间）；分辨率通过 ffprobe 读取（sharp 预编译版本不含 HEIC 解码，不依赖 sharp 处理 HEIC）—— 本系统只需元数据无需解码像素，此组合可稳定覆盖 |
| 视频解析    | ffprobe（拍摄时间 creation_time、分辨率、时长、编码），路径由用户在设置页配置，启动时校验版本可用性；不可用时优雅降级（见 FR-2.4）                                                    |
| 前端      | EJS 模板 + htmx + Alpine.js，无 SPA 框架                                                                                                 |
| 部署形态    | 本机启动服务（localhost），浏览器访问                                                                                                            |

依赖安装优先使用国内镜像源。

---

## 4. 功能需求

### 4.1 模块一：文件夹管理

#### FR-1.1 新增文件夹

- **描述**：用户在「文件夹管理」页面输入（或通过系统路径选择）一个本机目录路径，将其添加为受管理文件夹。
- **输入校验**：
  - 路径必须存在且为目录（服务端校验，前端即时提示）。
  - 不允许添加重复路径（与已有文件夹路径完全相同则拒绝，提示已存在）。
  - 不允许添加已有受管理文件夹的子目录（避免重复扫描同一文件），系统检测并提示；父目录下新添加子目录场景给出警告并允许用户确认强制添加。
- **添加成功后**：自动创建一个**后台扫描任务**对该文件夹进行首次全量扫描（见 4.2）。
- **字段**：文件夹记录包含 —— ID、路径、别名（可选，用户自定义显示名）、添加时间、最后扫描时间、扫描状态、统计缓存（image_count 图片数 / video_count 视频数 / livephoto_count 实况照片对数，扫描完成后更新）。

#### FR-1.2 文件夹列表

- **展示**：表格列出所有受管理文件夹：别名/路径、图片数（image_count）、视频数（video_count）、实况照片数（livephoto_count，按对计）、最后扫描时间、扫描状态（未扫描/扫描中/已完成/失败）、操作。
- **操作**：
  - 「重新扫描」：对该文件夹发起一次扫描任务。
  - 「移除」：逻辑移除该文件夹及其下所有媒体记录（**不删除磁盘文件**）。移除需二次确认弹窗，明确提示"仅从系统中移除记录，不删除照片/视频文件"。若该文件夹存在进行中的扫描任务，先自动取消任务再执行移除；已入库数据随移除一并删除（记录级，不动源文件）。

#### FR-1.3 重复/嵌套路径规则

- 添加 B 时若存在已管理路径 A 且 B 是 A 的子路径 → 默认阻止，提示冲突。
- 添加 A 时若存在已管理路径 B 且 B 是 A 的子路径 → 警告"部分文件会被重复管理"，允许用户确认后添加（文件入库时按 file_path 唯一去重，同一文件只归属一条记录）。

### 4.2 模块二：后台扫描与元数据解析

#### FR-2.1 扫描触发时机

- 新增文件夹后自动触发首次扫描。
- 用户对已有文件夹手动触发「重新扫描」。
- v1 不做文件系统监听（watch），不做定时自动扫描；以手动触发保证行为可控。

#### FR-2.2 扫描流程

1. 递归遍历文件夹（含子目录），收集所有扩展名匹配的**图片与视频**文件。
2. 对每个文件按类型分发解析：图片走 sharp/exifr 管线，视频走 ffprobe 管线（见 FR-2.3）。
3. 逐条写入数据库（事务批量提交，每 50~100 条一个事务）。
4. 更新任务进度与文件夹统计缓存（image_count / video_count / livephoto_count，目录匹配标记完成后按最终结果汇总）。
5. 扫描结束写入扫描摘要（新增数、更新数、失败数、耗时）。

#### FR-2.3 元数据解析

每个媒体文件解析并记录以下字段：

| 字段              | 来源      | 说明                                                                                                               |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| id              | 系统      | 主键，自增                                                                                                            |
| media_type      | 系统      | `image` / `video`                                                                                                |
| file_name       | 文件系统    | 含扩展名的文件名                                                                                                         |
| file_path       | 文件系统    | 绝对路径（唯一索引）                                                                                                       |
| dir_path        | 文件系统    | 所在目录绝对路径                                                                                                         |
| folder_id       | 系统      | 所属受管理文件夹 ID                                                                                                      |
| md5             | 计算      | 文件内容 MD5（流式读取计算，用于查重）。视频 MD5 开关（FR-5.2）关闭时为 NULL，不参与查重                              |
| taken_at        | 元数据     | 拍摄时间。图片：优先 EXIF DateTimeOriginal，其次 CreateDate；视频：优先 ffprobe tags 的 com.apple.quicktime.creationdate（带时区），其次 creation_time（UTC）。均无则取文件修改时间，并标记 `taken_at_source` |
| taken_at_source | 系统      | exif / ffprobe / file_mtime                                                                                      |
| format          | 文件系统/解析 | 文件格式（规范化小写）：图片 jpg/png/heic/webp/gif/bmp/tiff；视频 mov/mp4/m4v/avi                                                     |
| width           | 解析      | 宽度（px）。图片来自 sharp；HEIC 图片与视频来自 ffprobe                                                                           |
| height          | 解析      | 高度（px）。图片来自 sharp；HEIC 图片与视频来自 ffprobe                                                                           |
| megapixel       | 计算      | width×height/100万，保留 1 位小数（便于筛选）                                                                                 |
| camera_make    | EXIF/ffprobe | 相机厂商（Make），如 Apple / Canon / Nikon / Sony。图片来自 EXIF；iPhone 视频来自 ffprobe QuickTime tags（com.apple.quicktime.make）；安卓视频多为 NULL |
| camera_model   | EXIF/ffprobe | 相机型号（Model），如 iPhone 15 Pro / EOS R6。图片来自 EXIF；iPhone 视频来自 ffprobe tags（com.apple.quicktime.model）；安卓视频多为 NULL |
| lens_model     | EXIF     | 镜头型号（LensModel），如 EF24-70mm f/2.8L；无则为 NULL                                                                      |
| f_number       | EXIF     | 光圈（FNumber），如 1.8，保留 2 位小数；无则为 NULL                                                                          |
| exposure_time  | EXIF     | 快门速度（ExposureTime），以文本存储，如 "1/250"、"1/4"；无则为 NULL                                                          |
| iso            | EXIF     | 感光度（ISOSpeedRatings），整数，如 100/400/3200；无则为 NULL                                                                |
| focal_length   | EXIF     | 焦距（FocalLength，mm），保留 1 位小数；无则为 NULL                                                                          |
| orientation    | EXIF     | 图像方向（Orientation，1~8），用于记录旋转信息（v1 不显示预览，留作后续）；无则为 NULL                                              |
| gps_lat        | EXIF/ffprobe | 地理位置纬度（十进制度）。图片来自 EXIF GPSLatitude；iPhone 视频来自 ffprobe tags（location.ISO6709 解析）                                            |
| gps_lon        | EXIF/ffprobe | 地理位置经度（十进制度），来源同上                                                                                               |
| gps_alt        | EXIF/ffprobe | 地理位置海拔（米），来源同上                                                                                                  |
| duration        | ffprobe | 视频时长（秒，保留 1 位小数）；图片为 NULL                                                                                        |
| codec           | ffprobe | 视频编码（h264/hevc/prores 等）；图片为 NULL                                                                                |
| file_size       | 文件系统    | 文件大小（字节）                                                                                                         |
| mtime           | 文件系统    | 文件修改时间                                                                                                           |
| gmt_create      | 系统      | 记录创建时间（入库时间），所有表统一字段                                                                                             |
| gmt_modified    | 系统      | 记录最后修改时间，所有表统一字段                                                                                                 |
| scan_status     | 系统      | ok / failed / degraded（ffprobe 未配置，仅入基础信息）                                                                       |
| is_missing      | 系统      | 磁盘文件已不存在时置 1（保留记录，见 FR-2.4）                                                                                  |
| missing_since   | 系统      | 首次发现丢失的扫描时间；is_missing=1 时有值，恢复后清空                                                                            |
| fail_reason     | 系统      | 失败/降级原因，失败时记录                                                                                                    |
| marked          | 系统      | 用户标记（重复清理预留，见 FR-3.4）                                                                                            |
| is_livephoto    | 系统      | 是否实况照片：同目录下存在同主文件名的另一半（HEIC+MOV 成对）则为 1，否则 0。只做文件名匹配，不记录配对文件引用（见 FR-2.5）                                         |
| raw_metadata    | 解析      | 原始元数据 JSON 全文，见下方「原始元数据留存」说明                                                                                  |

**原始元数据留存（raw_metadata）**：

- **内容**：图片存 exifr 完整解析结果的 JSON；**HEIC 图片因分辨率来自 ffprobe（exifr 不解码 HEIC 像素），其 raw_metadata 须同时合并 ffprobe 输出的分辨率等 stream 信息，确保原始元数据仓库完整**；视频存 ffprobe `-show_format -show_streams` 的完整 JSON 输出（含 QuickTime tags 如 make/model/location 等）。
- **用途**：元数据的"后悔药"——后续版本新增解析字段（如 HDR 标记、白平衡、帧率、码率等）时，直接从库内 JSON 补列提取，**无需重新扫描源文件**；亦可用于文件详情展示与问题排查。
- **存储与性能约定**：
  - 每条约 2~10 KB，5 万条约增加 100~500 MB 数据库体积，SQLite 可承受，不做压缩（v1 保持简单，压缩列为 v1.5 优化候选）。
  - **列表/筛选/搜索等查询一律不得 SELECT 该列**（按需仅在详情场景取单条），避免大字段拖慢列表查询性能。
  - 解析失败（failed）时该列可为 NULL。
  - 降级模式（degraded）下的视频无 ffprobe JSON，仅入库时记录基本字段，raw_metadata 为 NULL；ffprobe 配置后补扫时回填。

**支持的图片格式**：jpg/jpeg、png、heic/heif、webp、gif、bmp、tiff/tif。**其中 HEIC/HEIF 为硬性要求**（iPhone 默认格式），解析策略见第 3 节技术架构；HEIC 的拍摄时间来自 exifr、分辨率来自 ffprobe。  
**支持的视频格式**：mov、mp4、m4v、avi（iPhone 实况照片的 mov 与普通录像同等处理；avi 为常见老旧录像容器）。  
其他扩展名忽略。两类格式均可在配置中扩展/缩减后缀白名单，并可按目录名忽略（如 `node_modules`、`.git` 等）。

#### FR-2.4 视频解析与 ffprobe 降级策略

- ffprobe 以子进程方式调用（`ffprobe -v quiet -print_format json -show_format -show_streams <file>`），**必须做路径转义与超时控制**（单次调用超时 30s，超时按 failed 处理），防止特殊字符文件名或损坏文件导致进程挂起。
- **ffprobe 路径由用户在设置页配置**（详见 FR-5.1）：
  - 设置页提供路径输入 +「测试」按钮，执行 `ffprobe -version` 校验，成功显示版本号。
  - 路径未配置或校验失败时系统仍可运行，但进入**降级模式**：视频仅入库基础信息（文件名、路径、大小、mtime、MD5），分辨率/时长/编码留空，拍摄时间取文件修改时间，scan_status = degraded；首页与设置页显示醒目提示"ffprobe 未配置，视频详细信息不可用"。
  - 用户后续配置成功后，重新扫描会对 degraded 的视频记录**强制重新解析**补全信息（设置页提供一键触发入口）。

**容错要求**：

- 单个文件解析失败（损坏、格式异常）不中断整体扫描，标记 failed 并记录原因。
- 扫描任务可取消（页面提供取消按钮）。
- 重复扫描时：file_path 已存在且 mtime + file_size 未变 → 跳过重新解析（含 MD5 计算）；mtime 或 size 变化 → 重新解析并更新记录；scan_status = degraded 的视频在 ffprobe 可用时强制重新解析。
- **missing 文件处理（已决策：保留记录）**：重新扫描发现磁盘上文件已不存在时——
  - 保留记录不物理删除，`is_missing` 置 1。
  - 记录 `missing_since` = 该次扫描时间（首次发现丢失时写入，之后不再覆盖），列表展示为"missing（自 2026-08-26 22:00 扫描起丢失）"，让用户清楚文件是哪次扫描之后丢失的。
  - 文件若在后续扫描中重新出现（移回原路径），自动恢复 `is_missing = 0` 并重新解析元数据，`missing_since` 清空。
  - 文件夹列表与首页提供 missing 记录数统计，用户可按状态筛出 missing 记录自行判断处理；v1 不提供一键删除记录入口（v1.5 候选）。

**性能要求**：

- 数万个文件全量扫描可后台完成，不阻塞页面其他操作。
- 页面可实时查看扫描进度（已处理/总数、当前正在扫描的目录）。
- MD5 计算采用流式读取，避免大文件（GB 级视频）一次性载入内存。
- 视频处理吞吐显著低于图片（ffprobe 子进程调用 + GB 级 MD5 计算），进度展示需体现"慢文件"预期；同时并发的 ffprobe 子进程数受限（默认 2），避免进程堆积。

#### FR-2.5 实况照片识别与标记（硬性要求）

iPhone 实况照片（Live Photo）在磁盘上是**同目录、同主文件名**的一对文件：`IMG_1234.HEIC`（静态帧）+ `IMG_1234.MOV`（约 3s 动态部分）。系统须在扫描入库时自动识别并打标：

- **标记规则**：同一 `dir_path` 下，去掉扩展名后主文件名完全相同的 image 记录与 video 记录同时存在时，两条记录均置 `is_livephoto = 1`；否则为 0。**只做文件名匹配，不记录配对文件的引用**（无 live_pair_id），需要时通过"同目录+同主文件名"即时查询另一半。
- **识别时机**：每个目录内的文件解析入库完成后，对该目录做一次匹配扫描（纯 SQL/内存匹配，无额外 IO），按目录重新计算该目录下所有记录的 `is_livephoto`，避免全库匹配的性能开销。
- **辅助校验（可选）**：同名但一个是普通照片、一个是无关视频（非实况）的场景，v1 接受按命名规则误判（误判率低）；若 MOV 时长已知（ffprobe 可用），可加"时长 ≤ 5s 才标记"校验降低误判。
- **边界情况**：
  - 只剩一半（MOV 被删或移走）：下次扫描时匹配不到另一半，`is_livephoto` 自动归 0；后续扫描另一半重新出现则自动恢复为 1。
  - 一方为 missing：仍按库内记录参与匹配（记录在即视为存在），`is_livephoto` 保持 1。
- **重复识别的交互**：实况照片的两半各自独立参与 MD5 查重（HEIC 与 MOV 内容不同，不会互为重复）。

### 4.3 模块三：媒体列表展示

#### FR-3.1 列表页（核心页面）

- **展示形式**：纯数据表格（**无缩略图、无图片预览、无视频播放**）。
- **列**（默认展示，可配置显隐）：

| 列        | 说明                                                                 |
| -------- | ------------------------------------------------------------------ |
| 文件名      | file_name；实况照片（is_livephoto=1）在文件名旁加"实况"徽标                         |
| 类型       | image / video（图标区分）                                                |
| 所在文件夹/目录 | 按 folder 别名 + 相对目录展示                                               |
| 拍摄时间     | taken_at，格式 YYYY-MM-DD HH:mm，来源为文件修改时间时以角标标注                       |
| 格式       | format                                                             |
| 分辨率      | `宽×高`                                                              |
| 时长       | 视频显示 mm:ss（如 03:25），图片显示 —                                         |
| 文件大小     | 人类可读格式（如 3.2 MB / 1.4 GB）                                          |
| 状态       | scan_status 与 is_missing 合并展示：ok / failed / degraded / missing；missing 时鼠标悬停或括号内显示丢失时间（自哪次扫描起丢失） |
| 重复       | 若 MD5 在库内出现 ≥2 次，标记"重复"并链接到同 MD5 组                                 |

- **分页**：默认每页 50 条，可选 20/50/100/200；显示总数。
- **排序**：所有列可点击排序（升/降），默认按拍摄时间倒序。
- **行操作**：
  - 「复制完整路径」：点击将 file_path 复制到剪贴板（前端 Clipboard API，成功后轻提示），用户自行粘贴到资源管理器定位。**不引入本地助手进程**（已决策）。
  - 「查看同 MD5」：跳转到该 MD5 的重复组列表。
- **性能**：数万条记录下分页查询响应 < 500ms（SQLite 索引保障：taken_at、format、media_type、folder_id、md5、file_size、duration、is_livephoto、camera_make、camera_model、iso、focal_length 均建索引）。

#### FR-3.2 筛选功能

列表上方为筛选栏，条件之间为 **AND** 关系，支持组合：

| 筛选项     | 控件        | 说明                                           |
| ------- | --------- | -------------------------------------------- |
| 媒体类型    | 下拉单选      | 全部 / 图片 / 视频                                 |
| 文件夹     | 下拉多选      | 按受管理文件夹过滤                                    |
| 格式      | 下拉多选      | jpg/png/heic/mov/mp4…                        |
| 拍摄时间    | 日期范围选择    | 起止日期，支持"仅选年份/月份"粒度                           |
| 分辨率     | 预设区间下拉    | 如 <100万、100-500万、500-1000万、>1000万像素，或自定义宽高范围 |
| 相机厂商    | 下拉多选      | camera_make（如 Apple/Canon/Nikon/Sony），按设备归类        |
| 相机型号    | 下拉多选      | camera_model，依赖厂商二级过滤（前端联动）                      |
| 拍摄参数    | 区间输入      | 光圈 f_number、快门（解析 "1/250" 为秒）、ISO、焦距 focal_length 任一或组合范围 |
| 有/无位置   | 开关        | gps_lat 非 NULL = 有地理位置（按地点归类/排除无定位照片）          |
| 文件大小    | 区间输入      | 支持单位 MB/GB                                   |
| 时长      | 区间输入（仅视频） | 支持单位秒/分钟                                     |
| 状态      | 下拉多选      | ok / failed / missing / degraded             |
| 仅看实况照片  | 开关        | is_livephoto = 1 的记录（成对的 HEIC+MOV，各计一条）      |
| 仅看重复    | 开关        | MD5 出现次数 ≥2 的记录（md5 为 NULL 的记录不参与）           |
| 无拍摄时间信息 | 开关        | taken_at_source = file_mtime 的记录（即无元数据时间）    |

- 筛选条件变化后即时刷新列表（htmx 局部刷新，不整页刷新）。
- 提供「重置筛选」按钮。
- 筛选状态写入 URL query，刷新页面后保持。

#### FR-3.3 搜索功能

- **搜索框**：对 file_name、file_path、dir_path 做 LIKE 模糊匹配（不区分大小写）。
- **精确搜索**：支持前缀语法 —— `md5:xxx` 精确匹配 MD5。
- 搜索与筛选条件可叠加。

#### FR-3.4 重复文件视图

- 独立入口「重复文件」页：按 MD5 分组展示重复组（图片与视频统一规则，GB 级重复视频是清理重点），每组显示该 MD5 的文件数、总占用空间、各文件路径/大小/时间。
- 组内提供「保留其一，其余标记」能力：v1 仅做**标记**（mark 为待处理），不删除文件——为后续清理功能做数据准备。
- 支持按"重复组浪费空间"排序，快速定位大头。

### 4.4 模块四：扫描任务管理

- 任务列表页：展示历史扫描任务 —— 文件夹、开始/结束时间、状态（进行中/已完成/已取消/失败）、处理总数/新增/更新/失败数。
- 进行中任务：显示实时进度（已处理数/预估总数，区分图片/视频计数），可取消。
- 首页概览卡片：媒体总数（图片数/视频数/实况照片对数）、总占用空间、受管理文件夹数、重复文件占用估算、missing 记录数（点击跳转状态筛选）、最近扫描时间。

### 4.5 模块五：系统设置（设置页面）

设置页面承载系统级配置，配置持久化到本地配置文件（JSON，如 `config/settings.json`），修改后即时生效（无需重启服务）。

#### FR-5.1 ffmpeg / ffprobe 路径配置（核心设置项）

- **表单**：两个文本输入框 ——「ffprobe 路径」「ffmpeg 路径」，可各自独立填写（v1 实际只调用 ffprobe，ffmpeg 路径为后续转码/截帧能力预留，但同一表单一并配置）。
- **输入支持**：
  - 完整可执行文件路径（如 `C:\ffmpeg\bin\ffprobe.exe`）。
  - 也允许直接填 `ffprobe`（依赖 PATH 环境变量查找的场景），测试按钮会实际验证。
- **「测试」按钮**（每个路径独立测试）：
  - 服务端执行 `<路径> -version`，校验返回码与输出。
  - 成功：绿色提示，显示解析出的版本号（如 `ffprobe version 7.1`）。
  - 失败：红色提示具体原因 —— 路径不存在 / 不是可执行文件 / 执行出错，便于排查。
- **保存**：
  - 仅保存测试通过或用户明确确认强制保存的路径；保存后系统从降级模式自动恢复完整模式（视频重新解析入口见 FR-2.4）。
  - 设置页顶部显示当前状态徽标：`ffprobe 可用（版本 x.x）` / `未配置` / `配置无效`。
- **默认值**：用户本机已安装 ffmpeg（路径后续提供），首次部署时将真实路径写入配置文件默认值，避免首次使用即进入降级模式。
- **联动提示**：当存在 scan_status = degraded 的视频记录且 ffprobe 从未配置变为可用时，设置页与首页提示"检测到 N 个视频可补充解析"，提供一键触发重新扫描（仅针对 degraded 记录）。

#### FR-5.2 扫描相关设置

| 设置项         | 类型   | 默认值                                          | 说明                        |
| ----------- | ---- | -------------------------------------------- | ------------------------- |
| 图片解析并发数     | 数字   | 4                                            | 同时解析的图片文件数                |
| ffprobe 并发数 | 数字   | 2                                            | 同时运行的 ffprobe 子进程数        |
| 视频 MD5 计算   | 开关   | 开启                                           | 关闭后视频不计算 MD5、不参与查重（大库提速用） |
| 图片格式白名单     | 多选标签 | jpg/jpeg/png/heic/heif/webp/gif/bmp/tiff/tif | 可增删后缀                     |
| 视频格式白名单     | 多选标签 | mov/mp4/m4v/avi                              | 可增删后缀                     |
| 忽略目录名列表     | 文本标签 | node_modules, .git, .Trash                   | 命中即跳过该目录                  |

#### FR-5.3 其他设置

- 每页默认条数（20/50/100/200）。
- 日志级别（info / debug）。

**保存反馈**：所有设置项统一「保存」按钮，保存成功后 htmx 局部刷新显示成功提示；非法值（如并发数 > 16、白名单为空）即时校验拦截。

---

## 5. 数据库设计（草案）

```sql
-- 受管理文件夹
CREATE TABLE folders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT NOT NULL UNIQUE,        -- 绝对路径
  alias         TEXT,                        -- 别名
  added_at      TEXT NOT NULL,
  last_scan_at  TEXT,
  scan_status   TEXT NOT NULL DEFAULT 'pending', -- 扫描状态缓存：pending | scanning | done | failed（随扫描任务更新）
  image_count     INTEGER NOT NULL DEFAULT 0,  -- 统计缓存（图片数，含实况照片的 HEIC 部分）
  video_count     INTEGER NOT NULL DEFAULT 0,  -- 统计缓存（视频数，含实况照片的 MOV 部分）
  livephoto_count INTEGER NOT NULL DEFAULT 0,  -- 统计缓存（实况照片对数，按图片侧 is_livephoto=1 的 HEIC 计数，每对计 1）
  gmt_create     TEXT NOT NULL,               -- 记录创建时间
  gmt_modified   TEXT NOT NULL                -- 记录最后修改时间
);

-- 媒体文件记录（照片 + 视频）
CREATE TABLE media (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id      INTEGER NOT NULL REFERENCES folders(id),
  media_type     TEXT NOT NULL,               -- image | video
  file_name      TEXT NOT NULL,
  file_path      TEXT NOT NULL UNIQUE,       -- 绝对路径，唯一
  dir_path       TEXT NOT NULL,
  md5            TEXT,                        -- 内容 MD5；视频 MD5 开关关闭时为 NULL（不参与查重）
  taken_at       TEXT,                       -- ISO 8601
  taken_at_source TEXT NOT NULL DEFAULT 'exif',  -- exif | ffprobe | file_mtime
  format         TEXT NOT NULL,              -- jpg/png/.../mov/mp4/m4v/avi
  width          INTEGER,
  height         INTEGER,
  megapixel      REAL,
  camera_make   TEXT,                       -- 相机厂商（EXIF Make）
  camera_model  TEXT,                       -- 相机型号（EXIF Model）
  lens_model    TEXT,                       -- 镜头型号（EXIF LensModel）
  f_number      REAL,                       -- 光圈（FNumber）
  exposure_time TEXT,                       -- 快门速度（EXIF ExposureTime），文本如 "1/250"
  iso           INTEGER,                    -- 感光度（EXIF ISOSpeedRatings）
  focal_length  REAL,                       -- 焦距 mm（EXIF FocalLength）
  orientation   INTEGER,                    -- 图像方向（EXIF Orientation 1~8）
  gps_lat       REAL,                       -- 地理位置纬度
  gps_lon       REAL,                       -- 地理位置经度
  gps_alt       REAL,                       -- 地理位置海拔（米）
  duration       REAL,                       -- 视频时长（秒），图片为 NULL
  codec          TEXT,                       -- 视频编码，图片为 NULL
  file_size      INTEGER NOT NULL,           -- 字节
  mtime          TEXT NOT NULL,
  scan_status    TEXT NOT NULL DEFAULT 'ok', -- ok | failed | degraded
  is_missing     INTEGER NOT NULL DEFAULT 0, -- 磁盘文件已不存在
  missing_since  TEXT,                       -- 首次发现丢失的扫描时间（is_missing=1 时有值）
  is_livephoto   INTEGER NOT NULL DEFAULT 0,  -- 实况照片标记：同目录同主文件名 HEIC+MOV 成对时为 1
  fail_reason    TEXT,
  marked         INTEGER NOT NULL DEFAULT 0, -- 用户标记（重复清理预留）
  raw_metadata   TEXT,                       -- 原始元数据 JSON 全文（exifr / ffprobe 完整输出）；列表查询禁止 SELECT 此列
  gmt_create     TEXT NOT NULL,             -- 记录创建时间（入库时间）
  gmt_modified   TEXT NOT NULL              -- 记录最后修改时间
);
CREATE INDEX idx_media_taken_at  ON media(taken_at);
CREATE INDEX idx_media_format    ON media(format);
CREATE INDEX idx_media_type      ON media(media_type);
CREATE INDEX idx_media_folder    ON media(folder_id);
CREATE INDEX idx_media_md5       ON media(md5);
CREATE INDEX idx_media_file_size ON media(file_size);
CREATE INDEX idx_media_megapixel ON media(megapixel);
CREATE INDEX idx_media_duration  ON media(duration);
CREATE INDEX idx_media_name      ON media(file_name);
CREATE INDEX idx_media_live ON media(is_livephoto);
CREATE INDEX idx_media_make  ON media(camera_make);
CREATE INDEX idx_media_model ON media(camera_model);
CREATE INDEX idx_media_iso    ON media(iso);
CREATE INDEX idx_media_focal  ON media(focal_length);

-- 扫描任务
CREATE TABLE scan_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id     INTEGER NOT NULL REFERENCES folders(id),
  status        TEXT NOT NULL,               -- running | done | cancelled | failed
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  total_count   INTEGER DEFAULT 0,           -- 预估总数
  processed     INTEGER DEFAULT 0,
  current_path  TEXT,                        -- 当前正在扫描的目录（实时进度展示，任务结束后置 NULL）
  added         INTEGER DEFAULT 0,
  updated       INTEGER DEFAULT 0,
  failed        INTEGER DEFAULT 0,
  message       TEXT,                        -- 失败/取消原因
  gmt_create    TEXT NOT NULL,               -- 记录创建时间
  gmt_modified  TEXT NOT NULL                -- 记录最后修改时间
);
```

数据库开启 `PRAGMA journal_mode = WAL`，保证读写并发（扫描写入与页面查询互不阻塞）。

**统一约定**：所有表均包含 `gmt_create`（记录创建时间）与 `gmt_modified`（记录最后修改时间）两个审计字段，应用层在插入/更新时维护；业务时间字段（如 folders.added_at、scan_jobs.started_at）与之并存、语义独立。

---

## 6. 非功能需求

| 类别  | 要求                                                                                        |
| --- | ----------------------------------------------------------------------------------------- |
| 性能  | 列表分页查询 < 500ms（5 万条规模）；图片扫描吞吐 ≥ 100 张/秒（普通 JPEG，SSD）；视频解析受 ffprobe 进程与 MD5 计算限制，单文件数秒级属正常 |
| 可靠性 | 扫描进程意外中断不丢已入库数据；重启后任务状态标记为 failed 可重新发起；ffprobe 子进程崩溃不影响主服务                               |
| 安全  | 系统对源文件（照片/视频）**只读**，任何功能不写、不删、不移动源文件                                                      |
| 兼容性 | Windows 10/11 优先；浏览器支持现代 Chrome/Edge                                                      |
| 编码  | 全路径含中文/空格正常处理（NTFS 长路径考虑 \\?\ 前缀兼容）                                                       |
| 可观测 | 扫描日志落盘（logs/ 目录，按天滚动），失败文件清单可导出                                                           |

---

## 7. 页面结构（信息架构）

```
/                首页概览（统计卡片：图片/视频/实况照片数量、空间占用 + 最近扫描任务 + missing 提示）
/folders         文件夹管理（列表 + 新增表单）
/media           媒体列表（表格 + 筛选栏 + 搜索框）★ 核心页面
/media/duplicates 重复文件分组视图
/jobs            扫描任务列表
/settings        设置 ★ ffmpeg/ffprobe 路径配置与测试、并发度、格式白名单、忽略目录、视频 MD5 开关
```

---

## 8. 里程碑建议

| 阶段       | 内容                                                                                       | 验收标准                                                      |
| -------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| M1 基础骨架  | Fastify + SQLite + EJS/htmx 框架搭建，文件夹增删，ffprobe 路径配置与测试，HEIC 解析链路实测（exifr + ffprobe 真机样片） | 可添加/移除文件夹，数据落库；ffprobe 配置校验可用；HEIC 拍摄时间与分辨率解析正确           |
| M2 扫描引擎  | 递归扫描 + sharp/exifr（图片）+ ffprobe（视频/HEIC）解析 + MD5 + 增量策略 + 实况照片标记 + 任务进度                  | 500 张图片 + 50 个视频扫描完成，元数据完整准确；实况照片正确标记；ffprobe 未配置时降级可用 |
| M3 列表与筛选 | 媒体列表、分页排序、全量筛选条件（含类型/时长）、搜索                                                              | 5 万条数据下筛选响应达标                                             |
| M4 重复与体验 | 重复分组视图、标记、统计概览、失败导出                                                                      | 重复组识别准确（含 GB 级视频），端到端流程可用                                 |

---

## 9. 开放问题（待确认）

（无 —— 全部决策完毕，PRD 定稿。）

已决策（记录备查）：

- ✅ **实况照片必须支持**：同目录同主文件名的 HEIC+MOV 识别后标记 `is_livephoto = 1`（布尔标记）；**只做文件名匹配，不记录配对文件引用**（无 live_pair_id），另一半通过同目录+同主文件名即时查询；MOV 时长 ≤5s 作为可选辅助校验降低误判；列表加"实况"徽标与筛选开关；只剩一半时标记自动归 0，另一半重新出现自动恢复 —— 见 FR-2.5。
- ✅ **HEIC 为硬性要求，必须支持**。实现策略：exifr 解析 HEIC 的 EXIF 拍摄时间 + ffprobe 读取 HEIC 分辨率（sharp 预编译不含 HEIC 解码，不依赖 sharp 处理 HEIC）。M1 阶段需用真实 iPhone HEIC 样片实测 exifr/ffprobe 解析链路 —— 见第 3 节、FR-2.3。
- ✅ missing 文件**保留记录**并记录丢失时间：首次发现丢失时写入 `missing_since`（该次扫描时间），列表显示"missing（自 XX 扫描起丢失）"；文件移回后自动恢复并重新解析；一键清理记录入口列入 v1.5 候选 —— 见 FR-2.4。
- ✅ 「打开所在目录」不做本地助手进程，v1 采用**「复制完整路径」按钮**（点击复制 file_path 到剪贴板，成功后提示）—— 见 FR-3.1 行操作。
- ✅ 扫描并发度开放配置（设置页），默认图片 4、ffprobe 2 —— 见 FR-5.2。
- ✅ 视频 MD5 计算提供开关（默认开启，大库可关闭提速）—— 见 FR-5.2。
- ✅ ffmpeg 已在本机安装可用，路径由用户在设置页配置并作为配置文件默认值 —— 见 FR-5.1，M1 阶段需确认实际路径。
