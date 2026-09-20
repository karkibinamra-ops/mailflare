export type OutboundEmailAttachment = {
	filename: string;
	type: string;
	content: ArrayBuffer;
	disposition: "attachment" | "inline";
	contentId?: string | null;
};

export type OutboundEmailInput = {
	from: string;
	to: string;
	subject: string;
	headers?: Record<string, string>;
	html?: string;
	text?: string;
	attachments?: OutboundEmailAttachment[];
};

export type OutboundEmailResult = {
	messageId: string;
};

/**
 * Thrown when no outbound provider (SMTP or Cloudflare Email Sending) is
 * configured at all. This is a setup problem, not a delivery problem — the
 * caller should surface it as "outbound email is not configured" rather than
 * retrying.
 */
export class OutboundProviderNotConfiguredError extends Error {
	constructor(message = "No outbound email provider is configured. Set SMTP_URL to enable sending.") {
		super(message);
		this.name = "OutboundProviderNotConfiguredError";
	}
}

/** Provider rejected the credentials (bad username/password/token). Retrying without a config change will not help. */
export class OutboundProviderAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OutboundProviderAuthError";
	}
}

/**
 * A permanent failure reported by the provider (invalid recipient, message
 * rejected, 5xx SMTP response, etc). Retrying the exact same send will not
 * succeed.
 */
export class OutboundProviderPermanentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OutboundProviderPermanentError";
	}
}

/**
 * A transient failure (network error, 4xx SMTP response, timeout). The same
 * send may succeed on a later attempt.
 */
export class OutboundProviderTemporaryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OutboundProviderTemporaryError";
	}
}