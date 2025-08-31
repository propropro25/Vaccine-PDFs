import fs from 'node:fs/promises';

// change '-' to '_' if you prefer underscores
const SEP = '-';

const inFile = process.argv[2] || 'rename_table_raw.txt';
const raw = (await fs.readFile(inFile, 'utf8'))
  .replace(/\r/g,'')
  // squash weird spacing quotes
  .replace(/[“”‘’]/g,'"')
  .replace(/\u00A0/g,' ')       // nbsp -> space
  .replace(/[^\S\n]+/g,' ');    // collapse spaces (keep newlines)

const lines = raw.split('\n').map(l => l.trim());

// helpers
const isPdfLine = l =>
  /\.pdf\b/i.test(l) &&
  !/^current image name/i.test(l) &&
  !/^new image/i.test(l) &&
  l.toLowerCase() !== 'map';

const isArrow = l => /(—>|->|→|—\s*>)/.test(l);

const ascii = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
const tidyTitle = s => s
  .replace(/&/g, ' and ')
  .replace(/[_]+/g, ' ')
  .replace(/["'`]+/g,' ')
  .replace(/[|()[\]{}<>]/g,' ')
  .replace(/[,:;!?]+/g,' ')
  .replace(/\s+/g,' ')
  .trim();

const slug = (title) => {
  let t = ascii(title).toLowerCase();
  t = t.replace(/[^a-z0-9]+/g, SEP).replace(new RegExp(`${SEP}+`,'g'), SEP);
  t = t.replace(new RegExp(`^${SEP}|${SEP}$`,'g'), '');
  return t || 'untitled';
};

let i = 0, pairs = [];
while (i < lines.length) {
  // 1) gather one or more current files (may be several on one line)
  if (!isPdfLine(lines[i])) { i++; continue; }
  const curr = lines[i].split(/\s+/).filter(x => /\.pdf$/i.test(x));
  i++;

  // 2) find the arrow line
  while (i < lines.length && !isArrow(lines[i]) && !isPdfLine(lines[i])) i++;
  if (i < lines.length && isArrow(lines[i])) i++;

  // 3) gather new-title lines until next .pdf block (or EOF)
  const buf = [];
  while (i < lines.length && !isPdfLine(lines[i])) {
    if (isArrow(lines[i]) || lines[i].toLowerCase()==='map') { i++; continue; }
    if (lines[i]) buf.push(lines[i]);
    i++;
    // stop if we peek next line as a PDF start (so titles don't slurp)
    if (i < lines.length && isPdfLine(lines[i])) break;
  }
  const newTitle = tidyTitle(buf.join(' '));
  if (!newTitle) continue;

  for (const f of curr) pairs.push([f, newTitle]);
}

// dedupe target filenames
const used = new Map(); // base -> next index
const seenOut = new Set();
const out = [];
for (const [from, title] of pairs) {
  const base = slug(title);
  let idx = used.get(base) || 1;
  let to = base + '.pdf';
  while (seenOut.has(to)) { idx++; to = `${base}-${idx}.pdf`; }
  used.set(base, idx);
  seenOut.add(to);
  out.push([from, to]);
}

// write to stdout as "from<TAB>to"
for (const [a,b] of out) console.log(`${a}\t${b}`);
