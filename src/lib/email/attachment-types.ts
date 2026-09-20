export type AttachmentDisposition = "attachment" | "inline";

export type AttachmentContent = {
  filename: string;
  type: string;
  content: ArrayBuffer;
  disposition: AttachmentDisposition;
  contentId?: string | null;
};

export type AttachmentMetadata = {
  id: string;
  messageId: string;
  filename: string;
  contentType: string;
  size: number;
  disposition: AttachmentDisposition;
  contentId: string | null;
};

export type StoredAttachment = AttachmentMetadata;
