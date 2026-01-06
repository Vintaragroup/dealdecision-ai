from __future__ import annotations

import unittest
from typing import Any, Dict, Tuple

from PIL import Image, ImageDraw

from app.extractors.table import detect_table, extract_table


def _make_synthetic_table_image(*, rows: int, cols: int, cell_w: int = 120, cell_h: int = 60) -> Image.Image:
    width = cols * cell_w + 2
    height = rows * cell_h + 2
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Draw grid lines
    for r in range(rows + 1):
        y = 1 + r * cell_h
        draw.line([(1, y), (1 + cols * cell_w, y)], fill=(0, 0, 0), width=2)
    for c in range(cols + 1):
        x = 1 + c * cell_w
        draw.line([(x, 1), (x, 1 + rows * cell_h)], fill=(0, 0, 0), width=2)

    # Add some text-ish strokes (not used by OCR in this hermetic test)
    for r in range(rows):
        for c in range(cols):
            x0 = 1 + c * cell_w
            y0 = 1 + r * cell_h
            draw.text((x0 + 10, y0 + 10), f"R{r+1}C{c+1}", fill=(0, 0, 0))

    return img


def _stub_cell_ocr(_: Image.Image) -> Tuple[str, Dict[str, Any]]:
    # Hermetic: do not depend on pytesseract/tesseract.
    return "X", {}


class TestTableExtraction(unittest.TestCase):
    def test_detect_table_true_on_synthetic_grid(self) -> None:
        img = _make_synthetic_table_image(rows=4, cols=3)
        res, flags = detect_table(img)
        self.assertTrue(res.grid_detected, msg=f"flags={flags}")
        self.assertTrue(res.detected, msg=f"flags={flags} res={res}")

    def test_extract_table_grid_shape_and_non_empty(self) -> None:
        img = _make_synthetic_table_image(rows=3, cols=3)
        detect_res, _ = detect_table(img)
        self.assertTrue(detect_res.detected)

        structured, flags = extract_table(img, detect=detect_res, ocr_fn=_stub_cell_ocr)
        self.assertIn("table", structured)
        table = structured["table"]
        self.assertEqual(table.get("method"), "grid_lines_v1")

        rows = table.get("rows")
        self.assertIsInstance(rows, list)
        self.assertGreaterEqual(len(rows), 2)
        # Expect at least 2 columns
        self.assertIsInstance(rows[0], list)
        self.assertGreaterEqual(len(rows[0]), 2)
        # Non-empty strings from stub OCR
        for row in rows[:3]:
            for cell in row[:3]:
                self.assertIsInstance(cell, str)
                self.assertNotEqual(cell.strip(), "", msg=f"flags={flags}")


if __name__ == "__main__":
    unittest.main()
