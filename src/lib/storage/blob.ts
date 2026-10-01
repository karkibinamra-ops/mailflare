import { eq, asc } from "drizzle-orm";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/db";
import { blobChunks } from "@/db/schema";

const CHUNK_SIZE = 1_800_000;

function externalStorageConfigured(env: CloudflareEnv): boolean {
  return Boolean(
    env.ATTACHMENT_STORAGE_ENDPOINT &&
      env.ATTACHMENT_STORAGE_BUCKET &&
      env.ATTACHMENT_STORAGE_ACCESS_KEY_ID &&
      env.ATTACHMENT_STORAGE_SECRET_ACCESS_KEY,
  );
}

function storageUrl(env: CloudflareEnv, key: string): string {
  const endpoint = env.ATTACHMENT_STORAGE_ENDPOINT!.replace(/\/$/, "");
  const bucket = encodeURIComponent(env.ATTACHMENT_STORAGE_BUCKET!);
  const encodedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${endpoint}/${bucket}/${encodedKey}`;
}

function storageClient(env: CloudflareEnv): AwsClient {
  return new AwsClient({
    accessKeyId: env.ATTACHMENT_STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: env.ATTACHMENT_STORAGE_SECRET_ACCESS_KEY!,
    service: "s3",
    region: env.ATTACHMENT_STORAGE_REGION || "us-east-1",
  });
}

async function putExternalBlob(
  env: CloudflareEnv,
  key: string,
  bytes: Uint8Array,
  contentType?: string,
): Promise<void> {
  const response = await storageClient(env).fetch(storageUrl(env, key), {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
    },
    body: bytes,
  });

  if (!response.ok) {
    throw new Error(`External object storage PUT failed: ${response.status}`);
  }
}

async function getExternalBlob(
  env: CloudflareEnv,
  key: string,
  range?: string,
): Promise<{ data: ArrayBuffer; contentType: string | null } | null> {
  const headers: Record<string, string> = {};
  if (range) headers.Range = range;

  const response = await storageClient(env).fetch(storageUrl(env, key), {
    method: "GET",
    headers,
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`External object storage GET failed: ${response.status}`);
  }

  return {
    data: await response.arrayBuffer(),
    contentType: response.headers.get("content-type"),
  };
}

async function deleteExternalBlob(
  env: CloudflareEnv,
  key: string,
): Promise<void> {
  const response = await storageClient(env).fetch(storageUrl(env, key), {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`External object storage DELETE failed: ${response.status}`);
  }
}

export async function putBlob(
  env: CloudflareEnv,
  key: string,
  data: ArrayBuffer | Uint8Array,
  contentType?: string,
): Promise<void> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (externalStorageConfigured(env)) {
    await deleteExternalBlob(env, key);
    await putExternalBlob(env, key, bytes, contentType);
    return;
  }

  const db = getDb(env);
  await deleteBlob(env, key);

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    chunks.push(bytes.slice(offset, offset + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push(new Uint8Array());

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
  if (externalStorageConfigured(env)) {
    const external = await getExternalBlob(env, key);
    if (external) return external;
  }

  const db = getDb(env);
  const rows = await db
    .select()
    .from(blobChunks)
    .where(eq(blobChunks.key, key))
    .orderBy(asc(blobChunks.chunkIndex));

  if (rows.length === 0) return null;

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
  const limit = length ?? Number.POSITIVE_INFINITY;

  if (externalStorageConfigured(env)) {
    if (!Number.isFinite(limit)) {
      const blob = await getExternalBlob(env, key);
      return blob?.data ?? null;
    }

    if (limit <= 0) return new ArrayBuffer(0);
    const blob = await getExternalBlob(env, key, `bytes=0-${limit - 1}`);
    return blob?.data ?? null;
  }

  const db = getDb(env);

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
  if (externalStorageConfigured(env)) {
    await deleteExternalBlob(env, key);
  }

  const db = getDb(env);
  await db.delete(blobChunks).where(eq(blobChunks.key, key));
}
