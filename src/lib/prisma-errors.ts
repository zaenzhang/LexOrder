function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function adapterCause(error: unknown, code: string) {
  const value = record(error);
  if (value?.code !== code) return undefined;
  const adapter = record(record(value.meta)?.driverAdapterError);
  return adapter?.name === "DriverAdapterError" ? record(adapter.cause) : undefined;
}

export function uniqueIndex(error: unknown, model: string): string | undefined {
  const value = record(error);
  const modelName = record(value?.meta)?.modelName;
  if (modelName !== undefined && modelName !== model) return undefined;
  const cause = adapterCause(error, "P2002");
  if (cause?.kind !== "UniqueConstraintViolation" || cause.originalCode !== "23505") return undefined;
  const index = record(cause.constraint)?.index;
  return typeof index === "string" ? index : undefined;
}

export function rawSqlState(error: unknown): string | undefined {
  const value = adapterCause(error, "P2010")?.originalCode;
  return typeof value === "string" ? value : undefined;
}
