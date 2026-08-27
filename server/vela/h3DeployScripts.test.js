import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const readDeployScript = (name) => fs.readFileSync(
  path.join(repositoryRoot, 'deploy', 'autodl-h3', name),
  'utf8',
);

test('H3 recovery health probes have bounded network timeouts', () => {
  const script = readDeployScript('start-comfy.sh');

  assert.match(script, /--connect-timeout\s+3/);
  assert.match(script, /--max-time\s+10/);
  assert.match(script, /health_ready/);
});

test('H3 deployment verification cannot wait forever on a wedged ComfyUI', () => {
  const script = readDeployScript('verify.sh');

  const curlLines = script.split(/\r?\n/).filter((line) => line.startsWith('curl '));
  assert.equal(curlLines.length, 2);
  for (const line of curlLines) {
    assert.match(line, /--connect-timeout\s+3/);
    assert.match(line, /--max-time\s+\d+/);
  }
});

test('H3 provisioning installs and verifies the Ref2VA model family', () => {
  const provision = readDeployScript('provision.sh');
  const models = readDeployScript('download-models.sh');
  const verify = readDeployScript('verify.sh');

  assert.match(provision, /download-models\.sh" ref2va/);
  assert.match(models, /minimax_h3_ref2va_pruned_int8_convrot\.safetensors/);
  assert.match(models, /minimax_h3_ref2v_turbo_4step_v0\.1_comfyui_bf16\.safetensors/);
  assert.match(models, /wait "\$download_pid" \|\| download_failed=1/);
  assert.doesNotMatch(models, /"[a-f0-9]{64}"\s*&/);
  assert.match(verify, /MiniMaxH3ReferenceToVideo/);
  assert.doesNotMatch(verify, /MiniMaxH3ImageToVideo/);
});
