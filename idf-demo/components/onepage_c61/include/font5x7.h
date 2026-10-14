#pragma once

#include <stdint.h>

/* Classic 5x7 bitmap font covering ASCII 0x20..0x5F (space, digits, uppercase
 * letters and punctuation).
 *
 * Layout: one 5-byte column per glyph, least significant bit is the top row.
 * A glyph occupies a 6x8 cell (5 columns plus one spacing column, 7 rows plus
 * one spacing row) so scaled text stays on a clean grid. */

#define FONT5X7_FIRST_CHAR 0x20
#define FONT5X7_LAST_CHAR 0x5F
#define FONT5X7_WIDTH 5
#define FONT5X7_HEIGHT 7

extern const uint8_t font5x7[FONT5X7_LAST_CHAR - FONT5X7_FIRST_CHAR + 1][FONT5X7_WIDTH];
