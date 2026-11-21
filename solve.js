// Fast broken-CSV reader: the same answers as csv-reader 1.0.0, without its
// character-at-a-time loop. The text is scanned with indexOf for the next
// field terminator and fields are taken with slice, so a field costs a few
// native scans instead of one string append per character. A whole plain
// line (no quotes, no stray CR) is taken with one split(',') instead of a
// field parse each. The positions of the next quote, CR and LF are cached
// and only refreshed once pos passes them, so no character is scanned for
// any of them more than once per pass.
//
// Semantics (csv-reader 1.0.0): a U+FEFF at the very start is dropped; a
// record ends at LF or CRLF and a line left with no characters is no record;
// outside quotes a CR not followed by LF is dropped (stray_cr); a field
// opening with a quote runs to the next quote that is not doubled, "" inside
// it is one quote and each CRLF or lone CR inside it is read as LF; what
// follows its closing quote up to the next comma or line break is appended as
// it stands (quote_junk, when the field ends, only if at least one junk char
// was appended); a quote that never closes is a literal character and the
// text after it is read again as unquoted (unterminated_quote); a quote
// inside an unquoted field is a literal character; fields stay strings.
// columns is the first record when header is true, else null; rows holds the
// records after it, each padded (short_row) or cut (long_row) to the first
// record's width. Errors are {code, line, row} in the order met; line is the
// 1-based line the record starts on, row its index in rows (null for the
// header). A record of exactly one empty unquoted field is no record.

