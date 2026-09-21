import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402


@pytest.fixture()
def app(tmp_path):
    return create_app({
        "TESTING": True,
        "DB_PATH": str(tmp_path / "test.db"),
        "VOICE_DIR": str(tmp_path / "voice"),
        "NARRATION_DIR": str(tmp_path / "narration"),
        "MEDIA_DIR": str(tmp_path / "media"),
    })


@pytest.fixture()
def client(app):
    return app.test_client()
