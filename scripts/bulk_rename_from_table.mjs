import fs from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2] || 'pdfs';
const table = process.argv[3] || 'rename_table.txt';

const exists = async p => !!(await fs.stat(p).catch(()=>null));
const ensureDir = p => fs.mkdir(p, {recursive:true});

const lines = (await fs.readFile(table,'utf8'))
  .split(/\r?\n/).map(l=>l.trim()).filter(Boolean);

const mappings = lines.map(l => {
  const [from, to] = l.split('\t');
  return {from, to};
});

let root = dir;
if (!(await exists(root))) root = '.';

const seenDest = new Set();
const results = {ok:0, skippedSame:0, missing:[], conflicts:[]};

for (const {from, to} of mappings) {
  const src1 = path.join(root, from);
  const src2 = path.join('.', from);
  let src = (await exists(src1)) ? src1 : (await exists(src2)) ? src2 : null;

  if (!src) { results.missing.push(from); continue; }

  // final dest (same folder as source)
  let dest = path.join(path.dirname(src), to);

  // avoid overwrite if dest exists (or already used this run)
  let base = dest.replace(/\.pdf$/i,'');
  let k = 2;
  while (seenDest.has(dest) || await exists(dest)) {
    dest = `${base}-${k++}.pdf`;
  }
  seenDest.add(dest);

  const samePath = path.resolve(src) === path.resolve(dest);
  if (samePath) { results.skippedSame++; continue; }

  // Case-only rename workaround on case-insensitive filesystems
  const tmp = path.join(path.dirname(src), `.tmp-rename-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  try {
    await ensureDir(path.dirname(dest));
    if (path.basename(src).toLowerCase() === path.basename(dest).toLowerCase()) {
      await fs.rename(src, tmp);
      await fs.rename(tmp, dest);
    } else {
      await fs.rename(src, dest);
    }
    results.ok++;
    console.log(`RENAMED: ${path.basename(src)}  ->  ${path.basename(dest)}`);
  } catch (e) {
    results.conflicts.push({from, to, error: e.message});
    console.error(`FAILED: ${from} -> ${to}  (${e.message})`);
  }
}

console.log('\n=== Summary ===');
console.log(`Renamed: ${results.ok}`);
console.log(`Skipped (already named): ${results.skippedSame}`);
console.log(`Missing: ${results.missing.length}`);
if (results.missing.length) console.log(results.missing.map(x=>'  - '+x).join('\n'));
console.log(`Errors: ${results.conflicts.length}`);
if (results.conflicts.length) console.log(results.conflicts.map(x=>`  - ${x.from} -> ${x.to}: ${x.error}`).join('\n'));
