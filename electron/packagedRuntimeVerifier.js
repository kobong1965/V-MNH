import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const isInside = (root, candidate) => {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
};

export function assertProjectOwnedNodeModules(projectRoot) {
  const resolvedProjectRoot = realpathSync(projectRoot);
  const resolvedNodeModules = realpathSync(path.join(resolvedProjectRoot, 'node_modules'));
  if (!isInside(resolvedProjectRoot, resolvedNodeModules)) {
    throw new Error(
      `Packaging requires a real node_modules directory inside the project. `
      + `Resolved node_modules outside the project: ${resolvedNodeModules}`
    );
  }
  return resolvedNodeModules;
}

export function verifyPackagedRuntime(appRoot) {
  const resolvedAppRoot = realpathSync(appRoot);
  const updaterDirectory = path.join(resolvedAppRoot, 'node_modules', 'electron-updater');
  const updaterPackagePath = path.join(updaterDirectory, 'package.json');
  const updaterPackage = JSON.parse(readFileSync(updaterPackagePath, 'utf8'));
  const updaterEntry = path.join(updaterDirectory, updaterPackage.main || 'out/main.js');
  const requireFromUpdater = createRequire(updaterEntry);
  const missingDependencies = [];

  for (const dependency of Object.keys(updaterPackage.dependencies || {})) {
    try {
      const resolvedDependency = realpathSync(requireFromUpdater.resolve(dependency));
      if (!isInside(resolvedAppRoot, resolvedDependency)) {
        missingDependencies.push(`${dependency} (resolved outside packaged app)`);
      }
    } catch {
      missingDependencies.push(dependency);
    }
  }

  if (missingDependencies.length > 0) {
    throw new Error(
      `Packaged electron-updater dependencies are incomplete: ${missingDependencies.join(', ')}`
    );
  }

  return {
    updaterVersion: updaterPackage.version,
    dependencies: Object.keys(updaterPackage.dependencies || {})
  };
}
