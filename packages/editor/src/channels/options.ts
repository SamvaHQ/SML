import type { WhatsAppButtonKind } from "@samva/markup/edit";
import type { SmsCategory } from "@samva/markup/sms";
import type { WhatsAppCategory, WhatsAppHeaderType } from "@samva/markup/whatsapp";

export const SMS_CATEGORY_OPTIONS = [
  { value: "transactional", label: "Transactional" },
  { value: "promotional", label: "Promotional" },
  { value: "service_implicit", label: "Service (implicit opt-in)" },
] as const satisfies ReadonlyArray<{ readonly value: SmsCategory; readonly label: string }>;

export const WHATSAPP_CATEGORY_OPTIONS = [
  { value: "marketing", label: "Marketing" },
  { value: "utility", label: "Utility" },
  { value: "authentication", label: "Authentication" },
] as const satisfies ReadonlyArray<{
  readonly value: WhatsAppCategory;
  readonly label: string;
}>;

export const WHATSAPP_HEADER_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "document", label: "Document" },
] as const satisfies ReadonlyArray<{ readonly value: WhatsAppHeaderType; readonly label: string }>;

export const WHATSAPP_BUTTON_TYPE_OPTIONS = [
  { value: "quick-reply", label: "Quick reply" },
  { value: "url", label: "URL" },
  { value: "phone", label: "Phone number" },
  { value: "copy-code", label: "Copy code" },
] as const satisfies ReadonlyArray<{ readonly value: WhatsAppButtonKind; readonly label: string }>;
