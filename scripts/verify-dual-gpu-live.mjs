const [baseUrlArg] = process.argv.slice(2);
if (!baseUrlArg) throw new Error('Usage: verify-dual-gpu-live.mjs <desktop-service-base-url>');

const baseUrl = String(baseUrlArg).replace(/\/$/, '');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const terminalStates = new Set(['succeeded', 'failed', 'cancelled']);

const requestJson = async (pathname, options = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}: ${data.error || 'unknown error'}`);
  return data;
};

const waitForJobs = async (groupIds, timeoutMs = 60 * 60_000) => {
  const startedAt = Date.now();
  const latest = new Map();
  while (Date.now() - startedAt < timeoutMs) {
    for (const groupId of groupIds) {
      const jobs = await requestJson(`/api/vela/jobs?groupId=${encodeURIComponent(groupId)}`);
      if (jobs[0]) latest.set(groupId, jobs[0]);
    }
    const rows = groupIds.map((groupId) => latest.get(groupId)).filter(Boolean);
    console.log(JSON.stringify({
      type: 'dual-gpu.jobs',
      jobs: rows.map((job) => ({
        id: job.id,
        profileId: job.profileId,
        status: job.status,
        progress: job.progress,
        promptId: job.promptId || null,
        error: job.error?.message || null
      }))
    }));
    if (rows.length === groupIds.length && rows.every((job) => terminalStates.has(job.status))) return rows;
    await delay(10_000);
  }
  throw new Error('Timed out waiting for the two H3 jobs');
};

const waitForIndependentShutdown = async (profileIds, timeoutMs = 12 * 60_000) => {
  const startedAt = Date.now();
  const sawCountdown = new Set();
  while (Date.now() - startedAt < timeoutMs) {
    const states = await Promise.all(profileIds.map(async (profileId) => ({
      profileId,
      state: await requestJson(`/api/vela/comfy/${encodeURIComponent(profileId)}/power`)
    })));
    for (const row of states) {
      if (row.state.state === 'idle-countdown') sawCountdown.add(row.profileId);
    }
    console.log(JSON.stringify({ type: 'dual-gpu.power', states }));
    if (states.every((row) => row.state.state === 'stopped')) {
      return { states, sawCountdown: [...sawCountdown] };
    }
    await delay(10_000);
  }
  throw new Error('Timed out waiting for both AutoDL instances to shut down independently');
};

const project = await requestJson('/api/vela/projects', {
  method: 'POST',
  body: JSON.stringify({
    name: `双 GPU 实机验收 ${new Date().toISOString()}`,
    nodes: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  })
});

const createDraft = (nodeId, seed, prompt) => ({
  projectId: project.id,
  nodeId,
  profileId: 'auto-comfy',
  providerType: 'comfy',
  payload: {
    nodeKind: 'h3-video',
    prompt,
    duration: 1,
    aspectRatio: '16:9',
    resolution: '480p',
    videoGenerationMode: 'text-to-video',
    referenceUrls: [],
    h3Acceleration: 'turbo-4',
    h3Upscale: 'off',
    h3FrameFit: 'direct'
  },
  count: 1,
  seedMode: 'fixed',
  seed
});

const created = await Promise.all([
  requestJson('/api/vela/jobs', {
    method: 'POST',
    body: JSON.stringify(createDraft('dual-gpu-a', 20260820, 'A short cinematic sunrise over calm mountains, smooth camera motion.'))
  }),
  requestJson('/api/vela/jobs', {
    method: 'POST',
    body: JSON.stringify(createDraft('dual-gpu-b', 20260821, 'A short cinematic ocean wave in warm sunset light, smooth camera motion.'))
  })
]);

const groupIds = created.map((item) => item.group.id);
const initiallySelectedProfiles = created.map((item) => item.jobs[0].profileId);
if (new Set(initiallySelectedProfiles).size !== 2) {
  throw new Error(`Automatic routing did not select two different GPUs: ${initiallySelectedProfiles.join(', ')}`);
}
console.log(JSON.stringify({
  type: 'dual-gpu.started',
  projectId: project.id,
  groupIds,
  profileIds: initiallySelectedProfiles
}));

const completed = await waitForJobs(groupIds);
if (completed.some((job) => job.status !== 'succeeded')) {
  throw new Error(`One or more H3 jobs failed: ${completed.map((job) => `${job.profileId}:${job.status}:${job.error?.message || ''}`).join(' | ')}`);
}
const shutdown = await waitForIndependentShutdown(initiallySelectedProfiles);
if (shutdown.sawCountdown.length !== initiallySelectedProfiles.length) {
  throw new Error(`Did not observe an independent idle countdown for both GPUs: ${shutdown.sawCountdown.join(', ')}`);
}

console.log(JSON.stringify({
  type: 'dual-gpu.verified',
  projectId: project.id,
  jobs: completed.map((job) => ({ id: job.id, profileId: job.profileId, promptId: job.promptId, status: job.status })),
  stoppedProfiles: initiallySelectedProfiles
}));
