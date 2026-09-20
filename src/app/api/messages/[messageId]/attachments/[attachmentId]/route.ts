import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getAttachmentForUser } from "@/lib/email/attachments";
import {
  getAttachmentContentDisposition,
  isPreviewableAttachmentType,
} from "./utils";
import type { AttachmentRouteParams } from "./types";

export async function GET(
  request: Request,
  { params }: AttachmentRouteParams,
) {
  const env = getEnv();
  const user = await getCurrentUser(env, request);

  if (!user) return new Response("Unauthorized", { status: 401 });

  const { attachmentId, messageId } = await params;
  const url = new URL(request.url);
  const isPreview = url.searchParams.has("preview");

  const result = await getAttachmentForUser(
    env,
    user,
    messageId,
    attachmentId,
  );

  if (!result) return new Response("Not found", { status: 404 });

  const inline = isPreview && isPreviewableAttachmentType(result.contentType);
  const headers = new Headers({
    "Content-Type": result.contentType,
    "Content-Length": String(result.data.byteLength),
    "Content-Disposition": getAttachmentContentDisposition(result.filename, inline),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });

  return new Response(result.data, { status: 200, headers });
}
