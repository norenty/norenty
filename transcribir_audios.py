"""Transcribe una carpeta de audios de WhatsApp a un unico .txt, con Whisper local
(self-host, sin pagar API). Uso puntual para transcribir notas de voz exportadas
de una conversacion (no forma parte del producto Norenty).

Instalacion (una vez):
    pip install faster-whisper

Uso:
    python transcribir_audios.py "C:\ruta\a\la\carpeta\de\audios"

Genera transcripcion.txt dentro de esa misma carpeta, con un encabezado por
archivo (nombre + hora si el nombre lo incluye, como exporta WhatsApp) seguido
del texto transcrito, en orden alfabetico de nombre de archivo (que en un
export de WhatsApp coincide con el orden cronologico).
"""
import sys
from pathlib import Path

from faster_whisper import WhisperModel

EXTENSIONES = {".opus", ".mp3", ".m4a", ".ogg", ".wav", ".aac"}


def main():
    if len(sys.argv) != 2:
        print("Uso: python transcribir_audios.py <carpeta_con_audios>")
        sys.exit(1)

    carpeta = Path(sys.argv[1])
    if not carpeta.is_dir():
        print(f"No existe la carpeta: {carpeta}")
        sys.exit(1)

    audios = sorted(p for p in carpeta.iterdir() if p.suffix.lower() in EXTENSIONES)
    if not audios:
        print(f"No se encontraron audios ({', '.join(EXTENSIONES)}) en {carpeta}")
        sys.exit(1)

    print(f"Encontrados {len(audios)} audios. Cargando modelo Whisper (esto tarda la primera vez)...")
    # "small" es buen equilibrio calidad/velocidad en CPU para espanol. Si va
    # lento, cambiar a "base"; si la calidad no convence, subir a "medium".
    modelo = WhisperModel("small", device="cpu", compute_type="int8")

    salida = carpeta / "transcripcion.txt"
    with salida.open("w", encoding="utf-8") as f:
        for i, audio in enumerate(audios, 1):
            print(f"[{i}/{len(audios)}] Transcribiendo {audio.name} ...")
            segmentos, _ = modelo.transcribe(str(audio), language="es")
            texto = " ".join(seg.text.strip() for seg in segmentos)
            f.write(f"=== {audio.name} ===\n{texto}\n\n")

    print(f"\nListo. Transcripcion completa en: {salida}")


if __name__ == "__main__":
    main()
