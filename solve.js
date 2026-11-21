// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's answer
// {columns, rows, errors} for {text, header}, but without its one-character-at-a-time
// loop. Written from scratch against the reference's written policy (RULES.txt):
//
//   - U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next undoubled quote ("" is one quote,
//     CRLF or lone CR inside it is read as LF); what follows the closing quote up to
//     the next comma or line break is appended as it stands (quote_junk, when the
//     field ends); a quote that never closes is a literal character and the text
//     after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is literal; fields stay strings;
//   - columns is the first record when header is true, else null; rows are padded
//     with "" (short_row, with fields: its count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met, line the 1-based line its
//     record starts on, row its record's index in rows (null for the header).
//
// Speed, two paths. A record whose first line holds no quote and no stray CR is
// read at once — one slice and one split. Any other record is read field by
// field, but each field jumps from delimiter to delimiter with one native
// regex scan (RegExp test with /g, position read back from lastIndex) instead
// of walking character by character; test() is used rather than exec() because
// it allocates no match array. The readers return small result objects, which
// V8 keeps cheap; passing the outcome through shared variables instead was
// measured slower.

/** Delimiter scan inside a quoted field: the next quote, CR or LF. (Kept at module level; the unquoted
    scan below is created fresh per run() call instead — a shared mutable /g regex there measured ~50% slower.) */
const Q_RE = /["\r\n]/g;

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field and how it ended; `added` counts the characters kept.
  // The scan regex is made fresh per run() call: a module-level shared one measured ~50% slower here.
  const UQ_RE = /[,\n\r]/g;
  function readUnquoted(value) {
    let added = 0;
    while (pos < len) {
      UQ_RE.lastIndex = pos;
      let idx = -1;
      let kind = -1; // 0 comma, 1 LF, 2 CR
      if (UQ_RE.test(text)) {
        idx = UQ_RE.lastIndex - 1;
        const mc = text.charCodeAt(idx);
        kind = mc === 44 ? 0 : mc === 10 ? 1 : 2;
      }
      if (idx === -1) {
        value += text.slice(pos, len);
        added += len - pos;
        pos = len;
        return { value, ended: END, added };
      }
      if (kind === 0) {
        value += text.slice(pos, idx);
        added += idx - pos;
        pos = idx + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === 1) {
        value += text.slice(pos, idx);
        added += idx - pos;
        pos = idx + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A CR: a line break when followed by LF, else a dropped stray_cr.
      if (text.charCodeAt(idx + 1) === 10) {
        value += text.slice(pos, idx);
        added += idx - pos;
        pos = idx + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      value += text.slice(pos, idx);
      added += idx - pos;
      error('stray_cr');
      pos = idx + 1;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      Q_RE.lastIndex = pos;
      let idx = -1;
      let kind = -1; // 0 quote, 1 CR, 2 LF
      if (Q_RE.test(text)) {
        idx = Q_RE.lastIndex - 1;
        const mc = text.charCodeAt(idx);
        kind = mc === 34 ? 0 : mc === 13 ? 1 : 2;
      }
      if (idx === -1) {
        value += text.slice(pos, len);
        pos = len;
        break;
      }
      if (kind === 0) {
        if (text.charCodeAt(idx + 1) === 34) {
          value += text.slice(pos, idx);
          value += '"';
          pos = idx + 2;
          continue;
        }
        value += text.slice(pos, idx);
        pos = idx + 1;
        closed = true;
        break;
      }
      // CRLF and a lone CR inside quotes are each one LF.
      value += text.slice(pos, idx);
      value += '\n';
      line += 1;
      pos = kind === 1 && text.charCodeAt(idx + 1) === 10 ? idx + 2 : idx + 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    if (pos >= len) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
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
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record sits on one line with no quote and no stray CR, so it is one slice and one split.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    let segEnd = lineEnd;
    // A CR is a line ending only as the CRLF pair before this LF; at the end of
    // the text a lone CR is a stray_cr, which the slow path reports.
    if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      const fields = seg.split(',');
      pos = nl === -1 ? len : nl + 1;
      line += 1;
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
      continue;
    }

    // Slow path: the record holds a quote or a stray CR; read it field by field.
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
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
