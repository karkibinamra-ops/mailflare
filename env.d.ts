interface CloudflareEnv {
	DB: D1Database;
	EMAIL: SendEmail;

	INBOUND_QUEUE: Queue<
		import("./src/lib/email/inbound").InboundQueueMessage
	>;

	// The outbound queue also carries webhook retries so that scheduled
	// redelivery needs no extra binding.
	OUTBOUND_QUEUE: Queue<
		| import("./src/lib/email/send").OutboundQueueMessage
		| import("./src/lib/email/webhooks").WebhookRetryMessage
	>;

	ASSETS: Fetcher;
	IMAGES: ImagesBinding;

	WORKER_SELF_REFERENCE: Fetcher;

	REALTIME: DurableObjectNamespace<
		import("./src/lib/realtime/hub").RealtimeHub
	>;

	LOGIN_RATE_LIMIT?: RateLimit;

	CF_TOKEN?: string;
	CF_API_KEY?: string;
	CF_EMAIL?: string;

	// Outbound mail: when set, SMTP relay is used instead of Cloudflare Email
	// Sending (which requires a paid plan). Format:
	//   smtps://user:pass@host:465  (implicit TLS)
	//   smtp://user:pass@host:587   (STARTTLS)
	SMTP_URL?: string;

	TURNSTILE_SECRET_KEY?: string;

	GITHUB_UPDATE_TOKEN?: string;
	GITHUB_UPDATE_REF?: string;
	GITHUB_UPDATE_REPO?: string;
}
