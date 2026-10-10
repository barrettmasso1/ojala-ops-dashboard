ALTER TABLE `stores` ADD `posType` enum('none','square','toast','shopify','other') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `cupSizesJson` text;