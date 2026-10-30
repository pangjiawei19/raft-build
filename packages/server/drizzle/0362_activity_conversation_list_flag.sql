-- Activity conversation list (#proj-uiux task #5): one row per conversation
-- with avatar, one-line preview and unread count. Default off; the /raft and
-- /botiverse allow rules are added in FFA after release.
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
	'activity_conversation_list_v0',
	'Activity conversation-list layout rollout gate',
	true,
	false,
	'server',
	false,
	NULL,
	'activity_conversation_list_v0'
) ON CONFLICT ("key") DO NOTHING;
