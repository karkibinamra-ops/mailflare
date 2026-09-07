import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mailboxes } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { deleteBlob, getBlob, putBlob } from "@/lib/storage/blob";
import {
	ALLOWED_AVATAR_TYPES,
	MAX_AVATAR_SIZE,
	isUploadedAvatarFile,
} from "@/app/api/profile/avatar/utils";
import type { MailboxAvatarRouteParams } from "./types";
import { mailboxAvatarKeyFor } from "./utils";

export async function GET(
	request: Request,
	{ params }: MailboxAvatarRouteParams,
) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);

	const access = await getMailboxAccessLevel(db, user, id);
	if (!access?.canRead) {
		return new Response("Not found", { status: 404 });
	}

	const [mailbox] = await db
		.select({ avatarKey: mailboxes.avatarKey })
		.from(mailboxes)
		.where(eq(mailboxes.id, id))
		.limit(1);

	if (!mailbox?.avatarKey) {
		return new Response("Not found", { status: 404 });
	}

	const blob = await getBlob(env, mailbox.avatarKey);

	if (!blob) {
		return new Response("Not found", { status: 404 });
	}

	const headers = new Headers();
	headers.set(
		"Content-Type",
		blob.contentType ?? "application/octet-stream",
	);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set(
		"Content-Security-Policy",
		"default-src 'none'; img-src 'self'; sandbox",
	);
	headers.set("Cache-Control", "private, no-cache");

	return new Response(blob.data, { headers });
}

export async function POST(
	request: Request,
	{ params }: MailboxAvatarRouteParams,
) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);

	const access = await getMailboxAccessLevel(db, user, id);

	if (!access?.canManage) {
		return NextResponse.json(
			{ error: "Mailbox not found" },
			{ status: 404 },
		);
	}

	let form: FormData;

	try {
		form = await request.formData();
	} catch {
		return NextResponse.json(
			{ error: "Expected multipart form data" },
			{ status: 400 },
		);
	}

	const file = form.get("file");

	if (!isUploadedAvatarFile(file)) {
		return NextResponse.json(
			{ error: "Missing image file" },
			{ status: 400 },
		);
	}

	if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
		return NextResponse.json(
			{ error: "Use a JPEG, PNG, WebP, or GIF image" },
			{ status: 400 },
		);
	}

	if (file.size > MAX_AVATAR_SIZE) {
		return NextResponse.json(
			{ error: "Image must be 2 MB or smaller" },
			{ status: 413 },
		);
	}

	const key = mailboxAvatarKeyFor(id);
	const data = await file.arrayBuffer();

	await putBlob(env, key, data, file.type);

	await db
		.update(mailboxes)
		.set({ avatarKey: key })
		.where(eq(mailboxes.id, id));

	return NextResponse.json({ ok: true });
}

export async function DELETE(
	request: Request,
	{ params }: MailboxAvatarRouteParams,
) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);

	const access = await getMailboxAccessLevel(db, user, id);

	if (!access?.canManage) {
		return NextResponse.json(
			{ error: "Mailbox not found" },
			{ status: 404 },
		);
	}

	const [mailbox] = await db
		.select({ avatarKey: mailboxes.avatarKey })
		.from(mailboxes)
		.where(eq(mailboxes.id, id))
		.limit(1);

	if (mailbox?.avatarKey) {
		await deleteBlob(env, mailbox.avatarKey);

		await db
			.update(mailboxes)
			.set({ avatarKey: null })
			.where(eq(mailboxes.id, id));
	}

	return NextResponse.json({ ok: true });
}
