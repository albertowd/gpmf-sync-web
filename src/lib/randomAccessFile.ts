// Browser-side equivalent of Python's BinaryIO with a stateful cursor.
// Backed by a `Blob` (which a DOM `File` extends), so reads are zero-copy
// at the OS level — only the requested byte range hits memory, never the
// full file. All reads are async because Blob.arrayBuffer() is.

export class RandomAccessFile {
  readonly size: number;
  private readonly blob: Blob;
  private cursor = 0;

  constructor(blob: Blob) {
    this.blob = blob;
    this.size = blob.size;
  }

  tell(): number {
    return this.cursor;
  }

  // whence: 0 = start, 1 = current, 2 = end (matches Python's io.SEEK_*).
  seek(offset: number, whence: 0 | 1 | 2 = 0): number {
    let target: number;
    switch (whence) {
      case 0:
        target = offset;
        break;
      case 1:
        target = this.cursor + offset;
        break;
      case 2:
        target = this.size + offset;
        break;
    }
    if (target < 0) target = 0;
    if (target > this.size) target = this.size;
    this.cursor = target;
    return this.cursor;
  }

  // Returns the bytes read (may be shorter than `n` near EOF) and advances
  // the cursor by exactly that many bytes.
  async read(n: number): Promise<Uint8Array> {
    const start = this.cursor;
    const end = Math.min(start + n, this.size);
    if (end <= start) return new Uint8Array(0);
    const slice = this.blob.slice(start, end);
    const buf = await slice.arrayBuffer();
    this.cursor = end;
    return new Uint8Array(buf);
  }

  // Convenience: read exactly the next `n` bytes as a DataView for struct
  // decoding. Throws if EOF cuts the read short.
  async readView(n: number): Promise<DataView> {
    const bytes = await this.read(n);
    if (bytes.byteLength < n) {
      throw new Error(`unexpected EOF: wanted ${n} bytes, got ${bytes.byteLength}`);
    }
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}
