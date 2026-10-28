---
name: market-scout
description: 用户提出任何新任务（做 PPT、改代码、批量处理、删/管理会话、视频转文字、转换文件……）时使用：先做插件覆盖检查（plugin_market_scout action:"coverage"）再搜市场，不许直接开干；搜到好用插件先告知、经用户同意再装；搜到但不好用就先 fetch 读源码改完再装；一条都没搜到必须说"未找到可用插件，接下来要 ……"并写清具体工作。用户消息里已带插件名/截图/安装命令时以它为准。
whenToUse: 用户提出任何新任务；或提到"插件 / 市场 / 装一个 / 有没有现成的"；或抱怨 DSH 缺某个能力、"每次都……很麻烦"；或诉求是"删除 / 清理 / 批量 / 定时 / 管理会话或工作区"。
---

# 插件侦察

目标不是"搜一下"，是**装上、能用、宿主没坏**，并且**下次同类任务不用再走一遍**。

## 行为契约（每次任务都走这套，不许跳）

用户下任务后，**先想「市场里有没有更趁手的插件」，再搜**；搜完按结果分三路，每路的话术是固定的。

| 搜索/判断结果 | 你要做的 |
|---|---|
| 搜到 + 过硬门槛（好用） | **先告知**：把哪个、干什么、装完会怎样、风险是什么——一句话说完，**等用户同意**再 `install_bundle`，装完 `verify`，然后才用它干活 |
| 搜到但不过门槛（不好用） | **先 `fetch` 读源码**，说清"它差在哪、我准备改什么"，改完 `pack` → 装 → `verify` → 用；改了什么必须写在报告里 |
| 一条都没搜到 | 原样说这句：**「未找到可用插件，接下来要 ……」**，省略号里填**你具体要做什么**（做什么、怎么做、多久、要不要用户确认）。**不许**只问"要不要我再搜搜"，也不许硬凑一个不相关的候选 |

- `search` 返回 `notFound: true` 时，`message` 里已经带好这句模板，照着填就行。
- `coverage` 返回 `selfReference: true` 时（任务在操作这个插件自己），**不做覆盖判断**，直接按任务本身做。

## 总原则

1. **任何新任务先 `coverage` 一次，再决定搜不搜**。命中 `installed`/`builtin` → 本机有现成能力，用它；返回 `suggestions`/候选 → 按 fit 挑；都没有 → 搜市场。
2. **"已装"不等于"不用搜"**：`coverage` 只回答"本机有没有"，回答不了"市场里有没有更好的"。任务形态变了（例如要发布/上传/卸载/升级这个插件本身）就别拿备忘当结论。
3. **规则不靠记性，靠工具记账**。`search` 带 `task` 会自动把候选写进 memo；`verify` 会报孤儿包/路径漂移；`audit` 会报 `patchDisabled`。跳过步骤不会"没人知道"，会在这些输出里露出来。
4. **省 token、别打扰**：问用户只问一次、带推荐默认项；报告五段、短；核对宿主真实 API 用 `cordis_inspect`（Service / Event / Slots），别读几百行 asar。

**动作速查**：`plan`（开工报备）→ `coverage`（覆盖检查）→ `search` → `fetch` → `audit` → `dryrun` → `pack`/`install_bundle` → `verify`；随时可用 `installed` / `updates` / `memo`，收尾用 `rollback` 清副本，发版前跑 `selftest`（`network:true` 连网络用例）。

## 第 0 步：覆盖检查（一次调用）

```
plugin_market_scout { action:"coverage", task:"<一句话需求>" }
```

| 返回 | 动作 |
|---|---|
| `selfReference:true` | 任务在操作这个插件自己（发布/上传/卸载/升级/打包）——**不做覆盖判断**，按任务本身做 |
| `needsSearch:false` + `availability: installed/builtin` | 直接用；`options` 里是更强候选，可以顺口告诉用户 |
| `needsSearch:false` + `availability: none` 且有 `candidates` | 从候选按 `fit` 挑一个，**不重搜** |
| `needsSearch:true` + `suggestions` | 先人工比对 suggestions（可能是同义 key），不对再搜 |
| `needsSearch:true` 且无建议 | 进第 1 步 |
| `staleHost` / `dueReview` 为 true | 结论过期，按"没有结论"处理 |

## 第 1 步：需求 → 能力

