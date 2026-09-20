"use client";

import { ArrowDownToLine } from "lucide-react";
import { formatAttachmentSize } from "@/app/(dashboard)/inbox/[messageId]/utils";
import type { MessageAttachmentCardProps } from "./message-attachment-card-types";
import { getAttachmentVisual } from "./message-attachment-card-utils";

export function MessageAttachmentCard({
  attachment,
  messageId: _messageId,
  onPreview,
}: MessageAttachmentCardProps) {
  const visual = getAttachmentVisual(attachment);
  const Icon = visual.icon;

  // Do not fetch the attachment binary while rendering the message page.
  // On Workers Free, eager image/video downloads can consume the request's
  // runtime budget and make the whole message page fail with Error 1102.
  // The file is fetched only after the user opens the attachment.
  return (
    <button
      type="button"
      onClick={() => onPreview(attachment)}
      className="group flex w-full items-center gap-3 rounded-lg border border-neutral-200 p-2.5 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/40"
    >
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-md ${visual.iconClassName}`}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-neutral-900">
          {attachment.filename}
        </span>
        <span className="mt-0.5 block truncate text-xs text-neutral-500">
          {visual.label} · {formatAttachmentSize(attachment.size)}
        </span>
      </span>
      <ArrowDownToLine className="h-4 w-4 shrink-0 text-neutral-400 transition-colors group-hover:text-blue-600" />
    </button>
  );
}
