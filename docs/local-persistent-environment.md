# 持久本地环境

持久环境适合日常使用：首次创建一次数据库和身份，之后反复启停。容器停止、启动失败或重复启动都不会删除数据库、附件和机器凭据。

## 使用方式

运行前需要安装 Node.js 24（仓库基准为 24.22.1）、pnpm 12.15.0、Docker 和 `tmux`，并启动 Docker。启动器会检查缺失依赖；例如 macOS 使用 Homebrew 时可通过 `brew install tmux` 安装 `tmux`。在仓库内运行 `pnpm --version`，应与 `package.json` 的 `packageManager` 一致。

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

### 本机环境变量配置

本机 `./.slockdev/local-dev` 通过 `RAFTDEV_ENV_FILE` 加载 `.slockdev/local.env`，配置文件不进入 Git。其他机器可从 `scripts/dev/local.env.example` 复制，再在自己的启动入口设置 `RAFTDEV_ENV_FILE`，或直接指定：

```bash
RAFTDEV_ENV_FILE="$PWD/.slockdev/local.env" ./raftdev start raft-build
```

配置使用 dotenv 格式，支持注释、引号和 `变量名=值`，不执行 shell 命令，也不展开 `$变量`。调用时显式提供的同名环境变量优先。文件中的变量会传给 tmux 启动的服务；端口、数据库和存储等由启动器托管的连接参数仍按环境生成。

```dotenv
# 免费工作区的月上传额度：10 GiB，单位为字节。
FILE_UPLOAD_MONTHLY_LIMIT_BYTES=10737418240

# 其他已有配置项也可放在同一文件中。
IMAGE_DECODE_CONCURRENCY=2
```

`FILE_UPLOAD_MONTHLY_LIMIT_BYTES` 必须为正的安全整数，删除或留空时沿用上游默认的 100 MiB。它调整当前部署内免费工作区的月上传上限，保留已用及预占字节的核算；其他套餐额度和单文件大小上限沿用原规则。以后添加已有环境变量支持的参数即可；没有环境变量入口的参数仍需先增加代码支持。

本机已配置每月 10 GiB，并通过 12 MiB 文件上传、鉴权代理下载和字节一致性验收，原有用量与凭据保留。修改文件后执行 `./.slockdev/local-dev restart raft-build` 生效。对已经健康运行的环境再次执行 `start` 不会重新加载服务进程的配置。

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

从 `v1.13.0-source.1` 升级到 `v1.21.23-source.1` 时，上游重排了历史迁移，已有数据库不能直接沿用常规 `migrate` 流程。需要保留数据时应单独制定迁移方案；明确不需要旧数据时，可销毁该环境后重新初始化。

### 升级到 v1.24.0

持久环境继续沿用既有依赖选择，已启用的 RisingWave 自动恢复；尚未启用时仍需显式传入 `--risingwave`。上游临时开发环境的普通 `start` 则默认启用 RisingWave，可用 `--no-risingwave` 关闭。持久模式不支持临时预览或演示 Agent 初始化。

持久环境首次初始化与显式 `migrate` 使用上游部署迁移器及迁移后的索引步骤；日常 `start` 仍只检查数据库定义，不自动修改表结构。迁移失败后服务保持停止，已有数据、身份和附件继续保留。

已启用 RisingWave 的旧环境还需要根据 [RisingWave SQL 说明](../infra/risingwave/sql/README.md)单独升级 CDC 字段和物化视图，尤其是 078 的任务讨论区视图。普通 `start` 仅验证既有图，缺少新版关系时会拒绝启动，不会重建复制槽、清空命名卷或重新导入测试数据。代码合并与回归测试不自动执行这项业务环境升级。

2026 年 11 月 17 日代码合并验收：开发脚本、Agent 协作规则及提示词、附件存储与收件箱、前端任务与重连回归共 358 项通过、13 项跳过；当时真实 RisingWave 集成尚未配置隔离数据库，缺少私有 CI 依赖的快照清理测试未纳入。启动器、Shared、Server、Daemon、Web、CLI、Computer 以及本地初始化和 RisingWave 脚本的类型检查通过，CLI 与 Web 完整构建通过。

同日本机 `raft-build` 已完成业务环境迁移。先停止服务，离线复制并逐文件校验四个数据卷，同时备份 PostgreSQL、Agent home 和身份配置，再在隔离副本演练；演练通过后才升级正式环境。PostgreSQL 迁移记录从 374 条推进至 693 条，迁移后的 81 项索引步骤通过。RisingWave 原地补齐三个 CDC 字段、同步历史数据并升级任务讨论区和收件箱视图，保留原 source、publication、复制槽和数据卷；创建新图时仅临时放宽迁移会话的 actor 限额，退役旧派生关系后恢复限制，最终 actor 数为 370。

