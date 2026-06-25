"""Centrale logging-config voor de GEO-meter.

Schrijft naar twee plekken:
  - logs/geo-meter.log  (persistent bestand, voor achteraf onderzoeken)
  - stderr              (zichtbaar in de server-output / preview-logs)

Belangrijk: er worden NOOIT API-keys gelogd, alleen merk-config en foutmeldingen.
"""

import os
import logging

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
LOG_FILE = os.path.join(LOG_DIR, "geo-meter.log")


def get_logger():
    logger = logging.getLogger("geometer")
    if logger.handlers:  # al geconfigureerd
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except Exception:  # noqa: BLE001 — falen op bestandslog mag de app niet stoppen
        pass
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    logger.propagate = False
    return logger
