# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# ORBIT - testes WAN1/WAN2. Importar uma vez; nao modifica as regras PCC existentes.
# Classifica somente TCP Huawei -> Cloudflare:443 com origem 18201 ou 18202.
# Novas tabelas possuem rota blackhole de reserva, sem failover para outra WAN.
{
  :if ([:len [/ip firewall mangle find where comment~"^ORBIT speed "]] > 0) do={ :error "Regras ORBIT speed ja existem. Nao repetir a importacao." }
  :if ([:len [/routing table find where name="orbit-speed-wan1"]] > 0) do={ :error "Tabela orbit-speed-wan1 ja existe." }
  :if ([:len [/routing table find where name="orbit-speed-wan2"]] > 0) do={ :error "Tabela orbit-speed-wan2 ja existe." }
  :if ([:len [/ip route find where comment~"^ORBIT speed "]] > 0) do={ :error "Rotas ORBIT speed ja existem." }
  :local orbitAnchor [/ip firewall mangle find where comment="PCC WAN1 0"]
  :if ([:len $orbitAnchor] != 1) do={ :error "Ancora PCC WAN1 0 nao e unica. Nenhuma alteracao." }
  :local orbitWAN1Count 0
  :local orbitFixCount 0
  :foreach orbitRoute in=[/ip route print as-value] do={
    :if ([:tostr ($orbitRoute->"routing-table")] = "main") do={
      :local orbitGateway [:tostr ($orbitRoute->"gateway")]
      :if (([:tostr ($orbitRoute->"dst-address")] = "1.1.1.1/32") && (($orbitGateway = "203.0.113.1") || ($orbitGateway = "203.0.113.1%ether1"))) do={ :set orbitWAN1Count ($orbitWAN1Count + 1) }
      :if (([:tostr ($orbitRoute->"dst-address")] = "8.8.4.4/32") && (($orbitGateway = "203.0.113.1") || ($orbitGateway = "203.0.113.1%ether5"))) do={ :set orbitFixCount ($orbitFixCount + 1) }
    }
  }
  :if (($orbitWAN1Count != 1) || ($orbitFixCount != 1)) do={ :error "Rotas recursivas main nao confirmadas. Nenhuma alteracao." }
  :do {
    /routing table add name=orbit-speed-wan1 fib
    /routing table add name=orbit-speed-wan2 fib
    /ip route add comment="ORBIT speed WAN1 route" dst-address=0.0.0.0/0 gateway=1.1.1.1@main routing-table=orbit-speed-wan1 distance=1 scope=30 target-scope=11 check-gateway=ping
    /ip route add comment="ORBIT speed WAN1 block" blackhole dst-address=0.0.0.0/0 routing-table=orbit-speed-wan1 distance=254
    /ip route add comment="ORBIT speed WAN2 route" dst-address=0.0.0.0/0 gateway=8.8.4.4@main routing-table=orbit-speed-wan2 distance=1 scope=30 target-scope=11 check-gateway=ping
    /ip route add comment="ORBIT speed WAN2 block" blackhole dst-address=0.0.0.0/0 routing-table=orbit-speed-wan2 distance=254
    /ip firewall mangle add comment="ORBIT speed WAN1 connection" chain=prerouting in-interface=bridge src-address=192.0.2.253/32 dst-address=192.0.2.70/32 protocol=tcp src-port=18201 dst-port=443 connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=orbit-speed-wan1 passthrough=yes disabled=yes place-before=$orbitAnchor
    /ip firewall mangle add comment="ORBIT speed WAN2 connection" chain=prerouting in-interface=bridge src-address=192.0.2.253/32 dst-address=192.0.2.70/32 protocol=tcp src-port=18202 dst-port=443 connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=orbit-speed-wan2 passthrough=yes disabled=yes place-before=$orbitAnchor
    /ip firewall mangle add comment="ORBIT speed WAN1 routing" chain=prerouting in-interface=bridge connection-mark=orbit-speed-wan1 action=mark-routing new-routing-mark=orbit-speed-wan1 passthrough=no disabled=yes place-before=$orbitAnchor
    /ip firewall mangle add comment="ORBIT speed WAN2 routing" chain=prerouting in-interface=bridge connection-mark=orbit-speed-wan2 action=mark-routing new-routing-mark=orbit-speed-wan2 passthrough=no disabled=yes place-before=$orbitAnchor
    /ip firewall mangle set [find where comment~"^ORBIT speed "] disabled=no
  } on-error={
    /ip firewall mangle remove [find where comment~"^ORBIT speed "]
    /ip route remove [find where comment~"^ORBIT speed "]
    /routing table remove [find where name="orbit-speed-wan1"]
    /routing table remove [find where name="orbit-speed-wan2"]
    :error "Falha ao instalar; itens ORBIT speed criados foram removidos. Envie a saida."
  }
  /ip firewall mangle print detail where comment~"^ORBIT speed "
  /ip route print detail where comment~"^ORBIT speed "
  :put "ORBIT speed instalado. O painel confirmara as regras, rotas e WAN de cada conexao."
}
