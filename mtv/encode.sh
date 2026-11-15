#!/bin/sh
cd "$(dirname "$0")"
ffmpeg -hide_banner -loglevel error -y -i frames.mp4 -i song.m4a -filter_complex "[0:v]eq=contrast=1.05:saturation=0.88:gamma=0.97,colorbalance=bs=0.05:bm=0.03,noise=alls=5:allf=t,vignette=angle=PI/5,drawbox=x=0:y=0:w=iw:h=138:color=black:t=fill,drawbox=x=0:y=ih-138:w=iw:h=138:color=black:t=fill,fade=t=in:st=0:d=1.5,fade=t=out:st=152.6:d=1.6,ass=titles.ass:fontsdir=fonts[v]" -map "[v]" -map 1:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart -shortest "The Last Orbit - Junior Astronaut MV.mp4"
