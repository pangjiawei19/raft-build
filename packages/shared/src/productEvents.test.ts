import assert from "node:assert/strict";
import {
  PRODUCT_EVENT_REGISTRY,
  type ProductEventSpec,
  campaignToken,
  referrerHostname,
  validateProductEvent,
} from "./productEvents";

// Product events are designed on purpose (RFC-067 §3.2). Changing this list is
// a deliberate act that needs the event-registry owner's sign-off.
test("the product event registry changes only on purpose", () => {
  assert.deepEqual(Object.keys(PRODUCT_EVENT_REGISTRY).sort(), [
    "activity_item_open",
    "activity_mark",
    "activity_open",
    "agent_create_opened",
    "announcement_interacted",
    "announcement_shown",
    "bulk_model_change_closed",
    "bulk_model_change_finished",
    "bulk_model_change_opened",
    "bulk_model_change_submitted",
    "community_cn_qr_page_view",
    "nav_entry_selected",
    "page_viewed",
    "public_page_channel_opened",
    "public_page_server_joined",
    "public_page_thread_opened",
    "public_page_viewed",
    "pwa_install_appinstalled",
    "pwa_install_cta_clicked",
    "pwa_install_cta_shown",
    "pwa_install_eligible",
    "pwa_install_ios_instruction_dismissed",
    "pwa_install_native_prompt_result",
    "pwa_install_standalone_detected",
  ]);
});

test("every entry states its question and stays JSON-shaped", () => {
  const entries: Array<[string, ProductEventSpec]> = Object.entries(PRODUCT_EVENT_REGISTRY);
  for (const [name, spec] of entries) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, name);
    assert.ok(spec.question.trim().length > 0, `${name} needs a question`);
    assert.ok(spec.requestedBy.trim().length > 0, `${name} needs a requester`);
    assert.ok(spec.sources.length > 0, `${name} needs a source`);
    for (const property of Object.keys(spec.properties)) {
      assert.match(property, /^[a-z][a-z0-9_]*$/, `${name}.${property}: \`$\` names are reserved for the pipeline`);
    }
  }
  // Native clients generate their APIs from a JSON export (RFC-067 §6).
  assert.deepEqual(JSON.parse(JSON.stringify(PRODUCT_EVENT_REGISTRY)), PRODUCT_EVENT_REGISTRY);
});

test("validateProductEvent accepts registered events and rejects everything else", () => {
  assert.deepEqual(validateProductEvent("activity_open", { from: "rail" }, "web"), { ok: true, event: "activity_open" });
  assert.deepEqual(validateProductEvent("activity_open", {}, "desktop"), { ok: true, event: "activity_open" });
  assert.deepEqual(
    validateProductEvent("community_cn_qr_page_view", { from: "wechat_group_3" }, "web"),
    { ok: true, event: "community_cn_qr_page_view" },
  );

  assert.deepEqual(validateProductEvent("button_clicked", {}, "web"), { ok: false, reason: "unregistered_event" });
  assert.deepEqual(validateProductEvent("toString", {}, "web"), { ok: false, reason: "unregistered_event" });
  assert.deepEqual(validateProductEvent("activity_open", { from: "rail" }, "ios"), { ok: false, reason: "source_not_allowed" });
  assert.deepEqual(
    validateProductEvent("activity_open", { from: "rail", text: "hello" }, "web"),
    { ok: false, reason: "unknown_property", property: "text" },
  );
  assert.deepEqual(
    validateProductEvent("activity_open", { from: "elsewhere" }, "web"),
    { ok: false, reason: "invalid_property_value", property: "from" },
  );
  assert.deepEqual(
    validateProductEvent("community_cn_qr_page_view", { from: "x".repeat(65) }, "web"),
    { ok: false, reason: "invalid_property_value", property: "from" },
  );
  for (const from of ["someone@example.com", "+86 138 0000 0000", "WeChat", "join the group"]) {
    assert.deepEqual(
      validateProductEvent("community_cn_qr_page_view", { from }, "web"),
      { ok: false, reason: "invalid_property_value", property: "from" },
      from,
    );
  }
});

// Public Server visit sources (cindyz, 2026-10-14): a host name, never a URL.
test("hostname properties keep a referring site's host name and nothing more", () => {
  const viewed = (referrer_domain: unknown) => validateProductEvent("public_page_viewed", { referrer_domain }, "server");
  for (const host of ["x.com", "news.ycombinator.com", "xn--fiqs8s.cn"]) {
    assert.deepEqual(viewed(host), { ok: true, event: "public_page_viewed" }, host);
  }
  for (const value of [
    "https://x.com/someone/status/1", "x.com/path", "localhost", "192.168.1.10", "X.com", "x.com:8080",
    "someone@example.com", "", 42,
  ]) {
    assert.deepEqual(viewed(value), { ok: false, reason: "invalid_property_value", property: "referrer_domain" }, String(value));
  }

  assert.equal(referrerHostname("https://www.Google.com/search?q=raft"), "google.com");
  assert.equal(referrerHostname("https://t.co/abc"), "t.co");
  assert.equal(referrerHostname("http://raft.build/"), "raft.build");
  for (const referrer of ["", "not a url", "android-app://com.slack/", "http://10.0.0.1/", "http://[::1]/", "http://intranet/"]) {
    assert.equal(referrerHostname(referrer), null, referrer);
  }
});

