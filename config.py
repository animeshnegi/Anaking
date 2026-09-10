"""
Application configuration.

Every setting can be overridden with an environment variable so the same code runs on a
laptop, in a container or behind a production WSGI server.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-production")

    # Shared secret for the Studio builder and the admin dashboard (?token=...).
    ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "beacon-admin")

    # SQLite database holding studies, respondents and answers.
    DB_PATH = os.environ.get("DB_PATH", os.path.join(DATA_DIR, "survey.db"))

    # Respondent voice recordings (never committed to git).
    VOICE_DIR = os.environ.get("VOICE_DIR", os.path.join(UPLOAD_DIR, "voice"))

    # Narration clips uploaded from the Studio for walkthrough scenes (per study).
    NARRATION_DIR = os.environ.get("NARRATION_DIR", os.path.join(UPLOAD_DIR, "narration"))
    NARRATION_MAX_BYTES = 8 * 1024 * 1024

    # Images / video attached to questions from the Studio (per study).
    MEDIA_DIR = os.environ.get("MEDIA_DIR", os.path.join(UPLOAD_DIR, "media"))
    MEDIA_MAX_BYTES = 10 * 1024 * 1024

    # Pre-generated conjoint design + respondent task map for the seeded BEACON study.
    DESIGN_PATH = os.path.join(DATA_DIR, "design", "design.json")
    TASKMAP_PATH = os.path.join(DATA_DIR, "design", "respondent_task_map.csv")

    # Largest accepted request body (voice clips are base64, capped at ~2.5 MB raw).
    MAX_CONTENT_LENGTH = 12 * 1024 * 1024

    # Admin sign-in cookie (set on /login) - 30 days, HTTP-only, same-site.
    PERMANENT_SESSION_LIFETIME = 30 * 24 * 3600
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"

    SEND_FILE_MAX_AGE_DEFAULT = 3600
    JSON_SORT_KEYS = False


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


class TestingConfig(Config):
    TESTING = True
    ADMIN_TOKEN = "test-token"


CONFIGS = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}
