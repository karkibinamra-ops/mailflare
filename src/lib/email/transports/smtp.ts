import { buildMimeMessage } from "./mime";
import {
	OutboundProviderAuthError,
	OutboundProviderPermanentError,
	OutboundProviderTemporaryError,
	type OutboundEmailInput,
	type OutboundEmailResult,
} from "./types";

export type SmtpConfig = {
	host: string;
	port: number;
	/** true = implicit TLS from connect (smtps://, typically port 465). */
	implicitTls: boolean;
	/** false only for explicit local/dev relays with no encryption at all. */
	useStartTls: boolean;
	username: string | null;
	password: string | null;
};

/**
 * Parses a connection string of the form:
 *   smtps://user:pass@host:465   (implicit TLS)
 *   smtp://user:pass@host:587    (STARTTLS)
 *   smtp://user:pass@host:25     (STARTTLS if offered, otherwise plaintext)
 */
export function parseSmtpUrl(raw: string): SmtpConfig {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("SMTP_URL is not a valid URL");
	}

	if (url.protocol !== "smtp:" && url.protocol !== "smtps:") {
		throw new Error("SMTP_URL must use the smtp:// or smtps:// scheme");
	}
	if (!url.hostname) {
		throw new Error("SMTP_URL is missing a host");
	}

	const implicitTls = url.protocol === "smtps:";
	const port = url.port ? Number(url.port) : implicitTls ? 465 : 587;

	return {
		host: url.hostname,
		port,
		implicitTls,
		useStartTls: !implicitTls,
		username: url.username ? decodeURIComponent(url.username) : null,
		password: url.password ? decodeURIComponent(url.password) : null,
	};
}

type CloudflareSocketConnect = (
	address: { hostname: string; port: number },
	options: { secureTransport: "on" | "off" | "starttls"; allowHalfOpen: boolean },
) => Socket;

async function getCloudflareSocketConnect(): Promise<CloudflareSocketConnect> {
	try {
		const moduleName = "cloudflare:sockets";
		const sockets = (await import(
			/* webpackIgnore: true */
			/* @vite-ignore */
			moduleName
		)) as { connect: CloudflareSocketConnect };
		return sockets.connect;
	} catch {
		throw new OutboundProviderTemporaryError(
			"SMTP sending requires the Cloudflare Workers socket runtime",
		);
	}
}

function classifySmtpError(code: number, line: string): Error {
	if (code === 535 || code === 534 || code === 530) {
		return new OutboundProviderAuthError(`SMTP authentication failed: ${line}`);
	}
	if (code >= 500) {
		return new OutboundProviderPermanentError(`SMTP relay rejected the message: ${line}`);
	}
	if (code >= 400) {
		return new OutboundProviderTemporaryError(`SMTP relay is temporarily unavailable: ${line}`);
	}
	return new OutboundProviderTemporaryError(`Unexpected SMTP response: ${line}`);
}

class SmtpConnection {
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private writer: WritableStreamDefaultWriter<Uint8Array>;
	private decoder = new TextDecoder();
	private encoder = new TextEncoder();
	private buffer = "";

	constructor(private socket: Socket) {
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
	}

	async reattach(socket: Socket): Promise<void> {
		// Used after startTls() returns a new Socket wrapping the same connection.
		this.socket = socket;
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
	}

	async write(line: string): Promise<void> {
		await this.writer.write(this.encoder.encode(`${line}\r\n`));
	}

	/** Reads one full SMTP response, following "250-" continuation lines to the final "250 ". */
	async readResponse(): Promise<{ code: number; line: string }> {
		const lines: string[] = [];
		while (true) {
			const line = await this.readLine();
			lines.push(line);
			const match = /^(\d{3})([ -])/.exec(line);
			if (!match) throw new OutboundProviderTemporaryError(`Malformed SMTP response: ${line}`);
			if (match[2] === " ") {
				return { code: Number(match[1]), line: lines.join(" ") };
			}
		}
	}

