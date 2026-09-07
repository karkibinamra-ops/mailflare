import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
	ALLOWED_AVATAR_TYPES,
	MAX_AVATAR_SIZE,
	avatarKeyFor,
	isUploadedAvatarFile,
} from "@/app/api/profile/avatar/utils";
import { deleteBlob, getBlob, putBlob } from "@/lib/storage/blob";
import type { AccountRouteParams } from "../types";
import { getManagedAccount } from "./utils";

export async function GET(request: Request, { params }: AccountRouteParams) {
	const { id } = await params;
	const { access, account } = await getManagedAccount(request, id);

	if (access.error) return access.error;
	if (!account?.avatarKey) return new Response("Not found", { status: 404 });

	const blob = await getBlob(access.env, account.avatarKey);

	if (!blob) return new Response("Not found", { status: 404 });

	return new Response(blob.data, {
		headers: {
			"Content-Type": blob.contentType ?? "application/octet-stream",
			"Cache-Control": "private, no-cache",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

export async function POST(request: Request, { params }: AccountRouteParams) {
	const { id } = await params;
	const { access, account } = await getManagedAccount(request, id);

	if (access.error) return access.error;

	if (!account) {
		return NextResponse.json(
			{ error: "Account not found" },
			{ status: 404 },
		);
	}

	const form = await request.formData();
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

	const key = avatarKeyFor(account.id);
	const data = await file.arrayBuffer();

	await putBlob(access.env, key, data, file.type);

	await getDb(access.env)
		.update(users)
		.set({ avatarKey: key })
		.where(eq(users.id, account.id));

	return NextResponse.json({ ok: true });
}

export async function DELETE(
	request: Request,
	{ params }: AccountRouteParams,
) {
	const { id } = await params;
	const { access, account } = await getManagedAccount(request, id);

	if (access.error) return access.error;

	if (!account) {
		return NextResponse.json(
			{ error: "Account not found" },
			{ status: 404 },
		);
	}

	if (account.avatarKey) {
		await deleteBlob(access.env, account.avatarKey);

		await getDb(access.env)
			.update(users)
			.set({ avatarKey: null })
			.where(eq(users.id, account.id));
	}

	return NextResponse.json({ ok: true });
}
