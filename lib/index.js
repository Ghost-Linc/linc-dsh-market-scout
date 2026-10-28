/**
 * linc-dsh-market-scout —— 把「自己上插件市场找插件、把源码拉下来读改」暴露成一个
 * **模型可调用的工具**。
 *
 * ## 为什么需要这一层
 *
 * 本机装插件靠 `plugin_manager`（list / install / remove），但它是「你告诉我要装
 * 什么我就装什么」。模型想自己完成「找一个插件来做某个任务」这件事，中间缺两段：
 *
 *   1. **看不见目录** —— 设置页那个市场（`dsh-android-market`）只挂了 HTTP 路由
 *      `/api/dsh-android/market`，而且它有一道**会话 cookie 门**（`connection.
 *      requestRejection`）。模型跑在 Node 里、手上没有浏览器 cookie，直接 curl
 *      拿到的是 `401`。它唯一能用的入口是 `lib/collect.mjs` 的 `collectCatalog()`，
 *      而那是个**并发拉几百个 packument、耗时 2~6 秒、只按两个固定关键词**的
 *      全量目录扫描器 —— 语义是「生成市场目录」，不是「按意图搜索」。
 *
 *   2. **拿不到源码** —— 判断一个插件「能不能直接用」，必须读它的
 *      `cordis.patch.yml`（挂什么 id、改了哪一层 config）、`dsh.bundle` 声明、
 *      依赖里的原生模块。这些都在 npm tarball 里，而模型没有「下载并解包」的通道。
 *
 * 本插件补这两个洞：注册一个 `plugin_market_scout` 工具（不叫 `plugin_market`——宿主自带的
 * 市场索引浏览工具已占该名，重名会让路由时灵时不灵）。
 *
 * | action | 做什么 |
 * |---|---|
 * | `search` | 按关键词搜市场，顺带判掉「装不上」的包（无 `dsh.bundle`、原生依赖） |
 * | `fetch` | 把某个包的 tarball 拉到本地解包，回传文件树 + `dsh` 声明 + patch 全文 |
 * | `audit` | 装之前静态体检：patch 挂得上吗、entry id 撞不撞车、engines 对不对、register 有没有兜底 |
 * | `dryrun` | 子进程里用假 ctx 真 import 并调一次 `apply()`，回答「它会不会把宿主搞挂」 |
 * | `installed` | 只读：这台机器每个 profile 已装了什么、哪些声明了 bundle、patch 占了哪些 id |
 * | `memo` | 能力备忘读写（`$DSH_HOME/market-memo.json`）：第一次跑某类任务搜装完写结论，重复任务读备忘跳过搜索 |
 * | `pack` | 本地源码目录 → tgz（复用宿主自带 pnpm，返回精确路径交给 plugin_manager 装） |
 * | `verify` | 装后体检：依赖实体 + file:/link: 目标存在性 + guardian 启动预检报告 |
 *
 * `audit` / `dryrun` 是「直接装」这条路的安全阀。宿主侧一条硬约束决定了它们必须存在：
 * 插件 `apply()` 里抛出的异常会把整个 entry 判成 `failed`，进而 `dsh: startup failed`
 * —— **引擎退出、App 打不开**。所以「能不能装」不能只看 `dsh.bundle.patch` 存不存在。
 *
 * ## 随包技能
 *
 * `skills/market-scout/SKILL.md` 把「覆盖检查 → 翻译需求 → 搜 → 判 → 装 / 改 / 自写 → 验证」
 * 写成一本规程：任何新任务先查 `installed` + `memo`，重复任务不重复搜；装之前默认问一次
 * （用户授权可直接装）。它走 `ctx.get('skills')`（可选服务）：
 * 拿不到就静默跳过，绝不影响工具可用性 —— 技能是纯增益。
 *
 * ## 安装那一步**刻意不在这里**
 *
 * 安装复用 `@deepseek-ai/dsh-plugin-manager` 的 `plugin_manager` 工具：
 * `install_bundle` 接受**绝对本地目录**，所以「拉下来 → 改 → 从改完的目录装」这
 * 条链路天然成立，不需要本插件自己 spawn pnpm。
 *
 * ⚠️ 不自己 spawn pnpm 的理由是现成的教训（见 `market/lib/index.js` 顶部）：
 * pnpm 会把 profile 的「多余依赖」挪进 `node_modules/.ignored/`、`--allow-build`
 * 会把作者可控的包名泄漏进 registry、装错包要恢复 `package.json` 与
 * `pnpm-lock.yaml`。这些官方都做好且有回滚，重复实现只会更差。
 *
 * ## 为什么自己拼请求，而不 import 市场的 `collect.mjs`
 *
 * `collectCatalog()` 是**全量目录**语义（固定两个关键词、翻页到硬顶、并发拉全部
 * packument、还要处理 `from` 静默重置）。工具需要的是「任意检索词、按需条数」。
 * 把两者揉进一个函数，会让任何一方都迁就另一方。所以这里只**照抄它已经验证过的
 * 请求形态**（URL 构造、`fetchJson` 的超时写法、原生依赖判据），不 import 它的
 * 代码 —— 但 URL 形态必须与它一致，因为那是在本机真机上量出来可用的。
 *
 * ## 环境变量 / 落点
 *
 * 源码解包落在 `<DSH home>/plugin-hunt/`。home 的解析顺序与官方
 * `resolveDshHome()` 一致：`$DSH_HOME` > `~/.dsh`。
 *
 * ## 安装
 *
 * `dsh plugin --profile <name> add /abs/path/to/linc-dsh-market-scout`
 * 走官方安装通道（pnpm + 回滚 + 版本检查）；也可以在本地 `pack` 成 tgz 后交给
 * `plugin_manager install_bundle`。桌面端（Windows / macOS / Linux）是唯一目标平台。
 *
 * ## 平台中立性
 *
 * 只用 `node:` 内置模块（`fs` / `path` / `os` / `zlib`）+ 全局 `fetch`，
 * 零 external 依赖、零原生模块，所以 Linux / macOS / Windows 都跑得起来 ——
 * tar 解析是自己写的，不 shell 出去调 `tar`，正是为了不依赖平台 PATH。
 *
 * @module linc-dsh-market-scout
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

export const name = 'linc-dsh-market-scout';

/**
 * 只要 `tools`：本插件不发命令、不碰沙箱，只做 HTTP 拉取与本地解包。
 * @type {string[]}
 */
export const inject = ['tools'];

/** 工具名。不叫 `plugin_market`：宿主自带的同名工具（市场索引浏览）会占住那个名字，
 * 两个工具重名时路由不稳定（实测时灵时不灵）。改用与技能一致的 `plugin_market_scout`。 */
const TOOL_NAME = 'plugin_market_scout';

/** 包根目录（`lib/..`）。技能随包分发，装到哪儿都按这个路径找。 */
const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 随包技能名。与工具名同前缀，便于在日志里对上号。 */
const SKILL_NAME = 'market-scout';

/**
 * 搜索用**官方源**，不跟随本机镜像。
 *
 * 照抄市场采集器的结论：npmmirror 对 `keywords:dshapp-plugin` 返回 `total=0`
 * （镜像的关键词索引明显滞后）。而**安装**走镜像没问题（见 `plugin-manager.patch.yml`）
 * —— 查目录与装包刻意用不同的源。
 */
const OFFICIAL_REGISTRY = 'https://registry.npmjs.org';

/** 社区区关键词。任何 DSH 插件包带上它就会被收录。 */
const KEYWORD_COMMUNITY = 'dshapp-plugin';

/** 精选区关键词。维护者人工审核后补上再发版。 */
const KEYWORD_FEATURED = 'dshapp-plugin-featured';

/** 单次请求超时。tarball 比 packument 慢，单独给一个更宽的值。 */
const TIMEOUT_MS = 20000;
const TARBALL_TIMEOUT_MS = 60000;

/** 返回条数上限。再大对模型没有意义，只会把上下文塞满。 */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 15;

/** 并发拉 packument 的数量。与市场采集器一致，避免把 registry 打疼。 */
const CONCURRENCY = 6;

/** 解包落点（相对 `$DSH_HOME`）。 */
const HUNT_DIR = 'plugin-hunt';

/**
 * 大目录（awesome-dsh-plugin）镜像。npm 关键词区只有十几个包，而大目录收录
 * 几百个社区插件（带 homepage / repo / 发布时间的目录快照）。**两源合并**才能
 * 说"搜过了市场"——只搜关键词区等于只看冰山一角（dsh-whale-widget 那次教训里，
 * 关键词区根本搜不到现成插件，而它就在大目录里）。
 */
const CATALOG_URLS = [
	'https://fastly.jsdelivr.net/npm/dsh-plugin-catalog/index.json',
	'https://jsd.onmicrosoft.cn/npm/dsh-plugin-catalog/index.json',
	'https://gcore.jsdelivr.net/npm/dsh-plugin-catalog/index.json',
];

/** 目录缓存时长（目录更新不频繁）。 */
const CATALOG_CACHE_MS = 10 * 60 * 1000;

/** 单文件 / 单包解包上限，防一个大包把私有目录撑爆。 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 40 * 1024 * 1024;
const MAX_FILES_REPORTED = 200;

/** 回给模型的 patch 文本上限（`cordis.patch.yml` 可能很长）。 */
const MAX_PATCH_CHARS = 20000;

/** `dryrun` 子进程超时。第三方代码可能挂死，超时就是它的失败态。 */
const DRYRUN_TIMEOUT_MS = 15000;

/**
 * 已知**需要平台预编译产物**的依赖（桌面端通常没事，换平台就可能缺绑定）。
 *
 * 判据照抄 `market/lib/collect.mjs` 的 `NATIVE_RISK`（每一条都是真机踩过的）。
 * ⚠️ **这不是黑名单，是提示**：装了不代表一定坏，插件可能自己带了对应平台产物
 * （本 App 处理 sharp 就是这么做的），所以只标风险，不隐藏、不拒装。
 */
const NATIVE_RISK = [
	{ re: /^sharp$/, why: 'sharp 需平台预编译（wasm32 变体）' },
	{ re: /^@img\/sharp/, why: 'sharp 的 wasm 变体，需随包分发' },
	{ re: /^@vscode\/ripgrep/, why: 'ripgrep 需平台预编译产物' },
	{ re: /^node-pty$/, why: 'node-pty 需平台预编译绑定' },
	{ re: /^node-addon-/, why: '原生插件，需平台预编译产物' },
	{ re: /^@deepseek-ai\/node-addon-/, why: '原生插件，需平台预编译产物' },
	{ re: /^better-sqlite3$/, why: '原生模块，需平台预编译' },
	{ re: /^@napi-rs\//, why: 'N-API 原生模块，需平台产物' },
];

const DESCRIPTION = [
	'Any new task that might need a plugin (make PPT, edit code, batch ops, delete/manage sessions, "每次都要……很麻烦"): call action:"coverage" once before doing the work; reuse cached candidates instead of re-searching, and only search when both availability and candidates are missing. Before installing, run fetch → audit → dryrun. Long tasks: call action:"plan" first and report progress as you go.',
	'Long tasks first call action:"plan" (records 做什么/花多少/需确认 and returns a briefing). Install with plugin_manager action:"install_bundle" target:<dir>; after installing run action:"verify". action:"rollback" cleans this tool\'s own leftovers (what:"hunt" deletes the fetched copy, what:"memo" restores the previous memo snapshot; uninstalling plugins stays with plugin_manager).',
].join(' ');

// ─────────────────────────── HTTP ───────────────────────────

/**
 * 带超时的 fetch + JSON 解析。不读环境代理。
 *
 * 照抄 `collect.mjs` 的写法：调用方信号与超时信号合成一个，任一触发都中断。
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
	const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} :: ${url}`);
	return res.json();
}

/**
 * 拉一个包的 packument（`/<name>`，而不是 search 的返回体）。
 *
 * 只有 packument 带 `dependencies` / `dsh` / `dist.tarball`，而「能不能装」
 * 与「怎么下载」全靠这几个字段。
 *
 * @param {string} pkgName 包名（可含 scope）。
 * @returns {Promise<{ok: true, doc: any} | {ok: false, error: string}>}
 */
async function fetchPackument(pkgName) {
	const url = `${OFFICIAL_REGISTRY}/${pkgName.replace('/', '%2F')}`;
	try {
		return { ok: true, doc: await fetchJson(url) };
	} catch (error) {
		return { ok: false, error: String(error?.message ?? error) };
	}
}

// ─────────────────────── 包名与判据 ───────────────────────

/** npm 包名（含可选 scope）。用于挡掉路径穿越一类的输入。 */
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

/**
 * 拆分 `name[@version]`。
 *
 * ⚠️ 带 scope 的包名本身含 `@`（`@scope/name`），所以必须用 `lastIndexOf('@')`
 * 且要求它不在第 0 位，否则 `@scope/name` 会被误拆成包名 `''` + 版本 `scope/name`。
 *
 * @param {string} spec
 * @returns {{name: string, version?: string}}
 */
function parseSpec(spec) {
	const at = spec.lastIndexOf('@');
	if (at > 0) {
		const version = spec.slice(at + 1);
		if (version !== '') return { name: spec.slice(0, at), version };
	}
	return { name: spec };
}

/**
 * 收集 manifest 里的原生依赖风险。
 *
 * @param {any} manifest 某个版本的 manifest。
 * @returns {string[]}
 */
function nativeRisks(manifest) {
	const deps = {
		...(manifest?.dependencies ?? {}),
		...(manifest?.optionalDependencies ?? {}),
		...(manifest?.peerDependencies ?? {}),
	};

	const risks = [];
	for (const dep of Object.keys(deps)) {
		for (const rule of NATIVE_RISK) {
			if (rule.re.test(dep)) risks.push(`${dep} —— ${rule.why}`);
		}
	}
	return risks;
}

/**
 * 从 manifest 里收集判据：能不能装、有没有风险。
 *
 * @param {any} manifest 某个版本的 manifest。
 * @returns {{installable: boolean, risks: string[]}}
 */
function judge(manifest) {
	const risks = nativeRisks(manifest);

	// 没有 dsh.bundle.patch 就**装不上**（官方市场文档里最常见的被拒原因）
	const installable = Boolean(manifest?.dsh?.bundle?.patch);
	if (!installable) risks.push('未声明 dsh.bundle.patch —— 无法作为插件包安装');

	return { installable, risks };
}

/**
 * 从 packument 里取指定版本（缺省 latest）的 manifest。
 * @param {any} doc
 * @param {string} [version]
 * @returns {{version: string, manifest: any} | {error: string}}
 */
function pickVersion(doc, version) {
	const wanted = version ?? doc?.['dist-tags']?.latest;
	if (!wanted) return { error: '该包没有 dist-tags.latest' };
	const manifest = doc?.versions?.[wanted];
	if (!manifest) {
		const known = Object.keys(doc?.versions ?? {}).join(', ');
		return { error: `版本 ${wanted} 不存在（可用的有: ${known}）` };
	}
	return { version: wanted, manifest };
}

// ─────────────────────── tar 解包 ───────────────────────

/**
 * 读 tar 头里的一个字符串字段（trim 掉 NUL 与空格）。
 * @param {Buffer} buf
 * @param {number} offset
 * @param {number} length
 */
function readField(buf, offset, length) {
	const slice = buf.subarray(offset, offset + length);
	let end = slice.length;
	for (let i = 0; i < slice.length; i += 1) {
		if (slice[i] === 0) {
			end = i;
			break;
		}
	}
	return slice.subarray(0, end).toString('utf8').trim();
}

/**
 * 解析 ustar/pax tar 字节流。
 *
 * 为什么不 shell 出去调 `tar`：插件跑在 host 半，`tar` 的可执行文件与 PATH
 * 依赖 Termux 前缀，而这条链路只要解析一个格式固定的归档。Node 自带 `zlib`，
 * 补 60 行 tar 解析即可，零外部依赖、零 PATH 假设。
 *
 * @param {Buffer} buf
 * @returns {Array<{name: string, data: Buffer, directory: boolean}>}
 */
function untar(buf) {
	const entries = [];
	let offset = 0;
	/** pax / GNU 长名头留下的下一条 entry 的真实路径。 */
	let pendingName = null;

	while (offset + 512 <= buf.length) {
		const header = buf.subarray(offset, offset + 512);

		// 全零块 = 归档结束
		if (header.every((byte) => byte === 0)) break;

		const headerName = readField(header, 0, 100);
		const size = Number.parseInt(readField(header, 124, 12) || '0', 8);
		const type = String.fromCharCode(header[156] || 48);
		const prefix = readField(header, 345, 155);

		if (!Number.isFinite(size) || size < 0) break;

		const dataStart = offset + 512;
		const data = buf.subarray(dataStart, dataStart + size);

		if (type === 'x' || type === 'g') {
			// pax 扩展头：里面有一条 "path=<真实路径>"
			const text = data.toString('utf8');
			const match = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(text);
			if (match) pendingName = match[1];
		} else if (type === 'L') {
			// GNU 长文件名：数据体就是路径
			pendingName = data.toString('utf8').replace(/\0+$/, '');
		} else if (type === '0' || type === '\0' || type === '7') {
			const full = pendingName ?? (prefix ? `${prefix}/${headerName}` : headerName);
			pendingName = null;
			entries.push({ name: full, data, directory: type === '7' });
		} else {
			// '5' 目录 / '2' 符号链接 / 其它：都不落盘
			// ⚠️ 符号链接**不创建**：tarball 里的链接目标可以指向任意位置，
			// 解包时跟出去就等于把写入权交给包作者。
			pendingName = null;
		}

		offset = dataStart + Math.ceil(size / 512) * 512;
	}

	return entries;
}

/**
 * 把相对路径安全地解析到目标目录内。
 *
 * @param {string} root 目标根目录（已 resolve）。
 * @param {string} relative tar 里的路径。
 * @returns {string}
 */
function safeJoin(root, relative) {
	const target = path.resolve(root, relative);
	const prefix = root.endsWith(path.sep) ? root : root + path.sep;
	if (target !== root && !target.startsWith(prefix)) {
		throw new Error(`拒绝写入超出目标目录的路径: ${relative}`);
	}
	return target;
}

// ─────────────────────── 两个 action ───────────────────────

/**
 * 并发受限地映射。任何一项失败都退化为 `null`，不让一条坏数据毁掉整次搜索。
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<Array<R | null>>}
 */
async function mapLimit(items, limit, worker) {
	const results = new Array(items.length).fill(null);
	let cursor = 0;

	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			try {
				results[index] = await worker(items[index]);
			} catch {
				results[index] = null;
			}
		}
	});

	await Promise.all(runners);
	return results;
}

/**
 * `action: "search"` —— 搜市场。
 *
 * @param {any} args
 * @returns {Promise<any>}
 */
// ─────────────────── 大目录（awesome-dsh-plugin） ───────────────────

/** 内存缓存：{at, plugins}。 */
const catalogCache = { at: 0, plugins: [] };

/**
 * 拉取大目录快照（三个镜像依次尝试，全挂退回上次缓存）。
 * @returns {Promise<Array<any>>}
 */
async function loadCatalog() {
	if (Date.now() - catalogCache.at < CATALOG_CACHE_MS && catalogCache.plugins.length > 0) return catalogCache.plugins;
	for (const url of CATALOG_URLS) {
		try {
			const json = await fetchJson(url, TIMEOUT_MS);
			const plugins = Array.isArray(json?.plugins) ? json.plugins : [];
			if (plugins.length > 0) {
				catalogCache.at = Date.now();
				catalogCache.plugins = plugins;
				return plugins;
			}
		} catch {
			// 这个镜像不可用就换下一个
		}
	}
	return catalogCache.plugins;
}

/**
 * 在大目录里按检索词筛。
 *
 * 匹配口径：把 name + title + 中英文描述拼起来小写化，所有检索词都要命中
 * （全词命中优先）；全词没有命中就放宽成任一命中——但此时结果要明确标注"宽松"。
 * 排序按最近发布时间（目录自带 publishTimestamp，不需要再打 registry）。
 *
 * @param {Array<any>} plugins
 * @param {string} query
 * @param {number} limit
 * @returns {Array<any>}
 */
function catalogSearch(plugins, query, limit) {
	const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
	if (tokens.length === 0) return [];

	// 目录每个条目都同时有中英文描述（实测 3730/3730），所以这里按 zh + en + title
	// 一起匹配：英文查询也能命中中文插件，反之亦然。
	const textOf = (entry) => {
		const desc = entry?.description ?? {};
		const zh = typeof desc?.zh === 'string' ? desc.zh : '';
		const en = typeof desc?.en === 'string' ? desc.en : '';
		return [String(entry?.name ?? ''), String(entry?.title ?? ''), zh, en].join(' ').toLowerCase();
	};
	const matchCount = (entry) => {
		const text = textOf(entry);
		let count = 0;
		for (const token of tokens) {
			// 同义词组：字幕 ↔ subtitle、转写 ↔ ASR……字面对不上但概念相同的也算命中
			if (synonymMates(token).some((mate) => text.includes(mate))) count += 1;
		}
		return count;
	};
	const wantsZh = /[\u4e00-\u9fff]/u.test(query);

	let hits = plugins.filter((entry) => matchCount(entry) === tokens.length);
	let loose = false;
	if (hits.length === 0) {
		hits = plugins.filter((entry) => matchCount(entry) > 0);
		loose = true;
	}

	return {
		loose,
		rows: hits
			.map((entry) => {
				const versions = Array.isArray(entry?.versions) ? entry.versions : [];
				let latest = null;
				for (const version of versions) {
					const time = Number(version?.publishTimestamp ?? 0);
					if (latest === null || time > latest.time) latest = { version: version?.version ?? null, time };
				}
				const desc = entry?.description ?? {};
				const zh = typeof desc?.zh === 'string' ? desc.zh : '';
				const en = typeof desc?.en === 'string' ? desc.en : '';
				return {
					name: String(entry?.name ?? ''),
					title: typeof entry?.title === 'string' ? entry.title : '',
					version: latest?.version ?? null,
					// 按查询语言回描述：中文查询看中文，英文查询看英文
					description: wantsZh ? (zh || en) : (en || zh),
					descriptionEn: en,
					descriptionZh: zh,
					updated: latest?.time ? new Date(latest.time * 1000).toISOString() : null,
					homepage: typeof entry?.homepage === 'string' ? entry.homepage : null,
					from: 'catalog',
					matchedTokens: matchCount(entry),
				};
			})
			.filter((row) => PACKAGE_NAME.test(row.name))
			// 宽松模式下按命中词数排：命中越多越相关，同分再按发布时间
			.sort((a, b) => (b.matchedTokens ?? 0) - (a.matchedTokens ?? 0) || String(b.updated ?? '').localeCompare(String(a.updated ?? '')))
			.slice(0, limit),
	};
}

