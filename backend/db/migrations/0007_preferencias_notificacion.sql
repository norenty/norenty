-- Preferencias de notificación del gestor
ALTER TABLE gestor ADD COLUMN IF NOT EXISTS notif_incidencias boolean NOT NULL DEFAULT true;
ALTER TABLE gestor ADD COLUMN IF NOT EXISTS notif_entregas boolean NOT NULL DEFAULT true;
ALTER TABLE gestor ADD COLUMN IF NOT EXISTS notif_fuera_ventana boolean NOT NULL DEFAULT false;
