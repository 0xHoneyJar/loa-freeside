#!/usr/bin/env node
// wordcount — example graduated CLI. Reads JSON {text} on stdin, emits JSON stats on stdout.
// re_executable: no network, no clock, no randomness. The boring ideal every L3 CLI aspires to.
let raw = '';
process.stdin.on('data', c => raw += c);
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { console.error('wordcount: stdin must be JSON {text}'); process.exit(2); }
  if (typeof input.text !== 'string') { console.error('wordcount: missing field "text"'); process.exit(2); }
  const words = input.text.trim() === '' ? [] : input.text.trim().split(/\s+/);
  const freq = {};
  for (const w of words) freq[w.toLowerCase()] = (freq[w.toLowerCase()] ?? 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  process.stdout.write(JSON.stringify({ words: words.length, unique: Object.keys(freq).length, top }));
});
