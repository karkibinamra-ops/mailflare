import { and, eq } from "drizzle-orm";
import type {
  AttachmentContent,
  AttachmentMetadata,
  StoredAttachment,
} from "./attachment-types";
import { getDb } from "@/db";
import { messageAttachments, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { putBlob, getBlob } from "@/lib/storage/blob";
import type { SessionUser } from "@/lib/auth/types";

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_SIZE = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;

export function decodeBase64Content(content: string): ArrayBuffer {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export function normalizeAttachmentContent(
  content: ArrayBuffer | Uint8Array | string,
  encoding?: "base64" | "utf8",
): ArrayBuffer {
  if (content instanceof ArrayBuffer) return content;

  if (content instanceof Uint8Array) {
    return content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
  }

  if (encoding === "base64") return decodeBase64Content(content);

  return new TextEncoder().encode(content).buffer;
}

function sanitizeFilename(filename: string): string {
  const normalized = filename.trim().replace(/[/\\\0]/g, "_");
  return normalized || "attachment";
}

export function validateAttachments(
  attachments: AttachmentContent[],
): void {
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(
      `A message can include at most ${MAX_ATTACHMENT_COUNT} attachments`,
    );
  }

  let totalSize = 0;

  for (const attachment of attachments) {
    const size = attachment.content.byteLength;

    if (size > MAX_ATTACHMENT_SIZE) {
      throw new Error(
        `${attachment.filename} exceeds the 10 MB attachment limit`,
      );
    }

    totalSize += size;
  }

  if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) {
    throw new Error("Attachments exceed the 20 MB total limit");
  }
}

function toMetadata(
  row: typeof messageAttachments.$inferSelect,
): AttachmentMetadata {
  return {
    id: row.id,
    messageId: row.messageId,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    disposition: row.disposition,
    contentId: row.contentId,
  };
}

export async function storeMessageAttachments(
  env: CloudflareEnv,
  messageId: string,
  attachments: AttachmentContent[],
  options?: { validate?: boolean },
): Promise<StoredAttachment[]> {
  if (options?.validate !== false) {
    validateAttachments(attachments);
  }

  if (attachments.length === 0) return [];

  const db = getDb(env);
  const stored: StoredAttachment[] = [];

  for (const attachment of attachments) {
    const id = newId("att");
    const blobKey = `attachments/${messageId}/${id}`;
    const filename = sanitizeFilename(attachment.filename);
    const size = attachment.content.byteLength;

    // Persist binary first. If the D1 metadata insert fails, the orphaned blob
    // is harmless and can be cleaned up later; the message transaction below
    // only exposes metadata once the binary is present.
    await putBlob(env, blobKey, attachment.content, attachment.type);

    try {
      const row = {
        id,
        messageId,
        filename,
        contentType: attachment.type || "application/octet-stream",
        size,
        disposition: attachment.disposition,
        contentId: attachment.contentId ?? null,
        r2Key: blobKey,
      };

      await db.insert(messageAttachments).values(row);

      stored.push({
        id,
        messageId,
        filename,
        contentType: row.contentType,
        size,
        disposition: row.disposition,
        contentId: row.contentId,
      });
    } catch (error) {
      // Best-effort cleanup so a failed metadata insert does not leave a
      // permanently orphaned attachment blob.
      const { deleteBlob } = await import("@/lib/storage/blob");
      await deleteBlob(env, blobKey).catch(() => undefined);
      throw error;
    }
  }

  return stored;
}

export async function listMessageAttachments(
  env: CloudflareEnv,
  messageId: string,
): Promise<AttachmentMetadata[]> {
  const rows = await getDb(env)
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId));

  return rows.map(toMetadata);
}

export async function getAttachmentForUser(
  env: CloudflareEnv,
  user: SessionUser,
  messageId: string,
  attachmentId: string,
): Promise<{
  filename: string;
  contentType: string;
  disposition: AttachmentContent["disposition"];
  contentId: string | null;
  data: ArrayBuffer;
} | null> {
  const db = getDb(env);

  const [row] = await db
    .select({
      id: messageAttachments.id,
      filename: messageAttachments.filename,
      contentType: messageAttachments.contentType,
      disposition: messageAttachments.disposition,
      contentId: messageAttachments.contentId,
      blobKey: messageAttachments.r2Key,
      mailboxId: messages.mailboxId,
    })
    .from(messageAttachments)
    .innerJoin(messages, eq(messageAttachments.messageId, messages.id))
    .where(
      and(
        eq(messageAttachments.id, attachmentId),
        eq(messageAttachments.messageId, messageId),
      ),
    )
    .limit(1);

  if (!row?.mailboxId) return null;

  const access = await getMailboxAccessLevel(db, user, row.mailboxId);
  if (!access?.canRead) return null;

  const blob = await getBlob(env, row.blobKey);
  if (!blob) return null;

  return {
    filename: row.filename,
    contentType: row.contentType || blob.contentType || "application/octet-stream",
    disposition: row.disposition,
    contentId: row.contentId,
    data: blob.data,
  };
}