	async command(line: string, expect: number | number[] = 250): Promise<{ code: number; line: string }> {
		await this.write(line);
		const response = await this.readResponse();
		const expected = Array.isArray(expect) ? expect : [expect];
		if (!expected.includes(response.code)) {
			throw classifySmtpError(response.code, response.line);
		}
		return response;
	}

	async readGreeting(): Promise<void> {
		const response = await this.readResponse();
		if (response.code !== 220) {
			throw classifySmtpError(response.code, response.line);
		}
	}

	async releaseLocks(): Promise<void> {
		this.reader.releaseLock();
		this.writer.releaseLock();
	}

	private async readLine(): Promise<string> {
		while (true) {
			const index = this.buffer.indexOf("\r\n");
			if (index >= 0) {
				const line = this.buffer.slice(0, index);
				this.buffer = this.buffer.slice(index + 2);
				return line;
			}
			const { value, done } = await this.reader.read();
			if (done || !value) {
				throw new OutboundProviderTemporaryError("SMTP connection closed unexpectedly");
			}
			this.buffer += this.decoder.decode(value, { stream: true });
		}
	}
}

function dotStuff(message: string): string {
	// RFC 5321 transparency: any line starting with "." gets an extra leading dot.
	return message
		.split("\r\n")
		.map((line) => (line.startsWith(".") ? `.${line}` : line))
		.join("\r\n");
}

function extractEmail(address: string): string {
	const match = /<([^>]+)>/.exec(address);
	return match ? match[1] : address.trim();
}

async function authenticate(conn: SmtpConnection, username: string, password: string): Promise<void> {
	await conn.command("AUTH LOGIN", 334);
	await conn.command(Buffer.from(username, "utf-8").toString("base64"), 334);
	await conn.command(Buffer.from(password, "utf-8").toString("base64"), 235);
}

export async function sendViaSmtp(
	config: SmtpConfig,
	input: OutboundEmailInput,
	messageId: string,
): Promise<OutboundEmailResult> {
	const connect = await getCloudflareSocketConnect();
	let socket = connect(
		{ hostname: config.host, port: config.port },
		{ secureTransport: config.implicitTls ? "on" : "off", allowHalfOpen: false },
	);
	let conn = new SmtpConnection(socket);

	try {
		await conn.readGreeting();
		const localHostname = "mailflare.invalid";
		let ehlo = await conn.command(`EHLO ${localHostname}`, 250).catch(() => null);
		if (!ehlo) ehlo = await conn.command(`HELO ${localHostname}`, 250);

		if (config.useStartTls && ehlo.line.toUpperCase().includes("STARTTLS")) {
			await conn.command("STARTTLS", 220);
			await conn.releaseLocks();
			socket = socket.startTls();
			conn = new SmtpConnection(socket);
			await conn.command(`EHLO ${localHostname}`, 250);
		}

		if (config.username && config.password) {
			await authenticate(conn, config.username, config.password);
		}

		await conn.command(`MAIL FROM:<${extractEmail(input.from)}>`, 250);
		await conn.command(`RCPT TO:<${extractEmail(input.to)}>`, [250, 251]);
		await conn.command("DATA", 354);

		const raw = buildMimeMessage(input, messageId);
		await conn.write(`${dotStuff(raw)}\r\n.`);
		const dataResponse = await conn.readResponse();
		if (dataResponse.code !== 250) {
			throw classifySmtpError(dataResponse.code, dataResponse.line);
		}

		await conn.command("QUIT", [221, 250]).catch(() => undefined);

		// Some relays echo a provider message id in the final response (e.g. "250 2.0.0 Ok: queued as ABC123").
		const idMatch = /queued as ([\w.-]+)/i.exec(dataResponse.line);
		return { messageId: idMatch ? idMatch[1] : messageId };
	} finally {
		try {
			await socket.close();
		} catch {
			// Already closed by the server.
		}
	}
}