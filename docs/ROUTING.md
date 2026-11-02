# 路由文件 schema v1

`route` 读的那份 JSON 由**你自己维护**。本仓库不带任何内置规则、分类表或技能清单——
它是工具，不是数据集。

```
技能库（磁盘）
   │  plan / apply          ← 建索引
   ▼
skill-index/<category>.md
   │  route                 ← 本文件描述的那一半
   ▼
PRIMARY 分类索引 + 编排中心（hub）
```

## 完整形状

```jsonc
{
  "schemaVersion": 1,

  // 规则表。key 是规则 id（任意字符串，建议 R1..Rn）。
  "routes": {
    "R1": {
      "label": "APK / Android reverse",        // 给人读的名字，缺省用 id
      "categories": ["reverse-engineering",     // 命中后该 read 哪几份索引
                     "mobile-security"],        //   → <index-dir>/<category>.md
      "hubs": ["reverse-hub"],                  // 命中后该读哪个编排中心（可选）
      "keywords": [                             // 至少一条；组间是 OR
        {
          "must": "\\bapk\\b|smali|jadx|apktool|安卓",   // 必须命中的正则
          "mustAll": ["dex|so 文件"],                    // 全部都要命中（可选）
          "exclude": "模型|提示词|llm",                  // 命中即否决本组（可选）
          "note": "为什么这么写（不参与匹配）"            // 可选，纯注释
        }
      ]
    }
  },

  // 平局裁决：先列先赢。没列到的规则排在后面，按 id 里的数字自然序。
  "priority": ["R1", "R5", "R12"],

  // 编排中心表。path 是相对路径，解析时三种布局都会试（见下）。
  "hubs": {
    "reverse-hub": { "path": "_hubs/reverse-hub/SKILL.md", "purpose": "逆向类入口" }
  }
}
```

## 匹配算法（唯一权威定义）

按 `priority` 排好序后逐条检查，**第一条命中的规则就是 PRIMARY**：

```
对每条规则：
  命中 = 存在某一组 keywords 满足：
           (must 未给出 或 must 命中)
       且 (mustAll 为空 或 全部命中)
       且 (exclude 未给出 或 exclude 未命中)
```

要点：

1. **`must` / `mustAll` 组内是 AND，`keywords` 数组之间是 OR。**
2. **`exclude` 只否决它所在的那一组**，不影响同规则的其它组——
   这正是"同一个词在不同语境下归不同分类"的写法：两组，一组带 `exclude`、一组不带。
3. **没有 `must` 也没有 `mustAll` 的组恒不命中**（`--validate` 会警告），避免手滑写出"匹配一切"。
4. **全都不命中 → `fallback: true`**，不返回"最像的一条"。路由猜错的代价高于不路由。
5. **正则编译一次并缓存，语义固定为 `iu`**（不区分大小写、Unicode）。所以规则里不用写 `(?i)`。

## 五种写法上的坑

| 坑 | 错误写法 | 正确写法 | 为什么 |
|---|---|---|---|
| 中英混写 | `prompt.?inject` | `prompt[\s._-]?inject` | `.` 只吃一个字符，匹配不了 `prompt 注入` 里的空格 + 汉字 |
| 裸词误伤 | `must: "注入"` | `must: "(?=.*注入)(?=.*sql\|数据库)"` 或配合 `mustAll` | 单字裸词会吃掉一半无关任务 |
| 死规则 | 只写 `mustAll` 不写 `must` | 两者至少给一个 | 否则恒假（validate 会警告） |
| 平局不定 | 两条规则都命中却不排 `priority` | 明确排 `priority` | 否则按 id 数字序，改个 id 就换了结果 |
| hub 断链 | `path` 写死旧布局 | 写相对路径，让解析器试三种布局 | 库重新整合后 `_hubs/` 目录会消失 |

## hub 解析：三种布局

`hubs.<name>.path` 一律写**相对路径**（如 `_hubs/reverse-hub/SKILL.md`）。解析时依次尝试：

1. `<root>/<hub>/<file>` —— **拍平布局**（hub 被当成普通顶层技能）
2. `<root>/_hubs/<hub>/<file>` —— **旧布局**（hub 收在元数据目录里）
3. `<root>/<原样相对路径>`

`<root>` 按 `--source` / `--hub-root` 的顺序依次试，所以你可以传多个根做回退：

```bash
dsh-skill-router route "..." --routing r.json \
  --source ~/skills --hub-root ~/my-hubs
```

输出会标出命中的是哪一层（`[flat layout]` / `[meta layout]`），没命中会说原因。
**这是库重构之后最容易断的一环**：目录从 `_hubs/x/` 拍平成 `x/` 之后，规则文件不改也不会红，
但 `verify` 和 `route` 都会明确告诉你当前落在哪一层。

## 校验

```bash
dsh-skill-router route --validate --routing ~/.dsh/capabilities/routing.json
```

会检查：`routes` 结构、正则能否编译、`priority` 里的 id 是否存在、规则是否引用未定义的 hub、
`categories` 是否为空（空 = 命中了也没索引可读）。有 ERROR 退出码 1，只有 warning 退 0。

## 接入 agent（推荐形状）

1. 会话开始：只常驻**路由器**技能（`apply` 生成的那一份），不进分类索引。
2. 拿到任务：`route "<任务原句>" --json`，取 `primary.categories[0]` → `read` 那份索引。
3. 索引里挑一条具体技能 → `read` 它的 `SKILL.md`。
4. 全程 3 次读盘，常驻成本只有路由器本身。

`route` 的 `--json` 输出形状（稳定契约）：

```jsonc
{
  "routingFile": "...",
  "query": "...",
  "primary": { "id": "R1", "label": "...", "categories": ["..."], "hubs": ["..."] },
  "matches": [ /* 全部命中的规则，按 priority 序 */ ],
  "fallback": false,
  "indexes": [ { "category": "...", "file": "...", "exists": true } ],
  "hubs":    [ { "name": "...", "declaredPath": "...", "resolvedPath": "...", "layout": "flat" } ]
}
```