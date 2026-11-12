@echo off
title ORBIT - Termos do Speedtest by Ookla
echo Leia os termos apresentados e responda voce mesmo, se concordar.
echo Depois da aceitacao, o programa pode iniciar um teste geral deste PC.
echo Esse teste de aceitacao nao recebe uma WAN atribuida no ORBIT.
"%~dp0bin\speedtest.exe"
pause
