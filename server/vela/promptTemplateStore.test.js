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

test('prompt templates persist an optional effect image and remove its managed file on delete', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-prompts-'));
  try {
    const imageBytes = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
    const first = new PromptTemplateStore({ dataDirectory });
    const saved = first.save({
      name: '黑裤效果模板',
      text: '只把裤子改成纯黑色。',
      effectImage: {
        name: '黑裤效果.png',
        data: `data:image/png;base64,${imageBytes.toString('base64')}`
      }
    });

    assert.equal(saved.effectImage.name, '黑裤效果.png');
    assert.equal(saved.effectImage.mime, 'image/png');
    assert.equal(saved.effectImage.bytes, imageBytes.length);
    assert.equal(saved.effectImage.url, `/api/vela/prompt-templates/${saved.id}/effect-image`);

    const restarted = new PromptTemplateStore({ dataDirectory });
    assert.deepEqual(restarted.list(), [saved]);
    const resolved = restarted.resolveEffectImage(saved.id);
    assert.equal(resolved.mime, 'image/png');
    assert.deepEqual(fs.readFileSync(resolved.filePath), imageBytes);

    assert.equal(restarted.delete(saved.id), true);
    assert.equal(fs.existsSync(resolved.filePath), false);
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('prompt template effect images reject non-images and payloads above 10MB', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-prompts-'));
  try {
    const store = new PromptTemplateStore({ dataDirectory });
    assert.throws(() => store.save({
      name: '无效效果图',
      text: '内容',
      effectImage: { name: 'note.txt', data: 'data:text/plain;base64,dGV4dA==' }
    }), /效果图.*图片/);
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    assert.throws(() => store.save({
      name: '过大效果图',
      text: '内容',
      effectImage: { name: 'large.png', data: `data:image/png;base64,${oversized.toString('base64')}` }
    }), /效果图.*10MB/);
    assert.deepEqual(store.list(), []);
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
