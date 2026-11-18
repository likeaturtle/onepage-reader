'use strict';

/**
 * Device storage limits shared by the add and edit forms. The firmware fields
 * are 96/192 bytes with one length byte, leaving 95/191 usable bytes.
 */

const TITLE_BYTES = 95;
const NOTE_BYTES = 191;

module.exports = { TITLE_BYTES, NOTE_BYTES };
