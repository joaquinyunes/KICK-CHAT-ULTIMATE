"""
Módulo 10 — Orquestador / Supervisor

Lanza los módulos 1-9 como procesos independientes (subprocess), y
vigila el heartbeat de cada uno. Si un módulo deja de actualizar su
heartbeat por más tiempo del esperado, lo reinicia SIN tocar a los
demás.

Este script es intencionalmente el único que "conoce" a todos los
módulos — pero no ejecuta la lógica de ninguno, solo los lanza y
observa desde afuera.

Uso:
    python3 orquestador.py

Notas:
    - Cada módulo se puede desactivar poniendo "activo": False en la
      lista MODULOS de abajo (por ejemplo, si todavía no tienes
      credenciales de Kick, desactiva el módulo 6 y el resto funciona
      igual).
    - En caliente, el Panel de Control (Módulo 11) puede prender/apagar
      cualquier módulo escribiendo en /data/control/estado_deseado.json;
      este Orquestador lo lee en cada ciclo y arranca/detiene en
      consecuencia. Lo que diga el panel tiene prioridad sobre "activo".
    - Requiere que cada módulo ya tenga sus dependencias instaladas.
"""

import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
import config  # noqa: E402

MODULO = "modulo10_orquestador"
SRC_DIR = Path(__file__).resolve().parent.parent

INTERVALO_REVISION_SEG = 15
MAX_REINICIOS_EN_VENTANA = 5
VENTANA_REINICIOS_SEG = 600  # 10 min
TIEMPO_GRACIA_ARRANQUE_SEG = 20  # margen tras arrancar antes de exigir heartbeat

# --- Definición de módulos administrados ---------------------------------
# tiempo_max_silencio_seg: cuánto puede pasar sin heartbeat antes de
# considerar el módulo "caído". Cada módulo tiene su propio ritmo.
MODULOS = [
    {
        "nombre": "modulo01_captura_video",
        "script": SRC_DIR / "modulo01_captura_video" / "captura_video.py",
        "tiempo_max_silencio_seg": 35,
        "activo": True,
    },
    {
        "nombre": "modulo02_captura_audio",
        "script": SRC_DIR / "modulo02_captura_audio" / "captura_audio.py",
        "tiempo_max_silencio_seg": 35,
        "activo": True,
    },
    {
        "nombre": "modulo03_buffer_rotativo",
        "script": SRC_DIR / "modulo03_buffer_rotativo" / "buffer_rotativo.py",
        "tiempo_max_silencio_seg": 30,
        "activo": True,
    },
    {
        "nombre": "modulo04_transcripcion_audio",
        "script": SRC_DIR / "modulo04_transcripcion_audio" / "transcripcion_audio.py",
        "tiempo_max_silencio_seg": 90,
        # OFF: con Gemini, el Módulo 8 escucha el audio directo y lo resume
        # con sentido. Whisper local en CPU va lento y transcribe la música
        # como ruido. Poné True si querés transcripción literal (con micrófono).
        "activo": False,
    },
    {
        "nombre": "modulo05_analisis_visual",
        "script": SRC_DIR / "modulo05_analisis_visual" / "analisis_visual.py",
        "tiempo_max_silencio_seg": 30,
        # OFF por defecto: en modo Gemini, el Módulo 8 mira el frame directo
        # (mucho mejor que el OCR de Tesseract en streams con overlay cargado).
        # Poné True si preferís el OCR local (p. ej. con Ollama sin visión).
        "activo": False,
    },
    {
        "nombre": "modulo06_api_kick_metadata",
        "script": SRC_DIR / "modulo06_api_kick_metadata" / "api_kick_metadata.py",
        "tiempo_max_silencio_seg": 90,
        "activo": True,  # poner en False si aún no configuraste credenciales de Kick
    },
    {
        "nombre": "modulo07_unificacion_timeline",
        "script": SRC_DIR / "modulo07_unificacion_timeline" / "unificacion_timeline.py",
        "tiempo_max_silencio_seg": 30,
        # OFF: sólo tenía sentido para juntar transcripción (M4) + OCR (M5).
        # Con ambos apagados no hay nada que unificar. El Módulo 8 va directo
        # al frame + audio.
        "activo": False,
    },
    {
        "nombre": "modulo08_resumen_llm",
        "script": SRC_DIR / "modulo08_resumen_llm" / "resumen_llm.py",
        # La llamada a Gemini puede tardar hasta ~120s (timeout) sin latir
        # + extracción de frames. 200s da margen para no matarlo a mitad.
        "tiempo_max_silencio_seg": 200,
        "activo": True,
    },
    {
        "nombre": "modulo09_memoria_historica",
        "script": SRC_DIR / "modulo09_memoria_historica" / "memoria_historica.py",
        "tiempo_max_silencio_seg": 30,
        "activo": True,
    },
    {
        "nombre": "modulo12_comentarista",
        "script": SRC_DIR / "modulo12_comentarista" / "comentarista.py",
        # Llama a Gemini (hasta ~75s de timeout) + posible refresh de token Kick.
        "tiempo_max_silencio_seg": 200,
        # Por default genera comentarios en modo ensayo (no postea). Para que
        # publique en el chat: KICK_COMENTARIO_POSTEAR=1 en el .env.
        "activo": True,
    },
]


