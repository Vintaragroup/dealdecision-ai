from __future__ import annotations

import unittest

from PIL import Image, ImageDraw

from app.extractors.chart_bar import detect_bar_chart, extract_bar_chart


def _make_synthetic_bar_chart(*, heights: list[int]) -> Image.Image:
    # White background
    w, h = 640, 420
    img = Image.new("RGB", (w, h), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Axes
    left = 70
    bottom = 360
    right = 590
    top = 50
    draw.line([(left, top), (left, bottom)], fill=(0, 0, 0), width=3)
    draw.line([(left, bottom), (right, bottom)], fill=(0, 0, 0), width=3)

    # Bars
    bar_w = 55
    gap = 45
    x = left + 45
    for bh in heights:
        bh = max(1, min(bh, bottom - top - 5))
        draw.rectangle([x, bottom - bh, x + bar_w, bottom - 2], fill=(0, 0, 0))
        x += bar_w + gap

    return img


class TestBarChartExtraction(unittest.TestCase):
    def test_detect_bar_chart_true(self) -> None:
        img = _make_synthetic_bar_chart(heights=[80, 160, 120, 40])
        res, flags = detect_bar_chart(img)
        self.assertTrue(res.detected, msg=f"flags={flags} res={res}")
        self.assertGreaterEqual(res.bar_count, 3)

    def test_extract_bar_chart_normalized_values(self) -> None:
        heights = [80, 160, 120, 40]
        img = _make_synthetic_bar_chart(heights=heights)
        res, _ = detect_bar_chart(img)
        self.assertTrue(res.detected)

        structured, flags = extract_bar_chart(img, detect=res, ocr_blocks=None)
        self.assertIn("chart", structured)
        chart = structured["chart"]

        self.assertEqual(chart.get("type"), "bar")
        self.assertEqual(chart.get("method"), "bar_pixels_v1")

        series = chart.get("series")
        self.assertIsInstance(series, list)
        self.assertGreaterEqual(len(series), 1)
        s0 = series[0]
        self.assertTrue(s0.get("values_are_normalized"), msg=f"flags={flags} structured={structured}")

        values = s0.get("values")
        self.assertIsInstance(values, list)
        self.assertEqual(len(values), len(heights))
        self.assertTrue(all(isinstance(v, (int, float)) for v in values))

        # Ordering: 160 highest, then 120, then 80, then 40
        self.assertGreater(values[1], values[2])
        self.assertGreater(values[2], values[0])
        self.assertGreater(values[0], values[3])

        # Approx ratios (normalized by max height)
        # Expected: [0.5, 1.0, 0.75, 0.25]
        self.assertAlmostEqual(values[1], 1.0, delta=0.08)
        self.assertAlmostEqual(values[2] / values[1], 0.75, delta=0.12)
        self.assertAlmostEqual(values[0] / values[1], 0.5, delta=0.12)
        self.assertAlmostEqual(values[3] / values[1], 0.25, delta=0.12)


if __name__ == "__main__":
    unittest.main()
