"""Store annotated output image paths for completed detections."""
from alembic import op
from sqlalchemy import Column, Text, inspect

revision = "0002_result_path"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("detections")}
    if "result_path" not in columns:
        op.add_column("detections", Column("result_path", Text(), nullable=True))


def downgrade():
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("detections")}
    if "result_path" in columns:
        op.drop_column("detections", "result_path")
