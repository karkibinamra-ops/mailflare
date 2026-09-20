import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { backups } from "@/db/schema";
import { deleteBlob, putBlob } from "@/lib/storage/blob";
import { exportDatabaseRecords } from "./export";
import { createScheduledBackupIfDue, getBackupSettings } from "./service";

// D1's per-database size budget is finite (a few GB on the Free plan), and a
// backup blob is duplicated storage on top of the live tables it captured, so
// an unbounded export could quietly exhaust the database. Fail clearly well
// before that instead of writing a backup that might not fit.
const MAX_BACKUP_SIZE_BYTES = 50 * 1024 * 1024;

function backupBlobKey(backupId: string): string {
	return `backups/${backupId}.json`;
}

export async function runDatabaseBackup(
	env: CloudflareEnv,
	backupId: string,
): Promise<void> {
	const db = getDb(env);
	const startedAt = new Date();
	await db
		.update(backups)
		.set({ status: "running", startedAt })
		.where(eq(backups.id, backupId));

	try {
		const data = await exportDatabaseRecords(env.DB);

		if (data.byteLength > MAX_BACKUP_SIZE_BYTES) {
			throw new Error(
				`Backup is ${(data.byteLength / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${MAX_BACKUP_SIZE_BYTES / (1024 * 1024)} MB limit for database-stored backups.`,
			);
		}

		const key = backupBlobKey(backupId);
		const filename = `mailflare-backup-${backupId}.json`;
		await putBlob(env, key, data, "application/json");

		await db
			.update(backups)
			.set({
				status: "completed",
				r2Key: key,
				filename,
				size: data.byteLength,
				completedAt: new Date(),
			})
			.where(eq(backups.id, backupId));
	} catch (error) {
		const message = error instanceof Error ? error.message : "Backup failed";
		await db
			.update(backups)
			.set({ status: "failed", error: message, completedAt: new Date() })
			.where(eq(backups.id, backupId));
		throw error instanceof Error ? error : new Error(message);
	}
}

export async function runScheduledDatabaseBackup(
	env: CloudflareEnv,
	now: Date,
): Promise<void> {
	await deleteExpiredBackups(env);

	const backupId = await createScheduledBackupIfDue(env, now);
	if (!backupId) return;

	try {
		await runDatabaseBackup(env, backupId);
	} catch (error) {
		// runDatabaseBackup already recorded the failure on the row; the
		// scheduler itself must not throw, or the cron trigger would report the
		// whole invocation as failed for what is already a handled outcome.
		console.warn("runScheduledDatabaseBackup: scheduled backup failed", error);
	}
}

export async function deleteExpiredBackups(
	env: CloudflareEnv,
): Promise<number> {
	const settings = await getBackupSettings(env);

	if (!settings?.retentionEnabled) return 0;

	const cutoff = new Date(
		Date.now() - settings.retentionDays * 86_400_000,
	);

	const db = getDb(env);

	const expired = await db
		.select()
		.from(backups)
		.where(
			and(
				lt(backups.createdAt, cutoff),
				inArray(backups.status, ["completed", "failed"]),
			),
		);

	for (const backup of expired) {
		if (backup.r2Key) {
			await deleteBlob(env, backup.r2Key).catch((err) =>
				console.warn(`deleteExpiredBackups: failed to delete blob for ${backup.id}`, err),
			);
		}
		await db
			.delete(backups)
			.where(eq(backups.id, backup.id));
	}

	return expired.length;
}
