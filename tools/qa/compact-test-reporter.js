function singleLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export default async function* compactTestReporter(source) {
  for await (const event of source) {
    if (event.type === 'test:fail') {
      const error = event.data?.details?.error;
      const message = singleLine(error?.message || error || 'unknown failure');
      yield `FAIL ${singleLine(event.data?.name)} :: ${message}\n`;
    }
    if (event.type === 'test:summary' && !event.data?.file) {
      yield `SUMMARY ${JSON.stringify(event.data)}\n`;
    }
  }
}
