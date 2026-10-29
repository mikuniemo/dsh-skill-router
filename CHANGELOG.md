# 更新日志

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
