# 验证

这一页现在是一个索引。汇总结果在 [findings.zh-CN.md](findings.zh-CN.md)（英文版 [findings.md](findings.md)），详细写稿在下面。

| 实验 | 问题 | 写稿 |
|---|---|---|
| E0 | 模型能可靠地判断「推荐 vs 排除」吗？ | [judge-calibration.md](judge-calibration.md) |
| E1 | 真实代码上下文会削弱效应吗？ | [e1-code-context.md](e1-code-context.md) |
| E2 / E2b | 不相关的决策会扭曲无关工作吗？ | [e2-false-obedience.md](e2-false-obedience.md) |
| E3 | 效应在统计上成立吗？ | [e3-power.md](e3-power.md) |
| E4 | 决策的年龄重要吗？ | [e4-dose-response.md](e4-dose-response.md) |
| E5 | 真实 agent 会跨会话使用它吗？ | [e5-real-agent.md](e5-real-agent.md) |
| E6 | 真实使用中帮得上忙吗？ | **未运行** —— 见 [preregistration.md](preregistration.md) |

## 关于这一页的旧版本

这一页最早报告的是单个小实验的结果（每条件 n=3，两个模型）。那些数字曾经出现在 README 和发布材料里。

其中有几个是误导性的，有一个是**错的**：

- 「6/6 全部服从」这个说法低估了方差；n=20 时同一条决策在 60 次回复里被抵抗了 13 次。
- 剂量-反应实验的第一次判分把判分错误静默地当成了数据，产出了一个看起来很干净、实际不存在的结果。

两件事都记录在 [preregistration.md](preregistration.md) 里。现在项目中使用的数字都来自上面链接的实验。
