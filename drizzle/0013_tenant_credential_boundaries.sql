CREATE TABLE `storeCredentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`storeCredentialType` enum('staff_portal','frigate') NOT NULL,
	`credentialHash` varchar(64) NOT NULL,
	`label` varchar(160) NOT NULL DEFAULT '',
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storeCredentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `storeCredentials_type_hash_unique` UNIQUE(`storeCredentialType`,`credentialHash`)
);
--> statement-breakpoint
ALTER TABLE `stores` ADD `isActive` int DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `storeCredentials` ADD CONSTRAINT `storeCredentials_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX `idx_storeCredentials_storeId` ON `storeCredentials` (`storeId`);
