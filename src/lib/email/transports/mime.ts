import type { OutboundEmailInput } from "./types";

function encodeHeaderValue(value: string): string {
	// Keep it simple: encode-word wrap only when needed (non-ASCII subjects/names).
	if (/^[\x20-\x7e]*$/.test(value)) return value;
	const base64 = Buffer.from(value, "utf-8").toString("base64");
	return `=?UTF-8?B?${base64}?=`;
}

function foldHeader(name: string, value: string): string {
	return `${name}: ${encodeHeaderValue(value)}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	return Buffer.from(buffer).toString("base64");
}

function wrapBase64(base64: string): string {
	const lines: string[] = [];
	for (let i = 0; i < base64.length; i += 76) {
		lines.push(base64.slice(i, i + 76));
	}
	return lines.join("\r\n");
}

function newBoundary(): string {
	return `mf_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Builds an RFC 5322 message (headers + body) suitable for sending as the
 * SMTP DATA payload. Supports plain text, HTML, and attachments (including
 * inline attachments referenced by Content-ID).
 */
export function buildMimeMessage(input: OutboundEmailInput, messageId: string): string {
	const attachments = input.attachments ?? [];
	const hasHtml = !!input.html;
	const hasText = !!input.text || !hasHtml;
	const inline = attachments.filter((a) => a.disposition === "inline" && a.contentId);
	const regular = attachments.filter((a) => !(a.disposition === "inline" && a.contentId));

	const headers: string[] = [
		foldHeader("From", input.from),
		foldHeader("To", input.to),
		foldHeader("Subject", input.subject ?? ""),
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${messageId}>`,
		"MIME-Version: 1.0",
	];
	for (const [key, value] of Object.entries(input.headers ?? {})) {
		if (/^(from|to|subject|date|message-id|mime-version|content-type)$/i.test(key)) continue;
		headers.push(foldHeader(key, value));
	}

	// altBody: text/plain + text/html alternative (or just one of them)
	function buildAltBody(): { contentType: string; body: string } {
		if (hasText && hasHtml) {
			const boundary = newBoundary();
			const body = [
				`--${boundary}`,
				"Content-Type: text/plain; charset=UTF-8",
				"Content-Transfer-Encoding: base64",
				"",
				wrapBase64(Buffer.from(input.text ?? "", "utf-8").toString("base64")),
				`--${boundary}`,
				"Content-Type: text/html; charset=UTF-8",
				"Content-Transfer-Encoding: base64",
				"",
				wrapBase64(Buffer.from(input.html ?? "", "utf-8").toString("base64")),
				`--${boundary}--`,
			].join("\r\n");
			return { contentType: `multipart/alternative; boundary="${boundary}"`, body };
		}
		if (hasHtml) {
			return {
				contentType: "text/html; charset=UTF-8",
				body: wrapBase64(Buffer.from(input.html ?? "", "utf-8").toString("base64")),
			};
		}
		return {
			contentType: "text/plain; charset=UTF-8",
			body: wrapBase64(Buffer.from(input.text ?? "", "utf-8").toString("base64")),
		};
	}

	function attachmentPart(attachment: (typeof attachments)[number]): string {
		const lines = [
			`Content-Type: ${attachment.type}; name="${attachment.filename}"`,
			`Content-Transfer-Encoding: base64`,
			attachment.disposition === "inline" && attachment.contentId
				? `Content-ID: <${attachment.contentId}>`
				: null,
			`Content-Disposition: ${attachment.disposition}; filename="${attachment.filename}"`,
			"",
			wrapBase64(arrayBufferToBase64(attachment.content)),
		].filter((line): line is string => line !== null);
		return lines.join("\r\n");
	}

	const altBody = buildAltBody();

	// No attachments: single-part or alternative body only.
	if (inline.length === 0 && regular.length === 0) {
		headers.push(`Content-Type: ${altBody.contentType}`);
		if (altBody.contentType.startsWith("multipart")) {
			return [...headers, "", altBody.body].join("\r\n");
		}
		headers.push("Content-Transfer-Encoding: base64");
		return [...headers, "", altBody.body].join("\r\n");
	}

	// With inline images: related wraps alternative body.
	let relatedBody = altBody.body;
	let relatedContentType = altBody.contentType;
	if (inline.length > 0) {
		const boundary = newBoundary();
		const parts = [
			`--${boundary}`,
			`Content-Type: ${altBody.contentType}`,
			"",
			altBody.body,
			...inline.map((a) => `--${boundary}\r\n${attachmentPart(a)}`),
			`--${boundary}--`,
		];
		relatedBody = parts.join("\r\n");
		relatedContentType = `multipart/related; boundary="${boundary}"`;
	}

	// With regular attachments: mixed wraps everything above.
	if (regular.length > 0) {
		const boundary = newBoundary();
		const parts = [
			`--${boundary}`,
			`Content-Type: ${relatedContentType}`,
			"",
			relatedBody,
			...regular.map((a) => `--${boundary}\r\n${attachmentPart(a)}`),
			`--${boundary}--`,
		];
		headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
		return [...headers, "", parts.join("\r\n")].join("\r\n");
	}

	headers.push(`Content-Type: ${relatedContentType}`);
	return [...headers, "", relatedBody].join("\r\n");
}