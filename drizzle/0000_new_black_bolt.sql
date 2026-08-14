CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stage` text NOT NULL,
	`round_number` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_name_unique` ON `participants` (`name`);--> statement-breakpoint
CREATE TABLE `results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`participant_id` integer NOT NULL,
	`points` integer NOT NULL,
	`placement` integer NOT NULL,
	`selected_chart` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `results_match_participant_unique` ON `results` (`match_id`,`participant_id`);