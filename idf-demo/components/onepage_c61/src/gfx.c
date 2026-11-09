#include "gfx.h"

#include "font5x7.h"
#include "font_cjk.h"
#include "font_cjk_large.h"
#include "onepage_pins.h"

#include <string.h>

/* Mixed-text metrics: ASCII is the 5x7 table at scale 3, CJK is the 24 px
 * table. Both share a 24 px line box. */
#define UTF8_ASCII_SCALE 3
#define UTF8_ASCII_W (FONT5X7_WIDTH + 1) * UTF8_ASCII_SCALE
#define UTF8_CJK_STEP (FONT_CJK_PX + 1)
#define UTF8_ELLIPSIS 0x2026u

/* Logical UI coordinates are portrait. Map each pixel into the panel's
 * native landscape framebuffer so the rest of the drawing code never has to
 * know about the rotation. */
static inline void set_pixel(uint8_t *fb, int x, int y, bool black) {
  if (x < 0 || y < 0 || x >= ONEPAGE_UI_WIDTH || y >= ONEPAGE_UI_HEIGHT) {
    return;
  }

  int px;
  int py;
#if ONEPAGE_UI_ROTATION == 90
  /* Panel is viewed rotated counter-clockwise. */
  px = ONEPAGE_EPD_WIDTH - 1 - y;
  py = x;
#elif ONEPAGE_UI_ROTATION == 270
  /* Panel is viewed rotated clockwise. */
  px = y;
  py = ONEPAGE_EPD_HEIGHT - 1 - x;
#else
#error "ONEPAGE_UI_ROTATION must be 90 or 270"
#endif

  uint8_t *byte = fb + (size_t)py * ONEPAGE_EPD_ROW_BYTES + (px >> 3);
  const uint8_t mask = 0x80 >> (px & 7);
  if (black) {
    *byte &= ~mask;
  } else {
    *byte |= mask;
  }
}

void gfx_clear(uint8_t *fb, bool white) {
  memset(fb, white ? 0xFF : 0x00, ONEPAGE_EPD_BUFFER_SIZE);
}

void gfx_pixel(uint8_t *fb, int x, int y, bool black) { set_pixel(fb, x, y, black); }

void gfx_hline(uint8_t *fb, int x, int y, int w, bool black) {
  for (int i = 0; i < w; i++) {
    set_pixel(fb, x + i, y, black);
  }
}

void gfx_vline(uint8_t *fb, int x, int y, int h, bool black) {
  for (int i = 0; i < h; i++) {
    set_pixel(fb, x, y + i, black);
  }
}

void gfx_rect(uint8_t *fb, int x, int y, int w, int h, bool black) {
  gfx_hline(fb, x, y, w, black);
  gfx_hline(fb, x, y + h - 1, w, black);
  gfx_vline(fb, x, y, h, black);
  gfx_vline(fb, x + w - 1, y, h, black);
}

void gfx_fill_rect(uint8_t *fb, int x, int y, int w, int h, bool black) {
  for (int row = 0; row < h; row++) {
    gfx_hline(fb, x, y + row, w, black);
  }
}

void gfx_checker(uint8_t *fb, int x, int y, int w, int h, int cell, bool invert) {
  if (cell < 1) {
    cell = 1;
  }
  for (int row = 0; row < h; row++) {
    for (int col = 0; col < w; col++) {
      const bool odd = (((x + col) / cell) + ((y + row) / cell)) & 1;
      set_pixel(fb, x + col, y + row, invert ? !odd : odd);
    }
  }
}

void gfx_grid(uint8_t *fb, int x, int y, int w, int h, int cell, bool black) {
  if (cell < 1) {
    cell = 1;
  }
  gfx_rect(fb, x, y, w, h, black);
  for (int col = cell; col < w; col += cell) {
    gfx_vline(fb, x + col, y, h, black);
  }
  for (int row = cell; row < h; row += cell) {
    gfx_hline(fb, x, y + row, w, black);
  }
}