// How a field ended: 0 = comma, 1 = line break, 2 = end of text.

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Once indexOf reports no comma / LF from some position, there is none
  // later either (pos only moves forward), so later fields skip that scan.
  let noComma = false;
  let noLf = false;

  // The LF ending the current line, once found: every later field of the
  // same record shares it, so only the first field of a line scans for it.
  // -1 means unknown. A line break consumes it; a quoted field whose content
  // holds a newline makes it stale.
  let lfCache = -1;

  // The next '"' / CR at or after pos (or -1 when there is none left, with
  // the matching done flag): refreshed only once pos passes the cached one,
  // so every character is scanned for each at most once per pass.
  let nextQ = -1;
  let qDone = false;
  let nextCr = -1;
  let crDone = false;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters an
  // unquoted scan kept (for the quote_junk check).
  let fval = '';
  let fended = 2;
  let fadded = 0;

  function strayCr() {
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
  }

  // The next CR at or after `from`, refreshing the cache when pos passed it.
  function refreshCr(from) {
    if (!crDone && nextCr < from) {
      nextCr = text.indexOf('\r', from);
      if (nextCr === -1) crDone = true;
    }
  }

  // The LF ending the line `pos` is on, or -1 when the text ends first.
  function lineEnd() {
    if (noLf) return -1;
    if (lfCache !== -1 && pos <= lfCache) return lfCache;
    const iL = text.indexOf('\n', pos);
    if (iL === -1) {
      noLf = true;
      return -1;
    }
    lfCache = iL;
    return iL;
  }

  // Reads unquoted characters onto `init`, up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Sets fval, fended
  // and fadded (characters kept, not counting `init`).
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    const start = pos;
    let iC = noComma ? -1 : text.indexOf(',', pos);
    if (iC === -1) noComma = true;
    const iL = lineEnd();
    let end;
    let kind;
    if (iC === -1 && iL === -1) {
      end = n;
      kind = 2;
    } else if (iL === -1 || (iC !== -1 && iC < iL)) {
      end = iC;
      kind = 0;
    } else {
      end = iL;
      kind = 1;
      lfCache = -1;
    }
    // A CR right before the LF is the CRLF line break, not part of the field.
    let segEnd = end;
    if (kind === 1 && end > start && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
    // Every CR left inside the segment is stray: no LF can follow one here,
    // because the first LF after `start` is `end` itself (or there is none).
    // The cached next CR says whether one is in the segment at all, so a
    // field with none skips the scan for it.
    let seg = text.slice(start, segEnd);
    refreshCr(start);
    if (nextCr !== -1 && nextCr < segEnd) {
      const parts = seg.split('\r');
      for (let k = 1; k < parts.length; k++) strayCr();
      seg = parts.join('');
    }
    if (seg !== '') {
      value = value === '' ? seg : value + seg;
      added += seg.length;
    }
    if (kind === 0) {
      pos = end + 1;
    } else if (kind === 1) {
      pos = end + 1;
      line += 1;
    } else {
      pos = n;
    }
    fval = value;
    fended = kind;
    fadded = added;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fval / fended;
  // fadded is the junk length when junk follows the closing quote.
  function readQuoted() {
    const open = pos;
    let cur = pos + 1;
    let doubled = false;
    let closeQ = -1;
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        doubled = true;
        cur = q + 2;
        continue;
      }
      closeQ = q;
      break;
    }
    if (closeQ === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted. The failed scan never advanced
      // `line`, so no line reset is needed. The cached line-end LF is still
      // the first LF after the re-read's start, so it stays valid.
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      pos = open + 1;
      readUnquoted('"');
      return;
    }
    let value = text.slice(open + 1, closeQ);
    // Whether the content holds a CR or a line break, from the cached next
    // positions where they are known (the cached line-end LF sits past the
    // opening quote and before or inside the content), else by scanning the
    // content itself.
    refreshCr(open + 1);
    const hasCr = nextCr !== -1 && nextCr < closeQ;
    let hasLf;
    if (noLf) {
      hasLf = false;
    } else if (lfCache !== -1) {
      hasLf = lfCache <= closeQ;
    } else {
      hasLf = value.indexOf('\n') !== -1;
    }
    if (doubled) value = value.split('""').join('"');
    if (hasCr || hasLf) {
      // Each CRLF or lone CR inside quotes is one LF; count the breaks so
      // the lines after this field are numbered right.
      if (hasCr) value = value.replace(/\r\n?/g, '\n');
      let breaks = 0;
      let at = -1;
      while ((at = value.indexOf('\n', at + 1)) !== -1) breaks++;
      line += breaks;
      if (hasLf) lfCache = -1;
    }
    pos = closeQ + 1;
    if (pos >= n) {
      fval = value;
      fended = 2;
      fadded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fval = value;
      fended = 0;
      fadded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      lfCache = -1;
      fval = value;
      fended = 1;
      fadded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      lfCache = -1;
      fval = value;
      fended = 1;
      fadded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(value);
    if (fadded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a whole plain line. The line holds no quote and no stray
    // CR (a CR at its very end is just its CRLF), so it is one record of
    // unquoted fields and one split(',') reads it.
    let fields = null;
    let quoted = false;
    const iL = lineEnd();
    const segEnd = iL === -1 ? n : iL > pos && text.charCodeAt(iL - 1) === 13 ? iL - 1 : iL;
    if (!qDone && nextQ < pos) {
      nextQ = text.indexOf('"', pos);
      if (nextQ === -1) qDone = true;
    }
    refreshCr(pos);
    const hasQuote = nextQ !== -1 && (iL === -1 || nextQ < iL);
    const hasStrayCr = nextCr !== -1 && nextCr < segEnd;
    if (!hasQuote && !hasStrayCr) {
      fields = text.slice(pos, segEnd).split(',');
      if (iL === -1) {
        pos = n;
      } else {
        pos = iL + 1;
        line += 1;
      }
      lfCache = -1;
    } else {
      fields = [];
      do {
        if (text.charCodeAt(pos) === 34) {
          quoted = true;
          readQuoted();
        } else {
          quoted = false;
          readUnquoted('');
        }
        fields.push(fval);
      } while (fended === 0);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay). A record of exactly one empty unquoted
    // field is the same: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
