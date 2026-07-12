# Consentimiento para captura y transcripción de conversaciones (ítem 11.5)

**Estado: BORRADOR TÉCNICO, pendiente de revisión legal.** Este documento prepara el terreno
para el ítem 11.3 (nota de voz del gestor → transcripción Whisper, y su futura extensión a
llamadas transcritas/WhatsApp, ítems 11.6/11.7). No es asesoramiento legal — el criterio final
de textos exactos de consentimiento, plazos de retención y base legal aplicable debe confirmarlo
un abogado antes de activar 11.3 en producción, mismo criterio que el resto de
`PRIVACIDAD-*.md` (ver `PRIVACIDAD-RAT.md`, `PRIVACIDAD-ARCO.md`).

## 0. Por qué hace falta esto antes de activar 11.3

`contexto` (11.2) ya puede guardar cualquier texto anclado a un viaje/chófer/cliente, con
procedencia (`canal`, `gestor_id`/`autor_externo`). El ítem 11.3 añadiría el canal
`llamada_transcrita`: el gestor manda una nota de voz (o, más adelante, se transcribe una
llamada real), y el contenido — que puede incluir datos personales de terceros que NO son
usuarios directos del sistema (un contacto del cliente, un chófer mencionado de pasada) — queda
guardado y buscable. Grabar/transcribir voz es tratamiento de datos personales con requisitos
propios (RGPD art. 6, y si hay datos de salud/sindicales mencionados de pasada, art. 9); no
puede activarse solo porque la tabla ya soporte el campo.

## 1. Quién necesita dar consentimiento

- **El gestor que graba la nota de voz**: es SU acción, consciente y voluntaria — no necesita un
  consentimiento aparte más allá de aceptar los términos de uso de la plataforma como empleado/
  usuario de la herramienta de su empresa (a confirmar con 9.11 si hace falta algo explícito
  además).
- **El chófer, si la nota de voz lo menciona o la conversación es CON él** (p. ej. cuando 11.3 se
  extienda a llamadas telefónicas reales, no solo notas del gestor): necesita saber que sus
  conversaciones pueden quedar grabadas/transcritas y con qué finalidad. Candidato: aviso en el
  onboarding del chófer por Telegram (mismo canal donde ya se le pide vincular la cuenta).
- **El contacto del cliente** (persona física en la empresa cliente con la que se habla): el más
  delicado — es un tercero que no tiene cuenta en el sistema ni ha aceptado nada directamente.
  Necesita informarse en algún momento (p. ej. un aviso de privacidad accesible públicamente, o
  una mención en el contrato entre Norenty/la empresa cliente y SU cliente) — **pendiente de
  decidir el mecanismo exacto con el abogado**, no resuelto aquí.

## 2. Base legal candidata (a confirmar, no una conclusión)

- **Interés legítimo** (art. 6.1.f RGPD) para la nota de voz del propio gestor sobre su propia
  operación — parece el encaje más natural, análogo a cualquier nota escrita que ya podía tomar.
- Para llamadas reales con terceros (11.7, más adelante): probablemente necesite **consentimiento
  explícito** del interlocutor al inicio de la llamada ("esta conversación puede transcribirse
  para mejorar el servicio, ¿de acuerdo?") — patrón ya habitual en call centers, pero el texto
  exacto y si hace falta grabación del propio consentimiento son preguntas para el abogado.

## 3. Qué se propone construir cuando 11.3 se apruebe (no construido en este ítem)

- Un campo de consentimiento simple, ANTES del primer uso: un checkbox/aviso en el flujo de
  captura de la nota de voz ("al grabar, aceptas que se transcribe automáticamente y se guarda
  como contexto de este viaje/cliente") — bloqueante la primera vez, recordado ligero después.
- Registrar el hecho del consentimiento como un `contexto` más (`canal='nota_manual'`,
  `texto` describiendo qué se aceptó y cuándo) o una columna dedicada si el volumen lo justifica
  — decisión de implementación para cuando 11.3 se construya, no aquí.
- Un texto de aviso corto y claro, en español (y en los idiomas ya soportados del chófer si
  aplica), **redactado por el abogado**, no por este documento.

## 4. Qué NO se hace mientras esto siga en borrador

- No se activa el canal `llamada_transcrita` desde ningún flujo real del dashboard (el CHECK de
  la BD lo permite desde `0042_contexto.sql`, pero la capa JS de 11.2 restringe a
  `nota_manual`/`email` — barrera ya construida, ver `SPECS-11.md §2.3`).
- No se contrata Whisper/OpenAI para transcripción real hasta que este documento deje de ser
  un borrador (11.3 sigue como `[DECISIÓN]` de presupuesto, separada de esta de consentimiento).
