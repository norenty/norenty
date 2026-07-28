# Guion para la charla de hoy + demo del bot (nivel 0 — gestor amigo)

Basado en `ESTRATEGIA.md` §6.3. Objetivo real de esta llamada: **no vender, validar**. Las
respuestas de tu amigo valen más que cualquier feature nueva.

---

## 1. Apertura (30 segundos)

> "Quiero pedirte 15 minutos de tu cabeza, no de tu tiempo de trabajo. Llevo meses
> construyendo algo para flotas como la vuestra y prefiero equivocarme contigo antes que con
> un cliente. No te vendo nada, quiero que me digas sin filtro qué está mal."

Reconoce la asimetría desde la primera frase (no eres del sector) — no la escondas, roba el
argumento antes de que lo piense él.

---

## 2. Demo del dashboard (5-7 min) — enseñar, no explicar

Regla: **no enviar accesos, no capturas de pantalla** — pantalla compartida en vivo con la
cuenta demo. Termina en nómina, no en analítica (ESTRATEGIA §6.4 semana 2).

Login: `mpnoventy@gmail.com` / contraseña en `.norenty-secrets\.env prod.env` → `DEMO_PASSWORD`.
Empresa: "Transportes Demo Norenty" (con historial de 25 viajes, incidencias, valoraciones).

### Recorrido sugerido (en este orden, ~1 min cada pantalla):

1. **Hoy / panel principal** — de un vistazo, qué está en ruta, qué tiene incidencia abierta.
   *"Esto es lo que ve tu gestor al entrar por la mañana, sin que nadie le mande nada."*
2. **Mapa de flota** (con incidencia activa parpadeando en rojo) — clic en el camión con
   incidencia → lleva directo al viaje.
   *"Si un chófer tiene un problema, no hay que buscarlo entre 60 camiones."*
3. **Detalle de un viaje** — hitos (recogida, entrega), mapa de ruta embebido, fotos de POD.
   *"Todo esto lo manda el chófer por Telegram, sin instalar nada nuevo."*
4. **El bot de Telegram en sí** (si puedes, ten el móvil/otra pestaña con el bot a mano):
   muestra cómo un chófer marca "llegada", sube una foto del albarán, y eso aparece en vivo en
   el dashboard. Éste es el momento clave — es la cuña real (ESTRATEGIA §3.1).
5. **Nómina** — cierra aquí. Selecciona un chófer, muestra noches fuera / km calculados solos.
   *"Esto que hoy cuadráis a mano cada mes, aquí sale solo del mismo dato que ya mandó el
   chófer para el viaje."*

No entres en cotizador, facturación, roles, analítica avanzada salvo que él pregunte. Si
pregunta, contesta y vuelve a nómina.

---

## 3. Las 3 preguntas de validación (esto es el objetivo real de hoy)

Haz estas tres, literales, y anota la respuesta tal cual la dé (no la reformules tú después):

1. **"¿Cuánto tiempo os lleva cada mes cuadrar noches fuera y kilómetros para la nómina?"**
   → busca un número (horas, días) — es tu ROI en una servilleta.
2. **"Si te lo pido yo, ¿instalarías Telegram? ¿O eso ya es fricción de verdad?"**
   → la pregunta más cara del proyecto (ESTRATEGIA §3.1). Si dice que no, hay que mirar
   WhatsApp Business API — dilo tal cual si sale el tema, no lo escondas.
3. **"¿Alguna vez habéis tenido una disputa real con un cliente por una entrega — algo que un
   POD con hora y GPS os hubiera resuelto en el momento?"**
   → valida (o no) si la cadena de evidencia es un argumento de venta real o solo elegante.

---

## 4. Sonda del modelo B — como pregunta abierta, nunca como oferta

> "Si te dijera que puedo llevaros la gestión de tráfico por bastante menos de lo que os
> cuesta hoy el equipo, ¿eso suena a ayuda o a que alguien os quiere quitar el puesto?"

No ofrezcas nada, no des cifras. Solo escucha cómo reacciona — es el dato que decide si el
negocio es SaaS o Service-as-Software (ESTRATEGIA §5.4/5.5).

---

## 5. Cierre — pide puerta, no venta

> "No te pido que compres nada. Dime sin filtro qué está mal de lo que has visto, y si
> conoces a alguien más en tu situación — un dueño o gestor de otra flota con quien pueda
> hablar."

Si sale bien: pide la intro a su jefe (flota de 800, sección 6.4 semana 1) — para escuchar,
no para vender todavía.

---

## Lo que NO hacer hoy

- No enseñar precio ni el modelo B como oferta concreta.
- No pedir NDA — es una charla exploratoria con un amigo.
- No profundizar en arquitectura/tecnología salvo que pregunte.
- No convertir esto en una demo de ventas — es una entrevista con demo de apoyo.
