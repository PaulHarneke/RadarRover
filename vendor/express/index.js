const http = require('http');
const fs = require('fs');
const path = require('path');

function createApp() {
  const middlewares = [];
  const routes = [];

  const app = function (req, res) {
    enhanceResponse(res);
    req.path = getPathname(req.url);

    const stack = [...middlewares];
    const matchingRoutes = routes.filter((route) => route.method === req.method && route.path === req.path);
    matchingRoutes.forEach((route) => {
      route.handlers.forEach((handler) => stack.push(handler));
    });

    let index = 0;

    function next(err) {
      if (res.writableEnded) {
        return;
      }
      const layer = stack[index++];
      if (!layer) {
        if (err) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        } else if (!matchingRoutes.length) {
          res.statusCode = 404;
          res.end('Not Found');
        }
        return;
      }

      try {
        if (err) {
          if (layer.length === 4) {
            layer(err, req, res, next);
          } else {
            next(err);
          }
        } else if (layer.length === 4) {
          next();
        } else {
          layer(req, res, next);
        }
      } catch (error) {
        next(error);
      }
    }

    next();
  };

  app.use = (fn) => {
    middlewares.push(fn);
  };

  ['get', 'post', 'delete', 'put', 'patch'].forEach((method) => {
    app[method] = (routePath, ...handlers) => {
      routes.push({ method: method.toUpperCase(), path: routePath, handlers });
    };
  });

  app.listen = (port, cb) => {
    const server = http.createServer(app);
    return server.listen(port, cb);
  };

  return app;
}

function getPathname(url) {
  const queryIndex = url.indexOf('?');
  const pathname = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  try {
    return decodeURIComponent(pathname);
  } catch (error) {
    return pathname;
  }
}

function enhanceResponse(res) {
  if (res._enhanced) return;
  res._enhanced = true;

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (obj) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(obj));
  };

  res.send = (data) => {
    if (typeof data === 'object') {
      return res.json(data);
    }
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end(data);
  };

  res.sendFile = (filePath) => {
    fs.createReadStream(filePath)
      .on('error', () => {
        if (!res.headersSent) {
          res.statusCode = 404;
        }
        res.end();
      })
      .pipe(res);
  };
}

function staticMiddleware(root) {
  const absoluteRoot = path.resolve(root);
  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    let pathname = req.path || getPathname(req.url);
    if (pathname === '/') {
      pathname = '/index.html';
    }
    const filePath = path.join(absoluteRoot, pathname);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(absoluteRoot)) {
      return next();
    }
    fs.stat(resolved, (err, stats) => {
      if (err || !stats.isFile()) {
        return next();
      }
      const stream = fs.createReadStream(resolved);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        res.end();
      });
      if (!res.headersSent) {
        res.setHeader('Content-Type', getMimeType(resolved));
      }
      stream.pipe(res);
    });
  };
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function jsonMiddleware() {
  return function (req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return next();
    }
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return next();
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.length) {
        req.body = {};
        return next();
      }
      try {
        req.body = JSON.parse(body);
        next();
      } catch (error) {
        res.statusCode = 400;
        res.end('Invalid JSON');
      }
    });
    req.on('error', () => {
      res.statusCode = 400;
      res.end('Invalid request body');
    });
  };
}

module.exports = Object.assign(createApp, {
  json: jsonMiddleware,
  static: staticMiddleware,
});
