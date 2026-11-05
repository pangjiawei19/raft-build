# 持久收件箱休眠后恢复验收

日期：２０２６年１１月５日。时间均为北京时间。

## 故障与证据

Agent 报告 `raft inbox check` 连续返回 HTTP 503，关联编号为 `8523abc9f719162e`，但 `raft message check` 正常。

- Daemon 跟踪记录确认，该编号在 １４：５８：１１收到服务端 HTTP 503，路由为 `agent-api/inbox`。
- 使用现有小虾米的专用 CLI 复现相同错误，关联编号为 `a38c290639da2afc`。
- 服务端报告 `RisingWave unreachable: connect ECONNREFUSED 127.0.0.1:17708`。
- macOS 电源日志显示，１２：１６：５９因空闲进入休眠，１２：２０：１７唤醒。
- RisingWave 在１２：２０：２７删除心跳过期的内部节点，随后记录 `worker expired`，于１２：２０：２８退出。
- 容器退出码为 1，`OOMKilled=false`；Docker 可用内存约 8 GiB。原重启策略为 `no`，因此容器退出后一直未恢复。

这些证据将本次故障定位为休眠唤醒后的内部心跳过期退出，以及持久环境缺少自动重启保护。

## 修复

仅对持久环境的托管 RisingWave 配置 `unless-stopped`，保留原容器、命名卷和 CDC 状态。

- 新建持久 RisingWave 时直接配置重启策略。
- 复用已有容器时，检查托管标签及预期数据卷，再原地补齐策略。
- 健康环境的重复 `start` 也检查旧策略；已符合配置时不重复更新，不重启应用或 Agent。
- 临时预览环境维持原行为；正常停止持久环境后保持停止。策略语义见 [Docker 官方文档](https://docs.docker.com/engine/containers/start-containers-automatically/)。

本机已对原 RisingWave 容器更新策略并启动，未重建依赖、执行数据库迁移、重置 Agent 或发送业务消息。

## 真实验收

首次恢复后，小虾米与 vision 稳定性专家的 `inbox check`、`inbox check --view mentions` 共 4 次检查成功，网页 `/api/channels/inbox` 返回 HTTP 200，响应包含动态列表。

随后通过容器内 `SIGTERM` 令 RisingWave 主进程退出，未调用 `docker stop` 或手动重启。Docker 自动拉起同一容器，重启计数由 0 增至 1；网页收件箱再次返回 HTTP 200。

自动恢复后，通过全部 9 个有效 Agent 的现有专用 CLI，各执行 `inbox check`、`inbox check --view mentions` 和 `message check`，共 27 次检查全部成功。

恢复后的 PostgreSQL 与 RisingWave `rw_messages` 均为 328 条消息，最大序号均为 330，确认 CDC 已追上当前业务数据。

原有中文小文本和 12 MiB 验收附件，分别经用户 HTTP 与 Agent CLI 下载后，SHA256 均与上次上传记录一致。

## 数据连续性

修复前已创建新的数据库备份及逐行摘要快照。原有 1 个用户、1 个工作区、54 个频道、317 条消息、22 个任务、33 条附件记录、9 条 Agent 成员关系均保留；所有原消息正文和附件记录保持，Agent 会话、职责、模型等配置及本地凭据保持。

验收期间团队继续正常工作，新增了 1 个频道、11 条消息、2 条附件；1 条原消息增加了线程关联，3 个任务的修订号、更新时间或状态推进。这些运行更新没有被回滚。原有 32 个记忆、笔记文件均保留，四个依赖容器的 ID 保持不变。

数据库备份、原始日志、检查脚本及 JSON 回执仅保存在本机临时目录 `/private/tmp/raft-inbox-503-20261105/`，不进入 Git。

## 自动检查及限制

修复前，新增回归断言分别复现了新容器缺少重启策略，以及健康环境重复 `start` 未补齐旧容器策略的问题；修复后通过。

- `pnpm test:raftdev`：137 项通过，10 项按仓库条件跳过。
- `pnpm typecheck:raftdev`：通过。
- `git diff --check`：通过。

本次通过进程退出验证自动恢复，没有主动让用户电脑再次休眠。电脑休眠期间服务仍不可用；唤醒后若 RisingWave 再次退出，Docker 会尝试恢复，恢复期间收件箱可能短暂返回 503。应用进程自身退出仍需手动恢复。
