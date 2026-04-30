// Stream a Blob/File line-by-line. Returns an async iterator so callers can
// `for await ... break` to short-circuit as soon as a match is found, without
// pulling the rest of the file through the decoder.

export async function* readLines(blob: Blob): AsyncGenerator<string> {
  const reader = blob.stream().pipeThrough(new TextDecoderStream("utf-8")).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
        nl = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) {
      yield buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    }
  } finally {
    // Cancel the underlying source so we don't keep streaming after a break.
    await reader.cancel().catch(() => {});
  }
}
