# whynot

**记下你否决了什么、为什么否决——让你的编码 agent 不再重提。**

你的 agent 每次开新会话都从零开始。你上周否决的方案，它这周还会再提一遍。三个月后，你自己也忘了当初为什么否决。

记忆类工具记录的是「**你做了什么**」。那些在代码、commit、PR 里都已经有了。真正哪儿都不存在的是「**你为什么没做**」——它只在你脑子里，而且在慢慢腐烂。

`whynot` 就是你仓库里一个放 Markdown 的文件夹，外加一个很薄的 MCP server。

---

## 我们测到了什么

六个实验，三个模型家族，多数条件 n=20。完整写稿和脚本在 [`docs/`](docs/) 和 [`experiments/`](experiments/)。

### 年龄不重要，存在本身重要

同一条决策，只改创建日期，被遵循的比例完全一样：

| 决策的年龄 | 推荐被否决的选项 |
|---|---|
| 没有记录（基线） | 100% |
| 30 天 | **0%** |
| 1 年 | **0%** |
| 7 年 | **0%** |
| 7 年，已过期不可见 | **100%** |

**模型不按年龄打折——它把每一条记录都当成现行的。**

在提示词里加「这条很旧，请保持怀疑」没有用；**让过期条目不可见**才有用。这就是为什么「过期」是这个工具的核心，而不是可选项。

### 记录一条否决，会实质改变结论

n=20、三个模型家族合并：一条被记录的否决把推荐改变 **78–87 个百分点**（Fisher p < 0.0001）。

### 两个必须说的限定

- **不是所有模型都一样服从。** 当真实代码摆在面前时，一个模型直接从仓库推断出答案、无视了记录；另一个仍然倾向于被否决的方案，直到记录拦住它。
- **写的理由比日期更重要。** 当记录写的是「团队当时不会 TS」，约五分之一的回复会攻击这个前提、照样推荐 TypeScript；当写的是「这个项目字段变更频繁」，服从是 100%。**命名了「条件」的理由会邀请复核，陈述了「属性」的理由不会。**

### 没有测的东西

**我们没有测过它在真实使用中是否帮得上忙。** 这里每个实验都是受控的单轮任务。真正重要的那个数字——几周真实工作里，agent 重提已否决方案的次数有没有下降——没有测，这个项目也不声称它。

我们声称的是：**机制在测试条件下有效，而且脚本都在，你可以自己查。**

---

## 安装

```bash
npx whynot-cli init
```

然后把 [`AGENTS.snippet.md`](AGENTS.snippet.md) 里的那一段粘进你的 `AGENTS.md` 或 `CLAUDE.md`，再注册 MCP server。

需要 Node 20+。没有别的依赖。不用全局安装，不用注册账号，没有遥测。

### 注册 MCP server

Claude Code、Claude Desktop、Cursor 以及大多数 MCP 客户端都用同样的格式：

```json
{
  "mcpServers": {
    "whynot": {
      "command": "npx",
      "args": ["-y", "whynot-cli", "mcp"]
    }
  }
}
```

---

## 使用

```bash
npx whynot-cli audit              # 扫描你现有的规则，找出永远不会过期的那些
npx whynot-cli init               # 创建 .decisions/
npx whynot-cli add --title "..." --why "..."
npx whynot-cli check redis        # 这件事是不是已经定了？
npx whynot-cli stale              # 哪些需要人来决定
npx whynot-cli renew 0001         # 仍然成立 —— 续期
npx whynot-cli retire 0002        # 不再成立 —— 归档
```

大多数时候你不会手动跑这些。agent 在发现某个方案行不通时会调 `decisions_record`，在提议方案之前会调 `decisions_check`。

### 从 `audit` 开始

`audit` 是只读的。它扫描 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`.cursor/rules/*`、`.github/copilot-instructions.md`，找出那些**用绝对语气、但没写任何条件**的规则——也就是会被永久遵守的那一类。

