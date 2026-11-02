import fs from 'node:fs';

/**
 * route.mjs — 任务 → 索引 的**查询期路由**。
 *
 * `plan` / `apply` 解决"怎么把技能目录切成索引"，本模块解决另一半：
 * **一句话任务该先读哪个索引、哪个编排中心**。两者是同一个闭环的前后段：
 *
 *     scan/plan/apply  →  磁盘上有一堆 <category>.md
 *     route            →  给定任务，选出 PRIMARY 那一份去 read
 *
 * 设计约束（刻意保持）：
 *   - 纯函数：路由数据由调用方传入，本模块不读盘、不猜路径、不含任何内置规则或数据。
 *   - 无依赖：只用 JS 内建 RegExp。
 *   - 可回归：同样的 query + routing 必须永远给出同样的 primary。
 *
 * 路由文件 schema（v1）见 docs/ROUTING.md，形状：
 *
 *   {
 *     "schemaVersion": 1,
 *     "routes": {
 *       "<ruleId>": {
 *         "label": "人类可读的名字",
 *         "categories": ["<category>", ...],
 *         "hubs": ["<hub-name>", ...],
 *         "keywords": [
 *           { "must": "<regex>", "mustAll": ["<regex>"], "exclude": "<regex>", "note": "..." }
 *         ]
 *       }
 *     },
 *     "priority": ["<ruleId>", ...],
 *     "hubs": { "<hub-name>": { "path": "<库内相对路径>", "purpose": "..." } }
 *   }
 */

/**
 * @typedef {Object} KeywordClause 一条匹配子句。组内三条件是 AND，组间是 OR。
 * @property {string} [must]       必须命中的正则
 * @property {string[]} [mustAll]  全部都要命中的正则数组
 * @property {string} [exclude]    命中即否决该子句的正则
 * @property {string} [note]       为什么这么写（给人看的，不参与匹配）
 *
 * @typedef {Object} RouteRule
 * @property {string} [label]
 * @property {string[]} [categories]
 * @property {string[]} [hubs]
 * @property {KeywordClause[]} [keywords]
 *
 * @typedef {Object} Routing
 * @property {number} [schemaVersion]
 * @property {Record<string, RouteRule>} routes
 * @property {string[]} [priority]
 * @property {Record<string, {path: string, purpose?: string}>} [hubs]
 */

/** 路由文件缺省回退分类。 */
export const FALLBACK_CATEGORY = 'other';

/**
 * 把 routing 归一化成规则对象数组（按 priority 排序，未列出的排在后面、按 id 自然序）。
 * @param {Routing} routing
 * @returns {Array<{id: string, rule: RouteRule}>}
 */
export function orderedRules(routing) {
  const routes = routing?.routes ?? {};
  const ids = Object.keys(routes);
  const prio = Array.isArray(routing?.priority) ? routing.priority.filter((id) => id in routes) : [];
  const listed = new Set(prio);
  const rest = ids
    .filter((id) => !listed.has(id))
    .sort((a, b) => {
      const na = Number(String(a).replace(/\D/g, ''));
      const nb = Number(String(b).replace(/\D/g, ''));
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });
  return [...prio, ...rest].map((id) => ({ id, rule: routes[id] }));
}

/**
 * 判定单条子句是否命中。组内 AND：must ∧ mustAll ∧ ¬exclude。
 * @param {KeywordClause} clause
 * @param {string} query
 * @returns {boolean}
 */
export function clauseMatches(clause, query) {
  if (!clause || typeof clause !== 'object') return false;
  if (clause.must) {
    if (!compile(clause.must).test(query)) return false;
  } else if (!Array.isArray(clause.mustAll) || clause.mustAll.length === 0) {
    return false; // 既无 must 也无 mustAll 的子句不具判定力
  }
  if (Array.isArray(clause.mustAll)) {
    for (const p of clause.mustAll) {
      if (!compile(p).test(query)) return false;
    }
  }
  if (clause.exclude && compile(clause.exclude).test(query)) return false;
  return true;
}

