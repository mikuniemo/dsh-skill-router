# 中文说明

**把 DeepSeek Harness 的技能目录从 O(全部技能) 降到 ~600 token 的常驻路由器。**

DSH 会把每个技能的 `name` + `description` 塞进**每一次请求**的 `<available_skills>`。
实测 1,246 个技能的真实库：**~70,800 token**——200K 上下文先吃掉 35%，128K 直接爆。

本工具把技能移出扫描根，只留一个 `skill-router`，其余按类别生成索引文件，模型用 `read` 按需加载：

| | 常驻 token |
|---|---:|
| 改造前 | ~70,800 |
| 改造后 | **~600** |

按需代价：一个索引 1–4K token，用哪类读哪类。

零依赖，Node ≥ 20，Windows / Linux / macOS 通用。设计与踩坑详见
[方法论文档](docs/METHODOLOGY.md)（中文）。

## 快速开始

```bash
git clone https://github.com/mikuniemo/dsh-skill-luyou.git
cd dsh-skill-luyou

# 看真相：5 个扫描根、目录开销、被 DSH 静默跳过的技能
node bin/dsh-skill-luyou.mjs scan

# 预览（不写任何文件）
node bin/dsh-skill-luyou.mjs plan --source "D:\我的技能库" --locale zh

# 执行：建链接 + 生成路由器与索引
node bin/dsh-skill-luyou.mjs apply --source "D:\我的技能库" --locale zh

# 校验每条索引路径有效
node bin/dsh-skill-luyou.mjs verify

# 回滚（源库永不触碰）
node bin/dsh-skill-luyou.mjs restore
```

## 目录布局

```
~/.dsh/skills/            ← DSH 扫描这里。只放 skill-router。
~/.dsh/skill-index/       ← 不被扫描。普通 markdown 索引。
~/.dsh/skills-off/        ← 真实技能的 junction/symlink，指向你的源库。
```

## 五条设计原则（每条都来自真实翻车）

1. **链接，不移动** —— 移动会让索引路径失效（FM-1，实测复现）
2. **枚举全部 5 个扫描根** —— 只管 `~/.dsh/skills` 会漏掉 4 个
3. **精确镜像一层发现规则** —— 连 BOM / 注释横幅导致的静默失效也要报出来
4. **分类必须过预算关** —— 朴素分类会把 489 个技能塞进一个 25K token 的桶
5. **token 计算要建模 DSH 的渲染**（500 字符上限）与 **CJK 计价**（一字一 token）

完整推理与移植清单见 [docs/METHODOLOGY.md](docs/METHODOLOGY.md)。

## 测试

```bash
npm test    # 24 条端到端断言（沙箱，不碰用户目录）
```

## 许可证

MIT
