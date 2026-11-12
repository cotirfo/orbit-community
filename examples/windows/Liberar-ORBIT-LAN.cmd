@echo off
echo Execute este arquivo com o botao direito - Executar como administrador.
netsh advfirewall firewall set rule name="ORBIT-LAN-8787" new dir=in action=allow enable=yes profile=any protocol=TCP localport=8787 localip=198.51.100.107 remoteip=198.51.100.0/24 program="C:\Program Files\nodejs\node.exe"
if errorlevel 1 netsh advfirewall firewall add rule name="ORBIT-LAN-8787" dir=in action=allow enable=yes profile=any protocol=TCP localport=8787 localip=198.51.100.107 remoteip=198.51.100.0/24 program="C:\Program Files\nodejs\node.exe"
netsh advfirewall firewall show rule name="ORBIT-LAN-8787" verbose
netsh advfirewall firewall set rule name="ORBIT-LAN-80" new dir=in action=allow enable=yes profile=any protocol=TCP localport=80 localip=198.51.100.107 remoteip=198.51.100.0/24 program="C:\Program Files\nodejs\node.exe"
if errorlevel 1 netsh advfirewall firewall add rule name="ORBIT-LAN-80" dir=in action=allow enable=yes profile=any protocol=TCP localport=80 localip=198.51.100.107 remoteip=198.51.100.0/24 program="C:\Program Files\nodejs\node.exe"
netsh advfirewall firewall show rule name="ORBIT-LAN-80" verbose
pause
