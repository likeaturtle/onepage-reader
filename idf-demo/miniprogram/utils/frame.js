'use strict';

/**
 * Incremental byte buffer that yields complete newline-terminated lines.
 * Notifications from the device are fragments of a line, and a fragment may
 * end in the middle of a UTF-8 character, so decoding happens per line.
 */
const MAX_PENDING = 16 * 1024; // a protocol line is capped at 768 bytes on device

class LineDecoder {
  constructor() {
    this.pending = new Uint8Array(0);
  }

  push(arrayBuffer) {
    const chunk = arrayBuffer instanceof Uint8Array
      ? arrayBuffer
      : new Uint8Array(arrayBuffer || 0);

    const merged = new Uint8Array(this.pending.length + chunk.length);
    merged.set(this.pending, 0);
    merged.set(chunk, this.pending.length);

    const lines = [];
    let start = 0;
    for (let i = 0; i < merged.length; i += 1) {
      if (merged[i] === 0x0a) {
        lines.push(merged.subarray(start, i));
        start = i + 1;
      }
    }

    const rest = merged.subarray(start);
    if (rest.length > MAX_PENDING) {
      // The peer is misbehaving; drop the garbage instead of growing forever.
      this.pending = new Uint8Array(0);
      lines.push(new Uint8Array(0));
    } else {
      this.pending = rest.slice();
    }
    return lines;
  }

  reset() {
    this.pending = new Uint8Array(0);
  }
}

module.exports = { LineDecoder };