void gfx_dither_rect(uint8_t *fb, int x, int y, int w, int h, int level) {
  static const uint8_t bayer[4][4] = {
      {0, 8, 2, 10},
      {12, 4, 14, 6},
      {3, 11, 1, 9},
      {15, 7, 13, 5},
  };
  for (int row = 0; row < h; row++) {
    for (int col = 0; col < w; col++) {
      const bool black = bayer[(y + row) & 3][(x + col) & 3] < level;
      set_pixel(fb, x + col, y + row, black);
    }
  }
}

int gfx_text_width(const char *s, int scale) {
  if (scale < 1) {
    scale = 1;
  }
  const int advance = (FONT5X7_WIDTH + 1) * scale;
  int width = 0;
  for (const char *p = s; *p; p++) {
    width += advance;
  }
  return width;
}

/* --- UTF-8 helpers ------------------------------------------------------ */

/* Minimal UTF-8 decoder. Returns the codepoint and stores the encoded length in
 * `len`; a malformed lead byte comes back as U+FFFD and skips one byte. */
static uint32_t utf8_decode(const char *s, int *len) {
  const uint8_t *b = (const uint8_t *)s;
  if (b[0] < 0x80) {
    *len = 1;
    return b[0];
  }
  if ((b[0] & 0xE0) == 0xC0 && (b[1] & 0xC0) == 0x80) {
    *len = 2;
    return (uint32_t)((b[0] & 0x1F) << 6 | (b[1] & 0x3F));
  }
  if ((b[0] & 0xF0) == 0xE0 && (b[1] & 0xC0) == 0x80 && (b[2] & 0xC0) == 0x80) {
    *len = 3;
    return (uint32_t)((b[0] & 0x0F) << 12 | (b[1] & 0x3F) << 6 | (b[2] & 0x3F));
  }
  if ((b[0] & 0xF8) == 0xF0 && (b[1] & 0xC0) == 0x80 && (b[2] & 0xC0) == 0x80 &&
      (b[3] & 0xC0) == 0x80) {
    *len = 4;
    return (uint32_t)((b[0] & 0x07) << 18 | (b[1] & 0x3F) << 12 | (b[2] & 0x3F) << 6 |
                      (b[3] & 0x3F));
  }
  *len = 1;
  return 0xFFFD;
}

static int utf8_advance(uint32_t codepoint) {
  return codepoint < 0x80 ? UTF8_ASCII_W : UTF8_CJK_STEP;
}

/* A missing glyph is drawn as a hollow box so a title with an unsupported
 * character is still visibly incomplete instead of silently vanishing. */
static void draw_missing(uint8_t *fb, int x, int y, bool black) {
  gfx_rect(fb, x + 2, y + 2, FONT_CJK_PX - 4, FONT_CJK_PX - 4, black);
}

static int draw_codepoint(uint8_t *fb, int x, int y, uint32_t codepoint, bool black) {
  if (codepoint < 0x20) {
    return 0;
  }
  if (codepoint < 0x80) {
    char one[2] = {(char)codepoint, '\0'};
    gfx_text(fb, x, y, one, UTF8_ASCII_SCALE, black);
    return UTF8_ASCII_W;
  }

  const uint8_t *glyph = font_cjk_lookup(codepoint);
  if (!glyph) {
    draw_missing(fb, x, y, black);
    return UTF8_CJK_STEP;
  }
  for (int row = 0; row < FONT_CJK_PX; row++) {
    for (int col = 0; col < FONT_CJK_PX; col++) {
      const bool ink =
          (glyph[row * FONT_CJK_ROW_BYTES + col / 8] & (0x80 >> (col & 7))) != 0;
      set_pixel(fb, x + col, y + row, ink ? black : !black);
    }
  }
  return UTF8_CJK_STEP;
}

/* Draws the bytes in [start, end) at (x, y) and returns the end cursor. */
static int draw_range(uint8_t *fb, int x, int y, const char *start, const char *end,
                      bool black) {
  int cursor = x;
  const char *p = start;
  while (p < end && *p) {
    int len = 1;
    const uint32_t cp = utf8_decode(p, &len);
    if (p + len > end) {
      break;
    }
    const int advance = draw_codepoint(fb, cursor, y, cp, black);
    cursor += advance;
    p += len;
  }
  return cursor;
}

