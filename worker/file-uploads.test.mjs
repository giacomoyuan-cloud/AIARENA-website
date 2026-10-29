import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSkillFiles } from './skill-files.js';
test('official document transport preserves ZIP and source originals without changing its per-round limits', () => {
  const files = ['source.zip', 'main.py', 'notes.yaml', 'records.jsonl', 'Dockerfile'].map(name => ({ name, data: Buffer.from('test source').toString('base64') }));
  assert.deepEqual(validateSkillFiles(files).map(file => file.name), files.map(file => file.name));
  assert.throws(() => validateSkillFiles([...files, files[0]]), /5/);
  assert.throws(() => validateSkillFiles([{ name: 'program.exe', data: 'TVqQ' }]), /不支持/);
});
