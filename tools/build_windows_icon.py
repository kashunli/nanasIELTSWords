"""Rasterize the IELTS Vocabulary mark into a Windows ICO file.

The web app's SVG remains the design source. This small renderer mirrors its
64px geometry at a larger working size, then lets Pillow create the multiple
Windows icon sizes with antialiasing.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


SOURCE_SVG = Path(__file__).resolve().parents[1] / "frontend" / "public" / "icon.svg"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "launcher" / "assets" / "ielts-vocabulary.ico"


def cubic(start, control_one, control_two, end, steps=24):
    points = []
    for index in range(steps + 1):
        t = index / steps
        inverse = 1 - t
        points.append(
            (
                inverse**3 * start[0]
                + 3 * inverse**2 * t * control_one[0]
                + 3 * inverse * t**2 * control_two[0]
                + t**3 * end[0],
                inverse**3 * start[1]
                + 3 * inverse**2 * t * control_one[1]
                + 3 * inverse * t**2 * control_two[1]
                + t**3 * end[1],
            )
        )
    return points


def scale_points(points, scale):
    return [(round(x * scale), round(y * scale)) for x, y in points]


def draw_icon() -> Image.Image:
    scale = 16
    image = Image.new("RGBA", (64 * scale, 64 * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def line(points, fill, width):
        draw.line(scale_points(points, scale), fill=fill, width=round(width * scale), joint="curve")

    draw.rounded_rectangle(
        (0, 0, 64 * scale, 64 * scale),
        radius=18 * scale,
        fill="#263b35",
    )

    left = cubic((10.5, 18.5), (18.1, 15.3), (25.3, 16.4), (32, 21.7))
    left += [(32, 49.8)]
    left += cubic((32, 49.8), (25.3, 44.6), (18.1, 43.7), (10.5, 46.8))
    left += [(10.5, 18.5)]

    right = cubic((53.5, 18.5), (45.9, 15.3), (38.7, 16.4), (32, 21.7))
    right += [(32, 49.8)]
    right += cubic((32, 49.8), (38.7, 44.6), (45.9, 43.7), (53.5, 46.8))
    right += [(53.5, 18.5)]

    draw.polygon(scale_points(left, scale), fill="#fffaf3")
    draw.polygon(scale_points(right, scale), fill="#fffaf3")
    line(left, "#e4b36f", 2.4)
    line(right, "#e4b36f", 2.4)

    line([(32, 22), (32, 49.8)], "#c86d46", 2.4)
    line(cubic((17, 28.5), (21.1, 27.5), (25.2, 27.9), (29.2, 29.6), 12), "#9bb5a4", 2)
    line(cubic((47, 28.5), (42.9, 27.5), (38.8, 27.9), (34.8, 29.6), 12), "#9bb5a4", 2)
    line(cubic((16.5, 36.5), (20.6, 35.7), (24.7, 36.3), (28.7, 38.3), 12), "#9bb5a4", 2)
    line(cubic((47.5, 36.5), (43.4, 35.7), (39.3, 36.3), (35.3, 38.3), 12), "#9bb5a4", 2)
    line([(8.2, 51.5), (12.5, 51.5)], "#c86d46", 2.4)
    line([(15.5, 48.8), (19.2, 48.8)], "#c86d46", 2.4)
    line([(54.5, 48.8), (58.2, 48.8)], "#c86d46", 2.4)
    line([(51.5, 51.5), (55.8, 51.5)], "#c86d46", 2.4)

    return image.resize((256, 256), Image.Resampling.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not SOURCE_SVG.is_file():
        raise SystemExit(f"The web-service icon is missing: {SOURCE_SVG}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    draw_icon().save(
        args.output,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
