import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
const URL_ENV = process.env.REFERRAL_RETIREMENT_TEST_DATABASE_URL;
if (!URL_ENV && process.env.REFERRAL_RETIREMENT_REAL_PG_REQUIRED === "1")
    throw new Error("Set REFERRAL_RETIREMENT_TEST_DATABASE_URL to an isolated loopback PostgreSQL server");
const pgTest = URL_ENV ? test : test.skip;
const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const tables = [
    "referral_discount_financial_adjustment_resolutions", "referral_discount_financial_adjustments", "referral_discount_redemptions", "referral_discount_codes", "referral_discount_campaigns",
    "billing_paid_identity_resolutions", "billing_paid_identity_events", "billing_paid_history_coverage", "referral_discount_provider_events", "referral_discount_provider_operations",
];
let control: pg.Client;
let template: string;
let rootUrl: URL;
let copied: string;
beforeAll(async () => {
    if (!URL_ENV)
        return;
    rootUrl = new URL(URL_ENV);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(rootUrl.hostname))
        throw new Error("Retirement tests require loopback PostgreSQL");
    control = new pg.Client({ connectionString: rootUrl.toString() });
    await control.connect();
    template = `referral_retirement_base_${randomUUID().replaceAll("-", "")}`;
    await control.query(`CREATE DATABASE "${template}"`);
    copied = mkdtempSync(join(tmpdir(), "referral-history-"));
    mkdirSync(join(copied, "meta"));
    const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((entry: {
        idx: number;
    }) => entry.idx <= 335);
    for (const entry of journal.entries)
        copyFileSync(join(folder, `${entry.tag}.sql`), join(copied, `${entry.tag}.sql`));
    writeFileSync(join(copied, "meta/_journal.json"), JSON.stringify(journal));
    const url = new URL(rootUrl);
    url.pathname = `/${template}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
        await migrate(drizzle(client), { migrationsFolder: copied });
    }
    finally {
        await client.end();
    }
}, 60000);
afterAll(async () => {
    if (template && control)
        await control.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`);
    if (control)
        await control.end();
    if (copied)
        rmSync(copied, { recursive: true, force: true });
});
async function fixture(run: (client: pg.Client, url: string) => Promise<void>) {
    const name = `referral_retirement_${randomUUID().replaceAll("-", "")}`;
    await control.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    const url = new URL(rootUrl);
    url.pathname = `/${name}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
        await run(client, url.toString());
    }
    finally {
        await client.end();
        await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
}
async function present(client: pg.Client) { const result = await client.query("SELECT name,to_regclass('public.'||name) IS NOT NULL AS present FROM unnest($1::text[]) AS name", [tables]); return result.rows; }
async function pgFailure(work: Promise<unknown>): Promise<{
    code: string;
    message: string;
}> {
    try {
        await work;
        return { code: "NO_ERROR", message: "Unexpected success" };
    }
    catch (error: unknown) {
        let current: unknown = error;
        while (current && typeof current === "object") {
            if ("code" in current && typeof current.code === "string")
                return { code: current.code, message: "message" in current && typeof current.message === "string" ? current.message : "" };
            current = "cause" in current ? current.cause : null;
        }
        throw error;
    }
}
pgTest("empty 0335 database upgrades and all ten tables disappear without disturbing normal billing", async () => fixture(async (client) => {
    expect((await present(client)).every(r => r.present)).toBe(true);
    const oldCount = (await client.query("SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n;
    // 0336 plus any migration added after it.
    const laterMigrations = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")).entries.filter((entry: {
        idx: number;
    }) => entry.idx > 335).length;
    await migrate(drizzle(client), { migrationsFolder: folder });
    expect((await present(client)).every(r => !r.present)).toBe(true);
    expect((await client.query("SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(oldCount + laterMigrations);
    expect((await client.query("SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.subscriptions') IS NOT NULL AND to_regclass('public.webhook_events') IS NOT NULL AS normal")).rows[0].normal).toBe(true);
}), 30000);
pgTest("unexpected external dependencies also abort without partially dropping tables", async () => fixture(async (client) => {
    await client.query("CREATE TABLE public.synthetic_external_dependency(id uuid REFERENCES public.referral_discount_campaigns(id))");
    expect((await pgFailure(migrate(drizzle(client), { migrationsFolder: folder }))).code).toBe("2BP01");
    expect((await present(client)).every(r => r.present)).toBe(true);
}), 30000);
