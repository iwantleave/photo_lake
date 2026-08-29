# Photo World — AI 照片描述方案设计

> 目标：对导入的每一张照片/视频，调用 AI 视觉模型生成一段自然语言描述（画面内容、主体、场景、拍摄意图），
> 落库后可在详情页查看、可纳入检索。
> 本方案刻意**不内联进扫描流程**，而是作为独立的「AI 分析阶段」，原因见 §2。

---

## 1. 核心决策一览

| 决策点 | 方案 | 理由 |
|---|---|---|
| 是否内联进扫描 | **否**，独立阶段 | 扫描是纯元数据、快；AI 慢、贵、受限流影响，混在一起会让扫描被拖垮、难重试 |
| 预处理（图→可上传格式） | **ffmpeg 抽帧 + sharp 缩放** | HEIC 在 7.1.1 仍可被 ffmpeg 解码；sharp 不支持 HEIC 解码，统一走 ffmpeg 最省事；视频抽首帧同理 |
| 模型调用抽象 | `src/ai/describe.js` 统一 provider 接口 | 后续换 OpenAI/Claude/Gemini/本地 Ollama 只需加一个 adapter |
| 并发与取消 | 复用 `scanner.js` 的 `runPool` + `cancelled` 模式 | 与现有扫描引擎一致，零新机制 |
| 进度记录 | 新增 `ai_jobs` 表（仿 `scan_jobs`） | 可查进度、可取消、可重试 |
| API Key 存放 | `settings.json` 的 `ai` 段（已被 .gitignore 排除） | 不进版本库、不泄露 |
| 增量策略 | 只对 `ai_desc_status IS NULL/failed` 跑 | 重扫不重复烧钱；改 prompt 可 bump 版本批量重跑 |

---

## 2. 总体架构（数据流）

```
                       ┌─────────────┐
扫描阶段(已有) ───────▶ │  media 表    │  每行: ai_desc_status='pending'(默认)
                       └──────┬──────┘
                              │  用户触发 / 定时
                              ▼
        ┌─────────────────────────────────────────────┐
        │  AI 分析引擎  src/ai_job.js  (仿 scanner 模式) │
        │   1. 查待分析记录 (ai_desc_status IS NULL/failed) │
        │   2. 并发池(limit=ai.concurrency)             │
        │   3. 单条: ffmpeg抽帧→sharp缩放→provider→写库   │
        │   4. 进度写 ai_jobs，支持 cancelled 取消        │
        └─────────────────────────────────────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │ media.ai_desc│  ok/failed + 模型名 + 时间 + 错误
                       └─────────────┘
                              │
                              ▼
        详情弹窗展示 / 列表「AI描述」筛选 / (进阶)FTS 内容搜索
```

关键：**扫描与 AI 解耦**。扫描只负责「文件 → 元数据」，AI 负责「图像 → 文本」，两者通过 `media.ai_desc_status` 衔接。

---

## 3. 数据库设计

### 3.1 media 表新增列（ALTER）

```sql
ALTER TABLE media ADD COLUMN ai_desc        TEXT;     -- AI 生成的文字描述
ALTER TABLE media ADD COLUMN ai_desc_model  TEXT;     -- 使用的模型，如 gpt-4o-mini
ALTER TABLE media ADD COLUMN ai_desc_status TEXT NOT NULL DEFAULT 'pending'; -- pending|ok|failed|skipped
ALTER TABLE media ADD COLUMN ai_desc_at     TEXT;     -- 分析完成时间 ISO8601
ALTER TABLE media ADD COLUMN ai_desc_err    TEXT;     -- 失败原因
ALTER TABLE media ADD COLUMN ai_tags        TEXT;     -- (进阶)结构化标签 JSON，便于内容检索
ALTER TABLE media ADD COLUMN ai_prompt_ver  INTEGER NOT NULL DEFAULT 0; -- prompt 版本，bump 后批量重跑
```

> 不用复用 `scan_status`：那是元数据扫描状态（ok/failed/degraded），语义不同，混用会乱。

索引：
```sql
CREATE INDEX IF NOT EXISTS idx_media_aistatus ON media(ai_desc_status);
CREATE INDEX IF NOT EXISTS idx_media_aiprompt ON media(ai_prompt_ver);
```

### 3.2 新增 ai_jobs 表（仿 scan_jobs 风格）

```sql
CREATE TABLE IF NOT EXISTS ai_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id    INTEGER,                -- NULL 表示全部文件夹
  scope        TEXT NOT NULL,          -- all | folder | type | failed
  model        TEXT,
  status       TEXT NOT NULL,          -- running | done | cancelled | failed
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  total_count  INTEGER DEFAULT 0,
  processed    INTEGER DEFAULT 0,
  ok_count     INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  message      TEXT,
  gmt_create   TEXT NOT NULL,
  gmt_modified TEXT NOT NULL
);
```

