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

  if (!result) {
    return new Response("Not found", { status: 404 });
  }

  const disposition =
    result.disposition === "inline" ? "inline" : "attachment";
  const safeFilename = result.filename.replace(/["\\\r\n]/g, "_");

  return new Response(result.data, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.data.byteLength),
      "Content-Disposition": `${disposition}; filename="${safeFilename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
