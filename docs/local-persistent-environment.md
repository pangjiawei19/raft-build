# 持久本地环境

持久环境适合日常使用：首次创建一次数据库和身份，之后反复启停。容器停止、启动失败或重复启动都不会删除数据库、附件和机器凭据。

## 使用方式

运行前需要安装 Node.js 24、pnpm、Docker 和 `tmux`，并启动 Docker。启动器会检查缺失依赖；例如 macOS 使用 Homebrew 时可通过 `brew install tmux` 安装 `tmux`。

本机已经配置的入口为 `./.slockdev/local-dev`，默认启用持久模式。该入口负责选择本机的 Node 和 tmux，实际功能由纳入版本控制的 `raftdev` 实现。

```bash
# 可选：首次只初始化，不启动应用服务。
./.slockdev/local-dev init raft-build

# 未初始化时首次初始化，之后复用原有数据；默认一直运行。
./.slockdev/local-dev start raft-build

# 停止应用和容器，保留数据、配置和凭据。
./.slockdev/local-dev stop raft-build

./.slockdev/local-dev restart raft-build
./.slockdev/local-dev status
./.slockdev/local-dev logs raft-build
```

其他机器可使用仓库入口：首次执行 `./raftdev init <name>`，或 `./raftdev start <name> --persistent`。环境类型写入 `.slockdev/<name>/environment.json`，以后的 `start`、`stop` 会自动识别，不需要反复传入参数。

已健康运行时，重复 `start` 返回成功，不重启服务、不刷新凭据、不重跑初始化。启停操作使用环境锁，避免并发操作重复创建资源。部分服务退出时，`start` 会停止残留服务后恢复，数据继续保留。

## 首次创建的内容

- 一个本地账号：`dev@slock.ai`，初始密码为 `password123`。
- 一个本地工作区，地址为 `/s/dev`。
- 一个供本机 Daemon 使用的机器身份。
- `all` 和 `general` 两个基础频道。

不会创建演示消息、测试 Agent、多余账号或测试工作区。机器密钥只在初始化时生成，正常启停不轮换。需要完整演示数据时，使用另一个名字创建临时预览环境，不要向日常使用的持久环境导入 `seed`。

## 数据位置

| 内容 | 保存位置 |
| --- | --- |
| PostgreSQL | Docker 命名卷 `slock-dev-<name>-pg-data` |
| Redis | Docker 命名卷 `slock-dev-<name>-redis-data`，启用 AOF |
| 附件 | Docker 命名卷 `slock-dev-<name>-rustfs-data` |
| 环境类型和初始化状态 | `.slockdev/<name>/environment.json` |
| 本机 Agent 数据 | `.slockdev/<name>/home` |
| 本地账号和机器凭据 | `.dev-env-<name>.json` |
| 初始化重试密钥 | `.dev-env-<name>.json.bootstrap-key` |

这些本机文件不进入 Git。备份应同时包含数据库、附件和本地身份配置。不要把 `.slockdev` 当作可随意清空的构建缓存；配置或命名卷缺失时，启动器会拒绝用空数据替换原环境。

## 初始化、升级和删除

首次初始化应用仓库中的版本化数据库迁移。日常启动不执行 `drizzle-kit push --force`，也不执行开发用 `seed`。数据库定义变化时，启动器要求先处理版本化迁移。

代码升级应准备对应迁移文件，先备份，再执行：

```bash
./.slockdev/local-dev migrate raft-build
./.slockdev/local-dev start raft-build
```

`migrate` 会停止应用、执行迁移并保持服务停止。迁移失败时保留数据和日志，不重新建库。它不是自动回滚或备份工具。

只有明确删除环境时才执行以下命令，它会永久删除指定环境的托管容器、命名数据卷和本地配置：

```bash
./.slockdev/local-dev destroy raft-build --yes
```

`seed` 对持久环境拒绝执行；`nuke` 在发现持久环境时拒绝执行。未启用持久模式的临时预览环境仍保留原有的启动和清理行为。

## 运行范围

持久模式默认关闭公网预览隧道和空闲自动停止。若显式设置 `SLOCKDEV_IDLE_TTL_SECONDS`，到期也只停止服务，保留数据。

当前仍由 tmux 运行应用，电脑休眠期间服务不可用，电脑重启后需启动 Docker 并重新执行 `start`。本次改造不安装系统登录启动项，也不提供进程崩溃后的自动重启。持久模式暂不支持本地 RisingWave 预览重建流程、多副本和测试 onboarding 配置。
