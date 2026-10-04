// SMS segment math, GSM 03.38, shared by the editor's character counter and any send-side estimate.
// GSM-7: 160 septets single / 153 multi-segment (UDH uses 7). Extended GSM-7
// characters cost 2 septets. UCS-2 (any non-GSM char): 70 single / 67 multi.
// @see https://en.wikipedia.org/wiki/GSM_03.38

const GSM7_EXTENDED = new Set(["[", "]", "{", "}", "\\", "~", "|", "€", "^", "\f"]);

const GSM7_BASIC_PATTERN =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./:;<=>?¡0-9ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà]*$/;

const containsNonGsmCharacters = (text: string): boolean => {
  for (const char of text) {
    if (GSM7_EXTENDED.has(char)) continue;
    if (!GSM7_BASIC_PATTERN.test(char)) return true;
  }
  return false;
};

/** The encoding a message needs: GSM-7 when every character fits, UCS-2 otherwise. */
export type SmsEncoding = "gsm7" | "ucs2";

export interface SmsSegmentInfo {
  readonly encoding: SmsEncoding;
  readonly characterCount: number;
  readonly segmentCount: number;
}

export const smsSegmentInfo = (text: string): SmsSegmentInfo => {
  if (containsNonGsmCharacters(text)) {
    const codePoints = [...text].length;
    const segmentCount = codePoints <= 70 ? 1 : Math.ceil(codePoints / 67);
    return { encoding: "ucs2", characterCount: text.length, segmentCount };
  }

  let encodedLength = 0;
  for (const char of text) {
    encodedLength += GSM7_EXTENDED.has(char) ? 2 : 1;
  }
  const segmentCount = encodedLength <= 160 ? 1 : Math.ceil(encodedLength / 153);
  return { encoding: "gsm7", characterCount: text.length, segmentCount };
};

// Recognizes "STOP", "reply STOP", "text STOP to ...", "STOP to cancel", etc.
const SMS_OPT_OUT_PATTERN = /\b(stop|unsubscribe|opt[\s-]?out|cancel|quit)\b/i;

export const hasSmsOptOut = (text: string): boolean => SMS_OPT_OUT_PATTERN.test(text);
