import {
	OutboundProviderNotConfiguredError,
	OutboundProviderPermanentError,
	type OutboundEmailInput,
	type OutboundEmailResult,
} from "./types";

/**
 * Sends through the Cloudflare Email Sending binding (`env.EMAIL`). This
 * requires a sending subdomain to have been provisioned on the zone, which
 * Cloudflare's Free plan does not support — callers should treat this as an
 * optional, best-effort transport, not a required one.
 */
export async function sendViaCloudflareEmail(
	env: CloudflareEnv,
	input: OutboundEmailInput,
): Promise<OutboundEmailResult> {
	if (!env.EMAIL) {
		throw new OutboundProviderNotConfiguredError(
			"Cloudflare Email Sending is not configured for this Worker.",
		);
	}

	try {
		const response = await env.EMAIL.send({
			from: input.from,
			to: input.to,
			subject: input.subject,
			headers: input.headers,
			html: input.html,
			text: input.text,
			attachments: (input.attachments ?? []).map((attachment) =>
				attachment.disposition === "inline" && attachment.contentId
					? {
							filename: attachment.filename,
							type: attachment.type,
							content: attachment.content,
							disposition: "inline" as const,
							contentId: attachment.contentId,
						}
					: {
							filename: attachment.filename,
							type: attachment.type,
							content: attachment.content,
							disposition: "attachment" as const,
						},
			),
		});
		return { messageId: response.messageId };
	} catch (err) {
		// Cloudflare Email Sending failures (e.g. no sending subdomain configured
		// on a Free plan zone) are configuration problems, not transient ones.
		const message = err instanceof Error ? err.message : "Cloudflare Email Sending failed";
		throw new OutboundProviderPermanentError(message);
	}
}