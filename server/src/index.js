import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createRouter } from './routes.js';
import { setupSocket } from './socket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use('/api', createRouter({ io }));

if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.status(404).send(
      'Client build not found. Run "npm run build" from the project root, then restart this server.'
    );
  });
}

setupSocket(io);

httpServer.listen(PORT, () => {
  console.log(`🔒 Secure messaging server running on http://localhost:${PORT}`);
  console.log(`   REST API:  /api   WebSocket: /socket.io`);
});
