// Quote escaping alone does not stop spreadsheet formula evaluation.
// Treat user-controlled formula prefixes (including leading whitespace) as text.
export function safeCsvText(value: string): string {
  return /^[\s\u0000-\u001f]*[=+@\-＝＋－＠]/u.test(value) || /^[\t\r\n]/.test(value)
    ? `'${value}`
    : value;
}
