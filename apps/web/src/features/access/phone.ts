export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  const prefix = digits.startsWith("02") ? 2 : 3;
  if (digits.length <= prefix) return digits;
  if (digits.length <= prefix + 4)
    return `${digits.slice(0, prefix)}-${digits.slice(prefix)}`;
  const middle = digits.length === prefix + 7 ? 3 : 4;
  return `${digits.slice(0, prefix)}-${digits.slice(prefix, prefix + middle)}-${digits.slice(prefix + middle)}`;
}