---

## 4. 图像/视频预处理（src/util/thumb.js 或并入 ai 模块）

统一用 ffmpeg 抽帧，再 sharp 缩放，输出 JPEG buffer：

```js
// 伪代码
async function prepImage(filePath, mediaType, maxSide) {
  // 1. ffmpeg 抽一帧/转一图 → 临时 PNG
  //    图片: ffmpeg -i in.HEIC/JPG out.png
  //    视频: ffmpeg -ss 0 -i in.MOV -frames:v 1 out.png
  // 2. sharp(out.png).resize({ width/height: maxSide, withoutEnlargement:true }).jpeg({quality:80})
  // 3. 返回 buffer (或 base64 dataURL)
}
```

- `maxSide` 默认 1024（gpt-4o-mini 足够；细节要求高可 1280/1536）
- 视频抽首帧即可，不必整段分析
- 失败（ffmpeg 不在/解码失败）→ `ai_desc_status='failed'` + 错误，不阻塞其余

---

## 5. AI 调用模块（src/ai/describe.js）

### 5.1 Provider 接口

```js
// describeImage({ imageBuffer, mime, prompt, cfg }) => { text, model }
async function describeImage({ imageBuffer, mime, prompt, cfg }) {
  switch (cfg.provider) {
    case 'openai':   return await openaiVL(cfg, imageBuffer, mime, prompt);
    case 'anthropic':return await claudeVL(cfg, imageBuffer, mime, prompt);
    case 'google':   return await geminiVL(cfg, imageBuffer, mime, prompt);
    case 'ollama':   return await ollamaVL(cfg, imageBuffer, mime, prompt);
    default: throw new Error('未知 provider');
  }
}
```

所有云端走 **OpenAI 兼容 messages API**（`image_url` 带 base64 dataURL），Claude/Gemini 用各自 SDK 或兼容端点。

### 5.2 模型选型对比（面向美国客户）

| Provider | 推荐模型 | 视觉能力 | 价格(约/千张) | 数据出境 | 备注 |
|---|---|---|---|---|---|
| **OpenAI** | gpt-4o-mini | 强 | $2~3 | 美国合规 | 性价比首选 |
| OpenAI | gpt-4o | 最强 | $10~15 | 美国合规 | 描述质量要求高时用 |
| **Google** | gemini-1.5-flash | 强 | 极低/免费额度 | 美国合规 | 国内网络可达，推荐国内开发机 |
| Anthropic | claude-3.5-haiku | 强 | 中 | 美国合规 | |
| **本地** Ollama | llava/qwen2-vl | 中 | 0(算力成本) | **零出境** | 需本机 GPU/显存，隐私最强 |

> 合规结论（之前已确认产品面向美国客户、按美国法律）：可直接用上述美国服务，**无需** GCJ-02 等国内约束。
> 隐私提示：云端方案会把图像内容发往厂商；如照片敏感，用本地 Ollama 彻底不出本机。

### 5.3 Prompt 模板（可配置）

```
用简体中文描述这张照片：画面主体、场景/环境、明显活动或事件、大致氛围。
忽略 EXIF 等元数据，只描述可见内容。不超过 120 字。
```

存 `settings.json > ai.prompt`，用户可改；改后 `ai_prompt_ver + 1` 触发批量重跑。

---

## 6. 批量分析引擎（src/ai_job.js，仿 scanner.js）

- 复用 `scanner.js` 的 `runPool(items, limit, job, workerFn)` 与 `runningJobs` Map + `cancelled` 标志
- 查询待分析：
  ```sql
  SELECT id, file_path, media_type
  FROM media
  WHERE is_missing=0
    AND (ai_desc_status IS NULL OR ai_desc_status='failed' OR ?)   -- ?=rerunAll
    AND (? IS NULL OR folder_id=?)                                  -- 按文件夹
    AND (? IS NULL OR media_type=?)
  ```
- 单条 worker：
  1. `prepImage` 抽帧缩放
  2. `describeImage` 调模型
  3. 更新 `ai_desc / ai_desc_model / ai_desc_status='ok' / ai_desc_at`
  4. 失败则 `ai_desc_status='failed' / ai_desc_err`
- 进度每 N 条写 `ai_jobs`；`cancelled` 时置 `cancelled` 退出
- 导出 `startAiJob(filter)`, `cancelAiJob(id)`, `cancelAiByFolder(folderId)`

---

## 7. 配置（settings.json 新增 ai 段）

