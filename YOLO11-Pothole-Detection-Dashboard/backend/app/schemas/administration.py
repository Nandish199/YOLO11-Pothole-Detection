from typing import Literal

from pydantic import BaseModel


class RoleUpdate(BaseModel):
    role: Literal["admin", "client"]


class StatusUpdate(BaseModel):
    is_active: bool
