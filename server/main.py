from dotenv import load_dotenv   # type: ignore
load_dotenv()

from fastapi import FastAPI   # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.staticfiles import StaticFiles  # type: ignore
from app.database import db

import app.routers.health as health
import app.routers.results as results
import app.routers.generate as generate
import app.routers.dashboard as dashboard
import app.routers.auth as auth
from app.routers import test_data
from app.services.media_storage import MEDIA_ROOT
from app.routers import scout
from app.routers import crawler

# Trimmed on purpose for this generation-only build: no Execution Lab
# (execute.py), no Knowledge Space (knowledge.py), no Token & Cost or Admin
# Console (token_usage.py, and the admin-only bits of auth.py go unused on
# the frontend). See app/auth/middleware.py — there is also no login/role
# system anymore; every request shares one open-access account.

app = FastAPI(
    title="OmniTestAI Forge",
    description="AI-powered test case generation — Dashboard, Test Cases, AI Test Design, Test Data",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],  
)

@app.on_event("startup")
async def startup():
    await db.connect()

@app.on_event("shutdown")
async def shutdown():
    await db.disconnect()

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(results.router)
app.include_router(generate.router)
app.include_router(dashboard.router)
app.include_router(test_data.router)
app.include_router(scout.router)
app.include_router(crawler.router)

# Serve execution screenshots/videos as static files at /media/...
app.mount("/media", StaticFiles(directory=MEDIA_ROOT), name="media")