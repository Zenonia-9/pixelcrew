import releases from './release.json';

export const publishedReleases = releases.filter(release => release.published && /^\d+\.\d+\.\d+$/.test(release.version))
  .sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
