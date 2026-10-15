"""Known-resolution PDFs exercise the analyzer rather than its route mock."""
from io import BytesIO

import fitz
from PIL import Image
import pytest

from backend.services.pdf_dpi import analyze_pdf_dpi, PdfDpiAnalysisError


def png(width, height, color="white"):
    output = BytesIO()
    Image.new("RGB", (width, height), color).save(output, format="PNG")
    return output.getvalue()


def scan_pdf(resolutions, *, watermark=False, rotation=0):
    with fitz.open() as doc:
        for dpi in resolutions:
            page = doc.new_page(width=144, height=216)
            page.insert_image(page.rect, stream=png(dpi * 2, dpi * 3), rotate=rotation)
            if watermark:
                page.insert_image(fitz.Rect(0, 0, 36, 36), stream=png(300, 300, "red"))
        return doc.tobytes()


@pytest.mark.parametrize("dpi,recommended", [(150, 300), (300, 300), (400, 400), (600, 600)])
def test_detects_known_source_scan_resolution(dpi, recommended):
    result = analyze_pdf_dpi(scan_pdf([dpi, dpi]), "scan.pdf")
    assert result.page_count == result.pages_analyzed == result.pages_with_scan_estimate == 2
    assert result.detected_median_dpi == dpi
    assert result.recommended_dpi == recommended
    assert result.confidence == "high"
    if dpi == 150:
        assert any("low resolution" in warning for warning in result.warnings)


def test_ignores_a_repeated_small_logo_and_warns_about_mixed_resolution():
    result = analyze_pdf_dpi(scan_pdf([200, 600], watermark=True), "mixed.pdf")
    assert result.detected_min_dpi == 200
    assert result.detected_max_dpi == 600
    assert result.detected_median_dpi == 400
    assert result.ignored_probable_watermark_images == 2
    assert any("varies substantially" in warning for warning in result.warnings)


def test_vector_pdf_has_an_explicit_unavailable_estimate():
    with fitz.open() as doc:
        doc.new_page().insert_text((72, 72), "Vector text")
        result = analyze_pdf_dpi(doc.tobytes(), "vector.pdf")
    assert result.detected_median_dpi is None
    assert result.confidence == "unavailable"
    assert result.recommended_dpi == 300
    assert result.pages_with_scan_estimate == 0
    assert any("No dominant raster" in warning for warning in result.warnings)


@pytest.mark.parametrize("content,message", [(b"", "empty"), (b"not a PDF", "Unable to open")])
def test_bad_input_reports_an_analysis_error(content, message):
    with pytest.raises(PdfDpiAnalysisError, match=message):
        analyze_pdf_dpi(content, "bad.pdf")


def test_password_protected_pdf_is_rejected():
    with fitz.open() as doc:
        doc.new_page()
        content = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="reader")
    with pytest.raises(PdfDpiAnalysisError, match="Password-protected"):
        analyze_pdf_dpi(content, "locked.pdf")


def test_rotated_scan_uses_image_transform_dimensions():
    with fitz.open() as doc:
        page = doc.new_page(width=216, height=144)
        page.insert_image(page.rect, stream=png(600, 900), rotate=90)
        result = analyze_pdf_dpi(doc.tobytes(), "rotated.pdf")
    assert result.detected_median_dpi == 300