/**
 * 维护度信号（反下载量噪声）：从 packument 的 `time` 推出版本数、库龄、最近发布
 * 距今天数、最近 5 个版本的中位发布间隔。npm 下载量会被 CI / 镜像缓存噪声污染，
 * 这些纯时间信号不会——用来判断"维护者是否还在投入"，而不是"谁发版最勤"。
 *
 * @param {any} doc packument
 * @returns {{releases: number, ageDays: number|null, lastDaysAgo: number, cadenceDays: number|null} | null}
 */
function maintenanceSignal(doc) {
	const time = doc?.time;
	if (time === null || typeof time !== 'object') return null;
	const created = typeof time.created === 'string' ? Date.parse(time.created) : NaN;
	const versions = Object.keys(time)
		.filter((key) => key !== 'created' && key !== 'modified' && typeof time[key] === 'string')
		.map((key) => Date.parse(time[key]))
		.filter((ms) => Number.isFinite(ms))
		.sort((a, b) => a - b);
	if (versions.length === 0) return null;
	const last = versions[versions.length - 1];
	const now = Date.now();
	const recent = versions.slice(-5);
	let cadenceDays = null;
	if (recent.length >= 2) {
		const gaps = [];
		for (let i = 1; i < recent.length; i += 1) gaps.push((recent[i] - recent[i - 1]) / 86400000);
		gaps.sort((a, b) => a - b);
		cadenceDays = Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10;
	}
	return {
		releases: versions.length,
		ageDays: Number.isFinite(created) ? Math.max(0, Math.round((now - created) / 86400000)) : null,
		lastDaysAgo: Math.max(0, Math.round((now - last) / 86400000)),
		cadenceDays,
	};
}

/**
 * 领域同义词组：跨语言 + 近义词。只影响**本地匹配打分**（不改网络请求），
 * 用来补「ASR ↔ 转写」「字幕 ↔ subtitle」「会话 ↔ session」这类词形对不上的盲区。
 *
 * 维护约定：一组 = 一个概念，第一个词当规范形；中英混排；同组内不要放太泛的词。
 */
const SYNONYM_GROUPS = [
	['视频', '短片', '影片', 'video', 'videos', 'clip', 'movie'],
	['字幕', 'subtitle', 'subtitles', 'cc', 'captions'],
	['转写', '转录', '识别', 'transcribe', 'transcript', 'transcription', 'asr'],
	['总结', '摘要', '摘要生成', 'summary', 'summarize', 'summarise', 'digest'],
	['语音', '音频', 'voice', 'audio', 'speech', 'tts'],
	['会话', '对话', '聊天', 'session', 'conversation', 'chat'],
	['删除', '删掉', '移除', '清理', 'delete', 'remove', 'purge', 'clean'],
	['插件', '扩展', 'plugin', 'plugins', 'extension', 'addon'],
	['安装', '装上', 'install', 'setup'],
	['搜索', '检索', '查找', 'search', 'lookup', 'find', 'query'],
	['市场', '商店', 'market', 'marketplace', 'store', 'catalog'],
	['记忆', '备忘', 'memory', 'memorize', 'recall'],
	['定时', '排班', '计划', 'schedule', 'cron', 'timer', 'interval'],
	['图片', '图像', '照片', 'image', 'picture', 'photo', 'img'],
	['文字识别', 'ocr', '图片转文字'],
	['文档', 'docx', 'document', 'word'],
	['表格', 'excel', 'spreadsheet', 'xlsx', 'sheet'],
	['幻灯片', '演示', 'ppt', 'pptx', 'slide', 'slides', 'presentation'],
	['翻译', 'translate', 'translation'],
	['下载', 'download', 'fetch'],
	['上传', 'upload'],
	['设置', '配置', 'config', 'configuration', 'settings', 'option'],
	['登录', '扫码', 'auth', 'login', 'signin', 'credential'],
	['模型', 'model', 'llm', 'gpt', 'deepseek'],
	['智能体', '代理', 'agent', 'agents'],
	['技能', 'skill', 'skills'],
	['工具', 'tool', 'tools'],
	['提示词', 'prompt', 'prompts'],
	['主题', '皮肤', 'theme', 'skin', 'appearance'],
	['通知', '提醒', 'notification', 'notify', 'reminder', 'alert'],
	['日历', 'calendar', 'agenda'],
	['任务', '待办', 'task', 'todo', 'todos', 'kanban'],
	['远程', 'remote', 'tunnel', 'proxy', 'mcp'],
	['手机', '移动端', 'mobile', 'android', 'phone'],
	['微信', 'wechat', 'weixin'],
	['电报', 'telegram', 'tg'],
	['视频站', 'bilibili', 'b站', 'bili', '哔哩哔哩'],
	['油管', 'youtube', 'yt'],
	['音乐', 'music', 'song', 'audio'],
	['嵌入', '向量', 'embedding', 'embeddings', 'vector'],
	['工作区', 'workspace', 'workspaces', 'project'],
	['归档', 'archive', 'archived'],
	['收藏', '星标', 'favorite', 'favourite', 'star', 'bookmark'],
	['导入', 'import'],
	['导出', 'export'],
	['转换', 'convert', 'transform', 'format'],
	['压缩', 'compress', 'zip', 'archive'],
	['截图', '捕捉', 'screenshot', 'capture', 'snapshot'],
	['帧', '抽帧', 'frame', 'frames', 'keyframe'],
	['水印', 'watermark'],
	['页面', '界面', 'panel', 'page', 'ui', 'widget'],
];

/** 小写词 → 规范形（组首词）。 */
const SYNONYM_CANON = new Map();
for (const group of SYNONYM_GROUPS) {
	const canonical = String(group[0]).toLowerCase();
	for (const term of group) SYNONYM_CANON.set(String(term).toLowerCase(), canonical);
}

/**
 * 词 → 规范形：命中同义词组就归一，拉丁复数退化为单数再试一次，否则原样返回。
 */
function canonToken(token) {
	const key = String(token ?? '').toLowerCase();
	if (key === '') return '';
	if (SYNONYM_CANON.has(key)) return SYNONYM_CANON.get(key);
	if (/^[a-z]{4,}s$/.test(key)) {
		const singular = key.slice(0, -1);
		if (SYNONYM_CANON.has(singular)) return SYNONYM_CANON.get(singular);
	}
	return key;
}

/** 某个词的所有等价写法（含自身），用于目录的字面子串匹配。 */
function synonymMates(token) {
	const key = String(token ?? '').toLowerCase();
	const canonical = canonToken(key);
	const mates = new Set([key]);
	for (const [term, canon] of SYNONYM_CANON) if (canon === canonical) mates.add(term);
	return [...mates];
}

/**
 * 中文需求 → 英文检索词（取自 find-skills 的「中文关键词对照表」思路，但内置成数据，
 * 不靠模型自己记）。npm 关键词搜索和目录匹配都是字面量：中文词搜不到英文描述的包。
 */
const ZH_EN_HINTS = [
	['做ppt', ['ppt', 'presentation', 'slides']],
	['ppt', ['ppt', 'presentation', 'slides']],
	['幻灯片', ['ppt', 'presentation', 'slides']],
	['演示文稿', ['ppt', 'presentation']],
	['数据分析', ['data analysis', 'analytics']],
	['写文章', ['writing', 'article']],
	['文案', ['copywriting', 'copy']],
	['代码审查', ['code review', 'review']],
	['审查', ['review']],
	['部署', ['deploy', 'deployment']],
	['测试', ['testing', 'test']],
	['视频总结', ['video summary', 'transcript', 'video']],
	['视频', ['video', 'clip']],
	['字幕', ['subtitle', 'captions', 'transcript']],
	['语音转文字', ['asr', 'transcription', 'speech to text']],
	['转文字', ['transcript', 'asr']],
	['图片识别', ['ocr', 'image recognition']],
	['识别', ['ocr', 'recognize']],
	['表格', ['excel', 'spreadsheet', 'xlsx']],
	['文档', ['docx', 'document', 'word']],
	['日历', ['calendar']],
	['邮件', ['email', 'mail']],
	['记账', ['expense', 'ledger', 'bookkeeping']],
	['股票', ['stock', 'market']],
	['爬虫', ['crawler', 'scrape', 'scraping']],
	['翻译', ['translate', 'translation']],
	['定时', ['schedule', 'cron']],
	['提醒', ['reminder', 'notify']],
	['知识库', ['knowledge base', 'wiki', 'notes']],
	['笔记', ['notes', 'note']],
	['数据库', ['database', 'sql']],
	['搜索增强', ['search', 'retrieval']],
	['插件', ['plugin', 'extension']],
	['技能', ['skill', 'skills']],
	['主题', ['theme', 'skin']],
	['远程', ['remote', 'tunnel']],
	['微信', ['wechat']],
	['群聊', ['group chat', 'chat']],
];

/** 英文检索词 → 中文（由 ZH_EN_HINTS 反向生成，补"英文 query 找不到中文包"）。 */
const EN_ZH_HINTS = (() => {
	const map = new Map();
	for (const [zh, english] of ZH_EN_HINTS) {
		for (const term of english) if (!map.has(term)) map.set(term, zh);
	}
	return map;
})();

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 从一句需求里挑出可用的**另一种语言**检索词（最多 6 个）。
 * 中文 → 英文（做PPT → ppt/presentation）；英文 → 中文（transcript → 转写/字幕）。
 */
function queryHints(text) {
	// 去掉礼貌词/量词再匹配，否则「帮我做一份PPT」里的 一份 会把「做ppt」隔断
	const query = String(text ?? '').toLowerCase().replace(/一份|一个|一下|帮我|麻烦|请|给我/g, '');
	const hasCjk = /[\u4e00-\u9fff]/u.test(query);
	const hints = [];
	if (hasCjk) {
		for (const [zh, english] of ZH_EN_HINTS) {
			if (!query.includes(zh)) continue;
			for (const term of english) if (!hints.includes(term)) hints.push(term);
		}
	} else {
		for (const [term, zh] of EN_ZH_HINTS) {
			if (!new RegExp(`(^|[^a-z])${escapeRegExp(term)}([^a-z]|$)`).test(query)) continue;
			if (!hints.includes(zh)) hints.push(zh);
		}
	}
	return hints.slice(0, 6);
}

/**
 * `kind:"skill"` 判据：名字/标题/描述里明确提到 skill 或技能。
 * DSH 里的技能由插件携带（skills/ 目录），所以「找 skill」= 找这类插件。
 */
function matchesSkillKind(row) {
	const text = `${row?.name ?? ''} ${row?.title ?? ''} ${row?.description ?? ''} ${row?.descriptionEn ?? ''} ${row?.descriptionZh ?? ''}`;
	return /skill|技能|SKILL\.md/i.test(text);
}

/**
 * 相关度：查询 token 在 name / description 里的覆盖率，名称命中权重更高。
 * 用于把 npm 宽松全文检索的噪声压下去（实测长句 "bilibili video transcript summary"
 * 会把 dsh-bili-watch 挤出前 5 条）。
 */
function relevanceScore(queryTokens, name, ...texts) {
	if (queryTokens.size === 0) return 0;
	const nameT = memoTokens(name ?? '');
	// 目录条目同时带 zh / en 描述，两者都要参与打分——否则英文查询对中文插件永远 0 分
	const textT = memoTokens(texts.filter((t) => typeof t === 'string' && t !== '').join(' '));
	const nameCanon = new Set([...nameT].map(canonToken));
	const textCanon = new Set([...textT].map(canonToken));
	const matchAny = (pool, token) => {
		const canonical = canonToken(token);
		if (pool.has(canonical)) return true;
		for (const fieldToken of pool) if (memoTokenMatch(canonical, fieldToken)) return true;
		return false;
	};
	const meaningful = [...queryTokens].filter((tok) => tok.length > 1);
	if (meaningful.length === 0) return 0;
	let hit = 0;
	for (const tok of meaningful) {
		let best = 0;
		if (matchAny(nameCanon, tok)) best = 1;
		else if (matchAny(textCanon, tok)) best = 0.5;
		hit += best;
	}
	return Number(Math.min(1, hit / meaningful.length).toFixed(2));
}

async function doSearch(home, args) {
	const limit = clampLimit(args?.limit);
	const featured = args?.featured === true;
	const keyword = featured ? KEYWORD_FEATURED : KEYWORD_COMMUNITY;
	// 支持中英双语查询（queries 数组）：一种语言查 npm/目录都容易漏，两种一起召回更稳
	const incoming = [
		...(typeof args?.query === 'string' ? [args.query] : []),
		...(Array.isArray(args?.queries) ? args.queries : []),
	];
	const queryList = [...new Set(incoming.map((q) => (typeof q === 'string' ? q.trim() : '')).filter((q) => q !== ''))].slice(0, 3);
	// 中文查询自动补英文检索词（find-skills 的关键词表思路）：npm 与目录都是字面匹配
	const hintTerms = [];
	for (const single of queryList) {
		for (const hint of queryHints(single)) if (!queryList.includes(hint) && !hintTerms.includes(hint)) hintTerms.push(hint);
	}
	const effectiveQueries = [...queryList, ...hintTerms].slice(0, 5);
	const query = effectiveQueries.join(' ');
	// kind 只有 skill / all 两种语义；'plugin' 是旧值，按 all 处理（不再假装"只留插件"）
	const kindRaw = typeof args?.kind === 'string' ? args.kind.toLowerCase() : '';
	const kind = kindRaw === 'skill' ? 'skill' : 'all';

	// 两源合并：npm 关键词区 + 大目录。npm 结果先占一半额度，另一半留给目录
	// —— npm 的多词匹配很松（搜 "balance whale" 能带回远程目录插件），目录的
	// 命中通常更贴题。按名字去重，每条带 `from`（npm / catalog）。
	const candidates = [];
	const seen = new Set();
	const pushCandidate = (row) => {
		if (row === null || typeof row?.name !== 'string' || row.name === '' || seen.has(row.name)) return;
		seen.add(row.name);
		candidates.push(row);
	};
	const npmCap = Math.max(1, Math.ceil(limit / 2));

	let npmFetched = 0;
	for (const single of (effectiveQueries.length > 0 ? effectiveQueries : [''])) {
		const text = single === '' ? `keywords:${keyword}` : `keywords:${keyword} ${single}`;
		// 与市场采集器一致的请求形态（本机实测可用）
		let json;
		try {
			json = await fetchJson(`${OFFICIAL_REGISTRY}/-/v1/search?text=${encodeURIComponent(text)}&size=${limit}`);
		} catch (error) {
			if (effectiveQueries.length === 0) return { ok: false, message: `搜索失败: ${String(error?.message ?? error)}` };
			continue;
		}
		const objects = (json?.objects ?? []).slice(0, limit);
		npmFetched += objects.length;
		for (const object of objects) {
			if (candidates.filter((row) => row.from === 'npm').length >= npmCap * Math.max(1, effectiveQueries.length)) break;
			pushCandidate({
				name: object?.package?.name,
				version: object?.package?.version ?? null,
				description: object?.package?.description ?? '',
				from: 'npm',
			});
		}
	}

	let catalogNote = '';
	for (const single of effectiveQueries) {
		try {
			const catalog = await loadCatalog();
			const found = catalogSearch(catalog, single, limit);
			for (const row of found.rows) pushCandidate(row);
			catalogNote = `大目录命中 ${found.rows.length} 条${found.loose ? '（宽松：任一检索词命中，按相关度排序）' : ''}`;
		} catch {
			catalogNote = '大目录拉取失败（本次只看 npm 关键词区）';
		}
	}

	if (candidates.length === 0) {
		return {
			ok: true,
			count: 0,
			plugins: [],
			queries: effectiveQueries,
			hints: hintTerms,
			sources: { npm: npmFetched, catalog: 0 },
			// find-skills 的做法：明确说"没有"，并给替代路径，不硬凑。
			// 话术固定成一句可原样转述的话——模型不许把"接下来怎么办"推回给用户。
			notFound: true,
			message: notFoundNotice(
				`已搜 npm 关键词区 ${npmFetched} 个结果 + 大目录。可换更通用的词、或用 queries 给中英两版再搜一次；` +
				'但不要硬凑候选，也不要用"要不要我再搜搜"把决定权推回用户。',
			),
		};
	}

	// search / 目录的返回体都不带 dsh / dependencies，所以再补一次 packument
	const enrichCandidate = async (candidate) => {
		const packument = await fetchPackument(candidate.name);
		if (packument.ok === false) {
			return {
				...candidate,
				installable: null,
				risks: [`读取 manifest 失败: ${packument.error}`],
			};
		}
		const picked = pickVersion(packument.doc);
		if ('error' in picked) {
			return { ...candidate, version: null, installable: null, risks: [picked.error] };
		}
		const verdict = judge(picked.manifest);
		return {
			...candidate,
			version: picked.version,
			installable: verdict.installable,
			risks: verdict.risks,
			maintenance: maintenanceSignal(packument.doc),
			updated:
				candidate.updated
				?? (typeof packument.doc?.time?.modified === 'string' ? packument.doc.time.modified : null),
		};
	};

	const rows = await mapLimit(candidates.slice(0, limit), CONCURRENCY, enrichCandidate);

	let plugins = rows.filter((row) => row !== null);
	const queryTokens = memoTokens(query);
	const scoreRow = (row) => relevanceScore(queryTokens, row.name, row.description, row.descriptionEn, row.descriptionZh, row.title);
	for (const row of plugins) row.relevance = scoreRow(row);

	// 长句兜底：整页结果都不够相关（max < 0.34）时，用最有辨识度的 2 个 token 再搜。
	// 实测 "bilibili video transcript summary" 压根不返回 dsh-bili-watch，而 "bilibili" 能。
	let fallbackTokens = [];
	const maxRelevance = plugins.reduce((max, row) => Math.max(max, row.relevance ?? 0), 0);
	if (effectiveQueries.length > 0 && maxRelevance < 0.34) {
		const latin = [...queryTokens].filter((t) => /^[a-z0-9]{3,}$/.test(t)).sort((a, b) => b.length - a.length);
		const cjk = [...queryTokens].filter((t) => /^[\u4e00-\u9fff]{2}$/u.test(t));
		fallbackTokens = [...latin, ...cjk].slice(0, 2);
		for (const token of fallbackTokens) {
			// npm 关键词区
			try {
				const fb = await fetchJson(`${OFFICIAL_REGISTRY}/-/v1/search?text=${encodeURIComponent(`keywords:${keyword} ${token}`)}&size=${limit}`);
				for (const object of (fb?.objects ?? []).slice(0, limit)) {
					const name = object?.package?.name;
					if (plugins.some((row) => row.name === name)) continue;
					plugins.push({
						name,
						version: object?.package?.version ?? null,
						description: object?.package?.description ?? '',
						from: 'npm',
						relevance: relevanceScore(queryTokens, name, object?.package?.description),
						installable: null,
						risks: ['兜底命中：未读 manifest，可装性请用 fetch / audit 判定'],
					});
				}
			} catch {
				// 单个兜底失败不影响主结果
			}
			// 大目录：不少插件只在 directory 里（dsh-bili-watch 就是），npm 关键词搜不到
			try {
				const catalog = await loadCatalog();
				const found = catalogSearch(catalog, token, limit);
				for (const row of found.rows) {
					if (plugins.some((p) => p.name === row.name)) continue;
					plugins.push({
						...row,
						relevance: relevanceScore(queryTokens, row.name, row.description, row.descriptionEn, row.descriptionZh, row.title),
						installable: null,
						risks: ['兜底命中：未读 manifest，可装性请用 fetch / audit 判定'],
					});
				}
			} catch {
				// 目录拉取失败不影响主结果
			}
		}
	}

	// 兜底行来自目录/关键词区，没有 manifest：补一次 packument，别让它们带着旧版本号、
	// installable:null 进结果（目录快照可能落后于 npm）
	const pending = plugins.filter((row) => row.installable === null && PACKAGE_NAME.test(String(row.name ?? '')));
	if (pending.length > 0) {
		const enriched = await mapLimit(pending.slice(0, 8), CONCURRENCY, enrichCandidate);
		const byName = new Map(enriched.map((row) => [row.name, row]));
		plugins = plugins.map((row) => byName.get(row.name) ?? row);
	}

	// kind:"skill" —— 只留携带/描述技能包的插件
	if (kind === 'skill') {
		plugins = plugins.filter((row) => matchesSkillKind(row));
	}

	plugins = plugins.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || String(b.updated ?? '').localeCompare(String(a.updated ?? '')));

	// 工具侧记账：带 task 时把候选写进 memo —— 不依赖模型"记得写回"。
	// 先按身份分找最匹配的已有条目，命中就并进那条，避免同一个能力碎成一堆 key。
	let memoKey = null;
	const taskText = typeof args?.task === 'string' ? args.task.trim() : '';
	if (taskText !== '') {
		const host = readHostVersion(home) ?? '';
		const { entries } = await readMemo(home);
		const probe = memoTokens(taskText);
		let bestKey = null;
		let bestScore = 0;
		for (const [candidateKey, entry] of Object.entries(projectMemo({ entries }, host).entries)) {
			const score = scoreMemoEntryIdentity(probe, memoEntryTokens(entry, candidateKey));
			if (score > bestScore) {
				bestScore = score;
				bestKey = candidateKey;
			}
		}
		memoKey = bestScore >= MEMO_MATCH_AUTO && bestKey !== null ? bestKey : normalizeMemoKey(taskText);
		const existing = entries[memoKey];
		const candidates = plugins
			.filter((row) => row.installable !== false && (effectiveQueries.length === 0 || (row.relevance ?? 0) > 0))
			.slice(0, 8)
			.map((row) => ({
				pkg: row.name,
				version: row.version ?? '',
				fit: String(row.description ?? '').slice(0, 120),
				fitFor: [],
				checkedAt: Date.now(),
			}));
		if (candidates.length > 0) {
			await writeMemo(home, [{
				key: memoKey,
				availability: existing?.availability || 'none',
				candidates,
				note: existing?.note || `市场搜索：${taskText}`,
			}], {});
		}
	}

	// 「沾边」不等于「找到」：实测搜 nonsense 词也能返回 2 条 0.09 的包。
	// 阈值取 0.2 而不是更高的原因：中文查询的相关度天然偏低（"删除会话" 0.83，
	// 但 "删掉一个旧会话 delete session" 只有 0.43），定高了会把真命中判成没找到。
	// 0.2 只兜住纯噪声（实测 nonsense 查询最高 0.0~0.14）。
	const topRelevance = plugins.reduce((max, row) => Math.max(max, row.relevance ?? 0), 0);
	const weakResults = plugins.length > 0 && topRelevance < 0.2;

	return {
		ok: true,
		count: plugins.length,
		...(weakResults
			? {
					notFound: true,
					weakResults: true,
					message: notFoundNotice(
						`已搜 npm + 大目录，最高相关度只有 ${topRelevance.toFixed(2)}，都只是沾边，别当命中用；` +
						'换更通用的词或用 queries 给中英两版可再搜一次。',
					),
				}
			: {}),
		keyword,
		query,
		queries: effectiveQueries,
		...(hintTerms.length > 0 ? { hints: hintTerms } : {}),
		kind,
		toolVersion: readToolVersion(),
		...(memoKey !== null ? { memoKey } : {}),
		...(fallbackTokens.length > 0 ? { fallbackTokens } : {}),
		sources: {
			npm: plugins.filter((row) => row.from === 'npm').length,
			catalog: plugins.filter((row) => row.from === 'catalog').length,
		},
		plugins,
		// ⚠️ npm search 的多词是**宽松全文检索**，不是 name 过滤：搜 "zen" 会连带
		// 返回只在 description/keywords 里提到该词的包（本机实测）。所以别把返回条数
		// 当成"命中了这么多"，按 name + relevance 自己筛。
		...(effectiveQueries.length === 0
			? {}
			: {
					note:
						`${catalogNote}；relevance 按 name/标题/中英描述综合算（目录条目自带双语描述），双语查询可提高召回。`,
				}),
		nextStep:
			'If the user named a specific plugin or showed a screenshot containing an install command, fetch and install THAT one first — it is the answer, not a style reference. ' +
			'Otherwise pick a candidate, call action:"fetch" with its name to read its source, and install with plugin_manager action:"install_bundle".',
	};
}

