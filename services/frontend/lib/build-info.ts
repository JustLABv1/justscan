import packageJson from '../package.json';

const configuredVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
const packageVersion = typeof packageJson.version === 'string' ? packageJson.version : 'dev';
const rawVersion = configuredVersion || packageVersion;

export const APP_FRONTEND_VERSION = rawVersion.replace(/^v/, '');
export const APP_COPYRIGHT = `Copyright ${new Date().getFullYear()} JustLAB`;
