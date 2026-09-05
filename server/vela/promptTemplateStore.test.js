import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PromptTemplateStore } from './promptTemplateStore.js';

test('prompt templates survive a store restart and can be removed', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-prompts-'));
  try {
    const first = new PromptTemplateStore({ dataDirectory });
    const saved = first.save({ name: '黑裤换色', text: '只把裤子改成纯黑色，其他不变。' });
    assert.match(saved.id, /^[a-f0-9-]{36}$/i);
    assert.equal(first.list().length, 1);

    const restarted = new PromptTemplateStore({ dataDirectory });
    assert.deepEqual(restarted.list(), [saved]);
    assert.equal(restarted.delete(saved.id), true);
    assert.deepEqual(restarted.list(), []);
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('prompt templates reject empty values and cap the library size', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-prompts-'));
  try {
    const store = new PromptTemplateStore({ dataDirectory, maxTemplates: 2 });
    assert.throws(() => store.save({ name: '', text: '内容' }), /名称/);
    assert.throws(() => store.save({ name: '模板', text: '' }), /内容/);
    store.save({ name: '模板一', text: '内容一' });
    store.save({ name: '模板二', text: '内容二' });
    assert.throws(() => store.save({ name: '模板三', text: '内容三' }), /最多保存 2 条/);
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