/**
 * `action: "updates"` —— 检查已装插件有没有新版本。
 *
 * 只读：扫每个 profile 的 dependencies → 读 node_modules 里实际版本 → 对
 * registry 取 latest 比对。不下载、不改任何东西。升级动作仍然走
 * `plugin_manager`（升级前先对新版本跑 audit + dryrun，老规矩）。
 *
 * @param {string} home
 * @returns {Promise<any>}
 */
async function doUpdates(home) {
	const profiles = collectProfiles(home);
	const targets = [];
	const seen = new Set();
	for (const profile of profiles) {
		for (const [depName, spec] of Object.entries(profile.deps)) {
			if (seen.has(depName)) continue;
			seen.add(depName);
			targets.push({ name: depName, spec, dir: profile.dir, profile: profile.profile });
		}
	}

	const rows = await mapLimit(targets, CONCURRENCY, async (target) => {
		// 实装版本以 node_modules 里为准（spec 可能是 file:/link: 或 ^）
		let installed = null;
		try {
			const manifest = JSON.parse(await fsp.readFile(path.join(target.dir, 'node_modules', target.name, 'package.json'), 'utf8'));
			installed = manifest?.version ?? null;
		} catch {
			return { name: target.name, installed: null, latest: null, outdated: null, error: 'node_modules 里没有这个包' };
		}

		// 本地 tgz / 目录安装的包在 registry 上没有版本：这不是异常，标出来即可
		const localInstall = /^(file|link):/.test(String(target.spec ?? ''));
		if (localInstall) {
			return { name: target.name, installed, latest: null, outdated: null, local: true };
		}

		const packument = await fetchPackument(target.name);
		if (packument.ok === false) {
			return { name: target.name, installed, latest: null, outdated: null, error: packument.error };
		}
		const picked = pickVersion(packument.doc);
		if ('error' in picked) {
			return { name: target.name, installed, latest: null, outdated: null, error: picked.error };
		}
		if (installed === null) return { name: target.name, installed, latest: picked.version, outdated: null, error: '读不到本地版本' };

		const current = parseVersion(installed);
		const latest = parseVersion(picked.version);
		const comparable = current !== null && latest !== null;
		return {
			name: target.name,
			installed,
			latest: picked.version,
			updated: typeof packument.doc?.time?.modified === 'string' ? packument.doc.time.modified : null,
			outdated: comparable ? compareVersions(latest, current) > 0 : null,
		};
	});

	const results = rows.filter((row) => row !== null);
	return {
		ok: true,
		checked: results.length,
		outdated: results.filter((row) => row.outdated === true),
		maybeOutdated: results.filter((row) => row.outdated === null && row.error === undefined),
		upToDate: results.filter((row) => row.outdated === false).map((row) => row.name),
		local: results.filter((row) => row.local === true).map((row) => row.name),
		errors: results.filter((row) => row.error !== undefined),
		nextStep:
			'对每个 outdated 包：先 fetch 新版本源码跑 audit + dryrun，再问用户是否用 plugin_manager 升级。local 列表是本地 tgz/目录安装的包，升级要用户自己指定新来源。',
	};
}

/**
 * `action: "fetch"` —— 下载 tarball 并解包到 `$DSH_HOME/plugin-hunt/<name>-<version>/`。
 *
 * @param {string} home `$DSH_HOME`。
 * @param {any} args
 * @returns {Promise<any>}
 */
/**
 * 反抢注启发：npm 包的 `repository` 路径里是否出现（归一化后的）非 scoped 包名。
 * 返回 null 表示没有仓库信息、无法判定；false 表示路径与包名对不上，值得警惕。
 *
 * @param {any} repository npm repository 字段（string 或 {type,url}）
 * @param {string} pkgName 包名（可带 scope）
 * @returns {boolean | null}
 */
function repoMatchesName(repository, pkgName) {
	const url = typeof repository === 'string'
		? repository
		: (repository !== null && typeof repository === 'object' && typeof repository.url === 'string' ? repository.url : '');
	if (url === '') return null;
	const unscoped = pkgName.replace(/^@[^/]+\//, '');
	const slug = unscoped.toLowerCase().replace(/[^a-z0-9]+/g, '');
	if (slug === '') return null;
	return url.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(slug);
}

async function doFetch(home, args) {
	const rawSpec = typeof args?.name === 'string' ? args.name.trim() : '';
	if (rawSpec === '') {
		return { ok: false, message: 'fetch 需要 name：包名，可写成 name@version' };
	}

	const spec = parseSpec(rawSpec);
	if (!PACKAGE_NAME.test(spec.name)) {
		return { ok: false, message: `不是合法的包名: ${spec.name}` };
	}

	const packument = await fetchPackument(spec.name);
	if (packument.ok === false) {
		return { ok: false, message: `拉取 ${spec.name} 的 manifest 失败: ${packument.error}` };
	}

	const picked = pickVersion(packument.doc, spec.version);
	if ('error' in picked) return { ok: false, message: picked.error };

	const tarballUrl = picked.manifest?.dist?.tarball;
	if (typeof tarballUrl !== 'string' || tarballUrl === '') {
		return { ok: false, message: `${spec.name}@${picked.version} 没有 dist.tarball` };
	}

	let archive;
	try {
		const res = await fetch(tarballUrl, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) });
		if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
		archive = Buffer.from(await res.arrayBuffer());
	} catch (error) {
		return { ok: false, message: `下载 tarball 失败: ${String(error?.message ?? error)}` };
	}

	let entries;
	try {
		entries = untar(zlib.gunzipSync(archive));
	} catch (error) {
		return { ok: false, message: `解包 tar 失败: ${String(error?.message ?? error)}` };
	}

	// npm tarball 的路径统一以 `package/` 开头；去掉它，目录名已含版本
	const dirName = `${spec.name.replace(/[@/]/g, '-').replace(/^-/, '')}-${picked.version}`;
	const root = path.join(home, HUNT_DIR, dirName);

	// 重拉时先清干净，避免上一次改动过的文件残留下来造成误判
	await fsp.rm(root, { recursive: true, force: true });
	await fsp.mkdir(root, { recursive: true });

	const written = [];
	let skipped = 0;
	let totalBytes = 0;

	for (const entry of entries) {
		if (entry.directory) continue;

		const relative = entry.name.replace(/^package\//, '');
		if (relative === '' || relative.endsWith('/')) continue;

		if (entry.data.length > MAX_FILE_BYTES) {
			skipped += 1;
			continue;
		}
		if (totalBytes + entry.data.length > MAX_PACKAGE_BYTES) {
			skipped += 1;
			continue;
		}

		let target;
		try {
			target = safeJoin(root, relative);
		} catch {
			skipped += 1;
			continue;
		}

		await fsp.mkdir(path.dirname(target), { recursive: true });
		await fsp.writeFile(target, Buffer.from(entry.data));
		totalBytes += entry.data.length;
		written.push(relative);
	}

	written.sort();

	const verdict = judge(picked.manifest);
	const patchFiles = await readPatchFiles(root, picked.manifest);
	const repository = picked.manifest?.repository ?? packument.doc?.repository ?? null;
	const homepage = typeof picked.manifest?.homepage === 'string' ? picked.manifest.homepage : (typeof packument.doc?.homepage === 'string' ? packument.doc.homepage : null);
	const repoOk = repoMatchesName(repository, spec.name);
	const patchDisabled = patchFiles.some((entry) => /disabled:\s*true/i.test(String(entry?.text ?? '')));

	return {
		ok: true,
		name: spec.name,
		version: picked.version,
		dir: root,
		installable: verdict.installable,
		risks: verdict.risks,
		dsh: picked.manifest?.dsh ?? null,
		engines: picked.manifest?.engines ?? null,
		repository: typeof repository === 'string' ? repository : (repository?.url ?? null),
		homepage,
		repoMatchesName: repoOk,
		patchDisabled,
		files: written.slice(0, MAX_FILES_REPORTED),
		fileCount: written.length,
		skippedFiles: skipped,
		patchFiles,
		nextStep:
			(repoOk === false
				? `提示：npm repository（${typeof repository === 'string' ? repository : repository?.url ?? '无'}）路径里不含包名——monorepo 或改名很常见，装前瞄一眼 homepage 确认来源即可。` : '') +
			(patchDisabled ? '注意：patch 是 disabled: true，装完要在「插件」页启用并重启，否则工具不注册。' : '') +
			`Read ${root} to decide whether it fits. If it needs changes, edit it in place; ` +
			`then install with plugin_manager action:"install_bundle" target:"${root}".`,
	};
}

/**
 * 读 `dsh.bundle.patch` 指向的 patch 文件全文。
 *
 * 这是「能不能直接用」最关键的判据：它写着挂什么 entry id、改哪一层的 config。
 * 直接回传全文，模型就不必再为它单独调一次 read。
 *
 * @param {string} root
 * @param {any} manifest
 * @returns {Promise<Array<{file: string, text: string, truncated?: boolean}>>}
 */
async function readPatchFiles(root, manifest) {
	const declared = manifest?.dsh?.bundle?.patch;
	const list = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared : [];

	const out = [];
	for (const relative of list) {
		if (typeof relative !== 'string') continue;
		let target;
		try {
			target = safeJoin(root, relative);
		} catch {
			continue;
		}
		try {
			const text = await fsp.readFile(target, 'utf8');
			out.push(
				text.length > MAX_PATCH_CHARS
					? { file: relative, text: text.slice(0, MAX_PATCH_CHARS), truncated: true }
					: { file: relative, text },
			);
		} catch (error) {
			out.push({ file: relative, text: `(读取失败: ${String(error?.message ?? error)})` });
		}
	}
	return out;
}

// ───────────────── 审计：装之前先证明它不会把宿主搞挂 ─────────────────

/**
 * 从 patch 文本里收集全部 `id:`。
 *
 * 只做行级扫描，不引 YAML 解析器：这里要的是「这个包会占哪些 entry id」，
 * 而不是完整语义。漏判一个 id 的代价是漏一次撞车提醒，引一个依赖的代价是
 * 每次升级都要跟它对齐版本 —— 前者可接受，后者不可接受。
 *
 * 同时覆盖两种形状：顶层的 `- id: x`（配置覆盖）与 `- insert:` 下的 `- id: x`。
 *
 * @param {string} text
 * @returns {string[]}
 */
function collectIds(text) {
	const ids = [];
	for (const raw of String(text).split(/\r?\n/)) {
		const line = raw.replace(/\s+#.*$/, '');
		if (/^\s*#/.test(line) || line.trim() === '') continue;
		const match = /^\s*-\s+id:\s*(.+)$/.exec(line);
		if (!match) continue;
		const value = match[1].trim().replace(/^['"]|['"]$/g, '').split(/\s/)[0];
		if (value && !ids.includes(value)) ids.push(value);
	}
	return ids;
}

/**
 * 扫全部 profile：各自占用了哪些 entry id、装了哪些包。
 *
 * 撞车必须按「装到哪个 profile」判，而不是全局判 —— 同一个 id 在两个
 * profile 里各自存在是正常的（每个 profile 一份 cordis.patch.yml）。
 *
 * @param {string} home
 * @returns {Array<{profile: string, ids: string[], deps: Record<string, string>}>}
 */
function collectProfiles(home) {
	const root = path.join(home, 'profiles');
	const out = [];
	let entries;
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = path.join(root, entry.name);
		let ids = [];
		try {
			ids = collectIds(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'));
		} catch {
			// profile 没有 patch 层是正常状态（新 profile），不当失败
		}
		let deps = {};
		let bundles = [];
		try {
			const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
			deps = manifest?.dependencies ?? {};
			bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
		} catch {
			// 同上
		}
		out.push({ profile: entry.name, dir, ids, deps, bundles });
	}
	return out;
}

/**
 * 读宿主版本（`<$DSH_HOME>/dsh-runtimes/<runtime>/runtime.json` 的 `desktopVersion`）。
 *
 * 为什么不问 `dsh --version`：那要 shell 出去，而插件跑在 host 半、PATH 不可信
 * （Android 上尤其）。runtime.json 是宿主自己写的，读它没有歧义。
 *
 * @param {string} home
 * @returns {string | null}
 */
function readHostVersion(home) {
	try {
		const root = path.join(home, 'dsh-runtimes');
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			try {
				const data = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'runtime.json'), 'utf8'));
				if (typeof data?.desktopVersion === 'string' && data.desktopVersion.trim() !== '') return data.desktopVersion.trim();
			} catch {
				// 单个 runtime 坏掉不影响其它候选
			}
		}
	} catch {
		// 没有 dsh-runtimes（例如非桌面部署）
	}
	return null;
}

/** 本工具自身版本（读自己的 package.json）。暴露成 `toolVersion`，备忘与代码的漂移就不再靠人记。 */
let toolVersionCache = null;
function readToolVersion() {
	if (toolVersionCache !== null) return toolVersionCache;
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
		toolVersionCache = typeof manifest?.version === 'string' ? manifest.version : '';
	} catch {
		toolVersionCache = '';
	}
	return toolVersionCache;
}

/** @param {string} text @returns {{nums: number[], pre: string | null} | null} */
function parseVersion(text) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text).trim());
	if (!match) return null;
	return { nums: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
}

/** @param {{nums: number[], pre: string | null}} a @param {{nums: number[], pre: string | null}} b */
function compareVersions(a, b) {
	for (let index = 0; index < 3; index += 1) {
		if (a.nums[index] !== b.nums[index]) return a.nums[index] < b.nums[index] ? -1 : 1;
	}
	if (a.pre === b.pre) return 0;
	if (a.pre === null) return 1;
	if (b.pre === null) return -1;
	const left = a.pre.split('.');
	const right = b.pre.split('.');
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const l = left[index];
		const r = right[index];
		if (l === undefined) return -1;
		if (r === undefined) return 1;
		const lNum = /^\d+$/.test(l);
		const rNum = /^\d+$/.test(r);
		if (lNum && rNum) {
			const diff = Number(l) - Number(r);
			if (diff !== 0) return diff < 0 ? -1 : 1;
			continue;
		}
		if (lNum !== rNum) return lNum ? -1 : 1;
		if (l !== r) return l < r ? -1 : 1;
	}
	return 0;
}

/**
 * 判断版本是否满足 range。
 *
 * 只支持 DSH 插件里实际会出现的写法：`^` / `~` / `>=` / `>` / `<=` / `<` / 精确版
 * 本，逗号或空格分隔，`||` 分支。**解析不了就返回 `null`（无法判断）而不是 `false`**
 * —— 把「没看懂」当成「不满足」会拦掉好插件，方向错了。
 *
 * @param {string} range
 * @param {string} version
 * @returns {boolean | null}
 */
function satisfiesSimple(range, version) {
	const target = parseVersion(version);
	if (!target) return null;
	const branches = String(range).split('||').map((part) => part.trim()).filter(Boolean);
	if (branches.length === 0) return null;

	for (const branch of branches) {
		const tokens = branch.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
		const results = [];
		for (const token of tokens) {
			const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(token);
			if (!match) {
				results.push(null);
				continue;
			}
			const operator = match[1] ?? '=';
			const bound = parseVersion(match[2]);
			if (!bound) {
				results.push(null);
				continue;
			}
			const order = compareVersions(target, bound);
			switch (operator) {
				case '>=':
					results.push(order >= 0);
					break;
				case '>':
					results.push(order > 0);
					break;
				case '<=':
					results.push(order <= 0);
					break;
				case '<':
					results.push(order < 0);
					break;
				case '^':
					results.push(
						order >= 0 &&
							compareVersions(
								target,
								{ nums: bound.nums[0] === 0 ? [0, bound.nums[1] + 1, 0] : [bound.nums[0] + 1, 0, 0], pre: null },
							) < 0,
					);
					break;
				case '~':
					results.push(order >= 0 && compareVersions(target, { nums: [bound.nums[0], bound.nums[1] + 1, 0], pre: null }) < 0);
					break;
				default:
					results.push(order === 0);
			}
		}
		if (results.some((result) => result === null)) return null;
		if (results.every(Boolean)) return true;
	}
	return false;
}

/**
 * 从 package.json 里取入口文件（`main` 优先，其次 `exports["."]`）。
 * @param {any} manifest
 * @returns {string | null}
 */
function readPackageMain(manifest) {
	if (typeof manifest?.main === 'string' && manifest.main.trim() !== '') return manifest.main.trim();
	const exported = manifest?.exports?.['.'];
	if (typeof exported === 'string') return exported;
	if (exported && typeof exported === 'object' && typeof exported.default === 'string') return exported.default;
	return null;
}

/**
 * 入口文件里 `register(` 附近有没有 try/catch。
 *
 * 这是**启发式**，不是证明：只回三档，调用方只能把它当 warning 用。判据来自
 * 一条真实事故路径 —— 注册抛错 → entry failed → `dsh: startup failed` → 引擎退出。
 *
 * @param {string} entryFile
 * @returns {'guarded' | 'unguarded' | 'no-register'}
 */
