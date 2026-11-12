$ErrorActionPreference = 'Stop'
Get-NetFirewallRule | Where-Object { $_.Name -in @('ORBIT-LAN-8787','ORBIT-LAN-80') -or $_.DisplayName -in @('ORBIT-LAN-8787','ORBIT-LAN-80') } | Remove-NetFirewallRule
Write-Output 'Regras locais ORBIT-LAN-80 e ORBIT-LAN-8787 removidas. Nenhuma outra regra foi alterada.'
