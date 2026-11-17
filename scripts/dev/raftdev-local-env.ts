import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** 加载本机 dotenv 配置；调用者显式提供的环境变量优先，内容不作为 shell 执行。 */
export function loadLocalEnvironment(file: string | undefined, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!file) return {};
  const parsed = parseEnv(readFileSync(file, "utf8"));
  const carry: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`本机环境配置包含无效变量名，请检查：${file}`);
    }
    env[key] ??= value;
    carry[key] = env[key];
  }
  return carry;
}
