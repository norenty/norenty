# Estimación de costes — funciones con coste por uso (Bloque 1)

Estimaciones para una flota de referencia de **30-60 camiones** (el rango que confirmó tu
gestor amigo como salto realista de apalancamiento, ver `DISCOVERY.md`). Precios de mercado a
julio 2026, sin compromiso — hay que confirmar el precio exacto en el momento de contratar
(estos proveedores cambian tarifas con frecuencia). Todo en USD salvo que se indique EUR.

---

## 1. Voz Whisper (nota de voz del chófer → texto)

**Proveedor:** OpenAI Whisper API (`whisper-1` o `gpt-4o-mini-transcribe`, más barato).
**Precio:** $0.006/min (Whisper/GPT-4o Transcribe) o $0.003/min (GPT-4o Mini Transcribe).

**Estimación de uso:** si cada chófer manda ~5 notas de voz/día de ~20s cada una (~1,7
min/día/chófer):
- 30 chóferes → ~50 min/día → ~1.500 min/mes → **$9-18/mes**
- 60 chóferes → ~100 min/día → ~3.000 min/mes → **$18-36/mes**

**Conclusión:** el coste de la transcripción en sí es prácticamente irrelevante (menos de lo
que cuesta un café al mes por chófer). El coste real de este ítem es el TRABAJO de construirlo
(captura de audio en Telegram, subida, llamada a la API, mostrarlo al gestor como texto), no el
gasto de la API. Es el candidato más barato de activar del Bloque 1.

---

## 2. Validación de POD con visión LLM

**Proveedor:** OpenAI GPT-4o (visión). **Precio:** $2,50 / millón tokens entrada, $10 / millón
tokens salida. Una imagen consume aprox. 750-1.500 tokens de entrada según resolución/detalle;
una respuesta de validación corta (sí/no + motivo) son ~100-300 tokens de salida.

**Coste por imagen estimado:** ~$0,004-0,006/imagen.

**Estimación de uso:** 1-3 POD/viaje, ~1-2 viajes/camión/día:
- 30 camiones → ~50 POD/día → ~1.500/mes → **$6-9/mes**
- 60 camiones → ~100 POD/día → ~3.000/mes → **$12-18/mes**

**Conclusión:** igual de barato que la voz. El riesgo real no es el coste, es la fiabilidad
(falsos positivos/negativos validando si un albarán es "válido") — habría que probarlo con
fotos reales de vuestros propios POD antes de confiar en él para bloquear/aprobar nada
automáticamente (sugerencia, no automatización, mismo principio que el resto del sistema).

---

## 3. WhatsApp como canal (Meta Business API, vía un BSP como Twilio/360dialog)

**Precio Meta España (2026, por plantilla iniciada por la empresa):**
- Utilidad (confirmaciones, avisos de estado): €0,0166/mensaje
- Marketing: €0,0509/mensaje
- Autenticación: €0,0166/mensaje
- **Servicio (respuesta a un mensaje que inició el cliente/chófer, dentro de la ventana de
  24h): GRATIS**, sin límite.

**Estimación de uso:** si el bot es sobre todo reactivo (el chófer escribe primero, como hoy en
Telegram) el coste real es ~€0. El coste aparece solo en avisos PROACTIVOS (utilidad) — p.ej.
"tu próxima parada es en 20 min" sin que el chófer haya escrito antes:
- 60 camiones × ~3 avisos proactivos/día = 180/día → ~5.400/mes → **~€90/mes** en Meta.

**Coste adicional, aparte de Meta:** el BSP (proveedor intermediario obligatorio para usar la
API oficial — Twilio, 360dialog, Gupshup...) cobra aparte, normalmente **$0-50/mes de cuota
fija** + a veces un margen sobre el precio de Meta. Hay que cotizar con uno concreto antes de
decidir.

**Conclusión:** barato en Meta, pero es la integración MÁS compleja de las cuatro (BSP, número
verificado, plantillas pre-aprobadas por Meta con antelación, ventana de 24h que rompe el push
proactivo tal y como está diseñado el bot hoy). No es solo un coste, es un rediseño parcial de
cómo el bot avisa.

---

## 4. Agente telefónico (STT/LLM/TTS en tiempo real)

El más caro y el más complejo de construir, con diferencia.

**Componentes y coste aproximado por minuto de llamada:**
- Telefonía (Twilio Programmable Voice, España): variable por destino, del orden de
  $0,01-0,02/min entrante/saliente.
- Transcripción en tiempo real: ~$0,05/min (Twilio) o ~$0,017/min (OpenAI Realtime).
- Respuesta del LLM: depende de cuánto "razona" por llamada, normalmente unos pocos céntimos.
- Texto-a-voz en tiempo real: del mismo orden que el STT, ~$0,015-0,03/min según proveedor.

**Estimación total realista: $0,15-0,30/min de llamada** (todo incluido, sin contar el número
de teléfono ~$1-2/mes).

**Estimación de uso:** si sustituye llamadas puntuales (no todo el tráfico), p.ej. 60
llamadas/mes de ~3 min de media = 180 min/mes → **$27-54/mes** en costes de API/telefonía.

**Conclusión:** el coste de RUNTIME no es prohibitivo a este volumen, pero es por mucho la
integración más compleja de construir bien (latencia real-time, manejo de cortes/silencios,
identificar al chófer sin verlo, fallback si algo falla a media llamada) — coherente con que ya
estaba marcado como el último candidato del Bloque 1 en el roadmap.

---

## Resumen para decidir

| Función | Coste runtime/mes (30-60 camiones) | Complejidad de construir | Recomendación |
|---|---|---|---|
| Voz Whisper | $9-36 | Baja | Más barato, más simple — mejor candidato para empezar |
| POD visión LLM | $6-18 | Baja-media (fiabilidad a validar) | Segundo candidato |
| WhatsApp | ~€90 (Meta) + $0-50 BSP | Media-alta (rediseño del push) | Esperar a discovery — ¿lo pide alguien de verdad? |
| Agente telefónico | $27-54 | Alta | Último, cuando los otros tres ya funcionen |

Ningún importe aquí es alto en términos absolutos para un negocio con 30-60 camiones — el
verdadero coste de los cuatro es el tiempo de desarrollo, no la factura del proveedor. La
pregunta que de verdad decide el orden no es "¿cuánto cuesta?" sino "¿lo pide alguien de
verdad, con qué frecuencia, y cuánto tiempo/dinero le ahorra?" — de ahí que 12.3 (discovery)
deba ir antes de comprometerse con cualquiera de los cuatro.

Sources:
- [OpenAI Whisper API Pricing 2026](https://diyai.io/ai-tools/speech-to-text/openai-whisper-api-pricing-2026/)
- [Whisper API Pricing — brasstranscripts](https://brasstranscripts.com/blog/openai-whisper-api-pricing-2025-self-hosted-vs-managed)
- [OpenAI API Pricing (oficial)](https://developers.openai.com/api/docs/pricing)
- [WhatsApp Business API Pricing Spain 2026](https://gurusup.com/blog/whatsapp-api-pricing)
- [WhatsApp Business Platform Pricing (Meta, oficial)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Twilio Programmable Voice Pricing (España)](https://www.twilio.com/en-us/voice/pricing/es)
- [Twilio Voice Pricing 2026](https://www.vbwebsol.com/twilio-voice-pricing-2026/)
