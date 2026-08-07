import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { FakeImageProvider } from '../providers/fakeImageProvider.js';
import { FakeVideoProvider } from '../providers/fakeVideoProvider.js';

const router = express.Router();
const fakeImageProvider = new FakeImageProvider();
const fakeVideoProvider = new FakeVideoProvider();

const safeMetadataId = (nodeId, fallbackId) => {
  if (typeof nodeId !== 'string') return fallbackId;
  return /^[a-zA-Z0-9_-]{1,128}$/.test(nodeId) ? nodeId : fallbackId;
};

router.post('/vela/generate-image', async (req, res) => {
  try {
    const { prompt, aspectRatio, nodeId } = req.body ?? {};
    const output = await fakeImageProvider.generateImage({ prompt, aspectRatio });
    const assetId = crypto.randomUUID();
    const filename = `vela-fake-${assetId}.${output.extension}`;
    const metadataId = safeMetadataId(nodeId, assetId);
    const imagesDirectory = req.app.locals.IMAGES_DIR;

    if (!imagesDirectory) {
      throw new Error('Image storage is not configured');
    }

    fs.writeFileSync(path.join(imagesDirectory, filename), output.data);
    fs.writeFileSync(
      path.join(imagesDirectory, `${metadataId}.json`),
      JSON.stringify({
        id: metadataId,
        filename,
        prompt: prompt.trim(),
        model: output.providerId,
        createdAt: new Date().toISOString(),
        type: 'images'
      }, null, 2)
    );

    res.json({
      jobId: assetId,
      status: 'succeeded',
      providerId: output.providerId,
      resultUrl: `/library/images/${filename}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fake generation failed';
    const statusCode = /prompt is required/i.test(message) ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

router.post('/vela/generate-video', async (req, res) => {
  try {
    const { prompt, aspectRatio, nodeId } = req.body ?? {};
    const output = await fakeVideoProvider.generateVideo({ prompt, aspectRatio });
    const assetId = crypto.randomUUID();
    const filename = `vela-fake-h3-${assetId}.${output.extension}`;
    const metadataId = safeMetadataId(nodeId, assetId);
    const imagesDirectory = req.app.locals.IMAGES_DIR;

    if (!imagesDirectory) throw new Error('Image storage is not configured');

    fs.writeFileSync(path.join(imagesDirectory, filename), output.data);
    fs.writeFileSync(
      path.join(imagesDirectory, `${metadataId}.json`),
      JSON.stringify({
        id: metadataId,
        filename,
        prompt: prompt.trim(),
        model: output.providerId,
        createdAt: new Date().toISOString(),
        type: 'videos',
        previewOnly: true
      }, null, 2)
    );

    res.json({
      jobId: assetId,
      status: 'succeeded',
      providerId: output.providerId,
      previewOnly: true,
      resultUrl: `/library/images/${filename}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fake generation failed';
    const statusCode = /prompt is required/i.test(message) ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

export default router;
