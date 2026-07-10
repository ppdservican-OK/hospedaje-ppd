-- CreateEnum
CREATE TYPE "EstadiaEstado" AS ENUM ('Reservada', 'Activa', 'Finalizada', 'Cancelada');

-- CreateEnum
CREATE TYPE "TipoTratamiento" AS ENUM ('VACUNA_SEXTUPLE', 'VACUNA_ANTIRRABICA', 'VACUNA_TOS_PERRERAS', 'ANTIPARASITARIO_INTERNO', 'PIPETA_ANTIPARASITARIA');

-- CreateTable
CREATE TABLE "tutores" (
      "id" TEXT NOT NULL,
      "nombre_completo" VARCHAR(120) NOT NULL,
      "telefono_principal" VARCHAR(25) NOT NULL,
      "telefono_emergencia" VARCHAR(25),
      "email" VARCHAR(200),
      "whatsapp" VARCHAR(25),
      "direccion_completa" VARCHAR(300),
      "como_nos_conocio" VARCHAR(100),
      "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tutores_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "perros" (
      "id" TEXT NOT NULL,
      "tutor_id" TEXT NOT NULL,
      "nombre" VARCHAR(80) NOT NULL,
      "foto_url" VARCHAR(500),
      "fecha_nacimiento" DATE,
      "caracteristicas_generales" TEXT,
      "caracteristicas_especificas" TEXT,
      "datos_comportamiento" JSONB,
      "datos_salud" JSONB,
      "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perros_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "planes_sanitarios" (
      "id" TEXT NOT NULL,
      "perro_id" TEXT NOT NULL,
      "vacuna_sextuple_vencimiento" DATE,
      "vacuna_antirrabica_vencimiento" DATE,
      "vacuna_tos_perreras_vencimiento" DATE,
      "antiparasitario_interno_vencimiento" DATE,
      "pipeta_antiparasitaria_vencimiento" DATE,
      "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planes_sanitarios_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "registros_vacunacion" (
      "id" TEXT NOT NULL,
      "perro_id" TEXT NOT NULL,
      "tipo_tratamiento" "TipoTratamiento" NOT NULL,
      "fecha_aplicacion" DATE NOT NULL,
      "fecha_vencimiento" DATE NOT NULL,
      "marca_laboratorio" VARCHAR(100),
      "numero_lote" VARCHAR(80),
      "nombre_veterinario" VARCHAR(120),
      "clinica_veterinaria" VARCHAR(150),
      "certificado_url" VARCHAR(500),
      "observaciones" TEXT,
      "cargado_por" VARCHAR(100),
      "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_vacunacion_pkey" PRIMARY KEY ("id")
  );

-- CreateTable
CREATE TABLE "estadias" (
      "id" TEXT NOT NULL,
      "perro_id" TEXT NOT NULL,
      "fecha_ingreso" TIMESTAMP(3) NOT NULL,
      "fecha_egreso" TIMESTAMP(3) NOT NULL,
      "dias_completos" INTEGER NOT NULL,
      "aplica_medio_dia" BOOLEAN NOT NULL DEFAULT false,
      "valor_por_dia" DECIMAL(10,2) NOT NULL,
      "valor_estadia_total" DECIMAL(10,2) NOT NULL,
      "requiere_traslado" BOOLEAN NOT NULL DEFAULT false,
      "requiere_banio" BOOLEAN NOT NULL DEFAULT false,
      "requiere_adiestramiento" BOOLEAN NOT NULL DEFAULT false,
      "historial_estado" "EstadiaEstado" NOT NULL DEFAULT 'Reservada',
      "notas_internas" TEXT,
      "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estadias_pkey" PRIMARY KEY ("id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "tutores_telefono_principal_key" ON "tutores"("telefono_principal");

-- CreateIndex
CREATE UNIQUE INDEX "tutores_email_key" ON "tutores"("email");

-- CreateIndex
CREATE INDEX "perros_tutor_id_idx" ON "perros"("tutor_id");

-- CreateIndex
CREATE INDEX "perros_nombre_idx" ON "perros"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "planes_sanitarios_perro_id_key" ON "planes_sanitarios"("perro_id");

-- CreateIndex
CREATE INDEX "planes_sanitarios_vacuna_sextuple_vencimiento_idx" ON "planes_sanitarios"("vacuna_sextuple_vencimiento");

-- CreateIndex
CREATE INDEX "planes_sanitarios_vacuna_antirrabica_vencimiento_idx" ON "planes_sanitarios"("vacuna_antirrabica_vencimiento");

-- CreateIndex
CREATE INDEX "planes_sanitarios_vacuna_tos_perreras_vencimiento_idx" ON "planes_sanitarios"("vacuna_tos_perreras_vencimiento");

-- CreateIndex
CREATE INDEX "planes_sanitarios_antiparasitario_interno_vencimiento_idx" ON "planes_sanitarios"("antiparasitario_interno_vencimiento");

-- CreateIndex
CREATE INDEX "planes_sanitarios_pipeta_antiparasitaria_vencimiento_idx" ON "planes_sanitarios"("pipeta_antiparasitaria_vencimiento");

-- CreateIndex
CREATE INDEX "registros_vacunacion_perro_id_idx" ON "registros_vacunacion"("perro_id");

-- CreateIndex
CREATE INDEX "registros_vacunacion_tipo_tratamiento_idx" ON "registros_vacunacion"("tipo_tratamiento");

-- CreateIndex
CREATE INDEX "registros_vacunacion_fecha_vencimiento_idx" ON "registros_vacunacion"("fecha_vencimiento");

-- CreateIndex
CREATE INDEX "estadias_perro_id_idx" ON "estadias"("perro_id");

-- CreateIndex
CREATE INDEX "estadias_fecha_ingreso_idx" ON "estadias"("fecha_ingreso");

-- CreateIndex
CREATE INDEX "estadias_historial_estado_idx" ON "estadias"("historial_estado");

-- AddForeignKey
ALTER TABLE "perros" ADD CONSTRAINT "perros_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "tutores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planes_sanitarios" ADD CONSTRAINT "planes_sanitarios_perro_id_fkey" FOREIGN KEY ("perro_id") REFERENCES "perros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_vacunacion" ADD CONSTRAINT "registros_vacunacion_perro_id_fkey" FOREIGN KEY ("perro_id") REFERENCES "perros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estadias" ADD CONSTRAINT "estadias_perro_id_fkey" FOREIGN KEY ("perro_id") REFERENCES "perros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
