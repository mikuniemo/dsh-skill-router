# 更新日志

## 1.1.0 — 2026-11-02

补上闭环的另一半：**查询期路由**。`scan`/`plan`/`apply` 建索引，`route` 回答"这一句话该先读哪份索引"。

- `route` 新命令 —— 给一句任务，输出 PRIMARY 分类索引、该读的编排中心（hub），
  以及全部命中的规则（按 priority 序）。`--json` 输出稳定契约供 agent 消费。
- `src/route.mjs` —— 纯函数路由引擎，零依赖、不读盘、**不含任何内置规则或数据**：
  - `routeQuery(query, routing)`：`must`/`mustAll` 组内 AND、`keywords` 组间 OR、`exclude` 否决本组；
    全不命中返回 `fallback: true`，不做"最像的一条"猜测。
  - `validateRouting(routing)`：规则结构、正则可编译性、priority 引用、hub 引用、空 categories。
  - `resolveHubPath(relPath, roots)`：**三种 hub 布局**依次解析——拍平 `<root>/<hub>/` →
    旧 `<root>/_hubs/<hub>/` → 原样相对路径。库被重新整合后（hub 从 `_hubs/` 拍平成顶层目录）
    这是唯一不哑火的解析方式。
- `route --validate` —— 只校验规则文件，ERROR 退出码 1、只有 warning 退 0。
- `docs/ROUTING.md` —— 路由文件 schema v1 完整定义、匹配算法权威描述、五种写法坑
  （中英混写正则、裸词误伤、恒假子句、平局不定、hub 断链）。
- 测试从 24 条增到 **36 条**：新增 12 条覆盖 must/mustAll/exclude 语义、priority 裁决、
  fallback 行为、三种 hub 布局、非法正则退出码、校验器计数。

规则文件由使用者维护；本仓库不附带任何分类表、技能清单或路由规则。

## 1.0.0 — 2026-10-14

首次发布。

- `scan` —— 枚举 DSH 的全部五个技能扫描根，测量常驻目录开销（建模 500 字符
  description 截断上限与 CJK 计价），并列出被 DSH 静默跳过的技能
  （BOM / 注释横幅 / 缺 `name`）。
- `plan` —— 预算驱动的分类预览：override 映射 → `metadata.category` →
  `subdomain` → 名字前缀 → `other`；超预算的桶自动拆分（先按最具区分度 token，
  最多 2 层均衡拆分，再按字母分箱——必然收敛）；过小的桶折进 `other`；
  重名桶自动去重。
- `apply` —— 幂等的 junction（Windows）/ symlink（POSIX）挂载到扫描根之外，
  生成路由器 + 分类索引 + skill-manager + manifest。从不移动源文件；
  索引路径记录的是链接目标。
- `verify` —— 任何索引路径失效即退出码 1；扫描根回涨（重新塞入技能）也会报。
- `restore` —— 只移除本工具创建的链接与文件（按标记判定）；源库永不触碰。
- 24 条断言的端到端沙箱测试（`npm test`）。
- 方法论文档：docs/METHODOLOGY.md（含移植到其他 harness 的清单）。
