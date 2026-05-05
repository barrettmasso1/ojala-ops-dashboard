CREATE TABLE `staffAttendance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` varchar(10) NOT NULL,
	`staffAttendanceName` enum('Karol','Anhec','Jesse','Esme') NOT NULL,
	`clockInAt` bigint NOT NULL,
	`clockOutAt` bigint,
	`submittedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `staffAttendance_id` PRIMARY KEY(`id`)
);
