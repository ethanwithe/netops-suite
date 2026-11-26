"""Un PDF/Word/ZIP vacío o cortado nunca se entrega: se borra y se avisa."""
import zipfile

import pytest
from fastapi import HTTPException

from app.services.filestore import verify_output


def test_vacio_y_cortado(tmp_path):
    a = tmp_path / "a.pdf"
    a.write_bytes(b"")
    with pytest.raises(HTTPException):
        verify_output(a)
    assert not a.exists()
    b = tmp_path / "b.pdf"
    b.write_bytes(b"%PDF-1.4 sin final")
    with pytest.raises(HTTPException):
        verify_output(b)
    c = tmp_path / "c.docx"
    c.write_bytes(b"no es un zip")
    with pytest.raises(HTTPException):
        verify_output(c)


def test_validos(tmp_path):
    a = tmp_path / "a.pdf"
    a.write_bytes(b"%PDF-1.4\n...\n%%EOF\n")
    verify_output(a)
    d = tmp_path / "d.docx"
    with zipfile.ZipFile(d, "w") as z:
        z.writestr("word/document.xml", "<w/>")
    verify_output(d)
    assert a.exists() and d.exists()
