$ErrorActionPreference = 'Stop'
$resultPath = Join-Path $PSScriptRoot 'firewall-lan-result.txt'
try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Execute este script como administrador para criar a regra de entrada no Windows.'
    }
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    foreach ($orbitPort in @(80,8787)) {
    $ruleName = 'ORBIT-LAN-' + $orbitPort
    $rule = @(Get-NetFirewallRule -ErrorAction Stop | Where-Object { $_.Name -eq $ruleName -or $_.DisplayName -eq $ruleName })
    if ($rule) {
        $rule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any
        $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress '198.51.100.107' -RemoteAddress '198.51.100.0/24'
        $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $orbitPort -RemotePort Any
        $rule | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $nodePath
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Description 'ORBIT somente na rede Huawei.' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalPort $orbitPort -LocalAddress '198.51.100.107' -RemoteAddress '198.51.100.0/24' -Program $nodePath | Out-Null
    }
    }
    'OK: TCP 80 e 8787 liberados apenas em 198.51.100.107 para 198.51.100.0/24.' | Set-Content -LiteralPath $resultPath -Encoding UTF8
} catch {
    ('ERRO: ' + $_.Exception.Message) | Set-Content -LiteralPath $resultPath -Encoding UTF8
    exit 1
}
