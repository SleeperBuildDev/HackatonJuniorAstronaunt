EN_MY = {
    'v1': [
        ('Cold steel and the silence', 'အေးစက်တဲ့ သံမဏိနဲ့ တိတ်ဆိတ်မှု'),
        ('Waiting for the dawn', 'အရုဏ်ဦးကို စောင့်မျှော်ရင်း'),
        ("They move but they're hollow", 'သူတို့ လှုပ်ရှားနေပေမဲ့ ဗလာသက်သက်'),
        ('All the others gone', 'တခြားသူတွေ အားလုံး ပျောက်ကွယ်သွားပြီ'),
    ],
    'pre': [
        ('Fixing up the broken pieces', 'ကျိုးပဲ့နေတဲ့ အပိုင်းအစတွေကို ပြန်ပြင်ရင်း'),
        ('Learning how to breathe again', 'အသက်ပြန်ရှူတတ်အောင် သင်ယူရင်း'),
        ('Wires screaming in the dark', 'မှောင်မိုက်ထဲမှာ ဝါယာကြိုးတွေ အော်ဟစ်နေ'),
        ('This is where the ends begin', 'ဒီနေရာက အဆုံးသတ်တွေ စတင်ရာပဲ'),
    ],
    'chorus': [
        ('Lost inside the black expanse', 'မည်းနက်တဲ့ ကျယ်ပြင်ကြီးထဲ လမ်းပျောက်လို့'),
        ('Only me and ghosts remain', 'ငါနဲ့ တစ္ဆေတွေပဲ ကျန်ရစ်ခဲ့'),
        ('Diving into deep forever', 'ထာဝရ နက်ရှိုင်းရာထဲ ငုပ်ဆင်းရင်း'),
        ('Heavy silence fills the frame', 'လေးလံတဲ့ တိတ်ဆိတ်မှုက မြင်ကွင်းကို ဖုံးလွှမ်း'),
    ],
    'v2': [
        ('Glow of the terminal screen', 'တာမီနယ် မျက်နှာပြင်ရဲ့ အလင်းရောင်'),
        ('Flashing codes I have to know', 'ငါသိရမယ့် ကုဒ်တွေ လက်ခနဲ လက်ခနဲ'),
        ('Cold machines and empty eyes', 'အေးစက်တဲ့ စက်တွေ၊ ဗလာ မျက်လုံးတွေ'),
        ('Nowhere left for me to go', 'ငါသွားစရာ ဘယ်နေရာမှ မကျန်တော့ဘူး'),
    ],
    'outro': [
        ('Floating alone in the infinite black', 'အဆုံးမဲ့ မှောင်မိုက်ထဲ တစ်ယောက်တည်း လွင့်မျောရင်း'),
        ('Nothing is coming to carry me back', 'ငါ့ကို ပြန်ခေါ်ဆောင်ဖို့ ဘာမှ မလာတော့ဘူး'),
    ],
}
SONG = {
    'verse1': [14.0, 16.6, 19.2, 21.8, 24.45],
    'pre1': [24.45, 27.95, 31.45, 34.95, 38.46],
    'chorus1': [38.46, 41.65, 44.84, 48.03, 51.22, 54.41, 57.6, 60.8, 64.0],
    'verse2': [64.0, 66.76, 69.52, 72.28, 75.05],
    'pre2': [75.05, 78.5, 81.95, 85.4, 88.84],
    'chorus2': [88.84, 91.64, 94.44, 97.24, 100.05, 102.85, 105.65, 108.45, 111.25],
    'outro': [140.0, 147.0, 154.0],
}
plan = [('verse1', 'v1'), ('pre1', 'pre'), ('chorus1', 'chorus'), ('verse2', 'v2'), ('pre2', 'pre'), ('chorus2', 'chorus'), ('outro', 'outro')]
lines = []
for sec, words in plan:
    t = SONG[sec]
    n = len(t) - 1
    for i in range(n):
        en, my = EN_MY[words][i % len(EN_MY[words])]
        lines.append((t[i] + 0.15, t[i + 1] - 0.1, en, my))

def ts_ass(s):
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return f'{int(h)}:{int(m):02d}:{s:05.2f}'

def ts_srt(s):
    ms = int(round(s * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    sec, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{sec:02d},{ms:03d}'

head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: EN,Segoe UI Light,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,3,0,1,0,0,2,60,60,84,1
Style: MY,Myanmar Text,36,&H00C8D2D8,&H00C8D2D8,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,60,60,16,1
Style: Kicker,Bahnschrift,30,&H00C8E6FF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,14,0,1,0,0,5,60,60,0,1
Style: Title,Bahnschrift,120,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,24,0,1,0,6,5,60,60,0,1
Style: Small,Segoe UI Light,34,&H00D8D8D8,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,4,0,1,0,0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
ev = []
B = chr(92)
ev.append(f'Dialogue: 0,{ts_ass(1.2)},{ts_ass(6.4)},Kicker,,0,0,0,,{{{B}fad(900,700){B}pos(960,420)}}JUNIOR ASTRONAUT')
ev.append(f'Dialogue: 0,{ts_ass(2.0)},{ts_ass(6.5)},Title,,0,0,0,,{{{B}fad(1200,700){B}pos(960,540)}}THE LAST ORBIT')
ev.append(f'Dialogue: 0,{ts_ass(154.4)},{ts_ass(160.6)},Title,,0,0,0,,{{{B}fad(1000,800){B}pos(960,480)}}THE LAST ORBIT')
ev.append(f'Dialogue: 0,{ts_ass(155.2)},{ts_ass(160.6)},Small,,0,0,0,,{{{B}fad(1000,800){B}pos(960,600)}}Junior Astronaut: Lunar Survival Mission')
ev.append(f'Dialogue: 0,{ts_ass(155.8)},{ts_ass(160.6)},Small,,0,0,0,,{{{B}fad(1000,800){B}pos(960,650){B}fs26{B}c&H909090&}}Rendered in the game engine')
for a, b, en, my in lines:
    ev.append(f'Dialogue: 0,{ts_ass(a)},{ts_ass(b)},EN,,0,0,0,,{{{B}fad(250,300)}}{en}')
    ev.append(f'Dialogue: 0,{ts_ass(a)},{ts_ass(b)},MY,,0,0,0,,{{{B}fad(250,300)}}{my}')
open('lyrics.ass', 'w', encoding='utf-8-sig').write(head + '\n'.join(ev) + '\n')
srt = []
for i, (a, b, en, my) in enumerate(lines, 1):
    srt.append(f'{i}\n{ts_srt(a)} --> {ts_srt(b)}\n{en}\n{my}\n')
open('lyrics.srt', 'w', encoding='utf-8-sig').write('\n'.join(srt))
print(len(lines), 'lyric lines')
