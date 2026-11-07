"""Render a review GIF from the actual shipped original and directional sprites."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root=Path(__file__).resolve().parents[1]
out=root/'test-results'
out.mkdir(exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',14)
names=['atlas','pip','bolt','mira','nova']
labels=['Original','Down','SW','Left','NW','Up','NE','Right','SE']
frames=[]
for step in range(8):
    canvas=Image.new('RGB',(800,510),'#1b2927')
    draw=ImageDraw.Draw(canvas)
    draw.text((16,10),'Original appearance / rebuilt eight-direction walk cycles',fill='#e6d5aa',font=font)
    for column,label in enumerate(labels):
        draw.text((95+column*76,40),label,fill='#9eafa0',font=font)
    for row,name in enumerate(names):
        draw.text((12,93+row*84),name.title(),fill='#e6d5aa',font=font)
        source=Image.open(root/'public'/'sprites'/f'{name}.png').convert('RGBA')
        sheet=Image.open(root/'public'/'sprites'/f'{name}-walk-iso.png').convert('RGBA')
        for column in range(9):
            frame=source.crop((0,0,32,32)) if column==0 else sheet.crop((step*32,(column-1)*32,step*32+32,column*32))
            frame=frame.resize((64,64),Image.Resampling.NEAREST)
            canvas.paste(frame,(93+column*76,64+row*84),frame)
    frames.append(canvas)
frames[0].save(out/'character-turns.gif',save_all=True,append_images=frames[1:],duration=100,loop=0,disposal=2)
frames[0].save(out/'character-turns.png')
print(out/'character-turns.gif')
