'use strict';

require('dotenv').config();

const cron        = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const nodemailer  = require('nodemailer');
const twilio      = require('twilio');
const winston     = require('winston');

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
    new winston.transports.File({ filename: 'logs/notifications.log' }),
    new winston.transports.File({ filename: 'logs/errors.log', level: 'error' }),
  ],
});

const prisma = new PrismaClient({ log: ['error', 'warn'] });

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const SANITARIO_CAMPOS = [
  { campo: 'vacuna_sextuple_vencimiento',         nombre: 'Vacuna Séxtuple',         emoji: '💉' },
  { campo: 'vacuna_antirrabica_vencimiento',      nombre: 'Vacuna Antirrábica',      emoji: '💉' },
  { campo: 'vacuna_tos_perreras_vencimiento',     nombre: 'Vacuna Tos de las Perreras', emoji: '💉' },
  { campo: 'antiparasitario_interno_vencimiento', nombre: 'Antiparasitario Interno', emoji: '💊' },
  { campo: 'pipeta_antiparasitaria_vencimiento',  nombre: 'Pipeta Antiparasitaria',  emoji: '🧴' },
];

function getStartOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function getTodayPlusDays(days) {
  const d = getStartOfToday();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatDate(date) {
  if (!date) return 'Sin fecha';
  return new Date(date).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function templateTutorPreventiva({ nombrePerro, nombreVacuna, fechaVencimiento, emoji }) {
  return `🐾 ¡Hola! Te escribimos desde el equipo de *La Manada* con mucho cariño 💛

Queremos avisarte que *${nombrePerro}* tiene la *${emoji} ${nombreVacuna}* próxima a vencer el *${fechaVencimiento}*.

Sabemos lo mucho que lo/la querés, y mantener sus vacunas al día es una de las mejores formas de cuidarlo/la 🐶✨

¿Necesitás ayuda para coordinar con el veterinario? ¡Estamos acá para lo que necesites!

Con cariño,
*El equipo de La Manada* 🐾`;
}

function templateTutorCritica({ nombrePerro, nombreVacuna, fechaVencimiento, emoji }) {
  return `🚨 ¡Hola! Te escribimos con urgencia desde *La Manada* 🐾

Queremos contarte que la *${emoji} ${nombreVacuna}* de *${nombrePerro}* venció el *${fechaVencimiento}* o vence hoy.

Por la seguridad de todos los perritos que conviven en nuestra casa, es *requisito indispensable* tener todas las vacunas vigentes para su próxima estadía 🏠🐶

Por favor, coordiná lo antes posible con tu veterinario de confianza.

Con todo el cariño,
*El equipo de La Manada* 💛🐾`;
}

function templateStaff({ tipo, nombrePerro, nombreTutor, telefono, nombreVacuna, fechaVencimiento, emoji }) {
  const tipoLabel = tipo === 'CRITICA' ? '🔴 VENCIDA / VENCE HOY' : '🟡 POR VENCER EN 7 DÍAS';
  return `⚠️ ALERTA SANITARIA [${tipoLabel}]

🐕 Perro: ${nombrePerro}
👤 Tutor: ${nombreTutor}
📞 Teléfono: ${telefono}
${emoji} Vacuna/Antiparasitario: ${nombreVacuna}
📅 Fecha de vencimiento: ${fechaVencimiento}

ACCIÓN REQUERIDA: Contactar al tutor antes de aceptar próxima reserva.

— Sistema automático La Manada 🐾`;
}

async function sendEmail({ to, subject, text }) {
  if (!to || !subject || !text) return;
  try {
    const info = await mailTransporter.sendMail({
      from: `"La Manada 🐾" <${process.env.GMAIL_USER}>`,
      to, subject, text,
    });
    logger.info(`Email enviado a ${to} | MessageId: ${info.messageId}`);
  } catch (err) {
    logger.error(`Error al enviar email a ${to}: ${err.message}`);
  }
}

async function sendWhatsApp({ to, body }) {
  if (!to || !body) return;
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  try {
    const message = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: toFormatted,
      body,
    });
    logger.info(`WhatsApp enviado a ${toFormatted} | SID: ${message.sid}`);
  } catch (err) {
    logger.error(`Error al enviar WhatsApp a ${toFormatted}: ${err.message}`);
  }
}

