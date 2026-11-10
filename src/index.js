import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import videoRoutes from './routes/videoRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { ensureBinaries } from '../scripts/install-binaries.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Trust reverse proxy (Railway, Render, Fly.io, Nginx)
app.set('trust proxy', 1);

// Security Headers
app.use(helmet());

// CORS configuration (Strict - Never wildcard origin)
const clientUrlEnv = process.env.CLIENT_URL;
const rawOrigins = clientUrlEnv
  ? clientUrlEnv.split(',').map(url => url.trim().replace(/\/+$/, ''))
  : ['http://localhost:5174', 'http://127.0.0.1:5174'];

// Ensure both localhost and 127.0.0.1 on the specified ports are permitted
const expandedOrigins = new Set(rawOrigins);
for (const origin of rawOrigins) {
  if (origin.includes('localhost')) {
    expandedOrigins.add(origin.replace('localhost', '127.0.0.1'));
  } else if (origin.includes('127.0.0.1')) {
    expandedOrigins.add(origin.replace('127.0.0.1', 'localhost'));
  }
}
const finalAllowedOrigins = Array.from(expandedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server or tools with no origin header
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/+$/, '');
      if (finalAllowedOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy violation: Origin ${origin} not allowed.`));
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'Content-Length'],
  })
);

// Request parsing
app.use(express.json({ limit: '1mb' }));

// Mount API routes
app.use('/api', videoRoutes);

// Fallback for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Centralized error handling
app.use(errorHandler);

// Connect to MongoDB and start server
async function startServer() {
  await ensureBinaries();
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`[Video Saver Server] Running on http://localhost:${PORT}`);
    console.log(`[Video Saver Server] Allowed client origins: ${finalAllowedOrigins.join(', ')}`);
  });

  // Keep connections alive for long media downloads & transcode operations (up to 30 minutes)
  server.setTimeout(1800000);
  server.requestTimeout = 1800000;
  server.headersTimeout = 1810000;
  server.keepAliveTimeout = 1800000;
}

startServer();