class ProcesoAdministrado:
    def __init__(self, definicion: dict):
        self.definicion = definicion
        self.proceso = None
        self.historial_reinicios = []  # timestamps de reinicios recientes
        self.bloqueado = False
        self.iniciado_en = 0.0
        self.detenido_por_panel = False

    def iniciar(self):
        nombre = self.definicion["nombre"]
        script = self.definicion["script"]
        config.log(MODULO, f"Iniciando {nombre} ({script})...")
        self.proceso = subprocess.Popen([sys.executable, str(script)])
        self.iniciado_en = time.time()

    def detener(self, motivo: str = ""):
        if self.proceso is not None and self.proceso.poll() is None:
            self.proceso.kill()
            self.proceso.wait()
        self.proceso = None
        if motivo:
            config.log(MODULO, f"{self.definicion['nombre']} detenido: {motivo}")

    def en_periodo_de_gracia(self):
        return (time.time() - self.iniciado_en) < TIEMPO_GRACIA_ARRANQUE_SEG

    def esta_vivo_segun_proceso(self):
        return self.proceso is not None and self.proceso.poll() is None

    def esta_vivo_segun_heartbeat(self):
        if self.en_periodo_de_gracia():
            return True
        hb_path = config.LOGS_DIR / f"{self.definicion['nombre']}_heartbeat.txt"
        if not hb_path.exists():
            return False
        try:
            ultimo = int(hb_path.read_text().strip())
        except ValueError:
            return False
        return (time.time() - ultimo) <= self.definicion["tiempo_max_silencio_seg"]

    def reiniciar(self):
        nombre = self.definicion["nombre"]
        ahora = time.time()
        self.historial_reinicios = [t for t in self.historial_reinicios if ahora - t < VENTANA_REINICIOS_SEG]

        if len(self.historial_reinicios) >= MAX_REINICIOS_EN_VENTANA:
            if not self.bloqueado:
                config.log(
                    MODULO,
                    f"{nombre} se reinició {MAX_REINICIOS_EN_VENTANA} veces en "
                    f"{VENTANA_REINICIOS_SEG}s. Se marca como BLOQUEADO y se deja "
                    f"de reintentar automáticamente. Revisar manualmente.",
                    "ERROR",
                )
                self.bloqueado = True
            return

        if self.proceso is not None and self.proceso.poll() is None:
            self.proceso.kill()
            self.proceso.wait()

        self.historial_reinicios.append(ahora)
        config.log(MODULO, f"Reiniciando {nombre} (reinicio #{len(self.historial_reinicios)} en la ventana actual).", "WARN")
        self.iniciar()


def _modulo_deseado(pa, estado_deseado):
    """El Panel (Módulo 11) manda; si no dijo nada de este módulo, se usa
    el valor `activo` de la configuración de arriba como default."""
    return estado_deseado.get(pa.definicion["nombre"], pa.definicion["activo"])


def main():
    config.ensure_dirs()
    config.log(MODULO, "Orquestador iniciado. Lanzando módulos activos...")

    # Modo simulación: sin captura ni stream. Solo M8 (resumen sintético) +
    # M9 (memoria) + M12 (genera el lote con Gemini). Sirve para probar el
    # flujo completo contexto -> 30 líneas -> lote sin transmitir.
    if config.SIMULACION:
        _sim_activos = {"modulo08_resumen_llm", "modulo09_memoria_historica",
                        "modulo12_comentarista"}
        for d in MODULOS:
            d["activo"] = d["nombre"] in _sim_activos
        config.log(MODULO, "MODO SIMULACIÓN activo: solo M8 + M9 + M12 (sin captura).")

    # En cada arranque, el estado deseado se resetea a lo que dice esta lista
    # MODULOS ("activo"). Los toggles del Panel valen mientras el Orquestador
    # sigue corriendo; al reiniciarlo, vuelve a mandar la config de acá.
    estado_inicial = {d["nombre"]: d["activo"] for d in MODULOS}
    config.CONTROL_DIR.mkdir(parents=True, exist_ok=True)
    config.escribir_json(config.CONTROL_ESTADO_PATH, estado_inicial)

    administrados = [ProcesoAdministrado(d) for d in MODULOS]

    estado_deseado = config.leer_estado_deseado()
    for pa in administrados:
        if _modulo_deseado(pa, estado_deseado):
            pa.iniciar()
        else:
            pa.detenido_por_panel = True
            config.log(MODULO, f"{pa.definicion['nombre']} no se arranca (desactivado por configuración o panel).")

    # Damos tiempo a que todos escriban su primer heartbeat antes de vigilar
    time.sleep(10)

    try:
        while True:
            estado_deseado = config.leer_estado_deseado()
            for pa in administrados:
                nombre = pa.definicion["nombre"]
                deseado = _modulo_deseado(pa, estado_deseado)

                if not deseado:
                    if pa.esta_vivo_segun_proceso():
                        pa.detener("apagado desde el panel")
                    pa.detenido_por_panel = True
                    continue

                if pa.detenido_por_panel:
                    # Estaba apagado y el panel lo volvió a prender: arranque limpio.
                    pa.detenido_por_panel = False
                    pa.bloqueado = False
                    pa.historial_reinicios = []
                    config.log(MODULO, f"{nombre} reactivado desde el panel.")
                    pa.iniciar()
                    continue

                if pa.bloqueado:
                    continue

                if not pa.esta_vivo_segun_proceso() or not pa.esta_vivo_segun_heartbeat():
                    config.log(MODULO, f"{nombre} parece caído (proceso o heartbeat).", "WARN")
                    pa.reiniciar()

            config.heartbeat(MODULO)
            time.sleep(INTERVALO_REVISION_SEG)

    except KeyboardInterrupt:
        config.log(MODULO, "Orquestador detenido manualmente. Cerrando todos los módulos...")
        for pa in administrados:
            pa.detener()


if __name__ == "__main__":
    main()
