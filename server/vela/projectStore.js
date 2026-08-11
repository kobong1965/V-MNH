import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  VELA_EXPORT_VERSION,
  VELA_SCHEMA_VERSION,
  assertNoPlaintextSecrets,
  validateProjectDocument
} from '../../shared/vela-contracts.js';

const MEDIA_FOLDERS = ['assets', 'inputs/images', 'inputs/videos', 'outputs/images', 'outputs/videos'];
const MEDIA_INDEX_FILE = 'media-index.json';

const ensureDirectory = (directory) => fs.mkdirSync(directory, { recursive: true });
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const safeDirectoryName = (value) => {
  const normalized = String(value || '未命名项目')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 60);
  return normalized || '未命名项目';
};

const assertSafeRelativePath = (relativePath) => {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Invalid archive path');
  }
  const normalized = relativePath.replaceAll('\\', '/');
  if (
    normalized.split('/').includes('..')
    || (normalized !== MEDIA_INDEX_FILE && !MEDIA_FOLDERS.some((folder) => normalized === folder || normalized.startsWith(`${folder}/`)))
  ) {
    throw new Error('Archive path escapes the project media folders');
  }
  return normalized;
};

const rewriteProjectMediaReferences = (value, sourceProjectId, targetProjectId) => {
  if (typeof value === 'string') {
    if (value === sourceProjectId) return targetProjectId;
    return value.replaceAll(
      `/api/vela/projects/${sourceProjectId}/`,
      `/api/vela/projects/${targetProjectId}/`
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteProjectMediaReferences(item, sourceProjectId, targetProjectId));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      rewriteProjectMediaReferences(item, sourceProjectId, targetProjectId)
    ]));
  }
  return value;
};

export const atomicWriteFile = (targetPath, data, hooks = {}) => {
  ensureDirectory(path.dirname(targetPath));
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  try {
    const fileDescriptor = fs.openSync(temporaryPath, 'wx');
    try {
      fs.writeFileSync(fileDescriptor, data);
      fs.fsyncSync(fileDescriptor);
    } finally {
      fs.closeSync(fileDescriptor);
    }
    hooks.beforeRename?.(temporaryPath, targetPath);
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
};

export const atomicWriteJson = (targetPath, value, hooks) => {
  atomicWriteFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, hooks);
};

const collectFiles = (directory, rootDirectory, results = []) => {
  if (!fs.existsSync(directory)) return results;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(fullPath, rootDirectory, results);
    if (entry.isFile()) results.push({
      fullPath,
      relativePath: path.relative(rootDirectory, fullPath).replaceAll('\\', '/')
    });
  }
  return results;
};

const getProjectThumbnail = (project) => {
  for (const node of [...project.nodes].reverse()) {
    for (const candidate of [node.resultUrl, node.lastFrame]) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue;
      if (candidate.startsWith('data:') || candidate.startsWith('blob:')) continue;
      return candidate;
    }
  }
  return undefined;
};

