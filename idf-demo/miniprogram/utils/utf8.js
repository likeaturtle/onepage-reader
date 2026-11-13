'use strict';

/**
 * Minimal UTF-8 codec.
 *
 * The BLE protocol is newline-delimited UTF-8, and notifications may split a
 * multi-byte character across two packets. We therefore buffer raw bytes until
 * a newline and only then decode; a newline byte can never occur inside a
 * multi-byte sequence, so decoding whole lines is safe.
 *
 * The mini program runtime cannot be assumed to expose TextEncoder/TextDecoder,
 * hence these helpers.
 */

function encode(text) {
  const input = String(text == null ? '' : text);
  const bytes = [];
  for (let i = 0; i < input.length; i += 1) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}

function decode(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  let out = '';
  let i = 0;
  while (i < input.length) {
    const first = input[i];
    if (first < 0x80) {
      out += String.fromCharCode(first);
      i += 1;
      continue;
    }

    let code;
    let extra;
    if (first >= 0xc2 && first <= 0xdf) {
      code = first & 0x1f;
      extra = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      code = first & 0x0f;
      extra = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      code = first & 0x07;
      extra = 3;
    } else {
      out += '\ufffd';
      i += 1;
      continue;
    }

    if (i + extra >= input.length) {
      out += '\ufffd';
      i += 1;
      continue;
    }

    let valid = true;
    for (let j = 1; j <= extra; j += 1) {
      const byte = input[i + j];
      if ((byte & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (byte & 0x3f);
    }
    if (!valid || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      out += '\ufffd';
      i += 1;
      continue;
    }

    if (code > 0xffff) {
      const value = code - 0x10000;
      out += String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
    i += extra + 1;
  }
  return out;
}

function byteLength(text) {
  return encode(text).length;
}

module.exports = { encode, decode, byteLength };