function checkRegisterGuarded(entryFile) {
	let text;
	try {
		text = fs.readFileSync(entryFile, 'utf8');
	} catch {
		return 'no-register';
	}
	const index = text.indexOf('.register(');
	if (index < 0) return 'no-register';
	const window = text.slice(Math.max(0, index - 1500), index);
	return /try\s*\{/.test(window) ? 'guarded' : 'unguarded';
}

/**
 * 定位一次审计的对象：本地目录（fetch 产物 / 已装插件）优先，否则只拿 registry 上的 manifest。
 *
 * @param {string} home
 * @param {any} args
 * @returns {Promise<{dir: string | null, manifest: any, version: string | null, source: string} | {error: string}>}
 */
async function resolveAuditTarget(home, args) {
	const dirArg = typeof args?.dir === 'string' ? args.dir.trim() : '';
	if (dirArg !== '') {
		const dir = path.resolve(dirArg);
		try {
			const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf8'));
			return { dir, manifest, version: manifest?.version ?? null, source: 'dir' };
		} catch (error) {
			return { error: `${dir} 里读不到 package.json（${error?.code ?? error?.message ?? error}）` };
		}
	}

	const nameArg = typeof args?.name === 'string' ? args.name.trim() : '';
	if (nameArg === '') return { error: 'audit / dryrun 需要 dir（fetch 返回的本地目录）或 name（包名）' };

	const spec = parseSpec(nameArg);
	if (!PACKAGE_NAME.test(spec.name)) return { error: `不是合法的包名: ${spec.name}` };

	const hunted = findHunted(home, spec.name, spec.version);
	if (hunted !== null) {
		try {
			const manifest = JSON.parse(await fsp.readFile(path.join(hunted, 'package.json'), 'utf8'));
			return { dir: hunted, manifest, version: manifest?.version ?? spec.version ?? null, source: 'hunt' };
		} catch {
			// 落到 registry 分支
		}
	}

	const packument = await fetchPackument(spec.name);
	if (packument.ok === false) return { error: `拉取 ${spec.name} 的 manifest 失败: ${packument.error}` };
	const picked = pickVersion(packument.doc, spec.version);
	if ('error' in picked) return { error: picked.error };
	return { dir: null, manifest: picked.manifest, version: picked.version, source: 'registry' };
}

/**
 * 在 `plugin-hunt/` 里找某个包已解包的副本（有版本要求时优先精确匹配，否则取最新改动的）。
 *
 * @param {string} home
 * @param {string} pkgName
 * @param {string} [version]
 * @returns {string | null}
 */
function findHunted(home, pkgName, version) {
	const base = path.join(home, HUNT_DIR);
	const prefix = `${pkgName.replace(/[@/]/g, '-').replace(/^-/, '')}-`;
	let entries;
	try {
		entries = fs.readdirSync(base, { withFileTypes: true });
	} catch {
		return null;
	}
	const matches = entries.filter(
		(entry) => entry.isDirectory() && entry.name.startsWith(prefix) && /^\d/.test(entry.name.slice(prefix.length)),
	);
	if (matches.length === 0) return null;

	if (typeof version === 'string' && version !== '') {
		const exact = matches.find((entry) => entry.name === `${prefix}${version}`);
		if (exact) return path.join(base, exact.name);
	}

	let best = null;
	let bestTime = -1;
	for (const entry of matches) {
		const full = path.join(base, entry.name);
		try {
			const time = fs.statSync(full).mtimeMs;
			if (time > bestTime) {
				bestTime = time;
				best = full;
			}
		} catch {
			// 单个目录 stat 失败就跳过
		}
	}
	return best;
}

/**
 * `action: "installed"` —— 看这台机器上已经装了什么。
 *
 * 只读，不碰任何状态。两个用途：搜之前先看是不是已经有插件覆盖了这个需求（省掉
 * 一轮重复安装），以及装完确认依赖真的落进了 profile。
 *
 * ⚠️ 它**看不到正在运行的会话里有哪些工具** —— 工具装配发生在会话建立时。
 * "装完到底生效没"只能新开一个会话来验，这一点必须讲清楚，否则会误判成装失败。
 *
 * @param {string} home
 * @returns {Promise<any>}
 */
async function doInstalled(home) {
	const profiles = collectProfiles(home);
	const rows = profiles.map((profile) => {
		const packages = Object.entries(profile.deps).map(([name, spec]) => {
			const target = specTargetPath(spec);
			return {
				name,
				spec,
				installed: fs.existsSync(path.join(profile.dir, 'node_modules', name, 'package.json')),
				inBundles: profile.bundles.includes(name),
				specTargetMissing: target !== null && !fs.existsSync(target),
			};
		});
		return {
			profile: profile.profile,
			patchEntryIds: profile.ids,
			bundles: profile.bundles,
			packages,
		};
	});

	return {
		ok: true,
		home,
		huntDir: path.join(home, HUNT_DIR),
		hostVersion: readHostVersion(home),
		profiles: rows,
		nextStep:
			'判断某个需求是否已被覆盖时看 packages[].name 与 inBundles；确认一次安装是否落地，看 dependencies 里有这个包、node_modules 里 installed=true、inBundles=true；specTargetMissing=true 说明 file:/link: 目标已丢失（重装或改依赖）。⚠️ bundle 安装的 entry 来自包自己的 dsh.bundle.patch，不会出现在 patchEntryIds 里——patchEntryIds 只反映用户 patch 层。装完工具是否真生效，直接看当前会话的工具列表（本机实测会热加载）；没出现再新开一个会话。',
	};
}


// ─────────────────── 能力备忘（v3：availability / candidates / profile） ───────────────────

/** 备忘文件名：$DSH_HOME/market-memo.json。 */
const MEMO_FILE_NAME = 'market-memo.json';

/** 单条 key 上限（字符）。 */
const MEMO_KEY_MAX = 120;

/** 条目上限：只保留最近 N 条。 */
const MEMO_ENTRY_MAX = 200;

/** 旧 schema（v2）的 verdict 白名单 —— 只用于把老条目映射成 availability。 */
const MEMO_VERDICTS = new Set(['installed', 'covered', 'none']);

/** availability 前缀：installed:<pkg> / builtin:<cap> / none（本机无能力）。 */
const MEMO_AVAIL_PREFIXES = new Set(['installed', 'builtin', 'none', '']);

/** confidence 取值。 */
const MEMO_CONFIDENCE = new Set(['confirmed', 'provisional', 'conflict']);

/** none 结论的复审期（天）：市场在变，负结论会烂在库里。 */
const MEMO_NONE_REVIEW_DAYS = 30;

/** 软删除保留期（天）：forget 先打标，超期才被 prune 物理清除。 */
const MEMO_RETIRE_GRACE_DAYS = 7;

/** 单条 evidence 上限。 */
const MEMO_EVIDENCE_MAX = 5;

/** 单条 candidates 上限、字段长度上限、profile 键上限。 */
const MEMO_CANDIDATES_MAX = 30;
const MEMO_CANDIDATE_FIELD_MAX = 200;
const MEMO_PROFILE_MAX = 24;

/**
 * key 归一：小写、空白折叠、去尾部标点。避免"空格差一个就变两条"。
 */
function normalizeMemoKey(raw) {
	return raw.toLowerCase().replace(/\s+/g, ' ').replace(/[。，,.\s]+$/u, '').trim().slice(0, MEMO_KEY_MAX);
}

/**
 * 解析 file: / link: spec 的目标路径（Windows 盘符 / POSIX 绝对路径）。
 * 版本号、registry 语义的 spec 没有本地目标，返回 null。
 */
function specTargetPath(spec) {
	if (typeof spec !== 'string') return null;
	const lower = spec.toLowerCase();
	if (!lower.startsWith('file:') && !lower.startsWith('link:')) return null;
	const raw = spec.slice(spec.indexOf(':') + 1).trim();
	if (raw === '') return null;
	const slashed = raw.replace(/\\/g, '/');
	if (/^[a-zA-Z]:\//.test(slashed) || slashed.startsWith('/')) return slashed;
	return null;
}

/** 把 v2 的 verdict/plugin 映射成 v3 的 availability。 */
function verdictToAvailability(verdict, plugin) {
	if (verdict === 'installed') return plugin ? 'installed:' + plugin : 'installed';
	if (verdict === 'covered') return 'builtin';
	if (verdict === 'none') return 'none';
	return '';
}

/** 归一 availability：前缀必须在白名单，否则回落空串。 */
function normalizeAvailability(raw) {
	if (typeof raw !== 'string') return '';
	const s = raw.trim();
	if (s === '') return '';
	const i = s.indexOf(':');
	const prefix = i === -1 ? s : s.slice(0, i);
	if (!MEMO_AVAIL_PREFIXES.has(prefix) || prefix === '') return '';
	return s.slice(0, 120);
}

function availabilityPrefix(avail) {
	const s = avail ?? '';
	const i = s.indexOf(':');
	return i === -1 ? s : s.slice(0, i);
}

function normalizeCandidates(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const c of raw) {
		if (c === null || typeof c !== 'object') continue;
		const pkg = typeof c?.pkg === 'string' ? c.pkg.slice(0, MEMO_CANDIDATE_FIELD_MAX) : (typeof c?.name === 'string' ? c.name.slice(0, MEMO_CANDIDATE_FIELD_MAX) : '');
		if (pkg === '') continue;
		out.push({
			pkg,
			version: typeof c?.version === 'string' ? c.version.slice(0, 40) : '',
			fit: typeof c?.fit === 'string' ? c.fit.slice(0, MEMO_CANDIDATE_FIELD_MAX) : '',
			fitFor: Array.isArray(c?.fitFor) ? c.fitFor.map((s) => String(s).slice(0, 120)).slice(0, 12) : [],
			checkedAt: typeof c?.checkedAt === 'number' ? c.checkedAt : 0,
		});
		if (out.length >= MEMO_CANDIDATES_MAX) break;
	}
	return out;
}

function normalizeProfile(raw) {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out = {};
	let n = 0;
	for (const [k, v] of Object.entries(raw)) {
		if (n >= MEMO_PROFILE_MAX) break;
		const key = String(k).slice(0, 60);
		out[key] = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : (JSON.stringify(v) ?? '').slice(0, 300);
		n += 1;
	}
	return out;
}

function normalizeLastUsed(raw) {
	if (raw === null || typeof raw !== 'object') return null;
	return {
		pkg: typeof raw?.pkg === 'string' ? raw.pkg.slice(0, 120) : '',
		role: typeof raw?.role === 'string' ? raw.role.slice(0, 120) : '',
		at: typeof raw?.at === 'number' ? raw.at : 0,
	};
}

/** aliases 上限与单条长度。 */
const MEMO_ALIASES_MAX = 12;
const MEMO_ALIAS_FIELD_MAX = 60;

/** 归一 aliases：去重、去空、限长。写得越口语越好检索。 */
function normalizeAliases(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const a of raw) {
		const s = typeof a === 'string' ? a.trim().slice(0, MEMO_ALIAS_FIELD_MAX) : '';
		if (s === '' || out.includes(s)) continue;
		out.push(s);
		if (out.length >= MEMO_ALIASES_MAX) break;
	}
	return out;
}

/** 单条 entry 的宽容归一（坏字段回落到安全默认，绝不抛）。兼容 v2 verdict 形状。 */
function normalizeMemoEntry(entry) {
	const legacyVerdict = typeof entry?.verdict === 'string' && MEMO_VERDICTS.has(entry.verdict) ? entry.verdict : '';
	const availability =
		typeof entry?.availability === 'string' && entry.availability !== ''
			? normalizeAvailability(entry.availability)
			: verdictToAvailability(legacyVerdict, entry?.plugin);
	return {
		availability,
		candidates: normalizeCandidates(entry?.candidates),
		aliases: normalizeAliases(entry?.aliases),
		profile: normalizeProfile(entry?.profile),
		lastUsed: normalizeLastUsed(entry?.lastUsed),
		plugin: typeof entry?.plugin === 'string' ? entry.plugin.slice(0, 200) : '',
		installedVersion: typeof entry?.installedVersion === 'string' ? entry.installedVersion.slice(0, 80) : '',
		note: typeof entry?.note === 'string' ? entry.note.slice(0, 500) : '',
		at: typeof entry?.at === 'number' ? entry.at : 0,
		checkedAt: typeof entry?.checkedAt === 'number' ? entry.checkedAt : (typeof entry?.at === 'number' ? entry.at : 0),
		host: typeof entry?.host === 'string' ? entry.host.slice(0, 80) : '',
		reviewAt: typeof entry?.reviewAt === 'number' ? entry.reviewAt : 0,
		hits: typeof entry?.hits === 'number' ? entry.hits : 0,
		confidence: typeof entry?.confidence === 'string' && MEMO_CONFIDENCE.has(entry.confidence) ? entry.confidence : 'confirmed',
		evidence: Array.isArray(entry?.evidence) ? entry.evidence.slice(0, MEMO_EVIDENCE_MAX).map((e) => ({
			kind: typeof e?.kind === 'string' ? e.kind.slice(0, 40) : '',
			ref: typeof e?.ref === 'string' ? e.ref.slice(0, 300) : '',
			at: typeof e?.at === 'number' ? e.at : 0,
		})) : [],
		retiredAt: typeof entry?.retiredAt === 'number' ? entry.retiredAt : 0,
	};
}

/**
 * 读备忘。v2 / v3 都读（v2 的 verdict 形状在 normalize 时映射）；v1 平铺格式读时兼容。
 * 文件不存在或损坏都返回空 —— 备忘只是省一次搜索的优化，不值得为它把任务搞挂。
 */
async function readMemo(home) {
	const file = path.join(home, MEMO_FILE_NAME);
	try {
		const raw = await fsp.readFile(file, 'utf8');
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { entries: {}, legacy: false, stats: emptyMemoStats() };
		const version = Number(parsed?.version);
		const source = version >= 2 && parsed.entries !== null && typeof parsed.entries === 'object' ? parsed.entries : parsed;
		const entries = {};
		for (const [key, entry] of Object.entries(source)) {
			if (entry === null || typeof entry !== 'object') continue;
			entries[key] = normalizeMemoEntry(entry);
		}
		return { entries, legacy: source === parsed, stats: normalizeMemoStats(parsed?.stats) };
	} catch {
		return { entries: {}, legacy: false, stats: emptyMemoStats() };
	}
}

/** 价值计量的初值：让"没发生的事"可见（省了几次搜索、拦了几次风险）。 */
function emptyMemoStats() {
	return { coverageCalls: 0, searchesAvoided: 0, risksCaught: 0 };
}

/** 宽容归一已存统计。 */
function normalizeMemoStats(raw) {
	const stats = emptyMemoStats();
	stats.toolVersion = '';
	if (raw === null || typeof raw !== 'object') return stats;
	stats.coverageCalls = Number(raw.coverageCalls) || 0;
	stats.searchesAvoided = Number(raw.searchesAvoided) || 0;
	stats.risksCaught = Number(raw.risksCaught) || 0;
	stats.toolVersion = typeof raw.toolVersion === 'string' ? raw.toolVersion.slice(0, 40) : '';
	return stats;
}

/** 落盘：v3 包装、按 at 倒序、裁到上限，临时文件 + rename 原子写。stats 未传时保留原值。 */
async function persistMemo(home, entries, stats) {
	const file = path.join(home, MEMO_FILE_NAME);
	const finalStats = stats === undefined ? (await readMemo(home)).stats : normalizeMemoStats(stats);
	finalStats.toolVersion = readToolVersion();
	const sorted = Object.entries(entries).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, MEMO_ENTRY_MAX);
	// 写前留一份上一版快照：rollback what:"memo" 靠它恢复（只留一层，够用）
	try {
		if (fs.existsSync(file)) {
			const previous = await fsp.readFile(file, 'utf8');
			JSON.parse(previous); // 坏文件不覆盖快照
			await fsp.writeFile(file + '.bak', previous, 'utf8');
		}
	} catch {
		// 快照失败不影响主写入
	}
	const tmp = file + '.tmp';
	await fsp.writeFile(tmp, JSON.stringify({ version: 3, stats: finalStats, entries: Object.fromEntries(sorted) }, null, 1), 'utf8');
	await fsp.rename(tmp, file);
}

/** aliases 合并：并集去重，新的追加，超上限截断。 */
function mergeAliases(oldList, newList) {
	const out = [...(oldList ?? [])];
	for (const a of newList ?? []) if (!out.includes(a)) out.push(a);
	return out.slice(0, MEMO_ALIASES_MAX);
}

/** candidates 按 pkg 名合并去重：同 pkg 取较新 checkedAt，不触发 conflict。 */
function mergeCandidates(oldList, newList) {
	const map = new Map();
	for (const c of [...oldList, ...newList]) {
		const prev = map.get(c.pkg);
		if (!prev || (c.checkedAt ?? 0) >= (prev.checkedAt ?? 0)) map.set(c.pkg, c);
	}
	return [...map.values()].sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0)).slice(0, MEMO_CANDIDATES_MAX);
}

/**
 * 合并写入（v3）：
 *  - 新字段 availability（老写法 verdict 也接受）；candidates / profile / note 只合并，不冲突。
 *  - conflict 只按 availability 前缀：前缀变（installed↔builtin↔none）且未带 force → 拒写并回报；
 *    前缀不变只换来源（如 installed:A→installed:B）视为更新。
 */
async function writeMemo(home, records, opts = {}) {
	const { entries } = await readMemo(home);
	const host = readHostVersion(home) ?? '';
	const conflicts = [];
	const before = new Set(Object.keys(entries));
	for (const record of records) {
		const key = normalizeMemoKey(typeof record?.key === 'string' ? record.key : '');
		if (key === '') continue;
		const existing = entries[key];

		let incomingAvail;
		if (typeof record?.availability === 'string' && record.availability.trim() !== '') {
			incomingAvail = normalizeAvailability(record.availability);
		} else if (typeof record?.verdict === 'string' && MEMO_VERDICTS.has(record.verdict)) {
			incomingAvail = verdictToAvailability(record.verdict, record?.plugin);
		} else {
			incomingAvail = '';
		}
		if (incomingAvail === '') continue;

		const prevPrefix = availabilityPrefix(existing?.availability);
		const inPrefix = availabilityPrefix(incomingAvail);
		if (existing && existing.availability !== '' && prevPrefix !== inPrefix && opts.force !== true) {
			existing.confidence = 'conflict';
			conflicts.push({ key, existing: existing.availability, incoming: incomingAvail });
			continue;
		}

		const at = Date.now();
		entries[key] = {
			...normalizeMemoEntry(existing ?? {}),
			availability: incomingAvail,
			candidates: mergeCandidates(existing?.candidates ?? [], normalizeCandidates(record?.candidates)),
			profile: { ...(existing?.profile ?? {}), ...normalizeProfile(record?.profile) },
			aliases: mergeAliases(existing?.aliases ?? [], normalizeAliases(record?.aliases)),
			lastUsed: normalizeLastUsed(record?.lastUsed) ?? existing?.lastUsed ?? null,
			plugin: typeof record?.plugin === 'string' ? record.plugin.slice(0, 200) : (existing?.plugin ?? ''),
			note: typeof record?.note === 'string' ? record.note.slice(0, 500) : (existing?.note ?? ''),
			at,
			checkedAt: at,
			host,
			reviewAt: availabilityPrefix(incomingAvail) === 'none' ? at + MEMO_NONE_REVIEW_DAYS * 86400000 : 0,
			confidence: 'confirmed',
			evidence: [
				...(existing?.evidence ?? []),
				{ kind: typeof record?.evidence === 'string' ? record.evidence.slice(0, 40) : 'write', ref: typeof record?.ref === 'string' ? record.ref.slice(0, 300) : '', at },
			].slice(-MEMO_EVIDENCE_MAX),
			retiredAt: 0,
		};
		// 版本自检：记下写入时已装插件的版本，升级后 coverage 能报 drift
		entries[key].installedVersion = availabilityPrefix(incomingAvail) === 'installed'
			? (installedVersionOf(home, entries[key].plugin || incomingAvail.slice('installed:'.length)) || existing?.installedVersion || '')
			: '';
	}
	// 新 key 与已有条目高度相似 → 提示可能重复（不阻断，防止 memo 碎成一堆近义 key）
	const nearDuplicates = [];
	const fresh = Object.keys(entries).filter((k) => !before.has(k));
	if (fresh.length > 0 && Object.keys(entries).length <= 60) {
		for (const k of fresh) {
			const q = memoTokens(k + ' ' + (entries[k].note ?? '') + ' ' + (entries[k].aliases ?? []).join(' '));
			for (const [otherKey, other] of Object.entries(entries)) {
				if (otherKey === k) continue;
				const s = scoreMemoEntry(q, memoEntryTokens(other, otherKey));
				if (s >= MEMO_MATCH_AUTO) nearDuplicates.push({ key: k, nearest: otherKey, score: Number(s.toFixed(3)) });
			}
		}
	}
	await persistMemo(home, entries);
	return { entries, conflicts, nearDuplicates };
}

/** 读侧投影：过滤 retired、标注 staleHost（宿主版本变了）与 dueReview（none 到期）。读保持纯净。 */
function projectMemo({ entries }, host) {
	const out = {};
	let stale = 0;
	let due = 0;
	const now = Date.now();
	for (const [key, entry] of Object.entries(entries)) {
		if (entry.retiredAt > 0) continue;
		const staleHost = entry.host !== '' && host !== '' && entry.host !== host;
		const dueReview = entry.reviewAt > 0 && entry.reviewAt < now;
		if (staleHost) stale += 1;
		if (dueReview) due += 1;
		out[key] = { ...entry, staleHost, dueReview };
	}
	return { entries: out, stale, due };
}

/**
 * action: "memo" —— 能力备忘读写。
 *  - 读：默认索引视图（availability + 候选包名清单，evidence 省略）；query 按匹配排序；
 *    full: true 附 candidates 全文、profile、evidence。
 *  - 写：record 合并写入（availability 前缀变需 force）；forget 软删除；prune 物理清。
 */
async function doMemo(home, args) {
	const { entries, stats } = await readMemo(home);
	const records = Array.isArray(args?.record) ? args.record : [];
	const forgetKeys = Array.isArray(args?.forget) ? args.forget : [];
	const force = args?.force === true;
	const full = args?.full === true;
	const query = typeof args?.query === 'string' && args.query.trim() !== '' ? args.query.trim().toLowerCase() : null;
	const host = readHostVersion(home) ?? '';

	let conflicts = [];
	let nearDuplicates = [];
	if (records.length > 0) {
		const written = await writeMemo(home, records, { force });
		conflicts = written.conflicts;
		nearDuplicates = written.nearDuplicates ?? [];
		Object.assign(entries, written.entries);
	}
	if (forgetKeys.length > 0) {
		const now = Date.now();
		for (const rawKey of forgetKeys) {
			const key = normalizeMemoKey(String(rawKey));
			if (entries[key]) entries[key].retiredAt = now;
		}
		await persistMemo(home, entries, stats);
	}
	let pruned = 0;
	if (args?.prune === true) {
		const cutoff = Date.now() - MEMO_RETIRE_GRACE_DAYS * 86400000;
		for (const [key, entry] of Object.entries(entries)) {
			if (entry.retiredAt > 0 && entry.retiredAt < cutoff) { delete entries[key]; pruned += 1; }
		}
		if (pruned > 0) await persistMemo(home, entries, stats);
	}

	const { entries: visible, stale, due } = projectMemo({ entries }, host);
	let listed = Object.entries(visible).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0));
	if (query !== null) {
		listed = listed.map(([key, entry]) => {
			const candHay = entry.candidates.map((c) => c.pkg + ' ' + c.fit).join(' ').toLowerCase();
			const hay = (key + ' ' + entry.plugin + ' ' + entry.note + ' ' + candHay).toLowerCase();
			const rank = key === query ? 0 : hay.startsWith(query) ? 1 : hay.includes(query) ? 2 : 3;
			return [key, entry, rank];
		}).sort((a, b) => a[2] - b[2] || (b[1].at ?? 0) - (a[1].at ?? 0));
	}
	const view = Object.fromEntries(listed.map(([key, entry]) => {
		const projected = {
			availability: entry.availability,
			plugin: entry.plugin,
			note: entry.note.slice(0, 80),
			candidates: entry.candidates.map((c) => c.pkg),
			candidateCount: entry.candidates.length,
			aliases: (entry.aliases ?? []).slice(0, 6),
			at: entry.at,
			host: entry.host,
			reviewAt: entry.reviewAt,
			hits: entry.hits,
			lastUsedAt: entry.lastUsed?.at ?? 0,
			confidence: entry.confidence,
			staleHost: entry.staleHost,
			dueReview: entry.dueReview,
		};
		if (full) {
			projected.note = entry.note;
			projected.candidates = entry.candidates;
			projected.aliases = entry.aliases ?? [];
			projected.profile = entry.profile;
			projected.lastUsed = entry.lastUsed;
			projected.evidence = entry.evidence;
			projected.checkedAt = entry.checkedAt;
			projected.retiredAt = entry.retiredAt;
		}
		return [key, projected];
	}));
	const covered = listed.filter(([, entry]) => !entry.staleHost && !entry.dueReview).length;

	return {
		ok: true,
		file: path.join(home, MEMO_FILE_NAME),
		version: 3,
		host,
		entries: Object.keys(view).length,
		total: Object.keys(entries).length,
		stale,
		due,
		covered,
		pruned,
		conflicts,
		nearDuplicates,
		stats,
		memo: view,
	};
}