async function procesarAlerta({ planSanitario, campo, tipo }) {
  const perro  = planSanitario.perro;
  const tutor  = perro?.tutor;
  const meta   = SANITARIO_CAMPOS.find((c) => c.campo === campo);
  if (!perro || !tutor || !meta) return;

  const datos = {
    tipo,
    nombrePerro:      perro.nombre || 'Sin nombre',
    nombreTutor:      tutor.nombre_completo || 'Sin nombre',
    telefono:         tutor.telefono_principal || 'Sin teléfono',
    nombreVacuna:     meta.nombre,
    fechaVencimiento: formatDate(planSanitario[campo]),
    emoji:            meta.emoji,
  };

  const mensajeTutor = tipo === 'PREVENTIVA'
    ? templateTutorPreventiva(datos)
    : templateTutorCritica(datos);

  if (tutor.whatsapp || tutor.telefono_principal) {
    await sendWhatsApp({ to: tutor.whatsapp || tutor.telefono_principal, body: mensajeTutor });
  }
  if (tutor.email) {
    await sendEmail({
      to: tutor.email,
      subject: tipo === 'PREVENTIVA'
        ? `🐾 Recordatorio: vacuna de ${datos.nombrePerro} próxima a vencer`
        : `🚨 Urgente: vacuna de ${datos.nombrePerro} vencida o vence hoy`,
      text: mensajeTutor,
    });
  }

  const mensajeStaff = templateStaff(datos);
  await sendWhatsApp({ to: process.env.STAFF_WHATSAPP, body: mensajeStaff });
  await sendEmail({
    to: process.env.STAFF_EMAIL,
    subject: tipo === 'CRITICA'
      ? `🔴 ALERTA SANITARIA CRÍTICA — ${datos.nombrePerro}`
      : `🟡 ALERTA SANITARIA PREVENTIVA — ${datos.nombrePerro}`,
    text: mensajeStaff,
  });
}

async function runNotificationJob() {
  logger.info('INICIANDO JOB DE NOTIFICACIONES SANITARIAS');
  try {
    const hoy        = getStartOfToday();
    const en7dias    = getTodayPlusDays(7);
    const en7diasFin = getTodayPlusDays(8);

    const condicionesPreventivas = SANITARIO_CAMPOS.map(({ campo }) => ({
      [campo]: { gte: en7dias, lt: en7diasFin },
    }));
    const condicionesCriticas = SANITARIO_CAMPOS.map(({ campo }) => ({
      [campo]: { lte: hoy },
    }));

    const registros = await prisma.planSanitario.findMany({
      where: { OR: [...condicionesPreventivas, ...condicionesCriticas] },
      include: { perro: { include: { tutor: true } } },
    });

    logger.info(`Registros con alertas: ${registros.length}`);
    let totalAlertas = 0;

    for (const plan of registros) {
      for (const { campo } of SANITARIO_CAMPOS) {
        const fecha = plan[campo];
        if (!fecha) continue;
        const fechaDate = new Date(fecha);
        let tipo = null;
        if (fechaDate >= en7dias && fechaDate < en7diasFin) tipo = 'PREVENTIVA';
        else if (fechaDate <= hoy) tipo = 'CRITICA';
        if (tipo) {
          await procesarAlerta({ planSanitario: plan, campo, tipo });
          totalAlertas++;
        }
      }
    }
    logger.info(`JOB COMPLETADO | Alertas procesadas: ${totalAlertas}`);
  } catch (err) {
    logger.error(`Error crítico en el job: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

cron.schedule('0 9 * * *', () => {
  runNotificationJob();
}, {
  scheduled: true,
  timezone: 'America/Argentina/Buenos_Aires',
});

logger.info('Cron Job registrado: todos los días a las 09:00 AM (Argentina).');

module.exports = { runNotificationJob };
