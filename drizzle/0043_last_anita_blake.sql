CREATE TABLE `project_domains` (
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `domain`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_domains_project_created_idx` ON `project_domains` (`project_id`,`created_at`);--> statement-breakpoint
INSERT INTO `project_domains` (`project_id`, `domain`)
SELECT `id`, `domain` FROM `projects`
WHERE `domain` IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP INDEX `gsc_connections_project_idx`;--> statement-breakpoint
ALTER TABLE `gsc_connections` ADD `domain` text;--> statement-breakpoint
UPDATE `gsc_connections`
SET `domain` = CASE
  WHEN `site_url` LIKE 'sc-domain:www.%' THEN lower(substr(`site_url`, 15))
  WHEN `site_url` LIKE 'sc-domain:%' THEN lower(substr(`site_url`, 11))
  WHEN `site_url` LIKE 'https://www.%' THEN lower(substr(`site_url`, 13, instr(substr(`site_url`, 13), '/') - 1))
  WHEN `site_url` LIKE 'https://%' THEN lower(substr(`site_url`, 9, instr(substr(`site_url`, 9), '/') - 1))
  WHEN `site_url` LIKE 'http://www.%' THEN lower(substr(`site_url`, 12, instr(substr(`site_url`, 12), '/') - 1))
  ELSE lower(substr(`site_url`, 8, instr(substr(`site_url`, 8), '/') - 1))
END;--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_connections_project_domain_idx` ON `gsc_connections` (`project_id`,`domain`);
