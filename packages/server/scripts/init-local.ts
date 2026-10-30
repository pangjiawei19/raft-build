/** 持久本地环境的最小初始化。只创建真实使用所需的身份和频道，不导入演示数据。 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { channelHumans, channels, machines, serverMembers, servers, users } from "../src/db/schema.js";
import { devSeedOnboardingValues } from "./devSeedOnboarding.js";

async function main(): Promise<void> {
  const output = process.argv[process.argv.indexOf("--output") + 1];
  if (!process.env.DATABASE_URL || !process.argv.includes("--output") || !output) {
    throw new Error("需要 DATABASE_URL 和 --output 凭据文件路径。");
  }
  if (existsSync(output)) throw new Error("凭据文件已存在，拒绝重复初始化。");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const keyFile = `${output}.bootstrap-key`;
  try {
    // 在事务之前保存随机密钥，让初始化被中断后的重试继续使用同一机器身份。
    if (!existsSync(keyFile)) {
      const existing = await db.select({ id: users.id }).from(users).limit(1);
      if (existing.length) throw new Error("数据库已有用户，拒绝覆盖已有环境。");
      writeFileSync(keyFile, `sk_machine_${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
    }
    const apiKey = readFileSync(keyFile, "utf8").trim();
    if (!/^sk_machine_[a-f0-9]{64}$/.test(apiKey)) throw new Error("初始化密钥格式无效。");
    const onboarding = devSeedOnboardingValues(false, new Date());
    const credentials = await db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, "dev@slock.ai"));
      if (!user) {
        [user] = await tx.insert(users).values({
          email: "dev@slock.ai", name: "本地用户", displayName: "本地用户",
          passwordHash: await argon2.hash("password123"), emailVerified: true,
          ...onboarding.user,
        }).returning();
      }
      let [server] = await tx.select().from(servers).where(eq(servers.slug, "dev"));
      if (!server) {
        [server] = await tx.insert(servers).values({ name: "本地工作区", slug: "dev", ownerId: user.id }).returning();
      }
      if (server.ownerId !== user.id) throw new Error("已有工作区不属于本地账号。");
      await tx.insert(serverMembers).values({
        serverId: server.id, userId: user.id, role: "owner", ...onboarding.membership,
      }).onConflictDoNothing();
      let [machine] = await tx.select().from(machines)
        .where(and(eq(machines.serverId, server.id), eq(machines.name, "local-machine")));
      if (!machine) {
        [machine] = await tx.insert(machines).values({
          serverId: server.id, userId: user.id, name: "local-machine",
          apiKeyHash: await argon2.hash(apiKey), apiKeyPrefix: apiKey.slice(0, 20),
        }).returning();
      } else if (!(await argon2.verify(machine.apiKeyHash, apiKey))) {
        throw new Error("已有机器密钥与本地配置不一致，拒绝重置。");
      }
      const basicChannels: { id: string; name: string }[] = [];
      for (const name of ["all", "general"]) {
        let [channel] = await tx.select().from(channels)
          .where(and(eq(channels.serverId, server.id), eq(channels.name, name), eq(channels.type, "channel")));
        if (!channel) {
          [channel] = await tx.insert(channels).values({ serverId: server.id, name, type: "channel" }).returning();
        }
        await tx.insert(channelHumans).values({ channelId: channel.id, userId: user.id }).onConflictDoNothing();
        basicChannels.push({ id: channel.id, name });
      }
      return {
        user: { id: user.id, email: user.email, password: "password123" },
        server: { id: server.id, name: server.name, slug: server.slug },
        machine: { id: machine.id, name: machine.name, apiKey },
        channels: basicChannels,
      };
    });
    const temporary = `${output}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, output);
    console.log("本地环境初始化完成：一个账号、一个工作区、一台机器、两个基础频道；未创建演示消息或测试 Agent。");
  } finally {
    await pool.end();
  }
}

void main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