const cache = new Map();
/** 正则编译缓存；大小写不敏感，与 CLI 的匹配语义一致。 */
function compile(source) {
  const key = String(source);
  let re = cache.get(key);
  if (!re) {
    re = new RegExp(key, 'iu');
    cache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

/**
 * 规则是否命中（组间 OR）。
 * @param {RouteRule} rule
 * @param {string} query
 */
export function ruleMatches(rule, query) {
  const clauses = Array.isArray(rule?.keywords) ? rule.keywords : [];
  for (const c of clauses) {
    if (clauseMatches(c, query)) return true;
  }
  return false;
}

/**
 * 路由一条 query。
 *
 * @param {string} query
 * @param {Routing} routing
 * @param {{includeSecondary?: boolean}} [opts]
 * @returns {{
 *   query: string,
 *   primary: null | {id: string, label: string, categories: string[], hubs: string[]},
 *   matches: Array<{id: string, label: string, categories: string[], hubs: string[]}>,
 *   fallback: boolean
 * }}
 */
export function routeQuery(query, routing, opts = {}) {
  const q = String(query ?? '').trim();
  const ordered = orderedRules(routing);
  const matched = [];
  for (const { id, rule } of ordered) {
    if (!ruleMatches(rule, q)) continue;
    matched.push({
      id,
      label: rule.label ?? id,
      categories: Array.isArray(rule.categories) ? [...rule.categories] : [],
      hubs: Array.isArray(rule.hubs) ? [...rule.hubs] : [],
    });
  }
  const primary = matched[0] ?? null;
  return {
    query: q,
    primary: primary ? { ...primary } : null,
    matches: opts.includeSecondary === false ? (primary ? [primary] : []) : matched,
    fallback: !primary,
  };
}

/**
 * 校验 routing 的结构与正则可编译性。返回错误清单（空数组 = 通过）。
 * @param {Routing} routing
 * @returns {{errors: string[], warnings: string[], ruleCount: number, hubCount: number}}
 */
export function validateRouting(routing) {
  const errors = [];
  const warnings = [];
  const routes = routing?.routes;
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) {
    return { errors: ['routes 缺失或不是对象'], warnings, ruleCount: 0, hubCount: 0 };
  }
  const ids = Object.keys(routes);
  if (!ids.length) errors.push('routes 为空');

  const prio = routing?.priority;
  if (prio != null && !Array.isArray(prio)) errors.push('priority 必须是数组');
  for (const id of Array.isArray(prio) ? prio : []) {
    if (!(id in routes)) warnings.push(`priority 里的 ${id} 不在 routes 中`);
  }

  for (const id of ids) {
    const r = routes[id] ?? {};
    if (!Array.isArray(r.keywords) || r.keywords.length === 0) {
      warnings.push(`${id}: 没有 keywords，永不命中`);
      continue;
    }
    if (!Array.isArray(r.categories) || r.categories.length === 0) {
      warnings.push(`${id}: 没有 categories，命中后无处可读`);
    }
    if (r.hubs != null && !Array.isArray(r.hubs)) errors.push(`${id}: hubs 必须是数组`);
    for (const [i, c] of r.keywords.entries()) {
      for (const field of ['must', 'exclude']) {
        if (c?.[field] == null) continue;
        if (typeof c[field] !== 'string') { errors.push(`${id}.keywords[${i}].${field} 必须是字符串`); continue; }
        try { new RegExp(c[field]); } catch (e) { errors.push(`${id}.keywords[${i}].${field} 正则不合法：${e.message}`); }
      }
      for (const [j, p] of (Array.isArray(c?.mustAll) ? c.mustAll : []).entries()) {
        try { new RegExp(p); } catch (e) { errors.push(`${id}.keywords[${i}].mustAll[${j}] 正则不合法：${e.message}`); }
      }
      if (!c?.must && !(Array.isArray(c?.mustAll) && c.mustAll.length)) {
        warnings.push(`${id}.keywords[${i}]: 既无 must 也无 mustAll，该子句恒假`);
      }
    }
  }

  const hubs = routing?.hubs ?? {};
  for (const [name, h] of Object.entries(hubs)) {
    if (!h || typeof h.path !== 'string' || !h.path) errors.push(`hubs.${name}.path 缺失`);
  }
  for (const id of ids) {
    for (const h of Array.isArray(routes[id]?.hubs) ? routes[id].hubs : []) {
      if (!(h in hubs)) warnings.push(`${id}: 引用了未定义的 hub "${h}"`);
    }
  }
  return { errors, warnings, ruleCount: ids.length, hubCount: Object.keys(hubs).length };
}

/**
 * 把 hub 记录的相对路径解析成磁盘上真实存在的文件，兼容三种布局（库被重构过也照样能用）：
 *
 *   1. `<root>/<hub>/<file>`       拍平布局（hub 作为顶层技能）
 *   2. `<root>/<_hubs/<hub>/<file>>` 旧布局（hub 收在元数据目录下）
 *   3. `<root>/<原样相对路径>`
 *
 * `roots` 会被依次尝试，因此可以传 `[<技能库>, <仓库自带 hub 目录>]` 做多级回退。
 *
 * @param {string} relPath routing.json 里的 "path"（正/反斜杠均可）
 * @param {string[]} roots 依次尝试的根目录
 * @param {(p: string) => boolean} [exists] 便于测试注入
 * @returns {{path: string, layout: 'flat'|'meta'|'as-is'} | null}
 */
export function resolveHubPath(relPath, roots, exists) {
  const has = exists ?? ((p) => {
    try { return fsStatIsFile(p); } catch { return false; }
  });
  const norm = String(relPath ?? '').replace(/[\\/]+/g, '/').replace(/^\/+/, '');
  if (!norm) return null;
  const seg = norm.split('/');
  const file = seg[seg.length - 1];
  const hub = seg.length >= 2 ? seg[seg.length - 2] : null;
  for (const root of roots ?? []) {
    if (!root) continue;
    const candidates = [];
    if (hub) candidates.push({ p: joinish(root, hub, file), layout: 'flat' });
    if (norm.includes('_hubs')) candidates.push({ p: joinish(root, ...seg), layout: 'meta' });
    else if (seg.length >= 2) candidates.push({ p: joinish(root, '_hubs', ...seg), layout: 'meta' });
    candidates.push({ p: joinish(root, ...seg), layout: 'as-is' });
    for (const c of candidates) {
      if (has(c.p)) return { path: c.p, layout: c.layout };
    }
  }
  return null;
}

// 让本模块在没有 node:fs 注入时也能工作（测试可传 exists 覆盖）
function fsStatIsFile(p) { return fs.statSync(p).isFile(); }
function joinish(...parts) {
  return parts
    .filter((s) => s != null && s !== '')
    .join('/')
    .replace(/\/{2,}/g, '/');
}