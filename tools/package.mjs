/**
 * A copy testers can install with no Node, no build and no repository:
 *   npm run package   ->   release/tab-amnesty-<version>.zip
 * Built into release/ — never dist/, which is the owner's live install (CLAUDE.md).
 * Tester steps are in README.md, "Installing it as a tester".
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
const name = `tab-amnesty-${version}`;
const dir = join('release', name);
const zip = join('release', `${name}.zip`);
rmSync(dir, { recursive: true, force: true });
rmSync(zip, { force: true });
execSync(`npx tsc --noEmit && npx vite build --outDir "${dir}" --emptyOutDir`, { stdio: 'inherit' });

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
console.log('Testers: unzip into a folder they will keep, chrome://extensions -> Developer mode -> Load unpacked -> that folder.');
