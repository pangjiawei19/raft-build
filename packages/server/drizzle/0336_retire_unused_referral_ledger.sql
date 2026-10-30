-- Retire the unused local referral ledger, children before parents.
DROP TABLE public."referral_discount_financial_adjustment_resolutions" RESTRICT;
--> statement-breakpoint
DROP TABLE public."referral_discount_financial_adjustments" RESTRICT;
--> statement-breakpoint
DROP TABLE public."referral_discount_redemptions" RESTRICT;
--> statement-breakpoint
DROP TABLE public."referral_discount_codes" RESTRICT;
--> statement-breakpoint
DROP TABLE public."referral_discount_campaigns" RESTRICT;
--> statement-breakpoint
DROP TABLE public."billing_paid_identity_resolutions" RESTRICT;
--> statement-breakpoint
DROP TABLE public."billing_paid_identity_events" RESTRICT;
--> statement-breakpoint
DROP TABLE public."billing_paid_history_coverage" RESTRICT;
--> statement-breakpoint
DROP TABLE public."referral_discount_provider_events" RESTRICT;
--> statement-breakpoint
DROP TABLE public."referral_discount_provider_operations" RESTRICT;
