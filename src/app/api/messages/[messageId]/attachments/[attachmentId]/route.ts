import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getAttachmentForUser } from "@/lib/email/attachments";
import type { AttachmentRouteParams } from "./types";

export async function GET(
	request: Request,
	{ params }: AttachmentRouteParams,
) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);

	if (!user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const { attachmentId, messageId } = await params;

	const result = await getAttachmentForUser(
		env,
		user,
		messageId,
		attachmentId,
	);

	// Attachment binary storage is disabled in R2-free mode.
	if (!result) {
		return new Response("Not found", { status: 404 });
	}

	// This should never be reached while attachment storage is disabled.
	return new Response("Not found", { status: 404 });
}
