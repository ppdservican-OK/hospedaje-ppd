'use strict';

require('dotenv').config();

const express    = require('express');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const cloudinary = require('cloudinary').v2;
const axios      = require('axios');
const winston    = require('winston');

const router = express.Router();
const prisma = new PrismaClient({ log: ['error', 'warn'] });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) =>
      `[${timestamp}] [${level.toUpperCase()}] ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/webhooks.log' }),
    new winston.transports.File({ filename: 'logs/errors.log', level: 'error' }),
  ],
});

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intentá más tarde.' },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit excedido desde IP: ${req.ip}`);
    res.status(429).json(options.message);
  },
});

function verificarFirma(req, res, next) {
  if (process.env.NODE_ENV !== 'production' && process.env.SKIP_WEBHOOK_SIG === 'true') {
    return next();
  }
  const firmaRecibida = req.headers['x-webhook-signature'];
  if (!firmaRecibida) {
    logger.warn(`Webhook sin firma | IP: ${req.ip}`);
    return res.status(401).json({ error: 'Firma de seguridad ausente.' });
  }
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Error de configuración del servidor.' });
  }
  const firmaEsperada = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  const a = Buffer.from(firmaRecibida, 'hex');
  const b = Buffer.from(firmaEsperada, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.warn(`Firma inválida | IP: ${req.ip}`);
    return res.status(403).json({ error: 'Firma de seguridad inválida.' });
  }
  next();
}

function handleValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Datos inválidos.', detalle: errors.array() });
  }
  return null;
}

function extraerHoraArgentina(fechaISO) {
  const date = new Date(fechaISO);
  const horaLocal = date.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const [horas, minutos] = horaLocal.split(':').map(Number);
  return { horas, minutos };
}

function contarDiasCalendario(fechaIngresoISO, fechaEgresoISO) {
  const opcionesTZ = { timeZone: 'America/Argentina/Buenos_Aires' };
  const ingreso = new Date(fechaIngresoISO);
  const egreso  = new Date(fechaEgresoISO);
  const fechaLocalIngreso = new Date(ingreso.toLocaleDateString('en-CA', opcionesTZ));
  const fechaLocalEgreso  = new Date(egreso.toLocaleDateString('en-CA', opcionesTZ));
  const msPorDia = 1000 * 60 * 60 * 24;
  const dias = Math.floor((fechaLocalEgreso - fechaLocalIngreso) / msPorDia) + 1;
  return dias > 0 ? dias : null;
}

function calcularCobro(fechaIngresoISO, fechaEgresoISO, valorPorDia) {
  const diasCalendario = contarDiasCalendario(fechaIngresoISO, fechaEgresoISO);
  if (!diasCalendario) return null;
  const { horas } = extraerHoraArgentina(fechaEgresoISO);
  const descuento = horas < 12;
  let total;
  if (descuento && diasCalendario > 1) {
    total = (diasCalendario - 1) * valorPorDia + (valorPorDia * 0.5);
  } else {
    total = diasCalendario * valorPorDia;
  }
  return {
    dias_completos:   diasCalendario,
    aplica_medio_dia: descuento && diasCalendario > 1,
    hora_egreso:      `${String(horas).padStart(2,'0')}:00`,
    valor_por_dia:    valorPorDia,
    valor_total:      Math.round(total * 100) / 100,
  };
}

