export const DEFAULT_UPDATE_CONFIG = Object.freeze({
  owner: 'kobong1965',
  repo: 'V-MNH',
  privateRepository: false
});

const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export const normalizeUpdateConfig = (value = {}, fallback = DEFAULT_UPDATE_CONFIG) => {
  const owner = String(value.owner || fallback.owner || '').trim();
  const repo = String(value.repo || fallback.repo || '').trim();
  if (!GITHUB_NAME.test(owner)) throw new Error('GitHub 用户名或组织名称格式不正确');
  if (!GITHUB_NAME.test(repo)) throw new Error('GitHub 仓库名称格式不正确');
  return {
    owner,
    repo,
    privateRepository: Boolean(value.privateRepository)
  };
};

export const buildFeedOptions = (config, token = '') => ({
  provider: 'github',
  owner: config.owner,
  repo: config.repo,
  private: Boolean(config.privateRepository),
  ...(config.privateRepository && token ? { token } : {})
});

export const redactUpdateError = (error, secrets = []) => {
  let message = error instanceof Error ? error.message : String(error || '更新操作失败');
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join('[已隐藏]');
  return message.replace(/(authorization|token|key)\s*[:=]\s*[^\s,;]+/gi, '$1=[已隐藏]');
};
