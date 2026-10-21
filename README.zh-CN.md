<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/icon-dark.svg">
    <img src="assets/icon-light.svg" alt="whynot" width="88">
  </picture>
</p>

<h1 align="center">whynot</h1>

<p align="center">
  <b>你的 agent 一直在重提你已经否决过的方案。</b><br>
  把它记一次。它会过期。agent 就不再提了。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/whynot-cli"><img src="https://img.shields.io/npm/v/whynot-cli?style=flat-square&color=111111&label=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen?style=flat-square" alt="node 20+">
  <img src="https://img.shields.io/badge/tests-29%20passing-brightgreen?style=flat-square" alt="29 tests passing">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square" alt="zero dependencies">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="platforms">
  <img src="https://img.shields.io/badge/MCP-compatible-8A2BE2?style=flat-square" alt="MCP compatible">
  <img src="https://img.shields.io/badge/Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20Gemini%20CLI-supported-informational?style=flat-square" alt="agent support">
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

<p align="center">
  <a href="#problem">问题</a> ·
  <a href="#install">安装</a> ·
  <a href="#quick-start">快速开始</a> ·
  <a href="#how-it-works">工作原理</a> ·
  <a href="#evidence">证据</a> ·
  <a href="#docs">文档</a> ·
  <a href="#license">许可证</a>
</p>

---

<a id="problem"></a>
## 问题

你试过用 Redis 存 session。一次区域故障时它读到 8 秒，于是你换成了 Postgres。

三周后，一个新会话里，你的 agent 建议用 Redis。

你又解释了一遍。一个月后你从 Claude Code 换到 Codex，第三次解释。半年后，你自己也记不清当初为什么否决 Redis 了——团队里其他人更不知道。

**代码记得住你选了什么。没有任何东西记得住你否决了什么。**

记忆类工具记录的是「发生了什么」，那些在 commit、PR 和代码里本来就有。`whynot` 记录另一半：**你排除了哪些方案、为什么**，放在一个 agent 提议任何东西之前会读的文件里。

---

<a id="install"></a>
## 安装

```bash
npx whynot-cli init
```

不需要全局安装，不用注册账号，没有遥测。只需要 Node 20+。

---

<a id="quick-start"></a>
## 快速开始

### 1. 先看哪些规则永远不会过期

`audit` 是只读的。它扫描你现有的 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules`，找出那些**用绝对语气、却没写任何条件**的规则——会被永久遵守的那些。

```bash
npx whynot-cli audit
```

```
Scanned 2 agent config files:
  AGENTS.md  (last changed 412d ago)
  CLAUDE.md  (last changed 8d ago)

3 rules look like permanent constraints:

  AGENTS.md:3
    "Never use TypeScript in this repo."
    → absolute rule with no stated condition; unchanged for 412 days
```

### 2. 创建记录目录

```bash
npx whynot-cli init
```

创建 `.decisions/`，并往 `.gitattributes` 写入 `*.md text eol=lf`。

### 3. 记录一条否决

```bash
npx whynot-cli add \
  --title "session 不存 Redis" \
  --why "us-east 故障时读延迟 8s，SLO 要求 p99 < 500ms" \
  --type rejected \
  --revisit "Redis 支持跨区域强一致时" \
  --evidence pr:412 \
  --tags infra,session
```

```markdown
---
id: 0001
title: session 不存 Redis
type: rejected
status: live
created: 2026-09-21
expires_on: 2026-12-20
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

### 4. 交给你的 agent

加上 MCP server：

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

然后把 [`AGENTS.snippet.zh-CN.md`](AGENTS.snippet.zh-CN.md) 里的那一段粘进你的 `AGENTS.md` 或 `CLAUDE.md`。MCP server 提供工具，这段指令才让 agent 真的去用。

> **MCP 不可用时，格式依然能用。** `.decisions/` 就是普通 Markdown，agent 可以直接读、直接 grep。这一条在真实 agent 测试里被观察到，不是假设。

---

<a id="how-it-works"></a>
## 工作原理

### 每条记录都会过期

