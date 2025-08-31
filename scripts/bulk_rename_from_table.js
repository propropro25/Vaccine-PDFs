/* Usage: node scripts/bulk_rename_from_table.js <dir> <tablefile>
 * Example: node scripts/bulk_rename_from_table.js pdfs rename_table.txt
 */
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const DIR = process.argv[2] || 'pdfs';
const TABLEFILE = process.argv[3] || 'rename_table.txt';

if (!fs.existsSync(DIR) || !fs.statSync(DIR).isDirectory()) {
  console.error(`ERROR: Directory not found: ${DIR}`);
  process.exit(1);
}
if (!fs.existsSync(TABLEFILE)) {
  console.error(`ERROR: Table file not found: ${TABLEFILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(TABLEFILE, 'utf8');

// Join wrapped lines: if a line does NOT contain an arrow and does NOT end with ".pdf",
// treat it as a continuation of the previous line's right-hand side (title).
const lines = raw.split(/\r?\n/);
const rows = [];
for (let i = 0; i < lines.length; i++) {
  let line = lines[i].trim();
  if (!line) continue;

  // Normalize various arrows
  line = line.replace(/—>|->|→/g, '->');

  if (line.includes('->')) {
    // accumulate continuation lines into RHS
    let acc = line;
    while (i + 1 < lines.length) {
      const peek = (lines[i+1] || '').trim();
      if (!peek) { i++; continue; }
      // a new mapping probably starts when we see another "something.pdf ... ->"
      const looksLikeNewMap = /\.(pdf|PDF)\b.*->/.test(peek);
      if (looksLikeNewMap) break;
      // otherwise, append to RHS
      acc += ' ' + peek;
      i++;
    }
    rows.push(acc);
  } else {
    // Single filenames without arrow are ignored
  }
}

// Helper: safe, consistent filename (no spaces, .pdf)
function sanitizeTitleToFilename(s) {
  if (!s) return null;
  // strip quotes
  s = s.replace(/[“”"']+/g, ' ').replace(/\s+/g,' ').trim();
  // transliterate accents
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // friendly substitutions
  s = s.replace(/&/g, ' and ').replace(/\+/g,' plus ');
  // keep only a-z0-9 and _ -
  s = s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  if (!s) s = 'untitled';
  s = s.toLowerCase();
  if (!s.endsWith('.pdf')) s += '.pdf';
  return s;
}

// Extract all filenames from LHS even if they contain spaces:
// match any substring that ends with .pdf/.PDF
function extractSources(lhs) {
  const out = [];
  const re = /(.+?\.pdf)\b/gi;
  let m;
  while ((m = re.exec(lhs)) !== null) {
    const name = m[1].trim();
    if (name) out.push(name);
  }
  return out;
}

const seenTargets = new Set();
const movePlan = []; // {src, dest}

for (const row of rows) {
  const m = row.match(/^(.*?)->(.*)$/);
  if (!m) continue;
  const lhs = m[1].trim();
  let rhs = m[2].trim();

  // sources (may be multiple)
  const sources = extractSources(lhs);
  if (!sources.length) continue;

  // title (may be empty)
  if (!rhs) {
    console.warn(`SKIP (no new title): ${lhs}`);
    continue;
  }
  const baseTarget = sanitizeTitleToFilename(rhs);

  // plan a move for each source
  for (let k = 0; k < sources.length; k++) {
    const srcName = sources[k];
    const srcPath = path.join(DIR, srcName);
    if (!fs.existsSync(srcPath)) {
      console.warn(`SKIP (missing): ${srcPath}`);
      continue;
    }

    // if multiple sources map to same title, add numeric suffixes
    let targetName = baseTarget;
    if (k > 0) {
      const dot = baseTarget.lastIndexOf('.pdf');
      const stem = baseTarget.slice(0, dot);
      targetName = `${stem}-${k+1}.pdf`;
    }

    // avoid collisions with existing files or already-planned targets
    let destPath = path.join(DIR, targetName);
    if (fs.existsSync(destPath) || seenTargets.has(destPath)) {
      const dot = targetName.lastIndexOf('.pdf');
      const stem = targetName.slice(0, dot);
      let n = 2, alt;
      do { alt = path.join(DIR, `${stem}-${n}.pdf`); n++; }
      while (fs.existsSync(alt) || seenTargets.has(alt));
      destPath = alt;
    }
    seenTargets.add(destPath);
    movePlan.push({src: srcPath, dest: destPath});
  }
}

if (!movePlan.length) {
  console.log('Nothing to rename. Check your directory and table.');
  process.exit(0);
}

console.log(`Planned ${movePlan.length} rename(s):`);
for (const {src,dest} of movePlan) {
  console.log(`- ${path.basename(src)}  ->  ${path.basename(dest)}`);
}

// Execute git mv
for (const {src,dest} of movePlan) {
  const res = spawnSync('git', ['mv', '--verbose', src, dest], {stdio:'inherit'});
  if (res.status !== 0) {
    console.error('git mv failed; aborting.');
    process.exit(res.status || 1);
  }
}

console.log('\nDone. Review with: git status');
console.log('If good: git commit -m "bulk: rename PDFs to normalized article titles" && git push');
