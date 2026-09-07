import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { backups } from "@/db/schema";
import { assertAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const env = getEnv();

	try {
		const user = await requireUser(env, request);
		assertAdmin(user);

		const { id } = await params;

		const [backup] = await getDb(env)
			.select()
			.from(backups)
			.where(eq(backups.id, id))
			.limit(1);

		// Backup files are not stored in R2 in this deployment.
		if (!backup || backup.status !== "completed") {
			return NextResponse.json(
				{ error: "Backup file not found" },
				{ status: 404 },
			);
		}

		return NextResponse.json(
			{
				error:
					"Stored backup downloads are disabled because this deployment does not use Cloudflare R2.",
			},
			{ status: 404 },
		);
	} catch {
		return NextResponse.json(
			{ error: "Forbidden" },
			{ status: 403 },
		);
	}
}
