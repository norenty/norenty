-- Base/domicilio de la empresa: coordenadas para calcular "noches fuera" en el
-- informe de nómina (ítem 5.1). Ambas columnas son NULLABLE a propósito: no todas
-- las empresas las habrán rellenado, y sin ellas el cálculo de noches fuera
-- simplemente no se puede hacer (se reporta como no disponible, no como cero).

ALTER TABLE empresa
  ADD COLUMN IF NOT EXISTS base_lat double precision,
  ADD COLUMN IF NOT EXISTS base_lon double precision;
