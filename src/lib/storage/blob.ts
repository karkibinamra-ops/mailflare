import { eq, and, asc } from "drizzle-orm";
import { getDb } from "@/db";
import { blobChunks } from "@/db/schema";

const CHUNK_SIZE = 1_800_000;

export async function putBlob(
	env: CloudflareEnv,
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
	env: CloudflareEnv,
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
  env: CloudflareEnv,
  key: string,
  length?: number,
): Promise<ArrayBuffer | null> {
  const db = getDb(env);
  const limit = length ?? Number.POSITIVE_INFINITY;

  if (!Number.isFinite(limit)) {
    const blob = await getBlob(env, key);
    return blob?.data ?? null;
  }

  if (limit <= 0) return new ArrayBuffer(0);

  const chunkCount = Math.max(1, Math.ceil(limit / CHUNK_SIZE));
  const rows = await db
    .select({
      chunkIndex: blobChunks.chunkIndex,
      data: blobChunks.data,
    })
    .from(blobChunks)
    .where(eq(blobChunks.key, key))
    .orderBy(asc(blobChunks.chunkIndex))
    .limit(chunkCount);

  if (rows.length === 0) return null;

  const targetSize = Math.min(
    limit,
    rows.reduce((sum, row) => sum + row.data.length, 0),
  );
  const output = new Uint8Array(targetSize);
  let offset = 0;

  for (const row of rows) {
    if (offset >= targetSize) break;
    const take = Math.min(row.data.length, targetSize - offset);
    output.set(row.data.subarray(0, take), offset);
    offset += take;
  }

  return output.buffer;
}

export async function deleteBlob(
	env: CloudflareEnv,
	key: string,
): Promise<void> {
	const db = getDb(env);

	await db
		.delete(blobChunks)
		.where(eq(blobChunks.key, key));
}
