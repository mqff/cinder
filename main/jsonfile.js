const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd = fs.openSync(temporary, "wx", 0o600);
  let buffer = "";
  function flush() {
    const bytes = Buffer.from(buffer);
    for (let offset = 0; offset < bytes.length;) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    buffer = "";
  }
  function append(text) {
    buffer += text;
    if (buffer.length >= 1024 * 1024) flush();
  }
  function encode(item, depth = 0) {
    if (depth < 8 && item && typeof item === "object" && !item.toJSON) {
      const array = Array.isArray(item);
      append(array ? "[" : "{");
      let separator = "";
      const keys = array ? Array.from({ length: item.length }, (_, index) => index) : Object.keys(item);
      for (const key of keys) {
        const next = item[key];
        if (!array && (next === undefined || typeof next === "function" || typeof next === "symbol")) continue;
        append(separator);
        separator = ",";
        if (!array) append(JSON.stringify(key) + ":");
        encode(next, depth + 1);
      }
      append(array ? "]" : "}");
    } else append(JSON.stringify(item) ?? "null");
  }
  try {
    encode(value);
    flush();
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== null) fs.closeSync(fd);
    try {
      fs.unlinkSync(temporary);
    } catch {}
  }
}
module.exports = { writeJsonFile };
