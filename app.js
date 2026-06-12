'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const morgan     = require('morgan');
const winston    = require('winston');

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) =>
      `[${timestamp}] [${level.toUpperCase()}] ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/app.log' }),
    new winston.transports.File({ filename: 'logs/errors.log', level: 'error' }),
  ],
});

const REQUIRED_ENV = ['DATABASE_URL', 'WEBHOOK_SECRET', 'NODE_ENV'];

function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error(`Variables de entorno faltantes: ${missing.join(', ')}`);
    process.exit(1);
  }
}
validateEnv();

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'", "'unsafe-inline'"],
        imgSrc:         ["'self'", 'data:', 'https:'],
        connectSrc:     ["'self'"],
        fontSrc:        ["'self'"],
        objectSrc:      ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hidePoweredBy: true,
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    noSniff:      true,
    frameguard:   { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [];

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000', 'http://localhost:5173');
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn(`CORS bloqueado para origen: ${origin}`);
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-signature'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Demasiadas solicitudes. Intentá nuevamente en 15 minutos.' },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit global excedido | IP: ${req.ip}`);
    res.status(429).json(options.message);
  },
});

app.use(globalLimiter);
app.use(express.json({ limit: '100kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (message) => logger.info(message.trim()) },
    skip: (req) => req.path === '/health',
  })
);

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const webhookRoutes = require('./webhookRoutes');
app.use('/api/webhooks', webhookRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    status:      'ok',
    timestamp:   new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

app.use((req, res) => {
  logger.warn(`404 | ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('Origen no permitido')) {
    return res.status(403).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido en el cuerpo del request.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo supera el límite de 100kb.' });
  }
  logger.error(`Error no manejado | ${req.method} ${req.path} | ${err.message}`);
  const statusCode = err.statusCode || 500;
  const mensaje = process.env.NODE_ENV === 'production'
    ? 'Error interno del servidor.'
    : err.message;
  return res.status(statusCode).json({ error: mensaje });
});

require('./notificationService');
logger.info('Servicio de notificaciones (cron 09:00 AM) registrado.');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Servidor corriendo en puerto ${PORT}`);
  logger.info(`Entorno: ${process.env.NODE_ENV}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

function gracefulShutdown(signal) {
  logger.info(`${signal} recibido. Cerrando servidor...`);
  server.close(async () => {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$disconnect();
    logger.info('Servidor apagado correctamente.');
    process.exit(0);
  });
  setTimeout(() => { process.exit(1); }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Promise Rejection: ${reason}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

module.exports = app;
