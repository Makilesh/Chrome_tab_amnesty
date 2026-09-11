// Thin wrapper: `node tools/py.mjs <module> [args]` runs `python -m tabamnesty.<module>` with the
// repo venv if there is one. Python is for the gate, not the product: the extension builds and
// runs without it, and this prints a clear message instead of a stack trace when it is missing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [mod, ...args] = process.argv.slice(2);
const candidates = ['.venv/Scripts/python.exe', '.venv/bin/python'].map((p) => resolve(p)).filter(existsSync);
const python = candidates[0] ?? 'python';
const r = spawnSync(python, ['-m', `tabamnesty.${mod}`, ...args], {
  cwd: resolve('analysis'),
  stdio: 'inherit',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});
if (r.error) {
  console.error(
    `Could not run Python (${python}). The analysis side needs it:\n` +
      '  uv venv && uv pip install -e "analysis[dev]"   (or pip install -e analysis)\n' +
      'The extension itself does not; npm run build / test work without Python.',
  );
  process.exit(127);
}
process.exit(r.status ?? 1);
