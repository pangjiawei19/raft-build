-- Thread-unread sidebar mark + jump pill (#wg-thread-unread). Default off; the
-- /raft and /botiverse allow rules are added in FFA after release.
INSERT INTO "feature_flags" (
	"key",
	"description",
	"enabled",
	"kill_switch",
	"randomization_unit",
	"default_enabled",
	"default_variant",
	"salt"
) VALUES (
	'thread_unread_badge_v0',
	'Thread-unread sidebar badge and jump pill rollout gate',
	true,
	false,
	'server',
	false,
	NULL,
	'thread_unread_badge_v0'
) ON CONFLICT ("key") DO NOTHING;
