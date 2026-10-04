// The closed value sets of the SMS and WhatsApp components. `Sms` and `WhatsApp` derive their prop
// types from them, and the static compiler reads the same tables, so an attribute the type accepts
// is one the compiler accepts.

export const SMS_CATEGORIES = ["transactional", "promotional", "service_implicit"] as const;
export const WHATSAPP_CATEGORIES = ["marketing", "utility", "authentication"] as const;
export const WHATSAPP_HEADER_TYPES = ["text", "image", "video", "document"] as const;

/** The attributes `<Sms>` accepts. */
export const SMS_ATTRIBUTES = ["category"] as const;
/** The attributes `<WhatsApp>` accepts. */
export const WHATSAPP_ATTRIBUTES = ["name", "language", "category"] as const;

/** The SMS categories `<Sms category>` accepts. */
export type SmsCategory = (typeof SMS_CATEGORIES)[number];
/** The Meta template categories `<WhatsApp category>` accepts. */
export type WhatsAppCategory = (typeof WHATSAPP_CATEGORIES)[number];
/** The header kinds `<WhatsApp.Header type>` accepts. */
export type WhatsAppHeaderType = (typeof WHATSAPP_HEADER_TYPES)[number];
