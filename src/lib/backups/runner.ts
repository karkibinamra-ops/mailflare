import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { backups } from "@/db/schema";
import { createScheduledBackupIfDue, getBackupSettings } from "./service";

export async function runDatabaseBackup(
	env: CloudflareEnv,
	backupId: string,
): Promise<void> {
	const db = getDb(env);

	const message =
		"Stored database backups are disabled because this deployment does not use Cloudflare R2.";

	await db
		.update(backups)
		.set({
			status: "failed",
			error: message,
			completedAt: new Date(),
		})
		.where(eq(backups.id, backupId));

	throw new Error(message);
}

export async function runScheduledDatabaseBackup(
	env: CloudflareEnv,
	now: Date,
): Promise<void> {
	// Stored scheduled backups require object storage.
	// R2 is intentionally disabled in this deployment, so do not create
	// scheduled backup records that cannot be stored.
	await deleteExpiredBackups(env);

	// Keep the parameter in the function signature because the Worker
	// scheduler still calls this function.
	void now;

	// Prevent the imported helper from becoming part of the active flow.
	void createScheduledBackupIfDue;
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
		await db
			.delete(backups)
			.where(eq(backups.id, backup.id));
	}

	return expired.length;
}
