#include "gfx.h"

#include "font5x7.h"
#include "onepage_pins.h"

#include <string.h>

static inline void set_pixel(uint8_t *fb, int x, int y, bool black) {
  if (x < 0 || y < 0 || x >= ONEPAGE_EPD_WIDTH || y >= ONEPAGE_EPD_HEIGHT) {
    return;
  }
  uint8_t *byte = fb + (size_t)y * ONEPAGE_EPD_ROW_BYTES + (x >> 3);
  const uint8_t mask = 0x80 >> (x & 7);
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
