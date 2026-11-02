# dsh-skill-router

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)
![runtime](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![dependencies](https://img.shields.io/badge/dependencies-0-success)
![license](https://img.shields.io/github/license/mikuniemo/dsh-skill-router)

[English](README.en.md)

**把 DeepSeek Harness 的技能目录从 O(全部技能) 降到一个 ~600 token 的常驻路由器。**

DSH 会把每个技能的 `name` + `description` 注入**每一次请求**的 `<available_skills>`。
没有真实技能库时你察觉不到它——一旦有了，就是致命的：

| 常驻技能数 | 每请求的目录开销 |
|---:|---:|
| 50 | ~5,000 tok |
| 1,246（实测，真实库） | **~70,800 tok** |

在 200K 上下文里，**第一条消息还没发就没了 35%**；128K 则开局即超预算。
目录是被缓存的，所以这不是*计费*问题——是*上下文*问题。

本工具把技能移出扫描根，只留一个 `skill-router` 技能，其余按类别生成索引文件，
模型在需要时用 `read` 按需加载：

| | 常驻 token |
|---|---:|
| 改造前 | ~70,800（实测） |
| 改造后 | **~600** |

按需代价：一个索引文件 1–4K token，只在需要那个类别时才读。

零依赖。Node ≥ 20（与 DSH 自身要求相同）。Windows / Linux / macOS 通用。

## 为什么不用 `disable-model-invocation`？

因为它不是你要的东西。按 DSH 文档，它会把技能从模型可见目录**和加载器**里同时移除——
隐藏即不可加载。而把技能移出扫描根，既保留了 `read` 的可加载性，又消掉了目录开销。

## 安装

不需要安装——就是一个零依赖的 Node 脚本：

```bash
git clone https://github.com/mikuniemo/dsh-skill-router.git
cd dsh-skill-router
node bin/dsh-skill-router.mjs --help
```

或者直接从任意位置运行：

```bash
npx github:mikuniemo/dsh-skill-router --help
```

## 快速开始

```bash
# 1. 看真相：DSH 扫描的每个根、目录开销、
#    以及被 DSH 静默跳过的技能（frontmatter 有问题）。
dsh-skill-router scan

# 2. 预览计划。不写任何文件。
dsh-skill-router plan --source "D:\my-skills" --locale zh

# 3. 执行：把技能链接到扫描根之外，写入路由器 + 索引。
dsh-skill-router apply --source "D:\my-skills" --locale zh

# 4. 证明每条索引路径都解析得到。
dsh-skill-router verify

# 5. 全部撤销。源库永不触碰。
dsh-skill-router restore
```

### 多库示例（作者自己的配置）

```bash
dsh-skill-router apply \
  --source "D:\daily\skill_merged\skills" \
  --source "D:\resource\Anthropic-Cybersecurity-Skills\skills" \
  --exclude-file excluded.json \
  --overrides category-map.json \
  --locale zh
```

`--source` 可以重复给。任何"直接子目录是技能包"（`<name>/SKILL.md` 或 `<name>.md`）
的目录都可以当源库。

## 工作原理

```
~/.dsh/skills/            ← 扫描根。这里只有 skill-router 一个。
  └── skill-router/SKILL.md     （~600 token：就是下面那张表）

~/.dsh/skill-index/       ← DSH 不扫描这里。普通 markdown。
  ├── ctf.md                    "- **ctf-crypto** — …\n  `D:\…\ctf-crypto\SKILL.md`"
  ├── malware-analysis.md
  └── skill-manager.md          （元技能：怎么加/删/找技能）

~/.dsh/skills-off/        ← 真实技能，每个技能一个 junction/symlink，
  ├── ctf-crypto  ──────────→  D:\daily\skill_merged\skills\ctf-crypto
  └── …                            （源库原地不动）
```

模型加载技能要走三跳：读路由器 → 读一个索引 → 读一个 SKILL.md。

## 五个设计决策（以及背后的证据）

这些全部是在真实技能库上摔出来的。它们是这个工具存在、而不是一份 20 行 PowerShell
脚本的理由。

### 1. 链接放进扫描根之外，绝不放进扫描根

天真的流程——"把真实目录放进 `~/.dsh/skills`，再用 `-DisableSkills` 挪走"——
**会产出死索引路径**。索引记录的是 `<skillsRoot>/<name>/SKILL.md`；下一步就把那个
目录挪走了；路由器于是宣传一批并不存在的技能。（已复现并报告上游。）

本工具从不移动任何东西。它创建**指向你源库的 junction（Windows）/ symlink（POSIX）**，
索引记录的是*目标*路径——目标永不移动。删链接不碰目标。`~/.dsh` 可以整个删掉重装，
一个技能都不丢。

### 2. 一个扫描根永远不够

DSH 扫描**五个**根（rank 100 项目 dsh → 500 用户 agents）。只管理
`~/.dsh/skills`（rank 400）的工具会静默漏掉 100/200/300/500——任何一个还常驻在
那些根里的技能都还在烧 token。`scan` 会把五个根全部列出来，包括从你 profile 的
`cordis.patch.yml` 解析出的 `customSkillDirs`。

### 3. 发现规则只有一层——精确镜像它

DSH 认 `<root>/<name>/SKILL.md` 和 `<root>/<name>.md`；嵌套的 `**/SKILL.md`
**故意不发现**。本工具原样镜像这个规则，所以它数出来的就是 DSH 数出来的——
不会出现"嵌套技能怎么没出现"的意外。

它还处理两种会让技能对 DSH **静默不可见**的现实情况（provider 只留一行日志就
跳过整个技能）：

- 开头 `---` 前有 UTF-8 **BOM**
- frontmatter 前有 `/* ... */` **注释横幅**（作者库里 14 个技能就是这样死的）

`scan` 会列出每个这样的技能，并告诉你两行的修法。

### 4. 分类器的上限是它的预算

最朴素的分类器——`subdomain` 优先，否则名字前缀，否则 `other`——在真实库上把
**1,548 个技能里的 489 个**塞进同一个桶，产出一个 ~25,100 token 的索引文件。
路由器的开销会追平它要替代的目录本身。

所以这里的分类是**预算驱动**，不是分类学驱动：

- 信号优先级：`--overrides` 映射 → `metadata.category` → `subdomain` → 名字前缀 → `other`
- 任何超过 `--max-tokens`（默认 4000）的桶会被**拆分**——先按技能名里最具区分度的
  token 拆（最多 2 层），拆不动就无条件按字母分箱，按实测 token 装箱、必然收敛
- 太小的桶折进 `other`，路由器表格保持小
- 重名的桶自动去重（`-2`、`-3`…），拆分出的两半永远不会互相覆盖索引文件

在作者库上实测：60 个桶，**0 个超预算**，最大正好 4000 token。

### 5. Token 数学必须诚实

本工具拒绝犯的两个错误：

- **按原始 description 计数。** DSH 对每条 description 有
  `catalogDescriptionMaxLength`（默认 500）截断。不建模这个上限会高估约 3%
  （实测 595,650 vs 578,548 字符）。我们建模了这个上限。
- **拿 ~4 chars/token 套一切。** 对英文没问题，对 CJK 错得离谱——一个汉字常常
  就是一个 token。这里的 token 估算区分文字体系（script-aware）。

## 命令

| 命令 | 干什么 | 写文件？ |
|---|---|---|
| `scan` | 五个根全部枚举、常驻目录开销、被静默跳过的技能 | 否 |
| `plan` | 分类结果、索引大小、链接动作的预览 | 否 |
| `apply` | 建链接，写路由器 + 索引 + manifest | 是（支持 `--dry-run`） |
| `verify` | 任何索引路径失效即失败（退出码 1）；目录回涨也会报 | 否 |
| `restore` | 只移除本工具建的链接和生成文件 | 源库不动 |
| `route` | **查询期路由**：给一句任务，输出该先读哪份索引、哪个编排中心 | 否 |

常用参数：`--source`（可重复）· `--exclude <name|prefix*>` · `--exclude-file <json>`
· `--overrides <json>` · `--max-tokens <n>` · `--locale <zh|en>` · `--profile <name>`
· `--dsh-home <dir>` · `--dry-run` · `--json`
· `route` 专用：`--routing <file>` · `--hub-root <dir>` · `--validate`

## `route`：让"该读哪份索引"也可查询

`scan`/`plan`/`apply` 解决的是**建索引**；真正干活时还有另一半问题：
手上这一句话，该先 `read` 哪一份索引？把 1,500 个技能名背给模型不如给它一个确定答案。

```bash
# 规则文件是你自己的（schema 见 docs/ROUTING.md），工具不带任何内置规则
dsh-skill-router route "帮我分析这个 APK 的签名校验" \
  --routing ~/.dsh/capabilities/routing.json --source ~/skills

#   query    : 帮我分析这个 APK 的签名校验
#   PRIMARY  : R1  APK / Android reverse
#     read   : ~/.dsh/skill-index/reverse-engineering.md
#     read   : ~/.dsh/skill-index/mobile-security.md
#     hub    : reverse-hub -> ~/skills/reverse-hub/SKILL.md  [flat layout]
#   (considered 57 rules; 1 matched)

dsh-skill-router route --validate --routing ~/.dsh/capabilities/routing.json   # 只验规则文件
dsh-skill-router route "..." --routing <f> --json                              # 给 agent 消费
```

三条语义值得记住：

- **`must` / `mustAll` 是 AND，多条 `keywords` 之间是 OR**；`exclude` 命中即否决该条。
- **一个都不命中就返回 `fallback: true`**，不猜、"最像的那条"也不给——路由猜错的代价比不路由高。
- **hub 路径三处布局依次尝试**（拍平 `<lib>/<hub>/` → 旧 `<lib>/_hubs/<hub>/` → 原样相对路径），
  库被重新整合过之后这条最容易断，`route` 会明确告诉你哪一层命中了、或者为什么没命中。

## 在另一台机器上部署

```bash
git clone https://github.com/mikuniemo/dsh-skill-router.git
cd dsh-skill-router
node bin/dsh-skill-router.mjs scan              # 看看有什么
node bin/dsh-skill-router.mjs plan --source <你的技能库> --locale zh
node bin/dsh-skill-router.mjs apply --source <你的技能库> --locale zh
node bin/dsh-skill-router.mjs verify
# 保险起见重启 DSH（一般 watcher 会热加载）
```

回滚：`restore`（或者干脆删掉 `skills/skill-router`、`skill-index/`、`skills-off/`）。

## 兼容性与限制

- DSH `0.2.x`，Windows/Linux/macOS（frontmatter 规则对照应用内置的
  `@deepseek-ai/dsh-skill-filesystem` 文档逐条验证）。
- **依赖模型真的去读路由器。** 弱模型可能无视指令；路由器文本已经把规则写得很
  显式，但这就是取舍。
- 比原生 `skill` 工具多一次 `read` 跳数。这是 ~70K token 换来的代价。
- 插件自带的技能（如 `dsh-plugin-ctf` 配 `includeDefaultRoots: false`）按设计
  就是隔离的，不在覆盖范围。
- 源库变化后索引不会自动更新；重跑 `apply`（幂等、增量）。

## 方法论

完整推导见 [docs/METHODOLOGY.md](docs/METHODOLOGY.md)：失败模式、测量数据、
每个设计决策背后的推理——目标是让你能从第一性原理重新推导出这个工具
（或移植到别的 harness）。

## 测试

```bash
npm test        # 24 条端到端断言，跑在一次性沙箱里
```

## 许可证

MIT