迁移前的 1 个账号、1 个工作区、224 个频道、12 个 Agent、2,788 条消息、166 个任务、311 个附件及本机 Daemon 记录均保留，所核对核心字段与本地凭据摘要一致。真实 RisingWave 图验证、PostgreSQL／RisingWave 收件箱一致性、真实数据库查询测试、原账号登录、网页动态和任务页面、历史附件摘要、新附件上传下载及匿名访问限制均通过，使用日常 `restart` 完整重启后再次通过。验收消息仅发送到本人私密临时频道，完成后已删除频道；这些验收记录不计入上述原数据基线。

备份与验收证据保存在本机 `.slockdev/raft-build/migration-v124-20261117-155341/`，四个离线备份卷以 `raft-build-pre-v124-155341-` 开头，均保留供恢复使用。日常仍通过 `./.slockdev/local-dev` 启停，四个容器均使用 `restart=no`，RisingWave 继续使用原低内存配置。本机入口已配置仓库要求的 pnpm 12.15.0。

验收时原工作区本月 100 MiB 上传额度剩余约 1.1 MiB，12 MiB 新文件按既有配额返回 `FILE_UPLOAD_QUOTA_EXCEEDED`；历史 12 MiB 附件仍能正常下载。本机未启用附件会话直传，沿用兼容上传和鉴权下载代理。外部产品反馈集成未配置，反馈列表返回 `feedback_integration_unavailable`；这两项限制独立于已通过的核心工作区功能。

只有明确删除环境时才执行以下命令，它会永久删除指定环境的托管容器、命名数据卷和本地配置：

```bash
./.slockdev/local-dev destroy raft-build --yes
```

`seed` 对持久环境拒绝执行；`nuke` 在发现持久环境时拒绝执行。未启用持久模式的临时预览环境仍保留原有的启动和清理行为。

## 运行范围

持久模式默认关闭公网预览隧道和空闲自动停止。若显式设置 `SLOCKDEV_IDLE_TTL_SECONDS`，到期也只停止服务，保留数据。

当前仍由 tmux 运行应用，电脑休眠期间服务不可用，电脑重启后需启动 Docker 并重新执行 `start`。不安装系统登录启动项；应用进程退出后需要手动恢复。持久模式不支持多副本和测试 onboarding 配置。

## 收件箱与新版附件

持久收件箱（网页动态和 `raft inbox check`）需要 RisingWave。

完整本地依赖使用仓库固定的 RisingWave 2.8.0 镜像，镜像压缩体积约 2.2 GiB。默认启动参数下，Docker Desktop 建议至少分配 8 GiB 内存；仅将 Docker 降到 4 GiB 而不调整 RisingWave，会触发该版本 compactor 的最低内存断言。应同时为镜像解压、数据和构建缓存预留磁盘空间。

### 本地低内存配置

2026 年 11 月 8 日，本机持久环境已使用 `infra/risingwave/local-low-memory.toml` 验收低内存运行。通过 `RAFTDEV_RISINGWAVE_LOW_MEMORY=1` 启用；本机 `./.slockdev/local-dev` 默认设置该变量。其他机器可显式运行：

```sh
RAFTDEV_RISINGWAVE_LOW_MEMORY=1 ./raftdev start <name> --persistent --risingwave
```

配置保持同一镜像、持久目录、CDC 和完整收件箱视图，仅缩小资源预算：

- RisingWave 内部总预算为 2 GiB，容器硬上限为 2.5 GiB、2 个 CPU，不额外使用容器交换空间。额外 512 MiB 为现有图的启动恢复预留余量。
- 计算并行度与 compactor 工作线程数均为 1；数据缓存、元数据缓存和共享缓冲区各为 32 MiB，预取缓冲区为 16 MiB。
- compactor 内存预算为 640 MiB，独立元数据缓存为 16 MiB。现有集群的 SST 大小保持不变；保留足够构建空间，使 2.8.0 的启动断言通过。这是内部总预算之外的显式覆盖，不能将容器硬上限视为所有组件预算的简单相加。
- 配置文件以只读方式挂载。已有容器日常启动仍原地复用；设置变量不会自动重建容器或替换现有数据卷。修改已有环境须先停止 RisingWave、离线备份数据卷，再用原镜像和原卷重建容器。

本机调整前容器约占 3.76 GiB，低内存配置恢复后约占 1.1～1.3 GiB；两次启动的峰值接近 2 GiB，因此没有将硬上限继续压低。实测范围为当前本机数据和收件箱读取，后续大批量导入或复杂查询仍需观察内存与延迟。

