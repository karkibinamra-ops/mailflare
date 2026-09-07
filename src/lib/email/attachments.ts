import type { AttachmentContent, AttachmentMetadata, StoredAttachment } from "./attachment-types";

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

/**
 * R2-free mode:
 * Attachment binary data is intentionally not persisted.
 *
 * Mailflare can still parse emails containing attachments, but the actual
 * attachment files are not stored or made downloadable.
 */
export async function storeMessageAttachments(
	_env: CloudflareEnv,
	_messageId: string,
	attachments: AttachmentContent[],
	options?: { validate?: boolean },
): Promise<StoredAttachment[]> {
	if (options?.validate !== false) {
		validateAttachments(attachments);
	}

	// Attachment storage is disabled because this deployment does not use R2.
	// Returning an empty array keeps the inbound email pipeline working.
	return [];
}

export async function listMessageAttachments(
	_env: CloudflareEnv,
	_messageId: string,
): Promise<AttachmentMetadata[]> {
	// No attachment binaries are persisted in R2-free mode.
	return [];
}

export async function getAttachmentForUser(
	_env: CloudflareEnv,
	_user: unknown,
	_messageId: string,
	_attachmentId: string,
) {
	// Attachment downloads are unavailable without R2 storage.
	return null;
}