static int range_width(const char *start, const char *end) {
  int width = 0;
  const char *p = start;
  while (p < end && *p) {
    int len = 1;
    const uint32_t cp = utf8_decode(p, &len);
    if (p + len > end) {
      break;
    }
    width += utf8_advance(cp);
    p += len;
  }
  return width;
}

/* --- CJK text ----------------------------------------------------------- */

int gfx_text_cjk_width(const char *utf8, int gap) {
  int width = 0;
  for (const char *p = utf8; *p;) {
    int len = 1;
    (void)utf8_decode(p, &len);
    p += len;
    width += FONT_CJK_PX + gap;
  }
  return width > 0 ? width - gap : 0;
}

void gfx_text_cjk(uint8_t *fb, int x, int y, const char *utf8, int gap, bool black) {
  int cursor = x;
  for (const char *p = utf8; *p;) {
    int len = 1;
    const uint32_t codepoint = utf8_decode(p, &len);
    p += len;

    const uint8_t *glyph = font_cjk_lookup(codepoint);
    if (glyph) {
      for (int row = 0; row < FONT_CJK_PX; row++) {
        for (int col = 0; col < FONT_CJK_PX; col++) {
          const bool ink = (glyph[row * FONT_CJK_ROW_BYTES + col / 8] & (0x80 >> (col & 7))) != 0;
          set_pixel(fb, cursor + col, y + row, ink ? black : !black);
        }
      }
    }
    /* Missing glyphs still advance, so gfx_text_cjk_width() stays correct. */
    cursor += FONT_CJK_PX + gap;
  }
}

int gfx_text_cjk_large_width(const char *utf8, int gap) {
  int width = 0;
  for (const char *p = utf8; *p;) {
    int len = 1;
    (void)utf8_decode(p, &len);
    p += len;
    width += FONT_CJK_LARGE_PX + gap;
  }
  return width > 0 ? width - gap : 0;
}

void gfx_text_cjk_large(uint8_t *fb, int x, int y, const char *utf8, int gap, bool black) {
  int cursor = x;
  for (const char *p = utf8; *p;) {
    int len = 1;
    const uint32_t codepoint = utf8_decode(p, &len);
    p += len;

    const uint8_t *glyph = font_cjk_large_lookup(codepoint);
    if (glyph) {
      for (int row = 0; row < FONT_CJK_LARGE_PX; row++) {
        for (int col = 0; col < FONT_CJK_LARGE_PX; col++) {
          const bool ink = (glyph[row * FONT_CJK_LARGE_ROW_BYTES + col / 8] & (0x80 >> (col & 7))) != 0;
          set_pixel(fb, cursor + col, y + row, ink ? black : !black);
        }
      }
    }
    cursor += FONT_CJK_LARGE_PX + gap;
  }
}

/* --- mixed text --------------------------------------------------------- */

int gfx_text_utf8_width(const char *utf8) {
  int width = 0;
  for (const char *p = utf8; *p;) {
    int len = 1;
    const uint32_t cp = utf8_decode(p, &len);
    if (cp == '\n') {
      p += len;
      continue;
    }
    width += utf8_advance(cp);
    p += len;
  }
  return width;
}

void gfx_text_utf8(uint8_t *fb, int x, int y, const char *utf8, bool black) {
  int cursor = x;
  for (const char *p = utf8; *p;) {
    int len = 1;
    const uint32_t cp = utf8_decode(p, &len);
    if (cp == '\n') {
      p += len;
      continue;
    }
    cursor += draw_codepoint(fb, cursor, y, cp, black);
    p += len;
  }
}

