ALTER TABLE "push_registrations" DROP CONSTRAINT "push_registrations_provider_check";--> statement-breakpoint
ALTER TABLE "push_registrations" ADD CONSTRAINT "push_registrations_provider_check" CHECK ("push_registrations"."provider" IN ('apns', 'fcm'));--> statement-breakpoint
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
	'mobile_push_fcm_v0',
	'Android (FCM) mobile push delivery; off by default until FCM credentials are configured, then rolled out by rule',
	true,
	false,
	'server',
	false,
	NULL,
	'mobile_push_fcm_v0'
) ON CONFLICT ("key") DO NOTHING;
