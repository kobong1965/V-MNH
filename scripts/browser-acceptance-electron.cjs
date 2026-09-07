const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const frontendUrl = process.env.VELA_QA_FRONTEND_URL;
const backendUrl = process.env.VELA_QA_BACKEND_URL;
const providerUrl = process.env.VELA_QA_PROVIDER_URL;
const evidenceDirectory = process.env.VELA_QA_EVIDENCE_DIR;
const electronData = process.env.VELA_QA_ELECTRON_DATA;
if (!frontendUrl || !backendUrl || !providerUrl || !evidenceDirectory || !electronData) {
  throw new Error('Browser acceptance environment is incomplete');
}
app.setPath('userData', electronData);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disk-cache-dir', path.join(electronData, 'cache'));

const requestJson = async (pathname, body) => {
  const response = await fetch(`${backendUrl}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${data.error || ''}`);
  return data;
};

const waitUntil = async (window, expression, label, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const clickMatchingButton = (window, text, selector = 'button') => window.webContents.executeJavaScript(`(() => {
  const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((item) => item.textContent.trim() === ${JSON.stringify(text)});
  if (!button) throw new Error('Button not found: ' + ${JSON.stringify(text)});
  button.click();
})()`);

const capture = async (window, fileName) => {
  await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise((resolve) => setTimeout(resolve, 180));
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(evidenceDirectory, fileName), image.toPNG());
};

const canvasResultExpression = (resultUrls) => `(() => {
  const isVisible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  const expected = ${JSON.stringify(resultUrls)};
  const resultImages = [...document.querySelectorAll('.vela-canvas-node--gpt-image img')];
  return isVisible(document.querySelector('button[aria-label="返回首页"]'))
    && isVisible(document.querySelector('.vela-canvas-node--gpt-image'))
    && !document.querySelector('.vela-home-shell')
    && expected.every((url) => resultImages.some((image) => (
      new URL(image.src).pathname === url
      && isVisible(image)
      && image.complete
      && image.naturalWidth > 0
      && image.naturalHeight > 0
    )));
})()`;

