import logging
import time
import threading
from functools import wraps

logger = logging.getLogger("error_handler")


class CircuitBreaker:
    def __init__(self, failure_threshold=3, recovery_timeout=30):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._failures = 0
        self._state = "closed"
        self._last_failure = 0
        self._lock = threading.Lock()

    @property
    def is_open(self):
        with self._lock:
            if self._state == "open":
                if time.time() - self._last_failure >= self.recovery_timeout:
                    self._state = "half-open"
                    logger.info("Circuit breaker: half-open (probando)")
                    return False
                return True
            return False

    def record_success(self):
        with self._lock:
            self._failures = 0
            self._state = "closed"

    def record_failure(self):
        with self._lock:
            self._failures += 1
            self._last_failure = time.time()
            if self._failures >= self.failure_threshold:
                self._state = "open"
                logger.warning(
                    f"Circuit breaker ABIERTO tras {self._failures} fallos. "
                    f"Reintentando en {self.recovery_timeout}s"
                )

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.record_failure()
        else:
            self.record_success()
        return False


def with_retry(max_retries=3, delay=2, backoff=2):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            current_delay = delay
            while retries <= max_retries:
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    retries += 1
                    if retries > max_retries:
                        logger.error(
                            f"{func.__name__} fallo tras {max_retries} reintentos: {e}"
                        )
                        raise
                    logger.warning(
                        f"{func.__name__} fallo (intento {retries}/{max_retries}): {e}. "
                        f"Reintentando en {current_delay}s..."
                    )
                    time.sleep(current_delay)
                    current_delay *= backoff
        return wrapper
    return decorator


class HealthMonitor:
    def __init__(self):
        self._services = {}
        self._lock = threading.Lock()

    def register(self, name: str):
        with self._lock:
            self._services[name] = {
                "circuit": CircuitBreaker(),
                "last_ok": time.time(),
                "status": "ok"
            }

    def record_ok(self, name: str):
        with self._lock:
            if name in self._services:
                self._services[name]["last_ok"] = time.time()
                self._services[name]["status"] = "ok"
                self._services[name]["circuit"].record_success()

    def record_error(self, name: str, error: str):
        with self._lock:
            if name in self._services:
                self._services[name]["status"] = f"error: {error}"
                self._services[name]["circuit"].record_failure()

    def is_healthy(self, name: str) -> bool:
        with self._lock:
            if name not in self._services:
                return False
            return not self._services[name]["circuit"].is_open

    def report(self) -> dict:
        with self._lock:
            return {
                name: {
                    "status": svc["status"],
                    "healthy": not svc["circuit"].is_open,
                    "last_ok_ago": round(time.time() - svc["last_ok"], 1)
                }
                for name, svc in self._services.items()
            }


health = HealthMonitor()
health.register("stream_extractor")
health.register("audio_transcriber")
health.register("frame_describer")
