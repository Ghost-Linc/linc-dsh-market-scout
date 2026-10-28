# linc-dsh-market-scout

> An on-demand plugin scout for DeepSeek Harness: coverage check → market search → pre-install audit → install → post-install verify → remember the outcome.

让 DSH 智能体自己上插件市场：**先查覆盖 → 缺能力才搜索 → 拉源码读 → 装前体检/干跑 → 本地改完打包 → 装后体检 → 记成备忘**。

注册工具 **`plugin_market_scout`**（不叫 `plugin_market`：宿主自带的官方市场索引工具占用了那个名字，重名时路由时灵时不灵），随包携带一本 `market-scout` 技能。零外部依赖：只用 `node:` 内置模块 + 全局 `fetch`，桌面端通用（Windows / macOS / Linux）。

## 它解决什么

`plugin_manager` 是「你告诉我装什么，我就装什么」；它不认识需求，也不判断能不能装、装完活没活。这个插件补的是中间那段：

| 缺口 | 本插件的补法 |
|---|---|
| 模型看不见市场 | `search` 双源合并：npm 关键词区 + [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 目录快照 |
| 中英描述对不上 | 双向查询补词（做PPT ↔ ppt/presentation）+ 51 组领域同义词（字幕 ↔ subtitle、转写 ↔ ASR） |
| 不知道能不能装 | `fetch` 读源码 → `audit` 静态体检 → `dryrun` 子进程真跑一次 `apply()` |
| 装完不知道活没活 | `verify` 查依赖、`file:/link:` 漂移、孤儿包、bundle 缺失、guardian 启动预检，`fix:true` 可修 |
| 每次重复搜同一件事 | memo v3：`availability` 决定要不要搜，`candidates` 永不过期 |

## 行为契约（4.1.0 起）

任务到手**不许直接开干**：先 `coverage` 再 `search`，然后只走三条路之一。

| 结果 | 动作 |
|---|---|
| 搜到 + 过门槛 | **先告知**（哪个、干什么、装坏怎么退）→ **等用户同意** → 装 → `verify` → 用 |
| 搜到但不过门槛 | `fetch` 读源码 → 说清改什么 → 改 → `pack` → 装 → `verify` → 用 |
| 一条没搜到 | 原样说：**「未找到可用插件，接下来要 ……」**，省略号填自己的具体工作 |

- `search` 返回 `notFound:true` 时 `message` 已带好这句话术；全场最高 `relevance < 0.2` 也判为没找到（只兜纯噪声，不误杀中文查询）。
- `coverage` 返回 `selfReference:true` 时（任务在操作本插件自己：发布/上传/卸载/升级/打包），**不做覆盖判断**——这正是 4.0.0 会把"我要发布这个插件"误判成"已覆盖"的地方。

## 安装

```bash
# 从 GitHub 目录安装
dsh plugin --profile desktop add /abs/path/to/linc-dsh-market-scout

# 或从 tgz 安装
plugin_manager { action:"install_bundle", target:"<tgz 路径>" }
```

装完跑一次体检：

```
plugin_market_scout { action:"verify" }
```

## 快速开始

```
# 1. 有任务先查覆盖（一步：已装 + 备忘 + 候选）
plugin_market_scout { action:"coverage", task:"从 B 站视频生成文字总结" }

# 2. 没有能力才搜市场（带 task 会自动把候选记进备忘）
plugin_market_scout { action:"search",
  queries:["B站 视频 转文字 字幕", "bilibili video transcript subtitles"],
  task:"从 B 站视频生成文字总结", limit:10 }

# 3. 装前门禁
plugin_market_scout { action:"fetch", name:"dsh-bili-watch" }
plugin_market_scout { action:"audit", dir:"<fetch 返回的 dir>" }
plugin_market_scout { action:"dryrun", dir:"<同上>" }

# 4. 装 + 体检（安装归宿主 plugin_manager）
plugin_manager { action:"install_bundle", target:"<dir 或 tgz>" }
plugin_market_scout { action:"verify" }
```

## 13 个动作

| action | 作用 |
|---|---|
| `coverage` | 一步覆盖检查：`availability` + 候选 + 建议；自动命中只认 key/aliases/pkg，弱命中只出建议 |
| `search` | 双源搜索，带 `relevance`/`maintenance`/`installable`；`kind:"skill"` 只找自带技能的包 |
| `fetch` | 下载解包到 `$DSH_HOME/plugin-hunt/`，回传文件树、patch 全文、`patchDisabled`、防抢注检查 |
| `audit` | 静态体检：patch、entry id 撞车、`engines.dsh`、原生依赖、register 兜底 → `pass/warn/block` |
| `dryrun` | 子进程假 ctx 真 `import` + `apply()`，报告注册了哪些工具；失败分 real / environmental，`deep:true` 先装依赖 |
| `installed` | 只读：本机各 profile 装了什么、bundle 名册、已占 entry id |
| `updates` | 只读：已装版本 vs registry 最新 |
| `memo` | 能力备忘读写（v3）：`record` / `forget` / `prune` / `force` / `full` |
| `pack` | 源码目录 → tgz（复用宿主 pnpm），检测 `.bak/.orig/.rej` 残留 |
| `verify` | 装后体检：依赖、spec 漂移、孤儿包、bundle 缺失、guardian；`fix:true` 修复 |
| `plan` | 开工前报备落档：做什么 / 花多少 / 需确认什么，返回可直接贴的文本 |
| `rollback` | 有限回滚：删源码副本、恢复上一版备忘快照；卸载插件给命令不代劳 |
| `selftest` | 内置回归：本地 9 条；`network:true` 追加 registry/目录/fetch/audit 网络用例 |

## 记忆（memo v3）

文件：`$DSH_HOME/market-memo.json`

- `availability`：`installed:<pkg>` / `builtin:<cap>` / `none` —— **只有它决定要不要再搜**
- `candidates`：见过的包 + fit，只合并不冲突、永不过期
- `aliases`：用户真会说的说法（"幻灯片""删掉旧会话"）
- `hits` / `lastUsed` / `stats`：命中次数、最近使用、省掉的搜索次数
- 写前自动留 `.bak`：`rollback { what:"memo" }` 可回到上一版

## 工作铁律（随包技能里的 8 条）

1. 不用"它肯定不行"当理由，先 `fetch` 读源码
2. 装之前默认问一次；已授权可直接装，装完必须报告
3. 没读 patch 不许说"能装"
4. 一次只动一个插件，验证不过就回滚
5. 用户给的插件名/截图/命令就是答案，先 `fetch` 它
6. **开工前报备三件事**（做什么/花多少/需确认）——用 `action:"plan"` 落档
7. **长任务边做边报进度**，不闷头跑完才开口
8. 收尾先想"要不要回滚"

## 自检

```
plugin_market_scout { action:"selftest" }                 # 本地 9 条
plugin_market_scout { action:"selftest", network:true }  # + 网络 2 条
```

覆盖：memo 迁移/冲突、身份打分、相关度与兜底、跨语言与同义词、双向补词、plan/rollback、孤儿包、bundle 识别、spec 解析、registry/目录/fetch/audit。

## 目录结构

```
lib/index.js                 # 单文件插件（~3900 行，零依赖）
skills/market-scout/SKILL.md # 随包技能：流程 + 铁律
cordis.patch.yml             # bundle patch（entry id: market-scout）
```

## 限制

- 安装/卸载归 `plugin_manager`，本插件只做发现、体检与体检后修复
- `dryrun` 用假 ctx，插件若强依赖真实服务会走降级分支（这是设计，不是 bug）
- `selftest` 只覆盖历史坑，新需求仍需真实任务验证
- 桌面端限定（Windows / macOS / Linux）

## License

MIT © Linc