async function subirFotoACloudinary(urlTemporal, nombrePerro, tutorId) {
  if (!urlTemporal) return null;
  try {
    const response = await axios({
      method: 'GET', url: urlTemporal,
      responseType: 'stream', timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const contentType = response.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) return null;
    const urlPermanente = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `la_manada/perros/${tutorId}`,
          public_id: `${nombrePerro.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
          resource_type: 'image',
          transformation: [
            { width: 800, height: 800, crop: 'limit' },
            { quality: 'auto:good' },
            { fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result.secure_url);
        }
      );
      response.data.pipe(uploadStream);
    });
    logger.info(`Foto subida a Cloudinary: ${urlPermanente}`);
    return urlPermanente;
  } catch (err) {
    logger.error(`Error al procesar foto: ${err.message}`);
    return null;
  }
}

const validarComportamiento = [
  body('telefono_tutor').trim().notEmpty().matches(/^[\d\s\+\-\(\)]{7,20}$/),
  body('email_tutor').trim().notEmpty().isEmail().normalizeEmail(),
  body('nombre_tutor').trim().notEmpty().isLength({ min: 2, max: 120 }).escape(),
  body('nombre_perro').trim().notEmpty().isLength({ min: 1, max: 80 }).escape(),
  body('fecha_nacimiento').optional({ nullable: true, checkFalsy: true }).isISO8601(),
  body('datos_comportamiento').notEmpty()
    .customSanitizer((v) => typeof v === 'object' ? v : (() => {
      try { return JSON.parse(v); } catch { return { texto: String(v) }; }
    })()),
  body('foto_url_temporal').optional({ nullable: true, checkFalsy: true }).isURL(),
];

router.post('/comportamiento', webhookLimiter, verificarFirma, validarComportamiento,
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;
    const { telefono_tutor, email_tutor, nombre_tutor, nombre_perro,
            fecha_nacimiento, datos_comportamiento, foto_url_temporal } = req.body;
    logger.info(`Webhook comportamiento | ${nombre_tutor} | ${nombre_perro}`);
    try {
      const resultado = await prisma.$transaction(async (tx) => {
        let tutor = await tx.tutor.findFirst({
          where: { OR: [{ email: email_tutor }, { telefono_principal: telefono_tutor }] },
        });
        if (!tutor) {
          tutor = await tx.tutor.create({
            data: { nombre_completo: nombre_tutor, telefono_principal: telefono_tutor, email: email_tutor },
          });
        }
        let perro = await tx.perro.findFirst({
          where: { tutor_id: tutor.id, nombre: { equals: nombre_perro, mode: 'insensitive' } },
        });
        let fotoUrl = perro?.foto_url || null;
        if (foto_url_temporal) {
          fotoUrl = await subirFotoACloudinary(foto_url_temporal, nombre_perro, tutor.id);
        }
        if (!perro) {
          perro = await tx.perro.create({
            data: {
              tutor_id: tutor.id, nombre: nombre_perro,
              fecha_nacimiento: fecha_nacimiento ? new Date(fecha_nacimiento) : null,
              datos_comportamiento, foto_url: fotoUrl,
            },
          });
        } else {
          const dataUpdate = { datos_comportamiento };
          if (fotoUrl && fotoUrl !== perro.foto_url) dataUpdate.foto_url = fotoUrl;
          perro = await tx.perro.update({ where: { id: perro.id }, data: dataUpdate });
        }
        return { tutor, perro };
      });
      return res.status(200).json({
        ok: true, mensaje: 'Formulario procesado.',
        tutor_id: resultado.tutor.id, perro_id: resultado.perro.id,
      });
    } catch (err) {
      logger.error(`Error en /comportamiento: ${err.message}`);
      return res.status(500).json({ ok: false, error: 'Error interno.' });
    }
  }
);

const validarReserva = [
  body('telefono_tutor').trim().notEmpty().matches(/^[\d\s\+\-\(\)]{7,20}$/),
  body('nombre_perro').trim().notEmpty().isLength({ min: 1, max: 80 }).escape(),
  body('fecha_ingreso').notEmpty().isISO8601(),
  body('fecha_egreso').notEmpty().isISO8601()
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.fecha_ingreso))
        throw new Error('La fecha de egreso debe ser posterior al ingreso.');
      return true;
    }),
  body('requiere_traslado').isBoolean().toBoolean(),
  body('requiere_banio').isBoolean().toBoolean(),
  body('requiere_adiestramiento').isBoolean().toBoolean(),
  body('valor_por_dia').notEmpty().isFloat({ min: 0.01 }).toFloat(),
  body('datos_salud_actuales').notEmpty()
    .customSanitizer((v) => typeof v === 'object' ? v : (() => {
      try { return JSON.parse(v); } catch { return { texto: String(v) }; }
    })()),
];

router.post('/reserva', webhookLimiter, verificarFirma, validarReserva,
  async (req, res) => {
    if (handleValidationErrors(req, res)) return;
    const { telefono_tutor, nombre_perro, fecha_ingreso, fecha_egreso,
            requiere_traslado, requiere_banio, requiere_adiestramiento,
            datos_salud_actuales, valor_por_dia } = req.body;
    const cobro = calcularCobro(fecha_ingreso, fecha_egreso, valor_por_dia);
    if (!cobro) return res.status(400).json({ ok: false, error: 'Fechas inválidas.' });
    try {
      const resultado = await prisma.$transaction(async (tx) => {
        const tutor = await tx.tutor.findFirst({ where: { telefono_principal: telefono_tutor } });
        if (!tutor) { const e = new Error('TUTOR_NOT_FOUND'); e.statusCode = 404; throw e; }
        const perro = await tx.perro.findFirst({
          where: { tutor_id: tutor.id, nombre: { equals: nombre_perro, mode: 'insensitive' } },
        });
        if (!perro) { const e = new Error('PERRO_NOT_FOUND'); e.statusCode = 404; throw e; }
        await tx.perro.update({ where: { id: perro.id }, data: { datos_salud: datos_salud_actuales } });
        const estadia = await tx.estadia.create({
          data: {
            perro_id: perro.id,
            fecha_ingreso: new Date(fecha_ingreso),
            fecha_egreso: new Date(fecha_egreso),
            dias_completos: cobro.dias_completos,
            aplica_medio_dia: cobro.aplica_medio_dia,
            valor_por_dia: cobro.valor_por_dia,
            valor_estadia_total: cobro.valor_total,
            requiere_traslado, requiere_banio, requiere_adiestramiento,
            historial_estado: 'Reservada',
          },
        });
        return { tutor, perro, estadia };
      });
      return res.status(201).json({
        ok: true, mensaje: 'Reserva creada.',
        data: {
          estadia_id: resultado.estadia.id,
          dias_completos: cobro.dias_completos,
          aplica_medio_dia: cobro.aplica_medio_dia,
          valor_total: cobro.valor_total,
          estado: 'Reservada',
        },
      });
    } catch (err) {
      if (err.statusCode) {
        const msgs = { TUTOR_NOT_FOUND: 'Tutor no encontrado.', PERRO_NOT_FOUND: 'Perro no encontrado.' };
        return res.status(err.statusCode).json({ ok: false, error: msgs[err.message] });
      }
      logger.error(`Error en /reserva: ${err.message}`);
      return res.status(500).json({ ok: false, error: 'Error interno.' });
    }
  }
);

module.exports = router;