写一句话：「要让 X 在 Y 时做 Z」。
拆 2~4 组检索词，中文需求翻成英文关键词（npm 以英文为主）。

## 第 2 步：搜（必须带 task）

```
plugin_market_scout { action:"search",
  queries:["B站 视频 转文字 字幕", "bilibili video transcript subtitles"],
  task:"<同一句需求>", limit:15 }
```

- **`queries` 一次给中英两版**：npm 关键词搜索和目录匹配都是字面匹配，只用一种语言会漏掉另一种语言描述的包。目录条目自带中英双语描述（3730/3730），目录侧单语言通常够，npm 侧两种都要。
- 中文 query 会自动补英文检索词，英文 query 会自动补中文检索词，返回里的 `hints` 就是补的。
- 想找"教 agent 做某事的技能包"而不是通用插件，加 `kind:"skill"`（只留自带技能的包）；`kind:"all"` 是默认，不筛。
- `task` 不能省：工具会把候选自动写进 memo（并进最匹配的已有 key），下次 `coverage` 直接命中。
- 结果带 `relevance`（0~1，按 name/标题/中英描述综合算）。整页都低时工具会自动用 2 个最有辨识度的词兜底重搜，返回里能看到 `fallbackTokens`。
- 两轮：社区区（默认）+ 精选区（`featured:true`）。
- 按 `name` + `relevance` + `maintenance` 筛，别按返回条数判断"命中了这么多"。
- **返回 0 条时不要硬凑**：按 message 给的三条替代走（换通用词 / 双语查 / 自己写）。

## 第 3 步：判

硬门槛（任一不过就淘汰）：

| 门槛 | 判据 |
|---|---|
| 能装 | `installable !== false` |
| 挂得上 | `fetch` → `audit`：patch 可读、entry id 不撞车 |
| 不过期 | 近 12 个月有版本；`maintenance.lastDaysAgo` 别太大 |
| 对得上 | 工具名/参数真的覆盖需求（读 `files` 里的源码） |
| 不拖雷 | 无原生依赖；`repoMatchesName === false` 只是提示（monorepo 很常见） |
| **装上能用** | `patchDisabled === true` → 装完必须在插件页启用并重启，否则工具不注册 |

## 第 4 步：装前门禁

```
plugin_market_scout { action:"dryrun", dir:"<fetch 的 dir>" }
plugin_market_scout { action:"dryrun", dir:"<同上>", deep:true }   // 声明依赖缺失时才用
```

- `classification:"real"` → 不装。
- `classification:"environmental"` → 按 `classificationReason` 处理，别误杀。
- `registeredTools` 里必须有你要的能力。

## 第 5 步：装 + 验证

```
# 0) 先告知，等同意（这是唯一一次问，问完别再问第二遍）
# 1) 没改过的包：直接交给宿主
plugin_manager { action:"install_bundle", target:"<tgz 或目录>" }
# 2) 本地改过的包：先打包
plugin_market_scout { action:"pack", dir:"<源码目录>", dest:"<输出目录>" }
plugin_market_scout { action:"verify" }
```

- **告知内容三句**：装的是哪个、它替你做什么、装坏了怎么退。
- `verify.overallOk` 必须为 true；`broken` 空、`orphans` 0、`guardian.issues` 空。
- 有 `specTargetMissing` → `verify fix:true`；有 `orphanPackages` → 同样 `fix:true`。
- 装了 `disabled:true` 的包 → 去「插件」页启用并重启，否则**别急着说装好了**。

## 第 6 步：写回结论

```
plugin_market_scout { action:"memo", record:[{
  key:"<任务类型，如 video-summary / delete-session>",
  availability:"installed:<pkg>" | "builtin:<cap>" | "none",
  candidates:[{ pkg, version, fit, fitFor, checkedAt }],
  aliases:["<2~6 个用户真会说的说法>"],
  note:"<一句话，含前置条件>"
}] }
```

- **可用 `search` 的 `task` 参数代替手写候选**；这一步只补 `availability` / `aliases`。
- 同 key 异 availability 前缀会被拒（conflict），确要覆盖加 `force:true`。
- `none` 默认 30 天后复审；宿主升级后条目标 `staleHost`。

## 铁律

