CREATE TABLE `tournaments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`event_date` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `tournaments` (`id`, `name`, `event_date`) VALUES (1, '第1回 IIDX 王決定戦', '');
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `participants_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tournament_id` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `participants_new` (`id`, `tournament_id`, `name`, `created_at`) SELECT `id`, 1, `name`, `created_at` FROM `participants`;
--> statement-breakpoint
CREATE TABLE `matches_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tournament_id` integer DEFAULT 1 NOT NULL,
	`stage` text NOT NULL,
	`round_number` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `matches_new` (`id`, `tournament_id`, `stage`, `round_number`, `created_at`) SELECT `id`, 1, `stage`, `round_number`, `created_at` FROM `matches`;
--> statement-breakpoint
DROP INDEX `participants_name_unique`;
--> statement-breakpoint
DROP TABLE `participants`;
--> statement-breakpoint
ALTER TABLE `participants_new` RENAME TO `participants`;
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_tournament_name_unique` ON `participants` (`tournament_id`,`name`);
--> statement-breakpoint
DROP TABLE `matches`;
--> statement-breakpoint
ALTER TABLE `matches_new` RENAME TO `matches`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
