import {createLocalServer} from '../server/local.js';

// Reuse every existing backend route and its loopback/origin/TLS checks.
export async function startDesktopServer({port, env, labDirectory, ...options}) {
  const server = createLocalServer({env, labDirectory, ...options});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  let closing;
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    close: () =>
      (closing ??= new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })),
  };
}

export function isAppUrl(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}