0. **不搜就直接开干，等于这个插件白装**。任务到手先 `coverage`，再 `search`；能装现成的不自己写，能改好的不重写。搜不到就报「未找到可用插件，接下来要 …」并写清你的具体工作。
1. **别用"它肯定不行"当理由**。说某个插件不适用之前，先 `fetch` 读它的 README/scripts——今天就有一次栽在这里：以为 `dsh-bili-watch` 要手工装 ffmpeg，其实它自带 `scripts/fetch-deps`。
2. **先告知、同意再装**（说清装哪个、为什么、失败怎么退）。用户点头就装，别反复追问；用户没点头不许装。陌生作者 / 原生依赖 / 改全局配置额外点一句风险。
3. **没读 patch 不许说"能装"**；`installable:true` 只说明声明存在。
4. **一次只动一个插件**，验证不过就回滚，不带病继续。
5. **用户消息里的插件名 / 截图 / 安装命令就是答案**，第一动作是 `fetch` 它，不是"参考一下另写一个"。
6. **开工前报备三件事，点头再动手**：① 做什么（一句话方案 + 关键取舍）② 花多少（预计时间、要改哪些文件、要不要装东西）③ 需要你确认什么。凡是会装/删插件、改 profile、跑超过 10 分钟的任务，先报备再干；纯查询、一次 `coverage` 这种秒级动作直接做。
7. **长任务边做边报进度**：每完成一个可验证的台阶就报一句"做到哪、卡在哪、还剩什么"，不要闷头跑完才开口。她看不到过程会不安；卡住超过预期也要先说，别硬撑。
8. **收尾先想"要不要回滚"**：实验性改动、装完不合用、留下解包副本时用 `action:"rollback"`——`what:"hunt"` 删源码副本、`what:"memo"` 恢复上一版备忘；卸载插件仍走 `plugin_manager remove_bundle`（本工具只给命令，不代劳）。

## 从 find-skills 学来的（已内置，不用照抄它）

- **中文需求自动补英文**：`search` 拿到中文 query 会自动加英文检索词（做PPT → `ppt/presentation`），结果里的 `hints` 就是补的词。你不用手动翻译。
- **"找不到"就明说，并给三条替代**：换通用词 / 双语查 / 自己写一个小插件。不许硬凑一个不相关的候选。
- **没找到时的固定句式**：`未找到可用插件，接下来要 <具体工作>`。省略号里必须是你的方案，不是抛回给用户的问题。
- **能先读就不用先装**：`fetch` 之后直接读 README 与 `SKILL.md`，够判断就不装——这等价于 find-skills 的 `skills use`（免安装试用）。
- **skill 也是插件**：`search` 加 `kind:"skill"` 只留"自带技能"的包。DSH 里技能由插件携带，所以"找个技能"= "找个带技能的插件"，不要另装第二套安装器。
- **别学它的**：`npx skills add -y` 静默装（无审计）、写死 `~/.agents/skills`（DSH 不扫这个目录，装了不生效）。

## 两个真实案例（别重演）

**余额挂件**：截图里有现成安装命令，却被当成视觉参考重写 1500 行，反复装 8 次、造了两个 bug；现成插件装好只用了 2.7 秒。

**删会话**：该装插件，却去手工删 `~/.dsh/sessions`；日志删了、投影缓存和记账没删，下次还得再手工一次。市场里光"删会话"就有七八个插件。

**视频总结（本轮的）**：`coverage` 明明返回 `needsSearch:true`，却绕过 search/fetch/audit 自己手搓 whisper，还把"它要 ffmpeg"当成不装的理由——没验证。

## 报告格式

五段，短：

1. **结论**：装了 / 改了 / 没装（为什么）。
2. **候选**：3~5 个，各一句选或淘汰的理由（引用工具给的数字，不自己推算）。
3. **动作**：装了什么、改了哪些文件；`verify` 结果；memo 写了什么 key。
4. **风险**：warn 项、fork 脱钩、`patchDisabled` 之类没验证到的地方。
5. **下一步**：需要用户做什么（启用、重启、确认）。

## 不要做

- 不要把"描述里出现过这个词"当命中（看 `relevance`）。
- 不要跳过 `audit`/`dryrun` 直接装——省下的两分钟，可能要用重装宿主来还。
- 不要自己推算数字（下载量、评分），只引用工具字段。
- 不要用没验证过的"它没有 X"当自写理由。
- 不要把"参考某插件"改成"重写某插件"。