```json
{
  "ai": {
    "enabled": true,
    "provider": "openai",
    "apiKey": "",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "maxImageSide": 1024,
    "concurrency": 2,
    "prompt": "用简体中文描述这张照片：画面主体、场景/环境、明显活动或事件、大致氛围。不超过120字。",
    "autoAfterScan": false
  }
}
```

- `config/index.js` 的 `DEFAULTS` 加 `ai` 段；`load/save` 自动合并（已支持）
- `apiKey` 永不进库（.gitignore 已排除 `config/`）

---

## 8. API（src/routes/api.js 新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/ai/analyze` | 启动分析 `{ folderIds?, mediaType?, rerunAll?, rerunFailed? }` → `{ jobId }` |
| GET | `/api/ai/jobs` | 历史/进行中任务列表 |
| GET | `/api/ai/jobs/:id` | 单任务进度 |
| POST | `/api/ai/cancel/:id` | 取消 |
| POST | `/api/ai/describe-one/:id` | 单张重分析（详情弹窗用） |

- 列表 `GET /api/media` 增加 `ai_desc_status` 过滤参数 + facets 选项
- `GET /api/media/:id` 已含 `raw_metadata`，补 `ai_desc*` 即可在详情弹窗展示

---

## 9. UI 改动

1. **设置页**：新增「AI 分析」卡片（provider 下拉、apiKey、model、并发、prompt 文本框、开关、保存时校验 key 可用性）
2. **媒体列表**：筛选区加「AI描述」分组（已生成 / 未生成 / 失败）；列可显示描述首行
3. **详情弹窗**：新增「AI 描述」分组，展示 `ai_desc` + 模型 + 时间 + 「重新分析」按钮
4. **概览页**（可选）：加「AI 分析进度」统计卡（已生成/总数）
5. **任务页**或独立「AI 任务」入口：展示 `ai_jobs` 进度、取消

---

## 10. 增量 / 重跑 / 取消

- **增量**：新扫描的记录 `ai_desc_status='pending'`，不自动烧钱；用户手动触发或开 `autoAfterScan`
- **重跑失败**：列表筛 `failed` → 批量重跑（网络抖动常见）
- **改 prompt 重跑**：bump `ai_prompt_ver` → 对 `ai_prompt_ver < 当前` 的记录批量重跑
- **取消**：引擎每轮查 `cancelled`，与扫描取消同机制

---

## 11. 成本与隐私（给美国客户的说明）

- **成本**：gpt-4o-mini 约 $0.002~0.003/张；1 万张 ≈ $20~30；Gemini Flash 更低/有免费额度
- **隐私/合规**：OpenAI/Google/Anthropic 均为美国服务，面向美国客户合规；图像内容会出境给厂商
- **零出境选项**：本地 Ollama + llava/qwen2-vl，适合含敏感照片的场景
- **国内开发机网络**：OpenAI 直连可能被墙，Gemini / 国内模型（通义千问 VL、智谱 GLM-4V）国内可达，可作开发期后端

---

## 12. 进阶：内容检索（可选 M3）

有了 `ai_desc` 文本后，可做自然语言搜索：
- SQLite FTS5 虚拟表索引 `ai_desc`（+ `file_name`）
- 列表搜索框支持「语义关键词」：输入「海边的日落」「有猫的桌子」→ 匹配描述
- `ai_tags` JSON 存结构化标签（主体/场景/情绪），支撑 facet 筛选（「全部人物」「全部风景」）

---

## 13. 实施步骤（M2 拆分）

1. `schema.sql` 加 media 列 + `ai_jobs` 表 + 索引；`db` 模块迁移
2. `config/index.js` 加 `ai` 默认段
3. `src/util/thumb.js`：ffmpeg 抽帧 + sharp 缩放
4. `src/ai/describe.js`：provider 抽象 + OpenAI adapter（先打通一个）
5. `src/ai_job.js`：批量引擎（复用 runPool/cancel）
6. `api.js`：增 5 个接口 + media 列表筛选/ facets
7. UI：设置页 + 列表筛选 + 详情弹窗 + 概览卡
8. 端到端验证：用 `D:\照片\2025\20250128过年` 跑一批，确认描述入库、失败重试、取消
9. 提交 + 推送

---

## 14. 开放问题（需奥古斯都拍板）

1. **Provider 选哪个**作为默认打通？（建议 OpenAI gpt-4o-mini，或 Gemini 因国内可达）
2. **是否扫描后自动分析**（`autoAfterScan`）还是每次手动触发？
3. **视频是否也分析**（抽首帧）还是仅图片？
4. **是否要 ai_tags 结构化标签 + FTS 内容搜索**（§12 进阶）一并做，还是先只存描述文本？
5. **描述语言**：简体中文（默认）还是跟随用户/英文？
