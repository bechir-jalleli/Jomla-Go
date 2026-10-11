const Module = require('node:module');
const origResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return origResolve.call(this, request, parent, isMain, options);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && typeof request === 'string' && request.endsWith('.js')) {
      try {
        return origResolve.call(this, request.slice(0, -3) + '.ts', parent, isMain, options);
      } catch {
        // Fall through to throw original error
      }
    }
    throw err;
  }
};
