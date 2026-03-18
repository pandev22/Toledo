const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const loadConfig = require('../handlers/config.js');
const settings = loadConfig('./config.toml');

const HeliactylModule = {
  "name": "Routing",
  "version": "1.0.0",
  "api_level": 4,
  "target_platform": "10.0.0",
  "description": "Core module",
  "author": {
    "name": "Matt James",
    "email": "me@ether.pizza",
    "url": "https://ether.pizza"
  },
  "dependencies": [],
  "permissions": [],
  "routes": [],
  "config": {},
  "hooks": [],
  "tags": ['core'],
  "license": "MIT"
};

module.exports.HeliactylModule = HeliactylModule;
module.exports.load = async function (app, db) {
  const distPath = path.join(__dirname, '../../frontend/dist');
  const indexPath = path.join(distPath, 'index.html');
  const devIndexPath = path.join(__dirname, '../../frontend/index.html');

  let cachedHtml = null;
  let isUsingDistBuild = false;

  const renderHtml = (html) => html.replace(/{{SITE_NAME}}/g, settings.website.name || 'Heliactyl');

  async function refreshHtmlCache() {
    try {
      const html = await fs.readFile(indexPath, 'utf8');
      cachedHtml = renderHtml(html);
      isUsingDistBuild = true;
      return cachedHtml;
    } catch (distError) {
      const html = await fs.readFile(devIndexPath, 'utf8');
      cachedHtml = renderHtml(html);
      isUsingDistBuild = false;
      return cachedHtml;
    }
  }

  await refreshHtmlCache().catch(() => null);

  const watcher = chokidar.watch([indexPath, devIndexPath], {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50
    }
  });

  watcher.on('add', () => refreshHtmlCache().catch(() => null));
  watcher.on('change', () => refreshHtmlCache().catch(() => null));
  watcher.on('unlink', () => refreshHtmlCache().catch(() => null));

  app.use('/', express.static(distPath, {
    fallthrough: true,
    index: false,
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }));

  app.get('/*', async (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();

    try {
      const html = cachedHtml || await refreshHtmlCache();

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('X-Frontend-Source', isUsingDistBuild ? 'dist' : 'dev');
      res.send(html);
    } catch (error) {
      next();
    }
  });
};