int gfx_text_utf8_clipped(uint8_t *fb, int x, int y, const char *utf8, int max_width,
                          bool black) {
  int cursor = x;
  const char *p = utf8;
  while (*p) {
    int len = 1;
    const uint32_t cp = utf8_decode(p, &len);
    if (cp == '\n') {
      break;
    }
    const int advance = utf8_advance(cp);
    if (cursor + advance > x + max_width) {
      break;
    }
    cursor += draw_codepoint(fb, cursor, y, cp, black);
    p += len;
  }
  if (*p && *p != '\n' && max_width >= UTF8_CJK_STEP) {
    int ellipsis_x = cursor;
    if (ellipsis_x + UTF8_CJK_STEP > x + max_width) {
      ellipsis_x = x + max_width - UTF8_CJK_STEP;
    }
    if (ellipsis_x >= x) {
      draw_codepoint(fb, ellipsis_x, y, UTF8_ELLIPSIS, black);
      cursor = ellipsis_x + UTF8_CJK_STEP;
    }
  }
  return cursor - x;
}

int gfx_text_utf8_wrap(uint8_t *fb, int x, int y, const char *utf8, int max_width,
                       int line_height, int max_lines, bool black) {
  if (max_lines <= 0 || max_lines > 8) {
    max_lines = max_lines > 8 ? 8 : 0;
  }
  if (max_lines == 0) {
    return 0;
  }

  typedef struct {
    const char *start;
    const char *end;
  } line_t;
  line_t lines[8];
  int count = 0;
  bool more = false;

  const char *p = utf8;
  const char *line_start = utf8;
  int width = 0;
  while (*p) {
    int len = 1;
    const uint32_t cp = utf8_decode(p, &len);

    if (cp == '\n') {
      if (count >= max_lines) {
        more = true;
        break;
      }
      lines[count].start = line_start;
      lines[count].end = p;
      count++;
      p += len;
      line_start = p;
      width = 0;
      continue;
    }

    const int advance = utf8_advance(cp);
    if (width + advance > max_width && p > line_start) {
      if (count >= max_lines) {
        more = true;
        break;
      }
      lines[count].start = line_start;
      lines[count].end = p;
      count++;
      line_start = p;
      width = 0;
      continue;
    }
    width += advance;
    p += len;
  }

  /* Add the current line when the loop ended normally. A trailing newline does
   * not create an empty extra line. */
  if (!more && count < max_lines && (p > line_start || count == 0)) {
    lines[count].start = line_start;
    lines[count].end = p;
    count++;
  }

  for (int i = 0; i < count; i++) {
    draw_range(fb, x, y + i * line_height, lines[i].start, lines[i].end, black);
    if (i == count - 1 && more && max_width >= UTF8_CJK_STEP) {
      const int used = range_width(lines[i].start, lines[i].end);
      int ex = x + used;
      if (ex + UTF8_CJK_STEP > x + max_width) {
        ex = x + max_width - UTF8_CJK_STEP;
      }
      if (ex >= x) {
        draw_codepoint(fb, ex, y + i * line_height, UTF8_ELLIPSIS, black);
      }
    }
  }
  return count;
}

void gfx_text(uint8_t *fb, int x, int y, const char *s, int scale, bool black) {
  if (scale < 1) {
    scale = 1;
  }
  int cursor = x;
  for (const char *p = s; *p; p++) {
    char c = *p;
    if (c >= 'a' && c <= 'z') {
      c = (char)(c - 'a' + 'A');
    }
    const uint8_t *glyph = NULL;
    uint8_t fallback[FONT5X7_WIDTH] = {0};
    if (c >= FONT5X7_FIRST_CHAR && c <= FONT5X7_LAST_CHAR) {
      glyph = font5x7[c - FONT5X7_FIRST_CHAR];
    } else {
      /* Unsupported character: draw a filled box so it is visible. */
      fallback[0] = 0x7F;
      fallback[1] = 0x41;
      fallback[2] = 0x41;
      fallback[3] = 0x41;
      fallback[4] = 0x7F;
      glyph = fallback;
    }
    for (int col = 0; col < FONT5X7_WIDTH; col++) {
      const uint8_t bits = glyph[col];
      for (int row = 0; row < FONT5X7_HEIGHT; row++) {
        if (!(bits & (1u << row))) {
          continue;
        }
        if (scale == 1) {
          set_pixel(fb, cursor + col, y + row, black);
        } else {
          gfx_fill_rect(fb, cursor + col * scale, y + row * scale, scale, scale, black);
        }
      }
    }
    cursor += (FONT5X7_WIDTH + 1) * scale;
  }
}
