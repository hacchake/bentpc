@echo off
rem BENT TOY RACK をこのパソコンの中の小さなサーバーで開きます（カメラやタブ共有を使うとき用）
rem 開いている間はこの黒い窓を閉じないでください。終わったら窓を閉じれば止まります。
cd /d %~dp0
call npm run serve
pause
