import path from 'path';
import { fileURLToPath } from 'url';

function getFilename(moduleUrl: string) {
  return path.basename(fileURLToPath(moduleUrl));
}

export function logger(module: { url: string }) {
  const label = getFilename(module.url);

  return {
    info: (message: string) => {
      console.log(`${new Date().toISOString()} [${label}] INFO: ${message}`);
    },
    error: (message: string) => {
      console.error(`${new Date().toISOString()} [${label}] ERROR: ${message}`);
    },
    warn: (message: string) => {
      console.warn(`${new Date().toISOString()} [${label}] WARN: ${message}`);
    },
  };
}