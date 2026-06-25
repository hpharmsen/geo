"""Lokale start-helper.  Gebruik:  python run.py
(of, identiek:  uvicorn app:app --reload --port 8000)
"""

import os
import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app:app", host="127.0.0.1", port=port, reload=True)
