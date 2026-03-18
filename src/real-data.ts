const PLACEHOLDER_TEXT_PATTERNS = [
  /\breplace(?:-with)?\b/i,
  /\bplaceholder\b/i,
  /\byour[-_ ]/i,
  /\bexample\b/i,
  /\bsandbox\b/i,
];

const PLACEHOLDER_EMAIL_PATTERNS = [
  /@example\.com$/i,
  /^your_sender@/i,
  /@(mcp\.so|glama\.ai)$/i,
];

const PLACEHOLDER_HOST_PATTERNS = [
  /(^|\.)example\.com$/i,
];

const LOCAL_HOST_PATTERNS = new Set(["localhost", "127.0.0.1", "::1"]);

const hasPlaceholderText = (value: string) =>
  PLACEHOLDER_TEXT_PATTERNS.some((pattern) => pattern.test(value));

export const isLocalDevelopmentUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return LOCAL_HOST_PATTERNS.has(parsed.hostname);
  } catch {
    return false;
  }
};

export const isPlaceholderUrl = (value: string, options: { allowLocal?: boolean } = {}) => {
  if (!value.trim()) return true;
  if (options.allowLocal && isLocalDevelopmentUrl(value)) return false;

  try {
    const parsed = new URL(value);
    if (PLACEHOLDER_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
      return true;
    }
    return hasPlaceholderText(value);
  } catch {
    return true;
  }
};

export const isPlaceholderEmail = (value: string) => {
  if (!value.trim()) return true;
  return PLACEHOLDER_EMAIL_PATTERNS.some((pattern) => pattern.test(value)) || hasPlaceholderText(value);
};

export const isPlaceholderTextValue = (value: string) => !value.trim() || hasPlaceholderText(value);

export const assertNoPlaceholderUrl = (
  fieldName: string,
  value: string | null | undefined,
  options: { allowLocal?: boolean } = {},
) => {
  if (!value) return;
  if (isPlaceholderUrl(value, options)) {
    throw new Error(`${fieldName} must use a real URL. Placeholder URLs are not allowed.`);
  }
};

export const assertNoPlaceholderEmail = (fieldName: string, value: string | null | undefined) => {
  if (!value) return;
  if (isPlaceholderEmail(value)) {
    throw new Error(`${fieldName} must use a real email address. Placeholder emails are not allowed.`);
  }
};

export const assertNoPlaceholderText = (fieldName: string, value: string | null | undefined) => {
  if (!value) return;
  if (isPlaceholderTextValue(value)) {
    throw new Error(`${fieldName} must use real data. Placeholder text is not allowed.`);
  }
};