/**
 * action: "coverage" —— 一步覆盖检查：把 installed + memo 合成一次调用，
 * 返回该任务的 availability、缓存候选、是否还要搜市场。
 *
 * 语义（v3 的关键修复）：
 *  - candidates 是正向知识，永不过期；只有 availability（本机能力）会抑制后续判断。
 *  - "这次不装"只影响这一次 —— 候选清单落进 candidates，下次同类任务直接读清单，不必重搜。
 *  - 任务画像 profile 不匹配 → 模型应重新评估 fit，而不是盲目复用旧结论。
 */
/** 打分阈值：>= AUTO 视为命中；>= SUGGEST 只作为建议返回；**宁可多搜一次，不可选错**。 */
const MEMO_MATCH_AUTO = 0.55;
const MEMO_MATCH_SUGGEST = 0.18;

/** 检索停用词：中英混合的高频虚词，命中它们只会让分数虚高。 */
const MEMO_STOP_TOKENS = new Set(['的', '了', '和', '与', '在', '是', '把', '用', '我', '你', '它', '这', '那', '个', '份', '做', '请', '帮', '要', '一个', '一份', '怎么', '什么', '哪些', '帮我', 'the', 'and', 'for', 'with', 'a', 'an', 'to']);

/** 字段权重：key 最硬，别名次之，包名再次；正文只作弱证据。 */
const MEMO_FIELD_WEIGHTS = [['key', 3.0], ['aliases', 2.5], ['pkg', 2.0], ['note', 1.5], ['profile', 1.5], ['fit', 0.8]];

/**
 * 切检索 token：
 *  - 拉丁/数字按非字母数字切词（dsh-ppt-master → dsh / ppt / master）；
 *  - 中文没有空格，按二元字组切（教学汇报 → 教学 / 学汇 / 汇报）。
 * 单字中文、单字母 token 一律丢弃（噪声太大）。前/后缀匹配在打分时补（ppt ↔ pptx）。
 */
function memoTokens(text) {
	const s = String(text ?? '').toLowerCase();
	const out = new Set();
	for (const m of s.match(/[a-z0-9]+/g) ?? []) {
		if (m.length >= 2 && !MEMO_STOP_TOKENS.has(m)) out.add(m);
	}
	for (const run of s.match(/[\u4e00-\u9fff]+/gu) ?? []) {
		if (run.length === 1) continue;
		for (let i = 0; i + 1 < run.length; i += 1) {
			const bg = run.slice(i, i + 2);
			if (!MEMO_STOP_TOKENS.has(bg)) out.add(bg);
		}
		// 单字也收：中文同义词（删掉 / 删除 / 清理）只有单字能接上，打分时降权
		for (const ch of run) {
			if (!MEMO_STOP_TOKENS.has(ch)) out.add(ch);
		}
	}
	return out;
}

/** 一条 entry 的各字段 token 集合（分字段算，避免长文本把短字段的命中稀释掉）。 */
function memoEntryTokens(entry, key) {
	return {
		key: memoTokens(key),
		aliases: memoTokens((entry.aliases ?? []).join(' ')),
		pkg: memoTokens((entry.candidates ?? []).map((c) => c.pkg).join(' ')),
		note: memoTokens(entry.note ?? ''),
		profile: memoTokens(Object.values(entry.profile ?? {}).map((v) => String(v)).join(' ')),
		fit: memoTokens((entry.candidates ?? []).map((c) => c.fit + ' ' + (c.fitFor ?? []).join(' ')).join(' ')),
	};
}

/** token 相等，或长度 >= 3 时互为前缀（ppt ↔ pptx）；单字只做精确相等。 */
function memoTokenMatch(a, b) {
	if (a === b) return true;
	if (a.length === 1 || b.length === 1) return false;
	if (a.length >= 3 && b.length >= 3) return a.startsWith(b) || b.startsWith(a);
	return false;
}

/** 单字命中只记部分信用：接得住同义词，但不足以单独触发自动命中。 */
function memoTokenCredit(a, b) {
	return (a.length === 1 || b.length === 1) ? 0.4 : 1;
}

/**
 * 加权打分：每字段命中率 × 权重，再归一。
 * 命中 4 个以上查询词即视为该字段"满匹配"——否则 12 个词的中文长句永远拿不到高分。
 */
function scoreMemoEntry(q, fields) {
	if (q.size === 0) return 0;
	// 固定分母：累积 3 个"整份"信用即视为该字段满匹配。固定值比 min(q.size,4) 稳——
	// 中文句子长度差异大，跟着句子长度缩放会让长句永远低分、短句永远高分。
	const denom = 3;
	let sum = 0;
	for (const [name, w] of MEMO_FIELD_WEIGHTS) {
		const t = fields[name];
		if (t === undefined || t.size === 0) continue;
		let credit = 0;
		for (const tok of q) {
			let best = 0;
			for (const ft of t) {
				if (!memoTokenMatch(tok, ft)) continue;
				best = Math.max(best, memoTokenCredit(tok, ft));
			}
			credit += best;
		}
		if (credit > 0) sum += w * Math.min(1, credit / denom);
	}
	return Math.min(1, sum / 3.0);
}

/**
 * 身份字段打分：只用 key / aliases / pkg 三个"标识位"。
 * 自动命中必须以它为准——note/profile 里的泛词（"生成"、讲稿、12-page）可以把任意任务
 * 抬到高分，实测出现过"从 B 站视频生成文字总结"被 `pptx:generate` 以 0.947 自动命中的误判。
 * note/profile 仍参与全量打分，但只用于**建议**，不足以抑制搜索。
 */
function scoreMemoEntryIdentity(q, fields) {
	if (q.size === 0) return 0;
	const weights = [['key', 3.0], ['aliases', 2.5], ['pkg', 2.0]];
	const denom = 3;
	let sum = 0;
	for (const [name, w] of weights) {
		const t = fields[name];
		if (t === undefined || t.size === 0) continue;
		let credit = 0;
		for (const tok of q) {
			// 单字太弱：不足以证明"这是同一个能力"，只让它进 suggestions（全量打分里仍算 0.4 信用）
			if (tok.length === 1) continue;
			let best = 0;
			for (const ft of t) {
				if (!memoTokenMatch(tok, ft)) continue;
				best = Math.max(best, memoTokenCredit(tok, ft));
			}
			credit += best;
		}
		if (credit > 0) sum += w * Math.min(1, credit / denom);
	}
	return Math.min(1, sum / 3.0);
}

/**
 * 「没找到」的固定话术。
 *
 * 这句是给模型**原样转述**的：搜不到时它必须说「未找到可用插件，接下来要 …」，
 * 省略号里填它自己的具体工作，而不是把"要不要我再搜搜"推回给用户。
 *
 * @param {string} [detail] 括注：搜了哪些源、为什么判定没找到
 * @returns {string}
 */
function notFoundNotice(detail) {
	return '未找到可用插件，接下来要 <写你具体要做什么：做什么、怎么做、大概多久、要不要用户确认>。'
		+ (detail ? `（${detail}）` : '');
}

/**
 * 自指任务守卫：这句话是在「操作本插件自己」吗？
 *
 * 实测翻过一次车：任务写「把 linc-dsh-market-scout 上传到 GitHub」，memo 里的
 * `market-scout` 条目按子串命中了**它自己**，coverage 回「已覆盖，直接用」，
 * 于是整个市场搜索被短路。问的是"怎么发这个插件"，答的是"你有这个插件"。
 *
 * 判据：文本点了本插件的名（或"这个插件/本插件"）**且**带操作动词。
 * 命中时不做备忘匹配、不给"已覆盖"结论，直接把"该搜就搜"抛回给调用方。
 *
 * @param {string} text 原始任务文本
 * @returns {boolean}
 */
const SELF_NAMES = ['linc-dsh-market-scout', 'plugin_market_scout', 'linc-dsh-market', 'market-scout'];
const SELF_VERBS = /发布|上传|推到|推上|传到|卸载|删掉|删除|升级|更新|重装|安装|打包|改成|修改|维护|开源|github|仓库/iu;

function isSelfReferentialTask(text) {
	const t = String(text ?? '').toLowerCase();
	if (t === '') return false;
	const named = SELF_NAMES.some((n) => t.includes(n)) || t.includes('这个插件') || t.includes('本插件');
	return named && SELF_VERBS.test(t);
}

async function doCoverage(home, args) {
	const host = readHostVersion(home) ?? '';
	const intentRaw = typeof args?.intent === 'string' ? args.intent.trim() : '';
	const taskText = typeof args?.task === 'string' ? args.task.trim() : '';
	const query = normalizeMemoKey(intentRaw !== '' ? intentRaw : taskText);
	if (query === '') {
		return { ok: false, message: 'coverage 需要 task（或 intent）：一句话需求，例如 task:"删掉一个旧会话"' };
	}

	const { entries, stats } = await readMemo(home);
	const { entries: visible } = projectMemo({ entries }, host);

	// 自指守卫先于一切匹配：任务在操作本插件自己时，包名不是"要用的能力"
	const selfReferential = isSelfReferentialTask(taskText !== '' ? taskText : intentRaw);

	let entry = null;
	let key = query;
	let matchedBy = 'none';
	let matchScore = 0;

	// 第 1 层：精确 key
	if (!selfReferential && query !== '' && visible[query]) {
		entry = visible[query];
		matchedBy = 'exact';
		matchScore = 1;
	} else if (!selfReferential && query !== '') {
		// 第 2 层：子串。只允许「key 被任务包含」这一个方向——
		// 反向的 `query.includes(k)` 和 note 全文的 `hay.includes(query)` 都太松：
		// 任务里一出现包名/说明词就命中，等于拿"提到过"当"需要"。
		let best = null;
		for (const [k, e] of Object.entries(visible)) {
			if (k.length < 3) continue;
			if (k.includes(query)) {
				if (!best || (e.at ?? 0) > (best.e?.at ?? 0)) best = { k, e };
			}
		}
		if (best) { key = best.k; entry = best.e; matchedBy = 'substring'; matchScore = 1; }
	}

	// 第 3 层：加权打分（永远算 —— 既用于兜底命中，也用于给建议）
	const rawQ = memoTokens(intentRaw !== '' || taskText !== '' ? intentRaw + ' ' + taskText : query);
	const entryTok = new Map();
	const df = new Map();
	for (const [k, e] of Object.entries(visible)) {
		const toks = memoEntryTokens(e, k);
		entryTok.set(k, toks);
		const uniq = new Set();
		for (const t of Object.values(toks)) for (const x of t) uniq.add(x);
		for (const x of uniq) df.set(x, (df.get(x) ?? 0) + 1);
	}
	const totalEntries = Object.keys(visible).length;
	// 区分度过滤：出现在 >60% 条目里的 token（如 dsh / ppt）命中它没有信息量，剔除
	const q = new Set([...rawQ].filter((t) => totalEntries < 3 || (df.get(t) ?? 0) / totalEntries <= 0.6));
	const ranked = Object.entries(visible)
		.map(([k, e]) => ({ key: k, entry: e, score: Number(scoreMemoEntry(q, entryTok.get(k)).toFixed(3)) }))
		.filter((r) => r.score >= MEMO_MATCH_SUGGEST)
		.sort((a, b) => b.score - a.score)
		.slice(0, 3);

	// 自动命中只看身份字段（key/aliases/pkg）；note/profile 的弱命中只进 suggestions
	const identityRanked = Object.entries(visible)
		.map(([k, e]) => ({ key: k, entry: e, score: Number(scoreMemoEntryIdentity(q, entryTok.get(k)).toFixed(3)) }))
		.sort((a, b) => b.score - a.score);

	if (!selfReferential && !entry && identityRanked.length > 0 && identityRanked[0].score >= MEMO_MATCH_AUTO) {
		key = identityRanked[0].key;
		entry = identityRanked[0].entry;
		matchedBy = 'score';
		matchScore = identityRanked[0].score;
	}

	const suggestions = ranked.map((r) => ({
		key: r.key,
		score: r.score,
		availability: r.entry.availability,
		candidates: r.entry.candidates.map((c) => c.pkg),
		note: r.entry.note.slice(0, 80),
		alreadyMatched: entry !== null && r.key === key,
	}));

	// 并列命中：前两名（身份分）都在阈值以上且分差极小 → 报告歧义（"做PPT" 同时像"改已有稿"和"从零生成"）
	const ambiguousWith = entry !== null && identityRanked.length > 1
		? identityRanked
				.filter((r) => r.key !== key && r.score >= MEMO_MATCH_AUTO && Math.abs(r.score - (identityRanked.find((x) => x.key === key)?.score ?? 0)) < 0.05)
				.map((r) => ({ key: r.key, score: r.score, availability: r.entry.availability }))
		: [];

	const memoIndex = Object.entries(visible).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).map(([k, e]) => ({
		key: k,
		availability: e.availability,
		candidates: e.candidates.map((c) => c.pkg),
		aliases: e.aliases ?? [],
		note: e.note.slice(0, 80),
		staleHost: e.staleHost,
		dueReview: e.dueReview,
	}));
	const profiles = collectProfiles(home);
	const installedNames = [...new Set(profiles.flatMap((p) => p.bundles.concat(Object.keys(p.deps))))].sort();

	let needsSearch = true;
	let recommendation = '';
	let reason = '';
	if (selfReferential) {
		// 自指任务永远不判"已覆盖"：它要的是操作手法（git/发布/卸载），不是某项能力
		needsSearch = true;
		recommendation =
			'自指任务：这次是在操作「本插件自己」（发布 / 上传 / 卸载 / 升级 / 打包），不是本机缺某个能力。' +
			'不查备忘也不判覆盖——按任务本身做；缺 git / 发布通道就直说缺什么，别拿"已装"当答案。';
		reason = '任务文本命中本插件名 + 操作动词，跳过 memo 匹配';
	} else if (entry && !entry.staleHost && !entry.dueReview) {
		const prefix = availabilityPrefix(entry.availability);
		const hasCandidates = entry.candidates.length > 0;
		if (prefix === 'installed' || prefix === 'builtin') {
			needsSearch = false;
			const better = entry.candidates.slice(0, 3);
			recommendation =
				(prefix === 'installed' ? '已装 ' + (entry.plugin || entry.availability) + '，直接用' : '内置能力已覆盖，直接干正事') +
				(better.length > 0
					? '；想要更强的可选：' + better.map((c) => `${c.pkg}${c.version ? '@' + c.version : ''}（${c.fit || '候选'}）`).join('、')
					: '');
			reason = 'memo 命中 ' + key + '（' + matchedBy + '），availability=' + entry.availability;
		} else if (prefix === 'none') {
			if (hasCandidates) {
				needsSearch = false;
				recommendation = '本机无能力，但已缓存 ' + entry.candidates.length + ' 个候选：按 fit 挑一个，无需重搜';
				reason = 'memo 命中 ' + key + '（' + matchedBy + '），availability=none 但带候选清单';
			} else {
				needsSearch = true;
				recommendation = '本机无能力且无缓存候选，重新搜市场';
				reason = 'memo 命中 ' + key + '，availability=none 且无候选，需复查';
			}
		}
	} else if (entry) {
		needsSearch = true;
		recommendation = '缓存结论过期（宿主升级或复审到期），重新搜';
		reason = 'memo 命中 ' + key + ' 但 ' + (entry.staleHost ? 'staleHost' : 'dueReview') + '，需重搜';
	} else if (suggestions.length > 0) {
		needsSearch = true;
		recommendation = '没有高置信命中，但最接近的是「' + suggestions[0].key + '」（' + suggestions[0].score + '）。先看它对不对，不对再搜市场';
		reason = '打分未过自动命中阈值 ' + MEMO_MATCH_AUTO + '；见 suggestions';
		if (identityRanked.length > 0 && identityRanked[0].score < MEMO_MATCH_AUTO && (ranked[0]?.score ?? 0) >= MEMO_MATCH_AUTO) {
			reason += '（高分来自 note/profile 的弱命中，按设计不自动命中）';
		}
	} else {
		needsSearch = true;
		recommendation = '未命中。备忘现有 ' + memoIndex.length + ' 条（见 memo 索引）——先看有没有 key 对得上你的任务，没有再搜市场';
		reason = 'memo 无与 ' + query + ' 匹配的条目';
	}

	if (ambiguousWith.length > 0) {
		recommendation += `（歧义：与「${ambiguousWith[0].key}」分数接近——按任务的实际形态选一个，别默认取第一个）`;
	}

	const projectedEntry = entry
		? {
				availability: entry.availability,
				plugin: entry.plugin,
				installedVersion: entry.installedVersion,
				note: entry.note,
				candidates: entry.candidates,
				aliases: entry.aliases ?? [],
				profile: entry.profile,
				staleHost: entry.staleHost,
				dueReview: entry.dueReview,
			}
		: null;

	// 版本自检：availability=installed:x 但 x 的已装版本已变 → note 可能过期
	const drift = entry !== null && availabilityPrefix(entry.availability) === 'installed'		? (() => {
				const pkg = (entry.plugin || entry.availability.slice('installed:'.length)).trim();
				const current = installedVersionOf(home, pkg);
				const recorded = entry.installedVersion || '';
				return current !== '' && recorded !== '' && current !== recorded ? { pkg, recorded, current } : null;
			})()
		: null;
	if (drift !== null) {
		recommendation += `（注意：${drift.pkg} 已从 ${drift.recorded} 升到 ${drift.current}，备忘 note 可能过期，复核后写回 memo）`;
	}

	// 价值计量：这条命中了几次 + 本次是否省掉一次市场搜索（让"没发生的事"可见）
	if (entry !== null) {
		const original = entries[key];
		if (original !== undefined) {
			original.hits = (original.hits ?? 0) + 1;
			original.lastUsed = {
				pkg: entry.plugin || entry.candidates?.[0]?.pkg || '',
				role: entry.availability,
				at: Date.now(),
			};
		}
	}
	stats.coverageCalls += 1;
	if (needsSearch === false) stats.searchesAvoided += 1;
	await persistMemo(home, entries, stats);

	const options = entry !== null
		? entry.candidates.slice(0, 3).map((c) => ({ pkg: c.pkg, version: c.version, fit: c.fit }))
		: [];

	return {
		ok: true,
		intent: key || query,
		matchedBy,
		matchScore,
		memoHit: !!entry,
		selfReference: selfReferential,
		entry: projectedEntry,
		suggestions,
		installed: installedNames,
		needsSearch,
		recommendation,
		reason,
		memo: memoIndex,
		hostVersion: host,
		toolVersion: readToolVersion(),
		stats,
		...(options.length > 0 ? { options } : {}),
		...(ambiguousWith.length > 0 ? { ambiguousWith } : {}),
		...(drift !== null ? { versionDrift: drift } : {}),
	};
}

