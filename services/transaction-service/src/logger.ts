import winston from "winston";

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});

export const sanitizeForLogging = (
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const redacted: Record<string, unknown> = { ...input };
  const sensitiveKeys = [
    "email",
    "phone",
    "password",
    "token",
    "ssn",
    "card_number",
  ];
  for (const [k, v] of Object.entries(redacted)) {
    redacted[k] = sensitiveKeys.some((s) => k.toLowerCase().includes(s))
      ? "[REDACTED]"
      : v;
  }
  return redacted;
};