验收通过：全部／未读／提及／未读提及收件箱及未读摘要均返回 200；前三种筛选与 PostgreSQL 的完整结果一致；重启后再次通过。1,890 条消息、242 个附件、账号、频道、Agent 和本机凭据摘要保持一致，21 个物化视图及主要派生表行数保留。通过一次成员表同值更新验证 CDC 消费计数在 1 秒内推进，成员数据逐字摘要不变，容器未发生 OOM。启动器测试 138 项通过、10 项公开快照契约跳过，类型检查通过；最终资源上限调整后，RisingWave 专项 28 项通过、5 项跳过。

参数依据为该版本官方源码的[单节点预算分配](https://github.com/risingwavelabs/risingwave/blob/v2.8.0/src/cmd_all/src/single_node.rs)和[compactor 内存检查](https://github.com/risingwavelabs/risingwave/blob/v2.8.0/src/storage/compactor/src/server.rs)。上述结果以本机真实数据和运行验收为准。

调整时保留的旧容器 `raft-rw-before-low-memory-20261108` 已于同日按用户要求删除，依赖该容器的原回退脚本同步移除。当前低内存容器、业务数据卷、离线备份卷 `raft-rw-data-before-low-memory-20261108`，以及 `.slockdev/raft-build/low-memory-validation/` 下的 PostgreSQL 备份、原容器配置和校验摘要均保留。

若需要回退，须根据保存的 `original-container.json` 重新创建原配置的容器，并复用当前原数据卷与原镜像，不恢复旧快照覆盖后续业务数据。备份卷仅供额外恢复使用；不要同时启动两个挂载原 RisingWave 数据卷的容器。

容器上限与 Docker Desktop 的虚拟机上限分别配置。首次仅调整 RisingWave 时，Docker Desktop 仍保留 8 GiB 配额，macOS 上虚拟机占用未立即下降。同日后续已通过 Docker Desktop 的 Resources 设置将总配额降至 5 GiB，正常停止持久环境后应用设置、重启 Docker，再使用日常入口恢复全部服务。

5 GiB 配额下，四个业务容器正常运行且未发生 OOM，收件箱四种筛选、未读摘要、PostgreSQL／RisingWave 一致性和 CDC 实时消费均通过；重启前后的全部数据与凭据摘要一致。Mac 虚拟机进程实测从约 8,208 MiB 降至 4,153 MiB。检查期间系统内存压力曾降至正常，最终复测回到警告，说明整机压力仍有波动，不能据此认定卡顿已完全解决。校验摘要保存在 `.slockdev/raft-build/low-memory-validation/before-docker-5g.json` 和 `after-docker-5g.json`。当前保留 5 GiB 总配额，后续大规模导入或并行构建仍需结合峰值观察，不能只根据容器稳态占用继续压低。

### 启用持久收件箱

首次为已有环境启用：

```sh
./raftdev start <name> --persistent --risingwave
```

持久模式保留原 PostgreSQL 容器和数据卷，通过 `ALTER SYSTEM` 启用逻辑复制并重启数据库，然后初始化 CDC 与物化视图。RisingWave 使用独立命名卷 `slock-dev-<name>-risingwave-data` 保存状态。启用结果写入环境配置，后续普通 `start` 自动恢复，启动时只验证既有复制槽和视图，不重建数据库或重新 seed。

日常 `stop` 保留四个数据卷。缺失已启用的 RisingWave 卷时拒绝创建空状态替代，需先恢复；只有显式 `destroy --yes` 才删除卷。

持久 RisingWave 与其他本地容器一致，使用 Docker 的 `no` 重启策略，不随 Docker 启动，也不在退出后自动重启。电脑从休眠唤醒后，单节点服务若因内部心跳过期退出，可再次执行 `start`，复用原容器和命名卷恢复 CDC 与视图。旧容器在下次 `start` 时原地关闭自动重启；环境健康运行时也会检查，无需重启应用或 Agent。临时预览环境同样不启用自动重启。

附件启动配置包含旧桶和独立的 `<旧桶名>-direct` 桶。旧附件继续使用原存储，新版 `attachments/v2/` 原件和直传使用专用桶。两个桶都保存在原 RustFS 持久卷中；本地凭据由启动脚本注入，不写入文档或版本库。

本地 RustFS 使用 HTTP，Agent CLI 只接受 HTTPS 下载重定向，因此本地启动显式设置 `S3_DOWNLOAD_PROXY_ENABLED=true`，由 Raft 的鉴权接口流式返回附件，用户与 Agent 下载都经过原有访问检查。该开关只影响 GET 下载，保留大文件直传能力；线上默认仍使用签名 URL。
