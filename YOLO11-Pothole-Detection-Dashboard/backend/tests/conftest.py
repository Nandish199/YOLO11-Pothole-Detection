import os
import tempfile

_tmp = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}/test.db"
os.environ["UPLOAD_DIR"] = f"{_tmp.name}/uploads"
os.environ["RESULTS_DIR"] = f"{_tmp.name}/results"
os.environ["MODEL_PATH"] = ""

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
import app.models  # noqa: F401
from app.main import app


@pytest.fixture(autouse=True)
def database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
