import sys
from PIL import Image, ImageDraw
out, ts = sys.argv[1], sys.argv[2:]
W, H, cols = 480, 270, 6
rows = (len(ts) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows))
d = ImageDraw.Draw(sheet)
for i, t in enumerate(ts):
    im = Image.open(f'mtv/still_{t}.jpg').resize((W, H))
    sheet.paste(im, ((i % cols) * W, (i // cols) * H))
    d.text(((i % cols) * W + 6, (i // cols) * H + 4), t + 's', fill=(255, 220, 120))
sheet.save(out)
