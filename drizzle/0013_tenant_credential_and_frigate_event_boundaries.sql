-- Tenant credential and Frigate source-event boundaries. Runs after 0012.
-- No table, row, index, or historical business data is removed.
CREATE TABLE `storeCredentials` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storeId` int NOT NULL,
  `storeCredentialType` enum('staff_portal','frigate') NOT NULL,
  `storeCredentialVerifierFormat` enum('scrypt_v1','sha256_v1') NOT NULL,
  `credentialVerifier` varchar(512) NOT NULL,
  `label` varchar(160) NOT NULL DEFAULT '',
  `revokedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `storeCredentials_id` PRIMARY KEY(`id`),
  CONSTRAINT `storeCredentials_type_verifier_unique` UNIQUE(`storeCredentialType`,`credentialVerifier`)
);
--> statement-breakpoint
ALTER TABLE `stores` ADD `isActive` int DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `frigateCupCounts` ADD `sourceEventId` varchar(128);
--> statement-breakpoint
ALTER TABLE `frigateCupCounts` ADD `sourceEventAt` timestamp;
--> statement-breakpoint
UPDATE `frigateCupCounts`
SET `sourceEventId` = CONCAT('legacy-', `id`), `sourceEventAt` = `receivedAt`
WHERE `sourceEventId` IS NULL OR `sourceEventAt` IS NULL;
--> statement-breakpoint
ALTER TABLE `frigateCupCounts` MODIFY `sourceEventId` varchar(128) NOT NULL;
--> statement-breakpoint
ALTER TABLE `frigateCupCounts` MODIFY `sourceEventAt` timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE `storeCredentials` ADD CONSTRAINT `storeCredentials_storeId_stores_id_fk` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE INDEX `idx_storeCredentials_storeId` ON `storeCredentials` (`storeId`);
