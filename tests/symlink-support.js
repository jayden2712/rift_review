import {mkdtemp, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Windows only allows symlinks with Developer Mode or admin rights. Probe once so
// symlink-specific assertions are skipped there instead of failing the suite.
async function probeSymlinks() {
  const dir = await mkdtemp(join(tmpdir(), 'rift-symlink-probe-'));
  try {
    await writeFile(join(dir, 'target'), '');
    await symlink(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return false;
    throw error;
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

export const canSymlink = await probeSymlinks();
export const symlinkSkip = canSymlink ? false : 'symlinks need Developer Mode or admin rights on Windows';