```
Scanned 2 agent config files:
  AGENTS.md  (last changed 412d ago)
  CLAUDE.md  (last changed 8d ago)

4 rules look like permanent constraints:

  AGENTS.md:3
    "Never use TypeScript in this repo."
    → absolute rule with no stated condition; unchanged for 412 days
```

这是启发式检查，不是判决。**扫出来是 0 条，也是有用的信息。**

---

## 格式

```
.decisions/
└── 0001-session-不存-redis.md
```

```markdown
---
id: 0001
title: session 不存 Redis
type: rejected            # rejected | decision | constraint
status: live              # live | retired
created: 2026-10-14
expires_on: 2027-01-12
revisit_when: "Redis 支持跨区域强一致时"
evidence:
  - "pr:412"
tags: [infra, session]
---

## 结论
不能把 session 存 Redis。

## 为什么
试过 Redis + 单写区域。us-east 故障时读延迟飙到 8s，SLO 要求 p99 < 500ms。
```

`rejected`（已否决）是最值钱的一类。它是唯一无法从代码里恢复出来的东西。

### 过期

每条记录都会过期：否决类 90 天，决策类 180 天，约束类 365 天。

过期之后，它**不再展示给 agent**，但**不会被删除**。`whynot stale` 会列出来，你决定续期还是归档。

这就是整个安全机制。过期条目是**不可见**的——因为「告诉 agent 这条很旧、请怀疑它」已经被实验证明不管用。

如果某件事真的永远不过期，写 `expires_on: never`。这应该很少见，而且应该是一个刻意的决定。

---

## 为什么是这个形态

- **Markdown 放在 git 里，不是数据库。** 你能读、能 diff、能 review、能回滚。就算这个工具明天消失，`grep` 依然能用。
- **不用向量库、不用 embedding、写入时不调模型。** 这每一条都是我们在现有工具里实际看到的失败模式：索引过期、写入成本、以及没人能审计的结果。
- **默认过期。** 这是它和其他所有记忆工具最不一样的地方。实验见 [docs/validation.zh-CN.md](docs/validation.zh-CN.md)。
- **没有工具时格式依然可用。** MCP 不可用时，agent 可以直接读 `.decisions/`。这一点是观察到的，不只是设计出来的。

---

## 它不是什么

- 不是向量数据库，也不是检索引擎。
- 不是托管服务。你对自己代码库的推理过程留在你自己的机器上。
- 不替代 `AGENTS.md`。那个告诉 agent 该怎么做事；这个记录哪些事已经定了。
- 不是全自动的。没人记，它就什么也不做。

---

## 跨平台说明

Windows / macOS / Linux 都测过。

- `init` 会往 `.gitattributes` 写 `*.md text eol=lf`。不写的话，Windows 上会写入 CRLF，每次 diff 都显示整个文件被改。
- 文件名会被 slug 成 `[a-z0-9]` 加中日韩字符。Windows 禁止 `\ / : * ? " < > |`，而且 Windows 和 macOS 大小写不敏感——在 Linux 上正常的文件名，换个系统就崩。
- 没有常驻进程，没有文件监听。只有被调用时才运行。
- 如果用非 ASCII 文件名，执行 `git config core.quotepath false`，否则 git 会把中文路径显示成八进制转义。

---

## 自己验证

```bash
npm test                         # 29 个测试，零依赖
node experiments/e3/run.mjs      # 统计功效实验
node experiments/e4/run.mjs      # 年龄 / 过期实验
node experiments/e5/run.mjs      # 真实 agent 的跨会话实验
```

六个实验和它们遵循的约定见 [`experiments/README.md`](experiments/README.md)。

实验通过一个 OpenAI 兼容端点调用模型。设置 `MAGPIE_URL`，或者改每个脚本顶部的网关地址。它们不属于工具本身，是我们验证结论用的。

---

## 许可证

MIT。没有账号、没有遥测、没有付费档、没有闭源二进制。
**没有任何东西要卖给你。**

---

[English](README.md) · [设计](docs/design.zh-CN.md) · [验证](docs/validation.zh-CN.md)
