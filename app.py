"""GEO-meter webapp.

Dun frontend (formulier + resultatenscherm) + backend die de meting draait.
De API-keys staan als environment-secrets op de server, nooit in de browser.

Start lokaal:  uvicorn app:app --reload --port 8000
"""

import os
import uuid
import asyncio

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()


def _load_key_file():
    """Laadt API-keys uit het zichtbare bestand 'API-keys-hier-invullen.txt'
    (naast app.py). Zo hoeft de gebruiker geen verborgen .env te bewerken.
    Bestaande environment-variabelen winnen; lege regels worden genegeerd.
    """
    path = os.path.join(os.path.dirname(__file__), "API-keys-hier-invullen.txt")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if v and not os.getenv(k):
                os.environ[k] = v


_load_key_file()

from geo import engine  # noqa: E402  (na key-laden zodat providers de keys zien)
from geo.logsetup import get_logger  # noqa: E402

log = get_logger()
log.info("GEO-meter gestart | providers beschikbaar: %s", engine.providers_mod.available_providers())

app = FastAPI(title="GEO-meter")


@app.middleware("http")
async def _noindex_header(request, call_next):
    # Interne tool: nooit indexeren door zoekmachines.
    resp = await call_next(request)
    resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    return resp


STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# In-memory status van lopende/afgeronde metingen. Voor één gebruiker prima;
# bij meer verkeer vervangen door een database.
JOBS = {}


class MeetRequest(BaseModel):
    merknaam: str
    url: str = ""
    categorie: str
    markt: str = "Nederland"
    taal: str = "nl"
    concurrenten: list = []
    doelgroep: str = ""
    runs_per_prompt: int = 5
    boek_analyses: bool = True
    landingspagina: str = ""
    modus: str = "zoeken"  # "kaal" | "zoeken" | "beide"


@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(STATIC_DIR, "index.html"), encoding="utf-8") as f:
        return f.read()


@app.post("/api/measure")
async def start_measure(req: MeetRequest):
    meting_id = engine._slug(req.merknaam) + "-" + uuid.uuid4().hex[:6]
    config = req.dict()
    config["meting_id"] = meting_id
    # Maak concurrenten schoon (lege strings eruit).
    config["concurrenten"] = [c.strip() for c in (config.get("concurrenten") or []) if c and c.strip()]

    JOBS[meting_id] = {"status": "running", "done": 0, "total": 0, "error": None, "note": None}
    log.info("VERZOEK meting %s | merk=%r categorie=%r runs=%s boek=%s landingspagina=%r",
             meting_id, config.get("merknaam"), config.get("categorie"),
             config.get("runs_per_prompt"), config.get("boek_analyses"), config.get("landingspagina"))

    def progress(done, total, note=None):
        JOBS[meting_id]["done"] = done
        JOBS[meting_id]["total"] = total
        JOBS[meting_id]["note"] = note

    async def run():
        try:
            await engine.run_measurement(config, progress=progress)
            JOBS[meting_id]["status"] = "done"
        except Exception as e:  # noqa: BLE001
            JOBS[meting_id]["status"] = "error"
            JOBS[meting_id]["error"] = str(e)
            log.exception("CRASH meting %s: %s", meting_id, e)

    asyncio.create_task(run())
    return {"meting_id": meting_id}


@app.get("/api/measure/{meting_id}/status")
def measure_status(meting_id):
    job = JOBS.get(meting_id)
    if not job:
        # Misschien een eerdere meting die al op schijf staat.
        if engine.load_result(meting_id):
            return {"status": "done", "done": 1, "total": 1, "error": None}
        raise HTTPException(404, "Meting niet gevonden")
    return job


@app.get("/api/measure/{meting_id}/result")
def measure_result(meting_id):
    result = engine.load_result(meting_id)
    if not result:
        raise HTTPException(404, "Resultaat nog niet beschikbaar")
    return JSONResponse(result)


@app.get("/api/measure/{meting_id}/report")
def measure_report(meting_id):
    md = engine.load_report(meting_id)
    if md is None:
        raise HTTPException(404, "Rapport nog niet beschikbaar")
    return PlainTextResponse(md, media_type="text/markdown")


@app.get("/api/health")
def health():
    from geo import providers
    return {"ok": True, "providers": providers.available_providers()}


@app.get("/api/logs")
def logs(lines: int = 200):
    """Laatste regels uit het logbestand — handig om mee te sturen bij debuggen.
    Bevat geen API-keys, alleen merk-config en foutmeldingen."""
    from geo.logsetup import LOG_FILE
    if not os.path.exists(LOG_FILE):
        return PlainTextResponse("(nog geen logregels)", media_type="text/plain")
    with open(LOG_FILE, encoding="utf-8") as f:
        alle = f.readlines()
    staart = "".join(alle[-max(1, min(lines, 2000)):])
    return PlainTextResponse(staart, media_type="text/plain")
