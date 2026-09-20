import { sendViaCloudflareEmail } from "./cloudflare-email";
import { parseSmtpUrl, sendViaSmtp } from "./smtp";
import { OutboundProviderNotConfiguredError, type OutboundEmailInput, type OutboundEmailResult } from "./types";

export type {
	OutboundEmailAttachment,
	OutboundEmailInput,
	OutboundEmailResult,
} from "./types";
export {
	OutboundProviderAuthError,
	OutboundProviderNotConfiguredError,
	OutboundProviderPermanentError,
	OutboundProviderTemporaryError,
} from "./types";

export type OutboundProviderName = "smtp" | "cloudflare-email";

/**
 * Picks the outbound transport in priority order:
 *   1. SMTP relay, when SMTP_URL is configured.
 *   2. Cloudflare Email Sending, when the EMAIL binding is available and a
 *      sending subdomain has actually been provisioned.
 *   3. Otherwise, fail clearly rather than pretending to have sent anything.
 *
 * Mailbox creation and domain setup never depend on this — outbound delivery
 * is resolved lazily, at send time.
 */
export function getConfiguredOutboundProvider(env: CloudflareEnv): OutboundProviderName | null {
	if (env.SMTP_URL?.trim()) return "smtp";
	if (env.EMAIL) return "cloudflare-email";
	return null;
}

export async function sendOutboundEmail(
	env: CloudflareEnv,
	input: OutboundEmailInput,
	messageId: string,
): Promise<OutboundEmailResult> {
	const provider = getConfiguredOutboundProvider(env);

	if (provider === "smtp") {
		const config = parseSmtpUrl(env.SMTP_URL!.trim());
		return sendViaSmtp(config, input, messageId);
	}

	if (provider === "cloudflare-email") {
		return sendViaCloudflareEmail(env, input);
	}

	throw new OutboundProviderNotConfiguredError(
		"Outbound email is not configured. Set SMTP_URL to send mail from this instance.",
	);
}