(async () => {
  await app.whenReady();
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const profile = await requestJson('/api/vela/profiles', {
    type: 'gpt',
    name: '浏览器自动验收账户',
    baseUrl: providerUrl,
    apiKey: 'browser-acceptance-only',
    models: { prompt: 'qa-prompt', analysis: 'qa-qwen-vl', image: 'qa-image' }
  });
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const batch = await requestJson('/api/vela/batches', {
    name: '浏览器自动验收批次',
    prompt: '只把裤子换成黑色，其他内容保持不变',
    profileId: profile.id,
    aspectRatio: '3:4',
    resolution: '2K',
    outputCount: 2,
    poseVariation: { enabled: true, outputCount: 2, prompt: '只改变姿势，其他细节不变' },
    images: [{ name: 'browser-source.png', data: pixel }]
  });

  const consoleErrors = [];
  let failNextProjectSave = false;
  let saveFailureInjectionActive = false;
  let cancelledProjectSave = null;
  const window = new BrowserWindow({ show: false, frame: false, width: 1280, height: 800 });
  window.webContents.session.webRequest.onBeforeRequest({
    urls: [`${frontendUrl}/api/vela/projects/*`]
  }, (details, callback) => {
    if (failNextProjectSave && details.method === 'PUT') {
      failNextProjectSave = false;
      cancelledProjectSave = { method: details.method, url: details.url };
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  window.webContents.on('console-message', (event) => {
    const entry = { level: event.level, message: event.message, line: event.lineNumber, sourceId: event.sourceId };
    if (entry.level === 'error' || entry.level === 3) {
      consoleErrors.push({ ...entry, expectedSaveFailure: saveFailureInjectionActive });
    }
  });
  await window.loadURL(frontendUrl);
  await waitUntil(window, "document.querySelector('nav[aria-label=\"项目导航\"]')", 'home navigation');
  await window.webContents.executeJavaScript(`(() => {
    const nav = document.querySelector('nav[aria-label="项目导航"]');
    const button = [...nav.querySelectorAll('button')].find((item) => item.textContent.trim() === '批量工厂');
    button.click();
  })()`);
  await waitUntil(window, "document.querySelector('main[aria-label=\"批量工厂\"]')", 'batch factory');
  await waitUntil(window, "document.querySelector('.vela-batch__start') && document.querySelector('.vela-batch__start').textContent.includes('（1）')", 'seeded batch selection');

  for (const [width, height] of [[1500, 900], [850, 700], [768, 700]]) {
    window.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const layout = await window.webContents.executeJavaScript(`(() => {
      const measure = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        main: measure('.vela-home-main'),
        form: measure('.vela-batch__form-grid'),
        analysis: measure('.vela-prompt-workbench__analysis-grid'),
        create: measure('.vela-batch__create-bar'),
        tableWrap: measure('.vela-batch__table-wrap')
      };
    })()`);
    for (const key of ['form', 'analysis', 'create']) {
      assert.ok(layout[key], `${key} must render at ${width}px`);
      assert.ok(layout[key].right <= layout.viewport.width + 1, `${key} is clipped at ${width}px`);
      assert.ok(layout[key].scrollWidth <= layout[key].clientWidth + 1, `${key} overflows at ${width}px`);
    }
    assert.equal(layout.main.scrollWidth <= layout.main.clientWidth + 1, true, `main content overflows at ${width}px`);
    assert.equal(layout.tableWrap.overflowX, 'auto');
    await window.webContents.executeJavaScript("document.querySelector('.vela-batch__create-bar').scrollIntoView({block:'center'})");
    await capture(window, `browser-layout-${width}x${height}.png`);
  }

  window.setContentSize(1280, 800);
  const failureControlUrl = new URL('/qa/fail-next-images?count=1', providerUrl);
  const failureControlResponse = await fetch(failureControlUrl, { method: 'POST' });
  assert.equal(failureControlResponse.ok, true, 'the QA provider must accept failure injection');
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.vela-batch__start');
    button.click();
    button.click();
  })()`);
  await waitUntil(window, "[...document.querySelectorAll('.vela-batch__status')].some((item) => item.textContent.includes('生成失败'))", 'failed batch result');
  const jobsBeforeRetry = await requestJson('/api/vela/jobs?limit=20');
  assert.equal(jobsBeforeRetry.length, 2, 'a rapid double click must create only the requested two jobs');
  assert.equal(jobsBeforeRetry.filter((job) => job.status === 'failed').length, 1);
  assert.equal(jobsBeforeRetry.filter((job) => job.status === 'succeeded').length, 1);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('.vela-batch__status[data-status=\"failed\"]')?.closest('tr')?.querySelector('input[type=\"checkbox\"]')?.disabled"), false, 'a failed row must remain selectable');
  await waitUntil(window, "document.querySelector('.vela-batch__start:not(:disabled)') && document.querySelector('.vela-batch__start').textContent.includes('（1）')", 'failed workflow retry selection');
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('[role=\"dialog\"]'))"), false, 'failed workflows must not require a retry confirmation dialog');
  await capture(window, 'browser-partial-failure-retry-ready.png');
  await window.webContents.executeJavaScript("document.querySelector('.vela-batch__start').click()");
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('[role=\"dialog\"]'))"), false, 'retry must start directly without a confirmation dialog');
  await waitUntil(window, "[...document.querySelectorAll('.vela-batch__status')].some((item) => item.textContent.includes('已完成'))", 'completed batch retry');
  const jobs = await requestJson('/api/vela/jobs?limit=20');
  assert.equal(jobs.length, 2, 'retry must reuse the original job group');
  assert.deepEqual(jobs.map((job) => job.id).sort(), jobsBeforeRetry.map((job) => job.id).sort());
  assert.equal(jobs.every((job) => job.status === 'succeeded'), true);
  assert.equal(jobs.filter((job) => job.retryCount === 1).length, 1);
  assert.equal(jobs.filter((job) => Number(job.retryCount || 0) === 0).length, 1);
  const resultUrls = jobs.map((job) => job.output?.media?.url).filter(Boolean);
  assert.equal(resultUrls.length, 2);

  await window.webContents.executeJavaScript("document.querySelector('.vela-batch__sync').click()");
  await waitUntil(window, "document.querySelector('.vela-batch-sync-dialog [data-primary=\"true\"]:not(:disabled)')", 'sync confirmation');
  await window.webContents.executeJavaScript("document.querySelector('.vela-batch-sync-dialog [data-primary=\"true\"]').click()");
  await waitUntil(window, "document.querySelector('.vela-batch-sync-dialog__result[data-status=\"succeeded\"]')", 'successful Storyworks sync');
  await capture(window, 'browser-sync-succeeded.png');
  await clickMatchingButton(window, '完成', '.vela-batch-sync-dialog button');

  await window.webContents.executeJavaScript("document.querySelector('.vela-batch__open').click()");
  await waitUntil(window, canvasResultExpression(resultUrls), 'completed result on canvas');
  assert.equal(await window.webContents.executeJavaScript("document.body.textContent.includes('正在制作 0%')"), false);
  await window.webContents.executeJavaScript(`(() => {
    const expandButton = document.querySelector('.vela-canvas-node--gpt-image .vela-result-collection__toggle[aria-expanded="false"]');
    if (!expandButton) throw new Error('Multi-result expand button was not found');
    expandButton.click();
  })()`);
  await waitUntil(
    window,
    "document.querySelector('.vela-canvas-node--gpt-image .vela-result-collection__toggle.is-collapse')",
    'expanded multi-result collection'
  );
  await window.webContents.executeJavaScript(`(() => {
    const node = document.querySelector('.vela-canvas-node--gpt-image');
    const rect = node.getBoundingClientRect();
    const eventOptions = {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + 24,
      clientY: rect.top + 24,
      pointerId: 71,
      pointerType: 'mouse',
      isPrimary: true
    };
    node.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
    node.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, buttons: 0 }));
  })()`);
  await waitUntil(window, "document.querySelector('.vela-canvas-node--gpt-image [data-testid=\"vela-media-toolbar\"]')", 'selected image material toolbar');
  const imageToolbarLayout = await window.webContents.executeJavaScript(`(() => {
    const node = document.querySelector('.vela-canvas-node--gpt-image');
    const sharedToolbar = node.querySelector('[data-testid="vela-media-toolbar"]');
    const collapseButton = node.querySelector('.vela-result-collection__toggle.is-collapse');
    const labels = [...sharedToolbar.children].map((item) => item.textContent.trim());
    const toolbarRect = sharedToolbar.getBoundingClientRect();
    const collapseRect = collapseButton?.getBoundingClientRect();
    const toolbarOverlapsCollapse = Boolean(collapseRect)
      && toolbarRect.left < collapseRect.right
      && toolbarRect.right > collapseRect.left
      && toolbarRect.top < collapseRect.bottom
      && toolbarRect.bottom > collapseRect.top;
    return {
      imageMaterialKept: labels.includes('图片素材'),
      uploadInsideSharedToolbar: labels.includes('上传'),
      annotationInsideSharedToolbar: labels.includes('备注'),
      cropKept: labels.includes('裁剪'),
      downloadKept: labels.includes('下载'),
      detachedCornerToolbarExists: node.querySelector('.vela-image-node-quick-actions') !== null,
      collapseButtonPresent: collapseButton !== null,
      toolbarOverlapsCollapse
    };
  })()`);
  assert.deepEqual(imageToolbarLayout, {
    imageMaterialKept: true,
    uploadInsideSharedToolbar: true,
    annotationInsideSharedToolbar: true,
    cropKept: true,
    downloadKept: true,
    detachedCornerToolbarExists: false,
    collapseButtonPresent: true,
    toolbarOverlapsCollapse: false
  }, '上传和备注必须并入节点上方的素材工具栏，不得继续覆盖多图收起按钮');
  await capture(window, 'browser-completed-result-on-canvas.png');
  await window.webContents.executeJavaScript(
    "document.querySelector('.vela-canvas-node--gpt-image .vela-result-collection__toggle.is-collapse').click()"
  );
  await waitUntil(
    window,
    "document.querySelector('.vela-canvas-node--gpt-image .vela-result-collection__toggle[aria-expanded=\"false\"]')",
    'collapsed multi-result collection after clicking the unobstructed control'
  );
  await capture(window, 'browser-result-collection-collapsed.png');

  window.webContents.reload();
  await waitUntil(window, "document.querySelector('nav[aria-label=\"项目导航\"]')", 'home after reload');
  await waitUntil(
    window,
    `[...document.querySelectorAll('.vela-home-sidebar-open')].some((item) => item.textContent.trim() === ${JSON.stringify(batch.name)})`,
    'recent batch project after reload'
  );
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.vela-home-sidebar-open')].find((item) => item.textContent.trim() === ${JSON.stringify(batch.name)});
    if (!button) throw new Error('Recent batch project was not found after reload');
    button.click();
  })()`);
  await waitUntil(window, canvasResultExpression(resultUrls), 'persisted result after reopen');
  assert.equal(await window.webContents.executeJavaScript("document.body.textContent.includes('正在制作 0%')"), false);
  await capture(window, 'browser-result-after-reopen.png');

  await window.webContents.executeJavaScript("document.querySelector('.vela-title-button').click()");
  await waitUntil(window, "document.querySelector('input[aria-label=\"项目名称\"]')", 'project title editor');
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[aria-label="项目名称"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '浏览器自动验收批次-保存失败保护');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await waitUntil(window, "document.querySelector('.vela-unsaved-dot')", 'dirty project marker');
  failNextProjectSave = true;
  saveFailureInjectionActive = true;
  await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"返回首页\"]').click()");
  await waitUntil(window, "document.querySelector('.vela-canvas-feedback[role=\"alert\"]')", 'save failure alert');
  saveFailureInjectionActive = false;
  assert.deepEqual(cancelledProjectSave?.method, 'PUT');
  assert.match(cancelledProjectSave?.url || '', /\/api\/vela\/projects\//);
  assert.ok(await window.webContents.executeJavaScript("!document.querySelector('.vela-home-shell') && document.querySelector('.vela-title-button')?.textContent.trim() === '浏览器自动验收批次-保存失败保护' && document.querySelector('.vela-unsaved-dot')"));
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('main[aria-label=\"电商工作流\"]'))"), false);
  await capture(window, 'browser-save-failure-blocks-navigation.png');

  await window.webContents.executeJavaScript("document.querySelector('.vela-save-button').click()");
  await waitUntil(window, "!document.querySelector('.vela-unsaved-dot') && !document.querySelector('.vela-canvas-feedback[role=\"alert\"]')", 'successful save recovery');
  await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"返回首页\"]').click()");
  await waitUntil(window, "document.querySelector('nav[aria-label=\"项目导航\"]')", 'home after successful save');

  const promptProject = await requestJson('/api/vela/projects', {
    name: '提示词模板自动验收项目',
    nodes: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  });
  window.webContents.reload();
  await waitUntil(window, "document.querySelector('nav[aria-label=\"项目导航\"]')", 'home for prompt template acceptance');
  await waitUntil(
    window,
    `[...document.querySelectorAll('.vela-home-sidebar-open')].some((item) => item.textContent.trim() === ${JSON.stringify(promptProject.name)})`,
    'prompt template project in recent list'
  );
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.vela-home-sidebar-open')]
      .find((item) => item.textContent.trim() === ${JSON.stringify(promptProject.name)});
    if (!button) throw new Error('Prompt template project was not found');
    button.click();
  })()`);
  await waitUntil(window, "document.querySelector('#canvas-background') && !document.querySelector('.vela-home-shell')", 'empty prompt template canvas');
  await window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('#canvas-background');
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 520, clientY: 360 }));
  })()`);
  await waitUntil(window, "document.querySelector('[data-testid=\"vela-quick-add-menu\"]')", 'three-block quick add menu');
  const quickAddLabels = await window.webContents.executeJavaScript(`[
    ...document.querySelectorAll('[data-testid="vela-quick-add-menu"] button')
  ].map((button) => button.querySelector('span')?.textContent?.trim())`);
  assert.deepEqual(quickAddLabels, ['提示词', '图片', '视频']);
  assert.equal(await window.webContents.executeJavaScript("document.body.textContent.includes('GPT 提示词优化')"), false);
  await capture(window, 'browser-three-block-quick-add.png');
  await window.webContents.executeJavaScript("document.querySelector('[data-testid=\"vela-quick-add-menu\"] button').click()");
  await waitUntil(window, "document.querySelector('.vela-canvas-node--prompt .vela-prompt-content.is-viewing')", 'original prompt node');
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=\"vela-prompt-node-editor\"]'))"), false);
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('.vela-canvas-node--prompt select'))"), false);
  assert.equal(await window.webContents.executeJavaScript("document.body.textContent.includes('上传效果图')"), false);
  await capture(window, 'browser-original-prompt-node-empty.png');
  await window.webContents.executeJavaScript(`(() => {
    const prompt = document.querySelector('.vela-canvas-node--prompt .vela-prompt-content');
    prompt.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  })()`);
  await waitUntil(window, "document.querySelector('.vela-canvas-node--prompt textarea[aria-label=\"提示词内容\"]')", 'original prompt textarea');
  await window.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('textarea[aria-label="提示词内容"]');
    textarea.focus();
    textarea.select();
  })()`);
  await window.webContents.insertText('只把裤子替换成纯黑色，人物、背景和光线保持不变。');
  await waitUntil(window, "document.querySelector('textarea[aria-label=\"提示词内容\"]')?.value.includes('纯黑色')", 'original prompt input value');
  await window.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('textarea[aria-label="提示词内容"]');
    textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
  })()`);
  await waitUntil(window, "document.querySelector('.vela-canvas-node--prompt .vela-prompt-content__view')?.textContent.includes('纯黑色')", 'original prompt text after editing');
  await capture(window, 'browser-original-prompt-node-edited.png');

  await window.webContents.executeJavaScript("document.querySelector('.vela-save-button').click()");
  await waitUntil(window, "!document.querySelector('.vela-unsaved-dot')", 'saved original prompt project');
  await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"返回首页\"]').click()");
  await waitUntil(window, "document.querySelector('nav[aria-label=\"项目导航\"]')", 'home after original prompt save');
  await waitUntil(
    window,
    `[...document.querySelectorAll('.vela-home-sidebar-open')].some((item) => item.textContent.trim() === ${JSON.stringify(promptProject.name)})`,
    'saved original prompt project in recent list'
  );
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.vela-home-sidebar-open')]
      .find((item) => item.textContent.trim() === ${JSON.stringify(promptProject.name)});
    if (!button) throw new Error('Saved original prompt project was not found');
    button.click();
  })()`);
  await waitUntil(window, "document.querySelector('.vela-canvas-node--prompt .vela-prompt-content__view')?.textContent.includes('纯黑色')", 'persisted original prompt after reopen');
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=\"vela-prompt-node-editor\"]'))"), false);
  await capture(window, 'browser-original-prompt-node-after-reopen.png');
  await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"返回首页\"]').click()");
  await waitUntil(window, "document.querySelector('nav[aria-label=\"项目导航\"]')", 'home after original prompt acceptance');

  const unexpectedConsoleErrors = consoleErrors.filter((entry) => (
    !(entry.expectedSaveFailure && /ERR_FAILED|Failed to fetch|Failed to save workflow/.test(entry.message || ''))
  ));
  assert.deepEqual(unexpectedConsoleErrors, []);
  console.log('Browser acceptance passed: responsive batch flow, retry/sync/result persistence, save recovery, three-block quick add, and the restored original prompt node.');
  window.destroy();
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
