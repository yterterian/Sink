CREATE TABLE `link_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`link_id` text,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`auth_method` text,
	`ip` text,
	`country` text,
	`reason` text,
	`changes` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `link_audit_slug_created_at_desc_idx` ON `link_audit` (`slug`,"created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `link_audit_created_at_desc_idx` ON `link_audit` ("created_at" desc,"id" desc);--> statement-breakpoint
ALTER TABLE `links` ADD `locked` integer;