export class ProjectStore {
  constructor({ dataDirectory, projectsDirectory, snapshotLimit = 20, hooks = {} }) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    this.dataDirectory = path.resolve(dataDirectory);
    this.projectsDirectory = path.resolve(projectsDirectory || path.join(this.dataDirectory, 'projects'));
    this.snapshotLimit = snapshotLimit;
    this.hooks = hooks;
    this.lastRecovery = null;
    ensureDirectory(this.projectsDirectory);
  }

  findProjectDirectory(projectId) {
    if (!projectId) return null;
    for (const entry of fs.readdirSync(this.projectsDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.projectsDirectory, entry.name);
      const projectPath = path.join(directory, 'project.json');
      const identityPath = path.join(directory, '.vela-project-id');
      if (fs.existsSync(identityPath) && fs.readFileSync(identityPath, 'utf8').trim() === projectId) return directory;
      if (!fs.existsSync(projectPath)) continue;
      try {
        if (JSON.parse(fs.readFileSync(projectPath, 'utf8')).id === projectId) return directory;
      } catch {
        // Corrupt projects can still be located by the identity file.
      }
    }
    return null;
  }

  createProjectDirectory(name, id) {
    const directory = path.join(this.projectsDirectory, `${safeDirectoryName(name)}--${id.slice(0, 8)}`);
    ensureDirectory(directory);
    for (const folder of [...MEDIA_FOLDERS, 'thumbnails', 'exports', 'snapshots']) {
      ensureDirectory(path.join(directory, folder));
    }
    atomicWriteFile(path.join(directory, '.vela-project-id'), `${id}\n`);
    return directory;
  }

  saveProject(draft) {
    assertNoPlaintextSecrets(draft);
    const now = new Date().toISOString();
    const id = draft.id || crypto.randomUUID();
    const existingDirectory = this.findProjectDirectory(id);
    const directory = existingDirectory || this.createProjectDirectory(draft.name, id);
    const projectPath = path.join(directory, 'project.json');
    let previous;

    if (fs.existsSync(projectPath)) {
      try {
        previous = validateProjectDocument(JSON.parse(fs.readFileSync(projectPath, 'utf8')));
        this.createSnapshot(directory, previous);
      } catch {
        // The last valid snapshot is kept; the corrupt primary will be replaced atomically.
      }
    }

    const project = validateProjectDocument({
      schemaVersion: VELA_SCHEMA_VERSION,
      id,
      name: String(draft.name || previous?.name || '未命名项目').trim() || '未命名项目',
      createdAt: previous?.createdAt || draft.createdAt || now,
      updatedAt: now,
      nodes: Array.isArray(draft.nodes) ? draft.nodes : [],
      groups: Array.isArray(draft.groups) ? draft.groups : [],
      viewport: draft.viewport || { x: 0, y: 0, zoom: 1 },
      settings: draft.settings || {}
    });

    atomicWriteJson(projectPath, project, this.hooks);
    return project;
  }

  createSnapshot(directory, project) {
    const snapshotsDirectory = path.join(directory, 'snapshots');
    ensureDirectory(snapshotsDirectory);
    const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`;
    atomicWriteJson(path.join(snapshotsDirectory, filename), project);
    const files = fs.readdirSync(snapshotsDirectory)
      .filter((item) => item.endsWith('.json'))
      .sort();
    for (const stale of files.slice(0, Math.max(0, files.length - this.snapshotLimit))) {
      fs.unlinkSync(path.join(snapshotsDirectory, stale));
    }
  }

  readLatestValidSnapshot(directory) {
    const snapshotsDirectory = path.join(directory, 'snapshots');
    if (!fs.existsSync(snapshotsDirectory)) return null;
    const files = fs.readdirSync(snapshotsDirectory)
      .filter((item) => item.endsWith('.json'))
      .sort()
      .reverse();
    for (const file of files) {
      try {
        const project = validateProjectDocument(JSON.parse(fs.readFileSync(path.join(snapshotsDirectory, file), 'utf8')));
        return { file, project };
      } catch {
        // Continue until a valid snapshot is found.
      }
    }
    return null;
  }

  getProject(projectId) {
    const directory = this.findProjectDirectory(projectId);
    if (!directory) return null;
    const projectPath = path.join(directory, 'project.json');
    try {
      return validateProjectDocument(JSON.parse(fs.readFileSync(projectPath, 'utf8')));
    } catch (error) {
      const snapshot = this.readLatestValidSnapshot(directory);
      if (!snapshot) throw error;
      atomicWriteJson(projectPath, snapshot.project);
      this.lastRecovery = { projectId, snapshot: snapshot.file };
      return snapshot.project;
    }
  }

  listProjects() {
    const projects = [];
    for (const entry of fs.readdirSync(this.projectsDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const identityPath = path.join(this.projectsDirectory, entry.name, '.vela-project-id');
      if (!fs.existsSync(identityPath)) continue;
      try {
        const project = this.getProject(fs.readFileSync(identityPath, 'utf8').trim());
        if (project) projects.push({
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          nodeCount: project.nodes.length,
          thumbnailUrl: getProjectThumbnail(project)
        });
      } catch {
        // A broken project without a valid snapshot is excluded from the list.
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  renameProject(projectId, name) {
    const project = this.getProject(projectId);
    if (!project) return null;
    const nextName = String(name || '').trim();
    if (!nextName) throw new Error('项目名称不能为空');
    return this.saveProject({ ...project, name: nextName });
  }

  deleteProject(projectId) {
    const directory = this.findProjectDirectory(projectId);
    if (!directory) return false;
    const relativeDirectory = path.relative(this.projectsDirectory, directory);
    if (!relativeDirectory || relativeDirectory.startsWith('..') || path.isAbsolute(relativeDirectory)) {
      throw new Error('Project path escapes the projects directory');
    }
    fs.rmSync(directory, { recursive: true, force: false });
    return true;
  }

  exportProject(projectId, { includeMedia = false } = {}) {
    const project = this.getProject(projectId);
    const directory = this.findProjectDirectory(projectId);
    if (!project || !directory) return null;
    const media = includeMedia
      ? [
        ...MEDIA_FOLDERS.flatMap((folder) => collectFiles(path.join(directory, folder), directory)),
        ...(fs.existsSync(path.join(directory, MEDIA_INDEX_FILE)) ? [{
          fullPath: path.join(directory, MEDIA_INDEX_FILE),
          relativePath: MEDIA_INDEX_FILE
        }] : [])
      ]
        .map(({ fullPath, relativePath }) => {
          const data = fs.readFileSync(fullPath);
          return { relativePath, sha256: sha256(data), dataBase64: data.toString('base64') };
        })
      : [];
    const archive = {
      format: 'vela-export',
      exportVersion: VELA_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      includeMedia,
      project,
      media
    };
    assertNoPlaintextSecrets(archive);
    return archive;
  }

  importProject(archive, { name } = {}) {
    if (!archive || archive.format !== 'vela-export' || archive.exportVersion !== VELA_EXPORT_VERSION) {
      throw new Error('Unsupported Vela export');
    }
    const source = validateProjectDocument(archive.project);
    const importedName = name || `${source.name}（导入）`;
    const placeholder = this.saveProject({
      ...source,
      id: undefined,
      name: importedName,
      nodes: [],
      groups: []
    });
    const directory = this.findProjectDirectory(placeholder.id);
    for (const item of archive.media || []) {
      const relativePath = assertSafeRelativePath(item.relativePath);
      const data = Buffer.from(item.dataBase64, 'base64');
      if (sha256(data) !== item.sha256) throw new Error(`Media hash mismatch: ${relativePath}`);
      const targetPath = path.join(directory, ...relativePath.split('/'));
      if (relativePath === MEDIA_INDEX_FILE) {
        const mediaIndex = JSON.parse(data.toString('utf8'));
        atomicWriteJson(targetPath, rewriteProjectMediaReferences(mediaIndex, source.id, placeholder.id));
      } else {
        atomicWriteFile(targetPath, data);
      }
    }
    const imported = rewriteProjectMediaReferences(source, source.id, placeholder.id);
    return this.saveProject({
      ...imported,
      id: placeholder.id,
      name: importedName,
      createdAt: placeholder.createdAt
    });
  }

  exportProjectPackage(projectId, options) {
    const archive = this.exportProject(projectId, options);
    return archive ? gzipSync(Buffer.from(JSON.stringify(archive), 'utf8'), { level: 9 }) : null;
  }

  importProjectPackage(packageBuffer, options) {
    const archive = JSON.parse(gunzipSync(packageBuffer).toString('utf8'));
    return this.importProject(archive, options);
  }
}
