#pragma once

#include <stdbool.h>
#include <stdint.h>

/* Minimal monochrome drawing helpers for the panel framebuffer.
 * Bit set = white, bit clear = black. No clipping beyond the panel edge. */

void gfx_clear(uint8_t *fb, bool white);
void gfx_pixel(uint8_t *fb, int x, int y, bool black);
void gfx_hline(uint8_t *fb, int x, int y, int w, bool black);
void gfx_vline(uint8_t *fb, int x, int y, int h, bool black);
void gfx_rect(uint8_t *fb, int x, int y, int w, int h, bool black);
void gfx_fill_rect(uint8_t *fb, int x, int y, int w, int h, bool black);
void gfx_checker(uint8_t *fb, int x, int y, int w, int h, int cell, bool invert);
void gfx_grid(uint8_t *fb, int x, int y, int w, int h, int cell, bool black);
/* 0..16: number of lit pixels out of 16 in a 4x4 dither block (screen tone). */
void gfx_dither_rect(uint8_t *fb, int x, int y, int w, int h, int level);

/* 5x7 bitmap text. `scale` 1..4 (each glyph cell is 6*scale x 8*scale). */
void gfx_text(uint8_t *fb, int x, int y, const char *s, int scale, bool black);
int gfx_text_width(const char *s, int scale);