| 类型 | 默认有效期 |
|---|---|
| `rejected`（已否决） | 90 天 |
| `decision`（决策） | 180 天 |
| `constraint`（约束） | 365 天 |

到期后，它**不再到达你的 agent**。不加注释、不加警告——直接不存在。`whynot stale` 会列出来，你决定续期还是归档。

这是整个设计的核心。让 agent「对旧笔记保持怀疑」被实测证明没有用；**把它从视野里移走**才有用。

### 三种记录

| 类型 | 用来记什么 |
|---|---|
| **`rejected`** | 试过并放弃的方案。**最值钱的一类**——仓库里没有别的东西记得它。 |
| `decision` | 在几个可行方案之间做的选择，附理由 |
| `constraint` | 项目必须满足的硬约束 |

### 刻意做得很轻

- **Markdown 放在 git 里。** 能读、能 diff、能 review、能回滚。工具消失了，`grep` 依然能用。
- **不用向量库、不用 embedding、写入时不调模型。** 每一条都是失败模式：索引过期、写入成本、没人能审计的结果。
- **没有守护进程、没有遥测、没有托管服务。** 你对自己代码库的推理留在你自己的机器上。

---

<a id="evidence"></a>
## 证据

六个实验，三个模型家族，多数条件 n=20。

| 问题 | 结果 |
|---|---|
| 决策的年龄重要吗？ | **不重要。** 30 天和 7 年被遵循的比例完全一样（各 0/12）。过期后 → 12/12。 |
| 记录否决会改变结论吗？ | **会。** 78–87 个百分点，p < 0.0001。 |
| 不相关的记录会扭曲无关工作吗？ | **不会。** 0/30。 |
| 真实 agent 会跨会话使用它吗？ | **会。** Codex 在 9/9 个会话里遵守了决策。 |

安装之前，有两条需要知道：

- **约五分之一的回复抵抗了陈旧记录**——方式是攻击记录里写的原因。命名了**「条件」**的理由（「团队当时不会 TS」）会邀请复核；陈述了**「属性」**的理由（「这个项目变更频繁」）不会。
- **当真实代码在上下文里时，有些 agent 会直接从仓库推断答案**、无视记录。记录最有价值的地方，是代码表达不了的东西：**你否决掉的方案**。

完整结果、方法和复现脚本：[`docs/findings.zh-CN.md`](docs/findings.zh-CN.md)。

---

<a id="docs"></a>
## 文档

| | |
|---|---|
| [设计](docs/design.zh-CN.md) | 为什么是这个形态 |
| [结论汇总](docs/findings.zh-CN.md) | 每个实验发现了什么、没发现什么 |
| [验证索引](docs/validation.zh-CN.md) | 详细写稿的入口 |
| [预注册](docs/preregistration.md) | 在数据之前定好的判据 |
| [贡献指南](CONTRIBUTING.md) | 四条不可协商的设计约束 |
| [AGENTS 片段](AGENTS.snippet.zh-CN.md) | 让 agent 真正用起来的那段指令 |

---

## 命令行

```
whynot init                     创建 .decisions/ 和 .gitattributes 规则
whynot add --title T --why W    记录一条
      [--type rejected|decision|constraint]
      [--revisit "条件"]         什么时候该重新考虑
      [--ttl N]                 多少天后过期
      [--expires never]         显式设为永久
      [--evidence pr:412]       可重复
      [--tags infra,session]
whynot list [--all]             列出有效记录
whynot check "<查询>"           查某件事是不是已经定了
whynot stale                    需要人决定的记录
whynot renew <id> [--days N]    续期
whynot retire <id>              归档（不删除）
whynot audit [--days N]         扫描 agent 配置文件（只读）
whynot doctor                   校验记录
whynot mcp                      运行 MCP server（stdio）
```

---

<a id="license"></a>
## 许可证

MIT。没有账号、没有遥测、没有付费档、没有闭源二进制。
**没有任何东西要卖给你。**

---

<p align="center">
  <sub><a href="README.md">English</a> · <a href="https://github.com/Stakenshake/whynot">GitHub</a> · <a href="https://www.npmjs.com/package/whynot-cli">npm</a></sub>
</p>
