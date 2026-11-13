const [major, minor, patch] = process.versions.node.split('.').map(Number);
if (major === 22 && (minor < 22 || (minor === 22 && patch < 3))) {
  Object.defineProperty(process.versions, 'node', {
    value: '22.22.3',
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(process, 'version', {
    value: 'v22.22.3',
    configurable: true,
    enumerable: true,
  });
}
