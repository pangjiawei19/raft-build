import { Router, type Router as RouterType } from "express";
import * as featureFlagService from "../services/featureFlagService";
import { sendJsonServerError } from "./errorResponse";

// Task #205: before-login feature flags. Mounted without auth: there is no user and no server, so
// only flags marked pre_auth_evaluable answer, from their kill switch, enabled bit, platform rules and
// default. Credentials on the request are ignored, so one URL always has one answer and can be cached.
export const publicFeatureFlagsRouter: RouterType = Router();

const FLAG_KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const PLATFORMS = new Set<featureFlagService.FeatureFlagPlatform>(["web", "mobile"]);
const MAX_KEYS = 50;

publicFeatureFlagsRouter.get("/", async (req, res) => {
  try {
    const rawKeys = typeof req.query.keys === "string" ? req.query.keys.split(",") : [];
    const keys = rawKeys.map((key) => key.trim());
    if (keys.length === 0 || keys.length > MAX_KEYS || keys.some((key) => !FLAG_KEY_RE.test(key))) {
      res.status(400).json({ error: `keys must contain 1-${MAX_KEYS} valid feature flag keys` });
      return;
    }

    const rawPlatform = req.query.platform;
    if (rawPlatform !== undefined && !(typeof rawPlatform === "string" && PLATFORMS.has(rawPlatform as featureFlagService.FeatureFlagPlatform))) {
      res.status(400).json({ error: "platform must be web or mobile" });
      return;
    }
    const platform = (rawPlatform as featureFlagService.FeatureFlagPlatform | undefined) ?? null;

    const flags = await featureFlagService.evaluatePreAuthFeatureFlags(keys, platform);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ flags });
  } catch (err) {
    sendJsonServerError(req, res, {
      error: "Failed to evaluate feature flags",
      logPrefix: "Public feature flag evaluate error:",
      err,
    });
  }
});
