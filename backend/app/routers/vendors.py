from fastapi import APIRouter

from app.services.vendor_commands import get_vendor_labels

router = APIRouter(prefix="/api/vendors", tags=["vendors"])


@router.get("")
def list_vendors():
    return [{"key": k, "label": lbl} for k, lbl in get_vendor_labels()]
