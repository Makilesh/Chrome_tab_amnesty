/**
 * A copy anyone can install with no Node, no build and no repository:
 *   npm run package              ->  release/tab-amnesty-<version>.zip        for everyone, and the Chrome Web Store
 *   npm run package -- --study   ->  release/tab-amnesty-<version>-study.zip  for testers in the research study
 * The first is the store build (vite --mode store): no study pages, no link to them, no open-tab
 * snapshots or press times. Built into release/ — never dist/, the owner's live install (CLAUDE.md).
 * Install steps: README.md, "Install"; testers: docs/RESEARCH.md.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const study = process.argv.includes('--study');
const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
const name = `tab-amnesty-${version}${study ? '-study' : ''}`;
const dir = join('release', name);
const zip = join('release', `${name}.zip`);
rmSync(dir, { recursive: true, force: true });
rmSync(zip, { force: true });
execSync(`npx tsc --noEmit && npx vite build${study ? '' : ' --mode store'} --outDir "${dir}" --emptyOutDir`, { stdio: 'inherit' });
if (!study) {
  // What the store build must not carry, checked on the files themselves.
  for (const p of ['src/ui/xray', 'src/ui/dev']) if (existsSync(join(dir, p))) throw new Error(`the store build has ${p}`);
  if (readFileSync(join(dir, 'src/ui/sweep/index.html'), 'utf8').includes('For the study')) throw new Error('the store build links to the study');
}

// One top-level folder, so unzipping gives exactly the folder to pick in "Load unpacked".
// bsdtar (built into Windows 10+ and macOS) writes a standard zip with forward-slash paths. Name
// Windows' own copy explicitly: under Git Bash, plain `tar` is GNU tar, which ignores -a and writes
// an uncompressed tar with a .zip name. (Windows PowerShell's Compress-Archive writes backslash
// paths, which other systems mis-extract.)
if (process.platform === 'linux') {
  execFileSync('zip', ['-qr', `${name}.zip`, name], { cwd: 'release', stdio: 'inherit' });
} else {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-a', '-c', '-f', `${name}.zip`, name], { cwd: 'release', stdio: 'inherit' });
}
console.log(`\n${zip}  (${Math.round(statSync(zip).size / 1024)} KB)`);
console.log('Install: unzip into a folder you will keep, chrome://extensions -> Developer mode -> Load unpacked -> that folder.');
