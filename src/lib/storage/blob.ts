import { eq, and, asc } from "drizzle-orm";
import { getDb } from "@/db";
import { blobChunks } from "@/db/schema";

const CHUNK_SIZE = 1_800_000;

export async function putBlob(
	env: Cloudflare.Env,
	key: string,
	data: ArrayBuffer | Uint8Array,
	contentType?: string,
): Promise<void> {
	const db = getDb(env);

	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

	await deleteBlob(env, key);

	const chunks: Uint8Array[] = [];

	for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
		chunks.push(bytes.slice(offset, offset + CHUNK_SIZE));
	}

	if (chunks.length === 0) {
		chunks.push(new Uint8Array());
	}

	for (let i = 0; i < chunks.length; i++) {
		await db.insert(blobChunks).values({
			key,
			chunkIndex: i,
			contentType: i === 0 ? contentType ?? null : null,
			data: Buffer.from(chunks[i]),
		});
	}
}

export async function getBlob(
	env: Cloudflare.Env,
	key: string,
): Promise<{ data: ArrayBuffer; contentType: string | null } | null> {
	const db = getDb(env);

	const rows = await db
		.select()
		.from(blobChunks)
		.where(eq(blobChunks.key, key))
		.orderBy(asc(blobChunks.chunkIndex));

	if (rows.length === 0) {
		return null;
	}

	const totalSize = rows.reduce((sum, row) => sum + row.data.length, 0);
	const output = new Uint8Array(totalSize);

	let offset = 0;

	for (const row of rows) {
		output.set(row.data, offset);
		offset += row.data.length;
	}

	return {
		data: output.buffer,
		contentType: rows[0].contentType,
	};
}

export async function getBlobPrefix(
	env: Cloudflare.Env,
	key: string,
	length?: number,
): Promise<ArrayBuffer | null> {
	const blob = await getBlob(env, key);

	if (!blob) {
		return null;
	}

	if (length === undefined) {
		return blob.data;
	}

	return blob.data.slice(0, length);
}

export async function deleteBlob(
	env: Cloudflare.Env,
	key: string,
): Promise<void> {
	const db = getDb(env);

	await db
		.delete(blobChunks)
		.where(eq(blobChunks.key, key));
}
