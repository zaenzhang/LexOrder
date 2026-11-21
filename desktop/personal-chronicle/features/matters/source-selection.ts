// The textarea normalizes CRLF to LF. Keep source offsets in the immutable text.
export function sourceOffset(text: string, selectionOffset: number) {
  let offset = selectionOffset
  for (const newline of text.matchAll(/\r\n/g)) {
    if (newline.index >= offset) break
    offset++
  }
  return offset
}