/** 找 pnpm 脚本：`$DSH_HOME/dsh-runtimes/<runtime>/dependencies/pnpm/bin/pnpm.mjs`，找不到回落到 PATH。 */
function resolvePnpmScript(home) {
	try {
		for (const entry of fs.readdirSync(path.join(home, 'dsh-runtimes'), { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const candidate = path.join(home, 'dsh-runtimes', entry.name, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs');
			if (fs.existsSync(candidate)) return candidate;
		}
	} catch {
		// 没有 runtimes 目录就走 PATH
	}
	return 'pnpm';
}

/**
 * `action: "pack"` —— 把本地源码目录打成 npm 风格 tgz（复用宿主自带 pnpm）。
 * 输出路径由 pnpm 打印的 `Tarball Details` 行确定，比猜 `<name>-<version>.tgz`
 * 更可靠（scoped 包、files 白名单都由 pnpm 处理）。
 *
 * @param {string} home
 * @param {any} args
 * @returns {Promise<any>}
 */
async function doPack(home, args) {
	const srcDir = typeof args?.dir === 'string' && args.dir.trim() !== '' ? path.resolve(args.dir) : null;
	if (srcDir === null) return { ok: false, message: 'pack 需要 dir：要打包的源码目录（须含 package.json）' };
	const manifestPath = path.join(srcDir, 'package.json');
	if (!fs.existsSync(manifestPath)) return { ok: false, message: `目录里没有 package.json：${srcDir}` };
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	} catch {
		manifest = null;
	}
	const pkgName = typeof manifest?.name === 'string' && manifest.name !== '' ? manifest.name : path.basename(srcDir);
	const pkgVersion = typeof manifest?.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0';
	const destDir = typeof args?.dest === 'string' && args.dest.trim() !== '' ? path.resolve(args.dest) : srcDir;

	const pnpm = resolvePnpmScript(home);
	const useScript = pnpm !== 'pnpm';
	const binary = useScript ? resolveNodeBinary(home) : pnpm;
	const argv = useScript ? [pnpm, '--dir', srcDir, 'pack', '--pack-destination', destDir] : ['--dir', srcDir, 'pack', '--pack-destination', destDir];
	const started = Date.now();
	const result = await new Promise((resolve) => {
		execFile(
			binary,
			argv,
			{ cwd: srcDir, timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
			(failure, stdout, stderr) => resolve({ failure: failure ?? null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
		);
	});
	const output = `${result.stdout}\n${result.stderr}`;
	const detail = output.match(/Tarball Details\s*\r?\n\s*([^\r\n]+\.tgz)/i);
	const expected = path.join(destDir, `${pkgName.replace(/^@/, '').replace('/', '-')}-${pkgVersion}.tgz`);
	const tgzPath = detail !== null && fs.existsSync(detail[1].trim()) ? detail[1].trim() : (fs.existsSync(expected) ? expected : null);
	// 包内卫生检查：pnpm 会照 `files` 白名单整目录收，编辑器备份/补丁残留会一起进包
	let junkFiles = [];
	if (tgzPath !== null) {
		try {
			const entries = untar(zlib.gunzipSync(fs.readFileSync(tgzPath)));
			junkFiles = entries
				.filter((entry) => !entry.directory && /(\.bak|\.orig|\.rej|\.tmp|\.swp|~)$|\.bak[-.]/i.test(entry.name))
				.map((entry) => entry.name);
		} catch {
			// 解不开不影响打包结果，只是少一层体检
		}
	}
	return {
		ok: tgzPath !== null,
		dir: srcDir,
		dest: destDir,
		package: pkgName,
		version: pkgVersion,
		tgz: tgzPath,
		...(tgzPath !== null ? { size: fs.statSync(tgzPath).size } : {}),
		junkFiles,
		elapsedMs: Date.now() - started,
		tail: output.slice(-600),
		nextStep: tgzPath !== null
			? junkFiles.length > 0
				? `打包成功，但包里有 ${junkFiles.length} 个备份/残留文件（${junkFiles.slice(0, 3).join(', ')}…）——从源码目录删掉它们或把它们移出 package.json 的 files 白名单后重打。`
				: '打包成功：用 plugin_manager { action:"install_bundle", target:"<tgz 路径>" } 安装；装完跑 plugin_market_scout { action:"verify" } 体检。'
			: '读 tail 修正后重试。',
	};
}

/** 读已装插件版本：扫所有 profile 的 `node_modules/<pkg>/package.json`。 */
function installedVersionOf(home, pkgName) {
	if (typeof pkgName !== 'string' || pkgName === '') return '';
	for (const profile of collectProfiles(home)) {
		try {
			const manifest = JSON.parse(fs.readFileSync(path.join(profile.dir, 'node_modules', pkgName, 'package.json'), 'utf8'));
			if (typeof manifest?.version === 'string' && manifest.version !== '') return manifest.version;
		} catch {
			// 这个 profile 没装，继续找下一个
		}
	}
	return '';
}

/**
 * 在缺失目标的上层目录里按文件名找同名产物（给 verify fix 用）。
 * 从目标目录逐级上溯到第一个存在的目录，再做限深递归（跳过 node_modules/.git）。
 *
 * @param {string} target spec 指向的缺失路径
 * @returns {string[]} 命中（最多 8 个，用于判定唯一性）
 */
function findReplacement(target) {
	const basename = path.basename(target);
	let dir = path.dirname(target);
	let root = null;
	for (let i = 0; i < 4; i += 1) {
		if (fs.existsSync(dir)) {
			root = dir;
			break;
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	if (root === null) return [];
	const matches = [];
	const skip = new Set(['node_modules', '.git', '.pnpm', '.cache']);
	const walk = (abs, depth) => {
		if (depth > 6 || matches.length > 8) return;
		let entries;
		try {
			entries = fs.readdirSync(abs, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(abs, entry.name);
			if (entry.isDirectory()) {
				if (!skip.has(entry.name)) walk(full, depth + 1);
			} else if (entry.name === basename) {
				matches.push(full);
			}
			if (matches.length > 8) return;
		}
	};
	walk(root, 0);
	return matches;
}

/** 改写 profile `package.json` 里一条依赖 spec；找不到该依赖返回 false。 */
function rewriteDependencySpec(profileDir, name, newSpec) {
	const file = path.join(profileDir, 'package.json');
	try {
		const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (manifest?.dependencies === null || typeof manifest?.dependencies !== 'object' || manifest.dependencies[name] === undefined) return false;
		manifest.dependencies[name] = newSpec;
		fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
		return true;
	} catch {
		return false;
	}
}

/**
 * 扫 profile 的 `node_modules` 顶层，找出既不在 manifest 依赖、也不在 lockfile 里的孤儿包。
 * 典型来源：`install_bundle` 对非 bundle 包先跑 pnpm、再在 bundle 校验时失败，留下一个
 * 不记账的链接目录（pnpm 用 junction，`Dirent.isDirectory()` 会是 false，所以这里用 stat）。
 *
 * lockfile 是判据的关键：pnpm 会把**传递依赖**以真实目录 hoist 到顶层，只看 manifest 会把
 * express / zod 这类正常依赖全误报成孤儿。
 */
function findOrphanPackages(profileDir, deps) {
	const nm = path.join(profileDir, 'node_modules');
	const direct = new Set(Object.keys(deps ?? {}));
	let lockText = '';
	try {
		lockText = fs.readFileSync(path.join(profileDir, 'pnpm-lock.yaml'), 'utf8');
	} catch {
		lockText = '';
	}
	// 在 lockfile 里出现过就不算孤儿；三种写法都认：
	//   `name@version:`（packages/snapshots）、`'@scope/name': ...`（optional deps 映射）、`\n  name: ...`
	const known = (name) =>
		direct.has(name) ||
		(lockText !== '' &&
			(lockText.includes(`${name}@`) || lockText.includes(`'${name}':`) || lockText.includes(`\n  ${name}:`)));
	// 用 lstat：悬空 junction（目标已被删）用 stat 会 ENOENT，正是最该报的一类残留
	const isDirLike = (full) => {
		try {
			const stat = fs.lstatSync(full);
			return stat.isDirectory() || stat.isSymbolicLink();
		} catch {
			return false;
		}
	};
	const skip = new Set(['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json', '.ignored']);
	const orphans = [];
	let entries;
	try {
		entries = fs.readdirSync(nm, { withFileTypes: true });
	} catch {
		return orphans;
	}
	for (const entry of entries) {
		if (skip.has(entry.name)) continue;
		const full = path.join(nm, entry.name);
		if (!isDirLike(full)) continue;
		if (entry.name.startsWith('@')) {
			let inner;
			try {
				inner = fs.readdirSync(full, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const sub of inner) {
				const name = `${entry.name}/${sub.name}`;
				if (name.startsWith('@deepseek-ai/') || known(name)) continue;
				if (!isDirLike(path.join(full, sub.name))) continue;
				orphans.push(name);
			}
			continue;
		}
		if (known(entry.name)) continue;
		orphans.push(entry.name);
	}
	return orphans.sort();
}

/**
 * `action: "verify"` —— 装后体检（零网络）：profile 依赖实体 + spec 目标存在性 +
 * node_modules 孤儿包 + guardian 启动预检报告（装了 dsh-my-guardian 时）。
 *
 * `fix: true` 时对 `specTargetMissing` 做有限修复（在缺失路径上层找唯一同名产物并改写
 * 依赖 spec），同时清掉孤儿包目录（只删 node_modules 里没记账的）。
 */
async function doVerify(home, args) {
	const profiles = collectProfiles(home);
	const rows = profiles.map((profile) => {
		const packages = Object.entries(profile.deps).map(([name, spec]) => {
			const target = specTargetPath(spec);
			return {
				name,
				spec,
				installed: fs.existsSync(path.join(profile.dir, 'node_modules', name, 'package.json')),
				specTargetMissing: target !== null && !fs.existsSync(target),
				inBundles: profile.bundles.includes(name),
			};
		});
		const broken = packages.filter((p) => !p.installed || p.specTargetMissing);
		// bundle 名册里有、node_modules 里没有 → 启动时整层解析失败。
		// 但 @deepseek-ai/* 是宿主随 App 分发的官方 bundle，本来就不在 profile 里，不能算缺失。
		const missingBundles = profile.bundles.filter((bundle) => {
			if (typeof bundle !== 'string' || bundle === '') return false;
			if (bundle.startsWith('@deepseek-ai/')) return false;
			return !fs.existsSync(path.join(profile.dir, 'node_modules', bundle, 'package.json'));
		});
		return {
			profile: profile.profile,
			dir: profile.dir,
			ok: broken.length === 0 && missingBundles.length === 0,
			broken: [...broken, ...missingBundles.map((bundle) => ({ name: bundle, bundleMissing: true }))],
			missingBundles,
			packages,
			orphanPackages: findOrphanPackages(profile.dir, profile.deps),
		};
	});

	const fixes = [];
	if (args?.fix === true) {
		for (const row of rows) {
			for (const pkg of row.broken) {
				if (!pkg.specTargetMissing) continue;
				const target = specTargetPath(pkg.spec);
				if (target === null) continue;
				const matches = findReplacement(target);
				if (matches.length === 1) {
					const newSpec = `file:${matches[0].replace(/\\/g, '/')}`;
					if (rewriteDependencySpec(row.dir, pkg.name, newSpec)) {
						fixes.push({ profile: row.profile, name: pkg.name, from: target, to: matches[0] });
						pkg.spec = newSpec;
						pkg.specTargetMissing = false;
					}
				} else {
					fixes.push({ profile: row.profile, name: pkg.name, ambiguous: matches.length, candidates: matches.slice(0, 5) });
				}
			}
			row.broken = [...row.packages.filter((p) => !p.installed || p.specTargetMissing), ...row.missingBundles.map((bundle) => ({ name: bundle, bundleMissing: true }))];
			row.ok = row.broken.length === 0;
			if (row.orphanPackages.length > 0) {
				const removed = [];
				for (const name of row.orphanPackages) {
					try {
						fs.rmSync(path.join(row.dir, 'node_modules', name), { recursive: true, force: true });
						removed.push(name);
					} catch {
						// 删不掉就留着继续报
					}
				}
				if (removed.length > 0) fixes.push({ profile: row.profile, removedOrphans: removed });
				row.orphanPackages = row.orphanPackages.filter((name) => !removed.includes(name));
			}
		}
	}

	let guardian = null;
	try {
		const gfile = path.join(home, 'guardian', 'startup-issues.json');
		if (fs.existsSync(gfile)) {
			const raw = JSON.parse(fs.readFileSync(gfile, 'utf8'));
			guardian = { file: gfile, checkedAt: raw?.checkedAt ?? 0, issues: Array.isArray(raw?.issues) ? raw.issues : [] };
		}
	} catch {
		// guardian 未装或报告不可读
	}
	const overall = rows.every((row) => row.ok) && (guardian === null || guardian.issues.length === 0);
	const fixedAny = fixes.length > 0;
	const specFixed = fixes.some((f) => f.to !== undefined);
	const orphansFixed = fixes.some((f) => Array.isArray(f.removedOrphans) && f.removedOrphans.length > 0);
	const orphanCount = rows.reduce((count, row) => count + row.orphanPackages.length, 0);
	const missingBundleCount = rows.reduce((count, row) => count + (row.missingBundles?.length ?? 0), 0);
	// 价值计量：这次体检抓出多少个坏项（路径漂移 / 依赖缺失）
	const brokenCount = rows.reduce((count, row) => count + row.broken.length, 0);
	const memo = await readMemo(home);
	memo.stats.risksCaught += brokenCount;
	await persistMemo(home, memo.entries, memo.stats);
	return {
		ok: true,
		overallOk: overall,
		home,
		hostVersion: readHostVersion(home),
		toolVersion: readToolVersion(),
		profiles: rows,
		guardian,
		stats: { ...memo.stats, toolVersion: readToolVersion() },
		orphans: orphanCount,
		missingBundles: missingBundleCount,
		...(args?.fix === true ? { fixes } : {}),
		nextStep: overall
			? fixedAny
				? [
						specFixed ? 'spec 已改写到现存路径（只改了 package.json，需 pnpm install 或重装让 lockfile 跟上）' : '',
						orphansFixed ? '孤儿包目录已删' : '',
					].filter(Boolean).join('；') + '。'
				: orphanCount > 0
					? `体检通过，但 node_modules 里有 ${orphanCount} 个不记账的孤儿包（install_bundle 对非 bundle 包失败时留下的）——verify 加 fix:true 可清。`
					: '体检通过。装完的插件是否真注册了工具/页面，仍需新开一个会话实测（工具在会话建立时装配）。'
			: missingBundleCount > 0
				? `有 ${missingBundleCount} 个 bundle 在 dsh.profile.bundles 名册里但没装进 node_modules——启动会整层解析失败。先 plugin_manager install_bundle 补装，或从 bundles 里摘掉。`
				: '先修 broken 项（specTargetMissing → verify 加 fix:true 自动找同名产物，或重装指向现存目录/tgz；installed=false → 重新 install_bundle），修完再重启宿主。',
	};
}

/**
 * `action: "selftest"` —— 内置回归套件（零网络）：把历史上真出过问题的地方固化成用例，
 * 发版前一次调用自证，而不是等用户拿真实任务当 QA。
 */
async function doSelftest(args) {
	const cases = [];
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-selftest-'));
	const assert = (cond, message) => {
		if (!cond) throw new Error(message);
	};
	const check = async (name, fn) => {
		try {
			const detail = await fn();
			cases.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) });
		} catch (error) {
			cases.push({ name, ok: false, detail: String(error?.message ?? error) });
		}
	};
	try {
		const memoHome = path.join(root, 'home');
		fs.mkdirSync(memoHome, { recursive: true });
		fs.writeFileSync(path.join(memoHome, MEMO_FILE_NAME), JSON.stringify({ x: { verdict: 'installed', plugin: 'p', note: 'n', at: 1 } }), 'utf8');

		await check('memo v1→v3 迁移', async () => {
			const { entries, stats } = await readMemo(memoHome);
			assert(entries.x?.availability === 'installed:p', `v1 verdict 未映射（${entries.x?.availability}）`);
			assert(stats.coverageCalls === 0, 'stats 默认值不对');
			return 'availability=installed:p';
		});

		await check('memo 冲突拒写', async () => {
			const written = await writeMemo(memoHome, [{ key: 'x', availability: 'none' }], {});
			assert(written.conflicts.length === 1, '应拒绝 installed→none');
			const after = await readMemo(memoHome);
			assert(after.entries.x?.availability === 'installed:p', '存储被覆盖');
			return 'conflicts=1';
		});

		await check('coverage 身份打分', async () => {
			const pptx = { aliases: ['做PPT', '新做PPT', '生成PPT', '从零做PPT', '做演示文稿'], note: '从零生成：内置 office-pptx 可做', candidates: [{ pkg: 'dsh-ppt', fit: '生成 PPT' }], profile: {} };
			const del = { aliases: ['删会话', '删除会话', '清理会话', '删掉旧会话', '会话删除'], note: '', candidates: [], profile: {} };
			const video = scoreMemoEntryIdentity(memoTokens('从 B 站视频生成文字总结'), memoEntryTokens(pptx, 'pptx:generate'));
			const delScore = scoreMemoEntryIdentity(memoTokens('删掉一个旧会话'), memoEntryTokens(del, 'delete-session'));
			const ppt = scoreMemoEntryIdentity(memoTokens('做一份 PPT'), memoEntryTokens(pptx, 'pptx:generate'));
			assert(video < MEMO_MATCH_AUTO, `视频任务误命中（${video}）`);
			assert(delScore >= MEMO_MATCH_AUTO, `删会话未命中（${delScore}）`);
			assert(ppt >= MEMO_MATCH_AUTO, `做 PPT 未命中（${ppt}）`);
			return `video=${video} delete=${delScore} ppt=${ppt}`;
		});

		await check('搜索相关度与兜底阈值', async () => {
			// 只给 name、不给描述：四个概念里只有 bilibili↔bili 一个命中，分数必须低于兜底阈值
			const long = relevanceScore(memoTokens('bilibili video transcript summary'), 'dsh-bili-watch', '');
			const short = relevanceScore(memoTokens('bilibili'), 'dsh-bili-watch', '');
			assert(long < 0.34, `长句相关度应触发兜底（${long}）`);
			assert(short >= 0.9, `单词应命中（${short}）`);
			return `long=${long} short=${short}`;
		});

		await check('跨语言检索（zh/en 双语描述）', async () => {
			const fake = [{
				name: 'dsh-bili-watch',
				title: 'Sacredbluedragon/dsh-bili-watch',
				description: { zh: '把 B 站视频内容读成文本：元数据、字幕、本地转写、抽帧 OCR', en: 'Reads Bilibili video content as text: metadata, subtitles, ASR, frame OCR' },
				versions: [{ version: '0.2.29', publishTimestamp: 1793090000 }],
			}];
			const en = catalogSearch(fake, 'bilibili subtitles', 5);
			const zh = catalogSearch(fake, '字幕 转写', 5);
			assert(en.rows.length === 1, `英文查询没命中（${en.rows.length}）`);
			assert(zh.rows.length === 1, `中文查询没命中（${zh.rows.length}）`);
			assert(String(en.rows[0].description).startsWith('Reads'), '英文查询应回英文描述');
			assert(String(zh.rows[0].description).startsWith('把'), '中文查询应回中文描述');
			const enScore = relevanceScore(memoTokens('bilibili subtitles'), 'dsh-bili-watch', '', 'Reads Bilibili video content as text: subtitles');
			assert(enScore > 0.5, `英文相关度应 > 0.5（${enScore}）`);
			// 同义词组：中英概念相同的词要能互相命中
			const syn = catalogSearch([{ name: 'dsh-x', title: 't', description: { zh: '', en: 'Extracts subtitles from any video' }, versions: [{ version: '1.0.0', publishTimestamp: 1 }] }], '字幕', 5);
			assert(syn.rows.length === 1, '「字幕」未同义命中 subtitles');
			const synScore = relevanceScore(memoTokens('转写'), 'x', 'ASR transcription pipeline');
			assert(synScore >= 0.5, `「转写」↔ ASR 未同义命中（${synScore}）`);
			return `en=${enScore} zhRows=${zh.rows.length} synonym=${synScore}`;
		});

		await check('中文需求→英文检索词 / kind:skill', async () => {
			const hints = queryHints('帮我做一份PPT');
			assert(hints.includes('ppt'), `「做一份PPT」未补出 ppt（${hints.join(',')}）`);
			// 反方向：英文 query 要能补出中文检索词
			const reverse = queryHints('bilibili video transcript');
			assert(reverse.some((h) => /[\u4e00-\u9fff]/u.test(h)), `英文 query 未补出中文（${reverse.join(',')}）`);
			assert(matchesSkillKind({ name: 'dsh-ppt-master', description: 'PPT Master — agent preset 形式提供全套技能' }) === true, '技能包未命中');
			assert(matchesSkillKind({ name: 'dsh-whale-widget', description: '桌面挂件' }) === false, '非技能包被误命中');
			return `${hints.join(',')} | ${reverse.join(',')}`;
		});

		await check('plan 报备落档 / rollback 恢复备忘', async () => {
			const planned = await doPlan(memoHome, { task: '测试任务', steps: ['第一步', '第二步'], etaMinutes: 12, needsConfirm: ['要不要装'] });
			assert(planned.ok === true && planned.briefing.includes('开工前报备'), 'plan 没产出报备文本');
			assert(fs.existsSync(path.join(memoHome, PLAN_FILE_NAME)), 'plan 没落档');
			const before = await readMemo(memoHome);
			await writeMemo(memoHome, [{ key: 'y', availability: 'none', note: '新写的' }], {});
			const rolled = await doRollback(memoHome, { what: 'memo' });
			assert(rolled.ok === true, `rollback 失败：${rolled.message ?? ''}`);
			const after = await readMemo(memoHome);
			assert(after.entries.y === undefined, 'rollback 后仍能看到新写的条目');
			assert(Object.keys(after.entries).length === Object.keys(before.entries).length, '条目数没回到快照状态');
			return `plans=ok rollbackEntries=${rolled.restored}`;
		});

		await check('孤儿包检出', async () => {
			const profile = path.join(root, 'profile');
			fs.mkdirSync(path.join(profile, 'node_modules', 'fake-orphan'), { recursive: true });
			fs.writeFileSync(path.join(profile, 'node_modules', 'fake-orphan', 'package.json'), '{"name":"fake-orphan"}');
			fs.mkdirSync(path.join(profile, 'node_modules', 'known-pkg'), { recursive: true });
			fs.writeFileSync(path.join(profile, 'node_modules', 'known-pkg', 'package.json'), '{"name":"known-pkg"}');
			fs.writeFileSync(path.join(profile, 'pnpm-lock.yaml'), 'packages:\n\n  known-pkg@1.0.0: {}\n', 'utf8');
			const orphans = findOrphanPackages(profile, {});
			assert(orphans.includes('fake-orphan'), '未检出 fake-orphan');
			assert(!orphans.includes('known-pkg'), '误报 known-pkg');
			return orphans.join(',');
		});

		if (args?.network === true) {
			await check('网络：registry 关键词 + 目录快照', async () => {
				const json = await fetchJson(`${OFFICIAL_REGISTRY}/-/v1/search?text=${encodeURIComponent(`keywords:${KEYWORD_COMMUNITY}`)}&size=3`);
				const npmHits = (json?.objects ?? []).length;
				assert(npmHits > 0, 'registry 关键词搜索返回 0 条');
				const catalog = await loadCatalog();
				assert(catalog.length > 100, `目录快照过小（${catalog.length}）`);
				return `npm=${npmHits} catalog=${catalog.length}`;
			});
			await check('网络：fetch 解包 + audit 拦截非插件', async () => {
				const fetchHome = path.join(root, 'fetchhome');
				fs.mkdirSync(fetchHome, { recursive: true });
				const fetched = await doFetch(fetchHome, { name: 'is-number' });
				assert(fetched.ok === true, `fetch 失败：${fetched?.message ?? ''}`);
				assert(fs.existsSync(path.join(fetched.dir, 'package.json')), '解包目录里没有 package.json');
				const audited = await doAudit(fetchHome, { dir: fetched.dir });
				assert(audited.verdict === 'block', `is-number 不是插件，audit 应 block，实际 ${audited.verdict}`);
				return `${path.basename(fetched.dir)} → ${audited.verdict}`;
			});
		}

		await check('spec 目标解析', async () => {
			assert(specTargetPath('file:D:/a/b.tgz').endsWith('/a/b.tgz'), 'file: 解析失败');
			assert(specTargetPath('link:C:\\x\\y') !== null, 'link: 解析失败');
			assert(specTargetPath('^1.2.3') === null, '版本号不应解析成路径');
			return 'ok';
		});
	} finally {
		try {
			fs.rmSync(root, { recursive: true, force: true });
		} catch {
			// 清理失败无害
		}
	}

	const failed = cases.filter((c) => !c.ok).length;
	const networkRan = args?.network === true;
	return {
		ok: failed === 0,
		total: cases.length,
		passed: cases.length - failed,
		failed,
		toolVersion: readToolVersion(),
		network: networkRan,
		cases,
		nextStep: failed === 0
			? networkRan
				? '本地 + 网络回归全绿。网络用例覆盖 registry 搜索、目录快照、fetch 解包、audit 拦截。'
				: '本地回归全绿（未跑网络用例）。发版前建议加 network:true 再跑一次，覆盖 registry/目录/fetch。'
			: '有用例失败：先修，别发版。',
	};
}

/** 计划日志文件名：把"开工前报备"落成可查的账，而不是只靠记性。 */
const PLAN_FILE_NAME = 'market-plans.json';

/**
 * `action: "plan"` —— 生成并记录「开工前报备」三件事：做什么 / 花多少 / 需要确认什么。
 * 长任务先调它，输出可以直接贴给用户；同时留档，事后能查"当时报备过什么"。
 */
async function doPlan(home, args) {
	const task = typeof args?.task === 'string' ? args.task.trim() : '';
	if (task === '') return { ok: false, message: 'plan 需要 task：一句话说清要做什么' };
	const steps = Array.isArray(args?.steps) ? args.steps.filter((s) => typeof s === 'string' && s.trim() !== '') : [];
	const needsConfirm = Array.isArray(args?.needsConfirm) ? args.needsConfirm.filter((s) => typeof s === 'string' && s.trim() !== '') : [];
	const eta = Number(args?.etaMinutes);
	const entry = {
		task,
		steps,
		etaMinutes: Number.isFinite(eta) && eta > 0 ? Math.round(eta) : null,
		needsConfirm,
		at: Date.now(),
		toolVersion: readToolVersion(),
	};
	const file = path.join(home, PLAN_FILE_NAME);
	let plans = [];
	try {
		const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
		if (Array.isArray(raw?.plans)) plans = raw.plans;
	} catch {
		// 首次使用或文件损坏：从空开始
	}
	plans.unshift(entry);
	plans = plans.slice(0, 20);
	await fsp.writeFile(file, JSON.stringify({ plans }, null, 2) + '\n', 'utf8');

	const lines = [
		'**开工前报备**',
		`1) 做什么：${steps.length > 0 ? steps.join('；') : task}`,
		`2) 花多少：${entry.etaMinutes === null ? '未估' : `约 ${entry.etaMinutes} 分钟`}`,
		`3) 需要你确认：${needsConfirm.length > 0 ? needsConfirm.join('；') : '无（已获授权则直接开始）'}`,
	];
	return { ok: true, file, plans: plans.length, briefing: lines.join('\n'), entry, toolVersion: readToolVersion() };
}

/**
 * `action: "rollback"` —— 有限回滚，只动本插件自己的产物：
 *  - `what:"hunt"` + `name`：删掉 `plugin-hunt/<name>-*` 解包副本（最干净的重来方式）
 *  - `what:"memo"`：从 `.bak` 恢复上一版备忘（每次写备忘前自动留快照）
 *  - `what:"plugin"` + `name`：**不代劳**——安装归宿主，返回精确的卸载命令
 */
async function doRollback(home, args) {
	const what = typeof args?.what === 'string' ? args.what.toLowerCase() : 'hunt';
	const name = typeof args?.name === 'string' ? args.name.trim() : '';
	if (what === 'memo') {
		const file = path.join(home, MEMO_FILE_NAME);
		const backup = file + '.bak';
		if (!fs.existsSync(backup)) return { ok: false, message: '没有备忘快照（.bak）。只能回滚到"上次写入之前"，没写过就没有快照。' };
		const snapshot = await fsp.readFile(backup, 'utf8');
		await fsp.writeFile(file, snapshot, 'utf8');
		const { entries } = await readMemo(home);
		return { ok: true, what, restored: Object.keys(entries).length, file, toolVersion: readToolVersion(), nextStep: '已恢复到上一版备忘；再调 action:"memo" 可核对内容。' };
	}
	if (what === 'plugin') {
		if (name === '') return { ok: false, message: 'rollback what:"plugin" 需要 name（包名）' };
		return {
			ok: false,
			what,
			message: '安装/卸载归宿主 plugin_manager 管，本插件不代劳（怕留下半装状态）。',
			command: `plugin_manager { action:"remove_bundle", target:"${name}" }`,
			nextStep: '先跑上面这条卸载；再 action:"rollback", what:"hunt", name:"<name>" 清掉解包副本。',
		};
	}
	// what === 'hunt'
	if (name === '') return { ok: false, message: 'rollback what:"hunt" 需要 name（包名）' };
	const huntRoot = path.join(home, HUNT_DIR);
	let removed = [];
	try {
		for (const dir of fs.readdirSync(huntRoot, { withFileTypes: true })) {
			if (!dir.isDirectory() && !dir.isSymbolicLink()) continue;
			if (dir.name !== name && !dir.name.startsWith(name + '-')) continue;
			const full = path.join(huntRoot, dir.name);
			// 防越界：目标必须仍在 hunt 根下
			if (!path.resolve(full).startsWith(path.resolve(huntRoot) + path.sep)) continue;
			fs.rmSync(full, { recursive: true, force: true });
			removed.push(dir.name);
		}
	} catch {
		return { ok: false, message: `plugin-hunt 目录不可读：${huntRoot}` };
	}
	return {
		ok: true,
		what,
		removed,
		...(removed.length === 0 ? { message: `plugin-hunt 下没有 ${name} 的副本（本来就没下过）` } : {}),
		toolVersion: readToolVersion(),
		nextStep: removed.length > 0 ? '副本已删。要重来就重新 fetch。' : '无需清理。',
	};
}

/**
 * `action: "audit"` —— 静态体检。
 *
 * @param {string} home
 * @param {any} args
 * @returns {Promise<any>}
 */
async function doAudit(home, args) {
	const target = await resolveAuditTarget(home, args);
	if ('error' in target) return { ok: false, message: target.error };

	const blockers = [];
	const warnings = [];
	const patchFiles = [];
	const entryIds = [];

	const declared = target.manifest?.dsh?.bundle?.patch;
	const patchList = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared : [];
	if (patchList.length === 0) blockers.push('package.json 未声明 dsh.bundle.patch —— 无法作为插件包安装');

	let patchDisabled = false;
	for (const relative of patchList) {
		if (typeof relative !== 'string') continue;
		if (target.dir === null) {
			warnings.push(`patch 内容未审计：${relative}（没有本地文件，先 action:"fetch" 再 audit）`);
			continue;
		}
		let file;
		try {
			file = safeJoin(target.dir, relative);
		} catch {
			blockers.push(`patch 路径越界：${relative}`);
			continue;
		}
		let text;
		try {
			text = await fsp.readFile(file, 'utf8');
		} catch (error) {
			blockers.push(`patch 文件读不到：${relative}（${error?.code ?? error?.message ?? error}）`);
			continue;
		}
		const ids = collectIds(text);
		for (const id of ids) if (!entryIds.includes(id)) entryIds.push(id);
		if (/disabled:\s*true/i.test(text)) patchDisabled = true;
		patchFiles.push({ file: relative, entryIds: ids });
	}

	// 装完才发现是禁用态会白折腾一轮：审计阶段就说清楚
	if (patchDisabled) {
		warnings.push('该 bundle patch 带 disabled: true —— 装完必须在「插件」页启用并重启，否则 entry 不激活、工具不注册');
	}

	// entry id 撞车：同一个 profile 里两条 entry 用同一个 id，后装的那条行为不可预期
	const profiles = collectProfiles(home);
	const collisions = [];
	for (const profile of profiles) {
		for (const id of entryIds) {
			if (!profile.ids.includes(id)) continue;
			const self = typeof target.manifest?.name === 'string' && profile.deps[target.manifest.name] !== undefined;
			collisions.push({ profile: profile.profile, id, self });
		}
	}
	for (const collision of collisions) {
		if (collision.self) {
			warnings.push(`entry id "${collision.id}" 已存在于 profile ${collision.profile} —— 同名包已装，视为覆盖/升级`);
		} else {
			blockers.push(`entry id "${collision.id}" 与 profile ${collision.profile} 的既有条目撞车 —— 装上会出现两条 entry 抢同一个 id`);
		}
	}

	// engines.dsh：不满足就是「装上也不会生效」，属于 blocker
	const host = readHostVersion(home);
	const need = target.manifest?.engines?.dsh;
	if (typeof need === 'string' && need.trim() !== '') {
		if (host === null) {
			warnings.push(`读不到宿主版本，engines.dsh "${need}" 未校验`);
		} else {
			const satisfied = satisfiesSimple(need, host);
			if (satisfied === false) blockers.push(`engines.dsh "${need}" 不满足宿主 ${host} —— 装上也不会生效`);
			else if (satisfied === null) warnings.push(`engines.dsh "${need}" 解析不了，宿主 ${host} 请人工确认`);
		}
	}

	for (const risk of nativeRisks(target.manifest)) warnings.push(risk);

	// 入口与 register 兜底：只有拿到本地文件才判得了
	if (target.dir !== null) {
		const main = readPackageMain(target.manifest);
		if (main === null) {
			blockers.push('package.json 没有 main / exports["."] 入口');
		} else {
			let entryFile = null;
			try {
				entryFile = safeJoin(target.dir, main);
			} catch {
				blockers.push(`入口路径越界：${main}`);
			}
			if (entryFile !== null && !fs.existsSync(entryFile)) {
				blockers.push(`入口文件不存在：${main}`);
			} else if (entryFile !== null) {
				const guard = checkRegisterGuarded(entryFile);
				if (guard === 'unguarded') {
					warnings.push(`入口 ${main} 的 register 附近没看到 try/catch —— 注册抛错会让宿主启动失败`);
				} else if (guard === 'no-register') {
					warnings.push(`入口 ${main} 没发现 .register( —— 可能是命令/技能型插件，读代码确认它注册了什么`);
				}
			}
		}
	}

	const verdict = blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass';
	return {
		ok: true,
		verdict,
		name: target.manifest?.name ?? null,
		version: target.version,
		dir: target.dir,
		source: target.source,
		hostVersion: host,
		engines: target.manifest?.engines ?? null,
		entryIds,
		patchFiles,
		patchDisabled,
		blockers,
		warnings,
		nextStep:
			verdict === 'block'
				? '不要安装。把 blockers 逐条讲给用户；需要的话先 fetch 后读源码，判断能不能改到可用。'
				: patchDisabled
					? '下一步 dryrun；注意 patch 是 disabled: true —— 装完要在「插件」页启用并重启，否则工具不注册。'
					: '下一步跑 action:"dryrun" 确认真能注册出工具，然后问用户是否安装（plugin_manager install_bundle）。',
	};
}

/**
 * 子进程里用的干跑脚本。
 *
 * 设计要点：假 ctx 用 Proxy 兜住未知属性（插件会碰 `ctx.on` / `ctx.plugin` 等
 * 一堆服务），但 `tools` / `logger` / `get` / `effect` 必须给真语义 ——
 * 前两个是要观测的东西，后两个决定插件走哪条分支（`get('skills')` 返回 undefined
 * 就是「技能服务缺席」的真实降级路径）。
 *
 * ⚠️ 这是**会执行第三方代码**的。放子进程、加超时、不进宿主进程，是这条链路
 * 唯一可接受的形态。
 */
const DRYRUN_RUNNER = String.raw`
const emit = (value) => process.stdout.write('__DRYRUN__' + JSON.stringify(value) + '\n', () => process.exit(0));
const registered = [];
const logs = [];
const noop = () => {};
// 兜住「apply() 返回一个永不落地的 promise」：这时没有任何 pending 句柄，
// 事件循环会直接空掉、进程静默退出（实测 code=0、无输出），调用方只能瞎猜。
// 用一个 ref 住的定时器把进程拖到超时，再诚实报「没返回」。
const guard = setTimeout(() => {
  emit({ ok: false, stage: 'timeout', error: 'apply() 在 12000ms 内没有返回（promise 悬空，或有死循环）', registered, logs: logs.slice(-20) });
}, 12000);
const ctx = new Proxy({
  tools: {
    register(def) {
      registered.push({
        name: def && def.name ? String(def.name) : '<unnamed>',
        description: def && def.description ? String(def.description).slice(0, 160) : null,
      });
      return def;
    },
  },
  logger: {
    info: (...args) => logs.push('info: ' + args.join(' ')),
    warn: (...args) => logs.push('warn: ' + args.join(' ')),
    error: (...args) => logs.push('error: ' + args.join(' ')),
    debug: noop,
  },
  get: () => undefined,
  effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
  on: noop, off: noop, emit: noop, plugin: noop, inject: noop, provide: noop,
  set: noop, start: noop, stop: noop, dispose: noop,
}, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'symbol') return undefined;
    return noop;
  },
  has: () => true,
});

(async () => {
  let mod;
  try {
    mod = await import(process.argv[1]);
  } catch (error) {
    emit({ ok: false, stage: 'import', error: String((error && error.stack) || error), registered, logs: logs.slice(-20) });
    return;
  }
  const plugin = mod && mod.default !== undefined ? mod.default : mod;
  const applyFn = typeof plugin === 'function' ? plugin : plugin && plugin.apply;
  if (typeof applyFn !== 'function') {
    emit({ ok: false, stage: 'shape', error: '模块没有导出 apply()（既不是函数，也没有 .apply 属性）', registered, logs: logs.slice(-20) });
    return;
  }
  try {
    await applyFn(ctx);
  } catch (error) {
    emit({ ok: false, stage: 'apply', error: String((error && error.stack) || error), registered, logs: logs.slice(-20) });
    return;
  }
  emit({ ok: true, registered, logs: logs.slice(-20) });
})();
`;

/**
 * 找出能跑 ESM 的 node 可执行文件。
 *
 * 桌面端宿主可能是 Electron：`process.execPath` 指向的是 App 本体，拿它加
 * `--input-type=module` 只会把 App 再启动一次。所以先按文件名筛，再从
 * `dsh-runtimes` 里找随包 node，最后才退回 PATH 上的 `node`。
 *
 * @param {string} home
 * @returns {string}
 */
function resolveNodeBinary(home) {
	const isNode = (candidate) => {
		if (typeof candidate !== 'string' || candidate.trim() === '') return false;
		const base = path.basename(candidate).toLowerCase();
		return base === 'node' || base === 'node.exe';
	};

	if (isNode(process.env.DSH_NODE)) return process.env.DSH_NODE;
	if (isNode(process.env.npm_node_execpath)) return process.env.npm_node_execpath;
	if (isNode(process.execPath)) return process.execPath;

	try {
		for (const entry of fs.readdirSync(path.join(home, 'dsh-runtimes'), { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			for (const relative of ['dependencies/node/bin/node.exe', 'dependencies/node/bin/node', 'dependencies/node/node.exe']) {
				const candidate = path.join(home, 'dsh-runtimes', entry.name, relative);
				if (fs.existsSync(candidate)) return candidate;
			}
		}
	} catch {
		// 没有 runtimes 目录就走 PATH
	}

	return 'node';
}

/**
 * 跑一次子进程，把 stdout/stderr 收全（不因超时抛出）。
 * @param {string} binary
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {Promise<{failure: any, stdout: string, stderr: string}>}
 */
function runChild(binary, argv, cwd) {
	return new Promise((resolve) => {
		execFile(
			binary,
			argv,
			{ cwd, timeout: DRYRUN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, DSH_MARKET_DRYRUN: '1' } },
			(failure, stdout, stderr) => resolve({ failure: failure ?? null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
		);
	});
}

/**
 * 把干跑失败分成「环境性」（隔离目录缺声明依赖 / 假 ctx 缺宿主方法）与「真错误」。
 * 环境性失败历史上误杀过至少三个好插件（dsh-shared 依赖、webServer.register 假 ctx…），
 * 所以单独归类并给出可操作的下一步，而不是一律"不装"。
 *
 * @param {string} dir
 * @param {string | null} stage
 * @param {string} error
 * @returns {{classification: string, classificationReason: string}}
 */
function classifyDryrunFailure(dir, stage, error) {
	const text = typeof error === 'string' ? error : '';
	const declared = new Set();
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
		for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
			for (const depName of Object.keys(manifest?.[section] ?? {})) declared.add(depName);
		}
	} catch {
		// 读不到 manifest 就不做依赖归类
	}
	const missing = text.match(/Cannot find package '([^']+)'/);
	if (stage === 'import' && missing !== null && declared.has(missing[1])) {
		return {
			classification: 'environmental',
			classificationReason: `入口 import 的 '${missing[1]}' 是 package.json 声明的依赖，隔离干跑目录里没装（install_bundle 会用 pnpm 装上）。先查 registry 确认该依赖存在，再决定。`,
		};
	}
	if (text.includes('ERR_MODULE_NOT_FOUND')) {
		return {
			classification: 'environmental',
			classificationReason: '入口 import 了干跑目录里没有的模块。若它是 package.json 声明的依赖，属预期（安装时随 pnpm 装上）；若 import 的是宿主包，需确认宿主 loader 能解析裸 @deepseek-ai/* import。',
		};
	}
	if (/is not a function|Cannot read properties of undefined|undefined is not an object/.test(text)) {
		return {
			classification: 'environmental',
			classificationReason: '疑似假 ctx 缺少宿主服务/方法（如 ctx.webServer.register）。用 cordis_inspect 核对宿主真实契约后再定夺，别直接淘汰。',
		};
	}
	return { classification: 'real', classificationReason: '错误来自插件自身逻辑（或无法归类），按真错误处理。' };
}

/**
 * 跑一次干跑子进程并组装结果（普通与 deep 共用）。`cwd` 是 import 的工作目录，
 * `classifyDir` 用于读 package.json 做失败分级；`dirLabel` 是回给调用方看的源目录。
 *
 * @param {string} home
 * @param {{cwd: string, classifyDir: string, dirLabel: string, entryRel: string, entryAbs: string}} opts
 * @returns {Promise<any>}
 */
async function executeDryrunChild(home, opts) {
	const { cwd, classifyDir, dirLabel, entryRel, entryAbs } = opts;
	const started = Date.now();
	const { failure, stdout, stderr } = await runChild(
		resolveNodeBinary(home),
		['--input-type=module', '-e', DRYRUN_RUNNER, pathToFileURL(entryAbs).href],
		cwd,
	);
	const elapsedMs = Date.now() - started;
	const marker = stdout.split(/\r?\n/).find((line) => line.startsWith('__DRYRUN__'));
	let payload = null;
	if (marker !== undefined) {
		try {
			payload = JSON.parse(marker.slice('__DRYRUN__'.length));
		} catch {
			payload = null;
		}
	}
	const stderrTail = stderr.length > 2000 ? stderr.slice(-2000) : stderr;
	if (payload === null) {
		const timedOut = Boolean(failure && (failure.killed === true || failure.signal === 'SIGTERM'));
		const classification = timedOut
			? { classification: 'real', classificationReason: 'apply() 挂起/死循环，按真错误处理。' }
			: classifyDryrunFailure(classifyDir, 'import', failure?.message ?? stderrTail);
		return {
			ok: false,
			dir: dirLabel,
			entry: entryRel,
			elapsedMs,
			timedOut,
			message: timedOut
				? `apply() 超过 ${DRYRUN_TIMEOUT_MS}ms 没返回 —— 有挂起或死循环，别装`
				: failure === null
					? '子进程在给出结果前就退出了（apply 返回了悬空的 promise，或什么也没注册）—— 视为不通过'
					: `子进程异常退出（code=${failure.code ?? '?'} / signal=${failure.signal ?? '-'}）`,
			error: failure?.message ?? null,
			stderrTail,
			...classification,
		};
	}
	const classification = payload.ok === true
		? { classification: 'none', classificationReason: '干跑通过。' }
		: classifyDryrunFailure(classifyDir, payload.stage ?? 'apply', payload.error ?? payload.message ?? '');
	return {
		ok: payload.ok === true,
		dir: dirLabel,
		entry: entryRel,
		elapsedMs,
		timedOut: payload.stage === 'timeout',
		registeredTools: payload.registered ?? [],
		logs: payload.logs ?? [],
		...(payload.ok === true
			? {}
			: { stage: payload.stage ?? null, message: payload.error ?? 'apply 失败', error: payload.error ?? null }),
		stderrTail,
		...classification,
		nextStep:
			payload.ok === true
				? '确认真实注册的工具名覆盖了用户需求，再问用户是否安装。'
				: classification.classification === 'environmental'
					? '环境性失败不等于插件坏：按 classificationReason 处理（查 registry 确认依赖 / 用 cordis_inspect 核对宿主契约），必要时装到真实宿主实测。'
					: '真错误：读源码判断是能小改（Fork）还是根本不适配。',
	};
}

/**
 * `dryrun deep:true` —— 隔离目录里 `pnpm install --ignore-scripts` 装上声明依赖后
 * 再 import + apply。补普通 dryrun 的短板：声明依赖在隔离目录缺失导致的假阴性。
 * 依旧不进宿主进程、不跑安装脚本；装依赖时限 120s，临时目录用完即删。
 *
 * @param {string} home
 * @param {any} target resolveAuditTarget 的结果
 * @param {string} main package 入口的相对路径
 * @param {string} entry 源目录下的入口绝对路径
 * @returns {Promise<any>}
 */
async function doDryrunDeep(home, target, main, entry) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dryrun-'));
	try {
		const skipJunk = (src) => {
			const parts = src.split(/[\\/]/);
			return !(parts.includes('node_modules') || parts.includes('.git'));
		};
		fs.cpSync(target.dir, tmp, { recursive: true, filter: skipJunk });
		const pnpm = resolvePnpmScript(home);
		const useScript = pnpm !== 'pnpm';
		const installBin = useScript ? resolveNodeBinary(home) : pnpm;
		const installArgv = useScript
			? [pnpm, 'install', '--ignore-scripts', '--no-frozen-lockfile', '--reporter=append-only']
			: ['install', '--ignore-scripts', '--no-frozen-lockfile', '--reporter=append-only'];
		const installResult = await new Promise((resolve) => {
			execFile(installBin, installArgv, { cwd: tmp, timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
				(failure, stdout, stderr) => resolve({ failure: failure ?? null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
		});
		if (installResult.failure !== null) {
			return {
				ok: false, dir: target.dir, entry: main, deep: true, depsInstalled: false,
				classification: 'environmental',
				classificationReason: `隔离目录 pnpm install 失败（exit=${installResult.failure.code ?? '?'}）。依赖在 npm 上不可得或存在安装脚本冲突——看 installTail。`,
				installTail: String(installResult.stderr).slice(-1500),
			};
		}
		const deepEntry = path.join(tmp, main);
		const result = await executeDryrunChild(home, { cwd: tmp, classifyDir: tmp, dirLabel: target.dir, entryRel: main, entryAbs: deepEntry });
		result.deep = true;
		result.depsInstalled = true;
		return result;
	} finally {
		try {
			fs.rmSync(tmp, { recursive: true, force: true });
		} catch {
			// 清理失败无害：留在系统临时目录，等 OS 回收
		}
	}
}

/**
 * `action: "dryrun"` —— 在子进程里真跑一次 `apply()`。
 *
 * @param {string} home
 * @param {any} args
 * @returns {Promise<any>}
 */
async function doDryrun(home, args) {
	const target = await resolveAuditTarget(home, args);
	if ('error' in target) return { ok: false, message: target.error };
	if (target.dir === null) {
		return { ok: false, message: 'dryrun 需要本地文件：先 action:"fetch" 解包，再用 dir 调用（registry 上的 manifest 不足以执行）' };
	}

	const main = readPackageMain(target.manifest);
	if (main === null) return { ok: false, message: 'package.json 没有 main / exports["."] 入口，无法执行' };

	let entry;
	try {
		entry = safeJoin(target.dir, main);
	} catch {
		return { ok: false, message: `入口路径越界: ${main}` };
	}
	if (!fs.existsSync(entry)) return { ok: false, message: `入口文件不存在: ${main}` };

	if (args?.deep === true) {
		return doDryrunDeep(home, target, main, entry);
	}
	return executeDryrunChild(home, { cwd: target.dir, classifyDir: target.dir, dirLabel: target.dir, entryRel: main, entryAbs: entry });
}

/**
 * 把 limit 夹到合法区间。
 * @param {unknown} value
 * @returns {number}
 */
function clampLimit(value) {
	const number = typeof value === 'number' ? Math.floor(value) : DEFAULT_LIMIT;
	if (!Number.isFinite(number)) return DEFAULT_LIMIT;
	return Math.min(Math.max(number, 1), MAX_LIMIT);
}

/** 渲染成给模型看的纯文本。 */
function renderText(value) {
	let text;
	try {
		text = JSON.stringify(value, null, 1);
	} catch {
		text = String(value);
	}
	return text.length > 16000 ? `${text.slice(0, 16000)}\n…(已截断)` : text;
}

/** 调用卡片的一句话描述。 */
function describeCall(args) {
	if (args?.action === 'fetch') return args?.name ? `取源码 ${args.name}` : '取插件源码';
	if (args?.action === 'audit') return args?.dir ? `体检 ${path.basename(args.dir)}` : args?.name ? `体检 ${args.name}` : '体检插件';
	if (args?.action === 'dryrun') return args?.dir ? `干跑 ${path.basename(args.dir)}` : args?.name ? `干跑 ${args.name}` : '干跑插件';
	if (args?.action === 'installed') return '看已装插件';
	if (args?.action === 'updates') return '检查插件更新';
	if (args?.action === 'coverage') return '任务覆盖检查';
	if (args?.action === 'memo') return '能力备忘';
	if (args?.action === 'pack') return args?.dir ? `打包 ${path.basename(args.dir)}` : '打包 tgz';
	if (args?.action === 'verify') return '装后体检';
	if (args?.action === 'selftest') return '内置回归自检';
	if (args?.action === 'plan') return '开工前报备';
	if (args?.action === 'rollback') return '回滚清理';
	const keyword = args?.featured === true ? '精选区' : '社区区';
	return args?.query ? `搜索插件：${args.query}（${keyword}）` : `浏览插件市场（${keyword}）`;
}

/**
 * 工具定义。
 *
 * ⚠️ 直接传对象字面量给 `ctx.tools.register()`，不 import `defineTool`：
 * `dsh-tools` 只校验形状（`name` / `description` / `parameters` / `output`），
 * 少一层运行时依赖就少一处版本漂移的可能。
 *
 * @param {string} home `$DSH_HOME`。
 */
function marketTool(home) {
	return {
		name: TOOL_NAME,
		description: DESCRIPTION,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				action: {
					type: 'string',
					enum: ['coverage', 'search', 'fetch', 'audit', 'dryrun', 'installed', 'updates', 'memo', 'pack', 'verify', 'selftest', 'plan', 'rollback'],
					description:
						'"coverage" = one-step coverage check (memorized availability + candidates + the installed list). Auto-hit only from key/aliases/pkg (identity fields); note/profile hits only produce suggestions. Returns availability, candidates, options, ambiguousWith, stats, toolVersion and needsSearch. "search" = market search over BOTH the npm keyword pool and the awesome-dsh-plugin catalog (from:"npm"|"catalog", relevance 0–1, maintenance signal); bilingual queries and a Chinese↔English hint expansion give cross-language recall; low-relevance pages retry with distinctive tokens (fallbackTokens); kind:"skill" keeps skill packs; passing task auto-saves candidates into memo. "fetch" = download and unpack a tarball (files, patch text, patchDisabled, repoMatchesName). "audit" = static pre-install checks (patch, entry ids, engines.dsh, native deps, register try/catch). "dryrun" = import the plugin in a child process with a fake ctx and call apply() once; failures are classified real vs environmental; deep:true installs declared deps first. "installed"/"updates" = read-only inventory and version check. "memo" = capability memo v3 (availability gates search; candidates never expire). "pack" = build a .tgz with the bundled pnpm (reports junkFiles). "verify" = post-install health check (deps, file:/link: drift, orphan packages, missing bundles, guardian); fix:true repairs specs and removes orphans. "plan" = record the pre-work briefing (what/how long/what needs confirmation) and return it. "rollback" = clean this tool\'s own leftovers (what:"hunt"|"memo"; uninstall stays with plugin_manager). "selftest" = built-in regression suite; network:true adds live registry/catalog/fetch cases.',
				},
				task: {
					type: 'string',
					description:
						'For action:"coverage" — the need in one line (e.g. "把这份 pptx 改成 12 页"). Used for scored retrieval, so a short natural phrase is fine; do not try to guess the exact key. For action:"search" — when given, the returned candidate list is automatically merged into the memo under this task key (tool-side bookkeeping, so a later coverage call finds them).',
				},
				intent: {
					type: 'string',
					description:
						'For action:"coverage" — explicit task-type key like "pptx:edit-existing"; when known it is the fastest, exact path. Omit it and pass task instead if unsure.',
				},
				query: {
					type: 'string',
					description:
						'For action:"search" — extra search terms on top of the keyword (e.g. "ppt", "memory", "terminal"). Omit to list the whole market. Prefer `queries` for bilingual recall. For action:"memo" — narrow the returned entries to those matching this substring (exact key > prefix > contains).',
				},
				queries: {
					type: 'array',
					description:
						'For action:"search" — up to 3 queries merged into one result set (deduped by package name, ranked by best relevance). Use BOTH languages for cross-language recall, e.g. ["B站 视频 转文字 字幕", "bilibili video transcript subtitles"]: npm keyword search and catalog matching are literal, so one language alone misses packages described only in the other. Catalog entries carry both zh and en descriptions (verified 3730/3730), so one language usually suffices on the catalog side, but npm-only packages may exist in either language. A Chinese query also auto-expands with English hints (做PPT → ppt/presentation), see `hints` in the result.',
				},
				kind: {
					type: 'string',
					enum: ['all', 'skill'],
					description:
						'For action:"search" — "skill" keeps only packages that describe themselves as skill packs (name/title/description mentions skill/技能/SKILL.md). In DSH skills are shipped by plugins, so "find a skill" == "find a plugin that carries one". "all" (default; legacy "plugin" is treated as all) does not filter.',
				},
				featured: {
					type: 'boolean',
					description:
						'For action:"search" — true narrows to the maintainer-reviewed featured section; default false is the community section.',
				},
				limit: {
					type: 'number',
					description: `For action:"search" — how many packages to return, 1–${MAX_LIMIT}; default ${DEFAULT_LIMIT}. Each hit costs one extra registry request.`,
				},
				name: {
					type: 'string',
					description:
						'Package name, optionally with a version: "dsh-zen-free" or "@scope/name@1.2.3". Used by "fetch" to download, and by "audit"/"dryrun" to locate an already-fetched copy (or just the registry manifest).',
				},
				dir: {
					type: 'string',
					description:
						'For action:"audit" / "dryrun" — absolute path to an unpacked package (the "dir" that action:"fetch" returned, or an installed plugin under the profile\'s node_modules). Takes precedence over name. For action:"pack" — the SOURCE directory to package (must contain package.json).',
				},
				dest: {
					type: 'string',
					description:
						'For action:"pack" — output directory for the .tgz. Defaults to the source directory.',
				},
				fix: {
					type: 'boolean',
					description:
						'For action:"verify" — true attempts a bounded repair of stale file:/link: specs: walks up from the missing target and looks for a uniquely-named replacement, then rewrites that dependency in the profile package.json (does NOT run pnpm; reinstall or run pnpm install afterwards).',
				},
				record: {
					type: 'array',
					description:
						'For action:"memo" — entries to merge into the capability memo: [{ key: "task type, e.g. pptx:edit-existing / delete-session", availability: "installed:<pkg>" | "builtin:<cap>" | "none", candidates: [{ pkg, version, fit, fitFor, checkedAt }], aliases: ["口语说法，如 幻灯片 / 演示文稿 / 改稿"], profile: { ...task fingerprint }, note: "one line", evidence: "kind label", ref: "supporting detail" }]. aliases are the cheap way to make an entry findable by how people actually phrase the task — write 2-6 of them. candidates/aliases/profile/note always merge; only a change to the availability PREFIX (installed ↔ builtin ↔ none) is refused as a conflict unless force:true. Omit to read without writing.',
				},
				forget: {
					type: 'array',
					description:
						'For action:"memo" — keys to soft-delete (hidden from reads; physically removed only by prune after a grace period).',
				},
				prune: {
					type: 'boolean',
					description:
						'For action:"memo" — true physically removes entries retired by forget for more than the grace period.',
				},
				full: {
					type: 'boolean',
					description:
						'For action:"memo" — true includes full note text and evidence per entry (default returns the index view with truncated notes).',
				},
				force: {
					type: 'boolean',
					description:
						'For action:"memo" — true overwrites an existing entry even when the new availability prefix differs (resolves a conflict).',
				},
				deep: {
					type: 'boolean',
					description:
						'For action:"dryrun" — true installs the plugin\'s declared dependencies with pnpm (--ignore-scripts) into a throwaway directory before importing apply(), so missing-dependency false negatives disappear. Slower (~seconds, needs network).',
				},
				what: {
					type: 'string',
					enum: ['hunt', 'memo', 'plugin'],
					description:
						'For action:"rollback" — "hunt" removes the fetched copy under $DSH_HOME/plugin-hunt/<name>-* (needs name); "memo" restores the previous market-memo.json snapshot (.bak, written automatically before each memo write); "plugin" refuses and returns the exact plugin_manager remove_bundle command instead (uninstalling is host-owned).',
				},
				steps: {
					type: 'array',
					description: 'For action:"plan" — the concrete steps you will take, in order (短句，3~6 条).',
				},
				etaMinutes: {
					type: 'number',
					description: 'For action:"plan" — estimated minutes for the whole task (让用户知道要等多久).',
				},
				needsConfirm: {
					type: 'array',
					description: 'For action:"plan" — things that need the user\'s explicit confirmation before you proceed (e.g. "要装 dsh-ffmpeg"). Empty array = nothing to confirm.',
				},
				network: {
					type: 'boolean',
					description:
						'For action:"selftest" — true also runs live network cases (registry keyword search, catalog snapshot, fetch+unpack of a tiny package, audit blocking a non-plugin). Default false keeps selftest fully offline.',
				},
			},
			required: ['action'],
		},
		// ⚠️ `render` 必须嵌在 `output` 里，不能放顶层（踩过：症状是插件装好了但
		// 工具从没出现，整个 entry 注册失败）。`schema` 也不能收窄：search / fetch /
		// audit / dryrun 的返回形状互不相同，写成固定形状会在渲染前炸 ToolOutputError。
		// 引擎侧只要求 object-rooted。
		output: {
			schema: {
				type: 'object',
				properties: {
					ok: { type: 'boolean' },
					message: { type: 'string' },
					dir: { type: 'string' },
					verdict: { type: 'string' },
					plugins: {},
					files: {},
					patchFiles: {},
					blockers: {},
					warnings: {},
					registeredTools: {},
					file: { type: 'string' },
					entries: { type: 'number' },
					memo: {},
					intent: { type: 'string' },
					needsSearch: { type: 'boolean' },
					recommendation: { type: 'string' },
					reason: { type: 'string' },
					memoHit: { type: 'boolean' },
					matchedBy: { type: 'string' },
					matchScore: { type: 'number' },
					suggestions: {},
					nearDuplicates: {},
					entry: {},
					installed: {},
					classification: { type: 'string' },
					classificationReason: { type: 'string' },
					conflicts: {},
					profiles: {},
					guardian: {},
					stale: { type: 'number' },
					due: { type: 'number' },
					overallOk: { type: 'boolean' },
					tgz: { type: 'string' },
					stats: {},
					options: {},
					orphans: { type: 'number' },
					patchDisabled: { type: 'boolean' },
					fallbackTokens: {},
					memoKey: { type: 'string' },
					cases: {},
					briefing: { type: 'string' },
					what: { type: 'string' },
					removed: {},
					restored: { type: 'number' },
					missingBundles: { type: 'number' },
					toolVersion: { type: 'string' },
					command: { type: 'string' },
				},
				required: ['ok'],
			},
			render: (_args, value) => [{ type: 'text', text: renderText(value) }],
		},
		presentCall: (args) => ({
			card: 'generic',
			title:
				args?.action === 'fetch'
					? '取插件源码'
					: args?.action === 'audit'
						? '审计插件'
						: args?.action === 'dryrun'
							? '干跑插件'
							: args?.action === 'installed'
								? '已装插件'
								: args?.action === 'updates'
									? '插件更新'
									: args?.action === 'memo'
										? '能力备忘'
										: args?.action === 'pack'
											? '打包 tgz'
											: args?.action === 'verify'
												? '装后体检'
												: args?.action === 'selftest'
													? '内置回归自检'
													: args?.action === 'plan'
														? '开工前报备'
														: args?.action === 'rollback'
															? '回滚清理'
															: args?.action === 'coverage' ? '任务覆盖检查' : '搜索插件市场',
			description: describeCall(args),
		}),
		async execute(args) {
			const action = args?.action;
			if (action === 'search') return doSearch(home, args);
			if (action === 'fetch') return doFetch(home, args);
			if (action === 'audit') return doAudit(home, args);
			if (action === 'dryrun') return doDryrun(home, args);
			if (action === 'coverage') return doCoverage(home, args);
			if (action === 'installed') return doInstalled(home);
			if (action === 'updates') return doUpdates(home);
			if (action === 'memo') return doMemo(home, args);
			if (action === 'pack') return doPack(home, args);
			if (action === 'verify') return doVerify(home, args);
			if (action === 'selftest') return doSelftest(args);
			if (action === 'plan') return doPlan(home, args);
			if (action === 'rollback') return doRollback(home, args);
			return { ok: false, message: `未知 action: ${String(action)}（可选 coverage / search / fetch / audit / dryrun / installed / updates / memo / pack / verify）` };
		},
	};
}

/**
 * 解析 DeepSeek Harness home。
 *
 * 优先级与官方 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()` **一致**：
 * `$DSH_HOME` > `~/.dsh`。这里不 import 那个包，照抄它的语义自己写两行 ——
 * 本机这批 `file://` 挂载的宿主插件（`logs-tool` / `bubble-tool` / …）全都是
 * 零外部依赖、只用 `node:` 内置模块，跟它们保持一致比多一条解析路径更稳。
 *
 * ⚠️ **必须带 `~/.dsh` 兜底**：Android 客户端会给引擎注入 `DSH_HOME`，但 PC 端
 * `dsh` CLI 通常**不设**这个变量，靠默认 home（`~/.dsh`）。只读环境变量的话，
 * 同一份插件在 PC 上会直接“工具未注册”，看起来像插件坏了。
 *
 * @returns {string | undefined} 绝对路径；`~/.dsh` 也拿不到时返回 undefined。
 */
function resolveHome() {
	const configured = process.env.DSH_HOME;
	if (typeof configured === 'string' && configured.trim() !== '') {
		return path.resolve(configured.trim());
	}
	try {
		return path.join(os.homedir(), '.dsh');
	} catch {
		return undefined;
	}
}

/**
 * 解析 SKILL.md：`---` frontmatter + 正文。
 *
 * 语义与 `@deepseek-ai/dsh-skill-filesystem` 的 parseSkillFile 对齐（content =
 * 去掉 frontmatter 后 trim 的正文），但**不引 YAML 依赖** —— 本包的卖点就是零
 * external，为了一个 frontmatter 拉一个解析器不值。代价是只支持单行标量，所以
 * 随包技能的 description 必须写成一行。
 *
 * @param {string} raw
 * @returns {{name: string, description: string, whenToUse?: string, content: string} | null}
 */
function parseSkillFile(raw) {
	if (typeof raw !== 'string') return null;
	const text = raw.replace(/^\uFEFF/, '');
	if (!text.startsWith('---')) return null;
	const close = text.indexOf('\n---', 3);
	if (close < 0) return null;

	const data = {};
	for (const line of text.slice(3, close).split(/\r?\n/)) {
		const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line.trim());
		if (!match) continue;
		if (data[match[1]] !== undefined) continue;
		data[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
	}
	if (typeof data.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name)) return null;
	if (typeof data.description !== 'string' || data.description === '') return null;

	const afterClose = text.indexOf('\n', close + 1);
	const content = afterClose < 0 ? '' : text.slice(afterClose + 1).trim();
	return {
		name: data.name,
		description: data.description,
		...(typeof data.whenToUse === 'string' && data.whenToUse !== '' ? { whenToUse: data.whenToUse } : {}),
		content,
	};
}

/**
 * 注册随包技能。
 *
 * 走 `ctx.get('skills')` 而不是声明成必需注入：技能是**纯增益**，skills 服务
 * 缺席时工具必须照常可用（Android 极简装配、web 端都可能没有）。所以这里单独
 * 一个 try/catch，失败只 warn，绝不影响工具注册。
 *
 * @param {any} ctx
 */
function registerSkill(ctx) {
	try {
		const skills = typeof ctx?.get === 'function' ? ctx.get('skills') : undefined;
		if (!skills || typeof skills.register !== 'function') return;

		const dir = path.join(PACKAGE_ROOT, 'skills', SKILL_NAME);
		const file = path.join(dir, 'SKILL.md');
		if (!fs.existsSync(file)) {
			ctx?.logger?.warn?.(`[linc-dsh-market-scout] 找不到随包技能 ${file}，技能未注册（工具不受影响）`);
			return;
		}
		const parsed = parseSkillFile(fs.readFileSync(file, 'utf8'));
		if (parsed === null) {
			ctx?.logger?.warn?.('[linc-dsh-market-scout] SKILL.md frontmatter 不合法，技能未注册（工具不受影响）');
			return;
		}

		const register = () =>
			skills.register({
				name: parsed.name,
				description: parsed.description,
				...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
				metadata: { plugin: 'linc-dsh-market-scout', delivery: 'embedded' },
				// 资源基址：技能正文里的相对引用可据此定位
				resourceBase: { kind: 'directory', path: dir },
				source: 'runtime',
				content: parsed.content,
			});

		// 挂在自己的 fiber 上：停用/卸载即自动注销，不会在技能注册表里留残影
		if (typeof ctx.effect === 'function') ctx.effect(register, `linc-dsh-market-scout: embedded skill (${parsed.name})`);
		else register();

		ctx?.logger?.info?.(`[linc-dsh-market-scout] 已注册随包技能 ${parsed.name}`);
	} catch (error) {
		ctx?.logger?.warn?.(`[linc-dsh-market-scout] 技能注册失败，工具照常可用: ${error?.message ?? error}`);
	}
}

/**
 * 注册工具。
 *
 * ⚠️ register 必须包 try/catch：异常从 apply 冒出去会被 cordis 判定该插件
 * `failed`，进而 `dsh: startup failed`，**整个引擎退出、App 打不开**。
 * 降级方向是「只有这个工具不存在」，但绝不能静默 —— 用 warn 把原始错误打出来。
 *
 * @param {any} ctx cordis 上下文。
 */
export function apply(ctx) {
	const home = resolveHome();
	if (typeof home !== 'string' || home === '') {
		ctx?.logger?.warn?.('[linc-dsh-market-scout] 无法解析 DSH home（DSH_HOME 与 ~/.dsh 都不可用），plugin_market_scout 工具未注册');
		return;
	}
	if (!fs.existsSync(home)) {
		ctx?.logger?.warn?.(`[linc-dsh-market-scout] DSH home 不存在（${home}），plugin_market_scout 工具未注册`);
		return;
	}

	try {
		ctx.tools.register(marketTool(home));
		ctx?.logger?.info?.(`[linc-dsh-market-scout] 已注册 ${TOOL_NAME} 工具，解包落点 ${path.join(home, HUNT_DIR)}`);
	} catch (error) {
		ctx?.logger?.warn?.(
			`[linc-dsh-market-scout] 注册 ${TOOL_NAME} 工具失败，本插件不激活（引擎继续启动）: ${error?.message ?? error}`,
		);
	}

	registerSkill(ctx);
}
