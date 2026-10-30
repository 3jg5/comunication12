import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const rootDir = __dirname;

// Set middleware for security and headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Alias for /Alfarooq-Communications prefix if requested
app.use('/Alfarooq-Communications', express.static(rootDir, {
  extensions: ['html', 'htm'],
  index: 'index.html',
  setHeaders: (res, path) => {
    if (path.endsWith('.webmanifest') || path.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));

// Serve static assets from root directory
app.use(express.static(rootDir, {
  extensions: ['html', 'htm'],
  index: 'index.html',
  setHeaders: (res, path) => {
    if (path.endsWith('.webmanifest') || path.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));

// Route aliases
app.get('/chat', (req, res) => {
  res.sendFile(join(rootDir, 'chat.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(join(rootDir, 'admin.html'));
});

// Fallback routing
app.get('*', (req, res) => {
  const possiblePath = join(rootDir, req.path);
  if (existsSync(possiblePath)) {
    return res.sendFile(possiblePath);
  }
  const possibleHtml = join(rootDir, `${req.path}.html`);
  if (existsSync(possibleHtml)) {
    return res.sendFile(possibleHtml);
  }
  res.sendFile(join(rootDir, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`منصة مدرسة الفاروق للتواصل الرقمي تعمل على http://${HOST}:${PORT}`);
});
