# Changelog

## 4.1.0 — 2026-10-29

把「先查再装」从一句口号变成会生效的判定。

### 修复

- **`coverage` 不再被自指任务骗过**。任务文本里出现本插件自己的包名（发布、上传、卸载、升级、打包它）时，不再按子串命中 memo 里的 `market-scout` 条目、不再回「已覆盖，直接用」。新增 `selfReference: true` 字段，这条路直接跳过覆盖判断。
- **子串匹配收窄**。去掉了 `query.includes(key)` 和 note 全文的 `hay.includes(query)` 两个反向匹配——任务里"提到过"某个词，不再等于"需要"这个能力。
- **`search` 不再把噪声当命中**。全场最高 `relevance < 0.2` 时返回 `notFound: true` + 固定话术（阈值取 0.2 而不是更高：中文查询相关度天然偏低，"删除会话" 0.83、"删掉一个旧会话 delete session" 0.43，定高会误杀）。

### 新增

- `search` 返回 `notFound: true` 时带固定话术：**「未找到可用插件，接下来要 ……」**，省略号由模型填具体工作，而不是把决定权推回用户。
- `coverage` 返回 `selfReference` 字段。

### 技能（`skills/market-scout/SKILL.md`）

- 新增「行为契约」：搜到好用的先告知、等同意再装；搜到不好用的先 `fetch` 读源码改完再装；一条没搜到必须说固定那句话并写清具体工作。
- 铁律新增第 0 条「不搜就直接开干，等于这个插件白装」；第 2 条从「装之前默认问一次」改为「先告知、同意再装」。

## 4.0.0

首个公开版本：13 个 action（coverage / search / fetch / audit / dryrun / pack / verify / plan / rollback / selftest / memo / installed / updates），memo v3。
