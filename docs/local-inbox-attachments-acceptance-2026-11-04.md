# 持久环境收件箱与附件修复验收（２０２６年１１月４日）

本轮在原 `raft-build` 持久环境中修复并验收，保留现有数据。验收后完整服务保持运行，日常入口仍为 `./.slockdev/local-dev start raft-build`，无需重复传入 RisingWave 参数。操作说明见[持久本地环境](local-persistent-environment.md)。

## 故障与修复

| 现象 | 原因 | 修复 |
| --- | --- | --- |
| `raft inbox check` 返回 HTTP ５０３，普通消息可读 | 未配置收件箱硬依赖 RisingWave | 为持久模式补齐完整 CDC、物化视图、连接配置与独立数据卷 |
| 新附件上传返回 HTTP ５００ | 只配置了旧附件桶，缺少专用直传桶配置 | 创建专用桶并注入全部 `S3_DIRECT_UPLOAD_*` 配置，复用原 RustFS 数据卷 |
| 本地 Agent 下载失败 | RustFS 签名下载重定向使用 HTTP，CLI 要求 HTTPS | 显式启用本地鉴权下载代理，GET 返回文件字节；保留直传能力和 CLI 的 HTTPS 校验 |
| 实际数据的收件箱严格对比失败 | 上游 RW 读取遗漏首条提及锚点，任务徽标读取旧消息字段，未使用 tasks 中的信息 | 在 RisingWave 中批量补齐当前页的任务字段与提及锚点，保留原候选集、计数、分页和硬依赖行为 |

原临时环境的 RisingWave 完整启动分支会重建数据库，不能直接用于持久环境。本轮增加独立持久路径：复用原 PostgreSQL 容器和命名卷，通过逻辑复制配置接入 CDC；RisingWave 状态挂在 `/var/lib/risingwave`，不会遮住镜像程序。首次建立图后记录启用状态，后续只验证既有 publication 和视图，不重置复制槽；缺失持久卷时拒绝用空状态替代。

## 数据保护与复核

操作前保存完整 PostgreSQL 备份、原 Agent home 备份、业务记录校验基线，以及凭据文件的 SHA-256 和修改时间。备份、原始日志和验收脚本保存在本机受限临时目录 `/private/tmp/raft-env-acceptance-20261104/`，不纳入 Git；需要长期备份时应另行转存。

完成真实验收及完整重启后再次核对：

| 原有内容 | 结果 |
| --- | --- |
| １个用户、１个工作区、２０个频道、５个 Agent、１个 Daemon | 原记录仍在，所选身份和业务字段校验一致 |
| １３１条历史消息 | 原 ID、频道、发送者、正文和创建时间逐条校验一致 |
| ９个任务 | 原任务 ID 全部保留 |
| 本地账号与机器凭据 | 内容 SHA-256、修改时间均未变化 |
| １２个原 Agent 记忆与笔记文件 | 全部存在，内容校验一致 |
| 原归档 Agent | 保持归档，未恢复旧小虾米 |
| 原三份 Docker 数据卷 | 保留并继续使用，另增加 RisingWave 卷 |

验收仅向本人和两个 Agent 的私信增加测试消息与附件，最终消息数为１４４；未向项目频道发送验收消息。正常读取会更新已读状态，不将这类运行状态当作不可变业务内容。

## 真实验收结果

| 链路 | 结果 |
| --- | --- |
| 原受影响 Agent CLI 复现 | 修复前实际得到 inbox ５０３、attachment upload ５００ |
| 小虾米和 vision稳定性专家 | 两者 `raft inbox check` 与 `raft inbox check --view mentions` 均成功 |
| 真实 Agent 执行 | 两者在本人私信收到验收请求，回复“持久收件箱真实验收通过”；完整重启后再次成功 |
| 网页 Activity | 页面真实加载，接口返回２００，任务徽标及列表正常 |
| PostgreSQL／RisingWave 严格一致性 | all、unread、mentions 三个视图的完整条目、计数、分页信息一致；重启后再次通过，未跳过元数据差异 |
| Agent 上传和发送附件 | 中文１０８字节文本与１２ MiB 文件上传成功，并通过正常消息新鲜度检查发送到本人私信 |
| 网页上传 | 同样实际上传并发送小文件和１２ MiB 大文件 |
| 网页预览与下载 | 文本预览正常，点击下载得到实际文件，SHA-256 与原文件一致 |
| 用户 HTTP 与 Agent CLI 下载 | 两个文件字节数、SHA-256 均与原文件一致；完整重启后再次通过 |
| 匿名访问 | Raft 附件接口返回４０１，匿名对象访问返回４０３ |
| 完整启停 | 普通 restart 自动恢复 managed/full；日志为验证既有 CDC／视图，publication OID 不变，复制槽继续推进 |

重启前后 PostgreSQL publication 的 OID 均为 `31149`，复制槽仍为 `slockdev_rw_slot`／`pgoutput`，确认位置从 `0/35D77E0` 前进到 `0/36BBDC8`。未重新初始化业务库、执行 seed 或删除数据卷。

## 自动检查

- `pnpm test:raftdev`：１３６项通过，１０项按条件跳过。
- storageService 回归：１５项通过，包含本地代理下载开关与直传能力保持的测试。
- 收件箱硬依赖与父频道可见性回归：１１项通过。
- 真实 RisingWave prepare／完整条目一致性回归：１项通过，使用现有工作区，不创建演示数据。
- `pnpm typecheck:raftdev`、服务端 TypeScript 检查、`git diff --check` 通过。

## 本机资源调整

首次拉取约２．２ GiB 的固定 RisingWave ２．８．０ 镜像时，发现 Docker 虚拟磁盘已满；原４ GiB 内存配置也触发该版本 compactor 的最低内存断言。本机已在备份 Docker Desktop 配置后，将虚拟磁盘上限由约６０ GiB 扩至９６ GiB，内存由４ GiB 调至８ GiB。未执行 prune、恢复出厂设置或删除用户镜像及卷。配置备份留在上述本机受限目录。

镜像按仓库默认官方摘要运行，下载内容逐层校验官方 SHA-256。日常使用仍依赖 Docker 和 tmux，电脑休眠期间服务不可用。

## 网页证据

网页收件箱、附件上传和完整重启后的 Agent 回复均已实际查看。三张截图含本地工作区聊天内容，仅保存在本机受限目录 `/private/tmp/raft-env-acceptance-20261104/`，与原始日志、数据库备份一起留在版本库之外。

收件箱列表中的历史故障消息保持原样；本轮验收结果以上表为准。