test("campaignToken lowercases a utm value but never rewrites it into a token", () => {
  assert.equal(campaignToken(" Newsletter_Oct "), "newsletter_oct");
  assert.equal(campaignToken("launch-2026"), "launch-2026");
  for (const value of [null, undefined, "", "someone@example.com", "spring sale", "news.ycombinator.com", "x".repeat(65)]) {
    assert.equal(campaignToken(value), null, String(value));
  }
});


test("announcement samples accept version identity and reject content or URL properties", () => {
  const properties = { announcement_id: "90000000-0000-4000-8000-000000000001", delivery_version: 7 };
  for (const event of ["announcement_shown", "announcement_interacted"]) {
    assert.equal(validateProductEvent(event, event === "announcement_interacted" ? { ...properties, action: "primary", has_cta: true } : properties, "web").ok, true);
    assert.equal(validateProductEvent(event, event === "announcement_interacted" ? { ...properties, action: "primary", has_cta: true } : properties, "desktop").ok, true);
    assert.equal(validateProductEvent(event, event === "announcement_interacted" ? { ...properties, action: "primary", has_cta: true } : properties, "server").ok, false);
    for (const key of ["title", "body", "url", "user_id"]) assert.equal(validateProductEvent(event, { ...properties, ...(event === "announcement_interacted" ? { action: "primary", has_cta: true } : {}), [key]: "private" }, "web").ok, false);
  }
});

test("announcement interaction accepts explicit controls and rejects unclassified actions", () => {
  for (const action of ["primary", "secondary", "close", "outside", "escape"]) {
    assert.equal(validateProductEvent("announcement_interacted", { announcement_id: "90000000-0000-4000-8000-000000000001", delivery_version: 7, action, has_cta: true }, "web").ok, true);
  }
  assert.equal(validateProductEvent("announcement_interacted", { announcement_id: "90000000-0000-4000-8000-000000000001", delivery_version: 7, action: "unknown", has_cta: true }, "web").ok, false);
});

test("new announcement events distinguish missing required properties from invalid values", () => {
  const complete = { announcement_id: "90000000-0000-4000-8000-000000000001", delivery_version: 7, action: "primary", has_cta: true };
  assert.deepEqual(validateProductEvent("announcement_interacted", complete, "web"), { ok: true, event: "announcement_interacted" });
  for (const event of ["announcement_shown", "announcement_interacted"] as const) {
    const keys = event === "announcement_shown" ? ["announcement_id", "delivery_version"] : Object.keys(complete);
    for (const property of keys) {
      const props: Record<string, string | number | boolean | undefined> = event === "announcement_shown"
        ? { announcement_id: complete.announcement_id, delivery_version: 7 } : { ...complete };
      delete props[property];
      assert.deepEqual(validateProductEvent(event, props, "web"), { ok: false, reason: "missing_property", property });
      props[property] = undefined;
      assert.deepEqual(validateProductEvent(event, props, "web"), { ok: false, reason: "missing_property", property });
    }
  }
  assert.deepEqual(validateProductEvent("announcement_interacted", { ...complete, has_cta: "true" }, "web"), { ok: false, reason: "invalid_property_value", property: "has_cta" });
  assert.equal(validateProductEvent("page_viewed", {}, "web").ok, true, "existing event contracts stay optional");
});

// xxchan 2026-10-17: the one event the native apps may send so far, so web and
// native entries compare in one table.
test("nav_entry_selected comes from web and the native apps, and always says where, from which entry, and whether already there", () => {
  const complete = { destination: "tasks", surface: "mobile_tab_bar", was_active: false };
  for (const source of ["web", "desktop", "ios", "android", "harmonyos"] as const) {
    assert.deepEqual(validateProductEvent("nav_entry_selected", complete, source), { ok: true, event: "nav_entry_selected" });
  }
  assert.deepEqual(validateProductEvent("nav_entry_selected", complete, "server"), { ok: false, reason: "source_not_allowed" });
  for (const property of Object.keys(complete)) {
    const props: Record<string, unknown> = { ...complete };
    delete props[property];
    assert.deepEqual(validateProductEvent("nav_entry_selected", props, "ios"), { ok: false, reason: "missing_property", property });
  }
  assert.deepEqual(validateProductEvent("nav_entry_selected", { ...complete, destination: "raftbench" }, "web"), { ok: false, reason: "invalid_property_value", property: "destination" });
  assert.deepEqual(validateProductEvent("nav_entry_selected", { ...complete, path: "/s/x/tasks" }, "web"), { ok: false, reason: "unknown_property", property: "path" });
  assert.equal(validateProductEvent("nav_entry_selected", { ...complete, display_mode: "standalone" }, "web").ok, true);
});
