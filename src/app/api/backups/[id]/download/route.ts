import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { backups } from "@/db/schema";
import { assertAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getBlob } from "@/lib/storage/blob";

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

		if (!backup || backup.status !== "completed" || !backup.r2Key) {
			return NextResponse.json(
				{ error: "Backup file not found" },
				{ status: 404 },
			);
		}

		const blob = await getBlob(env, backup.r2Key);
		if (!blob) {
			return NextResponse.json(
				{ error: "Backup file not found" },
				{ status: 404 },
			);
		}

		return new NextResponse(blob.data, {
			headers: {
				"Content-Type": blob.contentType ?? "application/json",
				"Content-Disposition": `attachment; filename="${backup.filename ?? `${backup.id}.json`}"`,
				"Cache-Control": "no-store",
			},
		});
	} catch {
		return NextResponse.json(
			{ error: "Forbidden" },
			{ status: 403 },
		);
	}
}
