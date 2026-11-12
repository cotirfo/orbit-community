# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# ORBIT RTT cruzado v2 - importar uma vez. Se houver erro, nao repetir.
# Seis sondas ICMP; tabelas isoladas e blackhole impedem reserva cruzada.
# Mantem rotas main, PCC e as sondas antigas. Nenhum script de failover.
# Origens 198.51.100.12/32 e .202/32 sao enderecos locais de diagnostico no lo.
{
  :if ([:len [/interface find where name="lo"]] != 1) do={ :error "Interface lo nao encontrada. Nenhuma alteracao." }
  :if ([:len [/ip firewall mangle find where comment~"^ORBIT RTT "]] > 0) do={ :error "Regras RTT ja existem. Nao repetir." }
  :if ([:len [/ip firewall nat find where comment~"^ORBIT RTT "]] > 0) do={ :error "NAT RTT ja existe. Nao repetir." }
  :if ([:len [/ip route find where comment~"^ORBIT RTT "]] > 0) do={ :error "Rotas RTT ja existem. Nao repetir." }
  :if ([:len [/ip address find where comment~"^ORBIT RTT "]] > 0) do={ :error "Origens RTT ja existem. Nao repetir." }
  :if ([:len [/tool netwatch find where comment~"^ORBIT RTT "]] > 0) do={ :error "Sondas RTT ja existem. Nao repetir." }
  :if ([:len [/ip firewall address-list find where list="orbit-rtt-targets"]] > 0) do={ :error "Lista RTT ja existe. Nao repetir." }
  :if ([:len [/ip address find where address~"^198[.]18[.]"]] > 0) do={ :error "Faixa de diagnostico 198.18 ja usada. Nenhuma alteracao." }
  :if ([:len [/ip firewall mangle find]] = 0) do={ :error "Mangle atual nao encontrado. Nenhuma alteracao." }
  :if ([:len [/ip firewall nat find]] = 0) do={ :error "NAT atual nao encontrado. Nenhuma alteracao." }
  :local orbitMangleAnchor [:pick [/ip firewall mangle find] 0]
  :local orbitNatAnchor [:pick [/ip firewall nat find] 0]
  :if ([:len [/routing table find where name="orbit-rtt-wan1"]] > 0) do={ :error "Tabela orbit-rtt-wan1 ja existe." }
  :local orbitWAN1Client [/ip dhcp-client find where interface="ether1"]
  :if ([:len $orbitWAN1Client] != 1) do={ :error "Cliente DHCP WAN1 nao e unico. Nenhuma alteracao." }
  :local orbitWAN1Gateway [:tostr [/ip dhcp-client get $orbitWAN1Client gateway]]
  :local orbitWAN1Status [:tostr [/ip dhcp-client get $orbitWAN1Client status]]
  :put ("DHCP WAN1: gateway=" . $orbitWAN1Gateway . " status=" . $orbitWAN1Status)
  :if (($orbitWAN1Gateway != "203.0.113.1") || ($orbitWAN1Status != "bound")) do={ :error "DHCP/gateway WAN1 nao confirmado. Nenhuma alteracao." }
  :if ([:len [/routing table find where name="orbit-rtt-wan2"]] > 0) do={ :error "Tabela orbit-rtt-wan2 ja existe." }
  :local orbitWAN2Client [/ip dhcp-client find where interface="ether5"]
  :if ([:len $orbitWAN2Client] != 1) do={ :error "Cliente DHCP WAN2 nao e unico. Nenhuma alteracao." }
  :local orbitWAN2Gateway [:tostr [/ip dhcp-client get $orbitWAN2Client gateway]]
  :local orbitWAN2Status [:tostr [/ip dhcp-client get $orbitWAN2Client status]]
  :put ("DHCP WAN2: gateway=" . $orbitWAN2Gateway . " status=" . $orbitWAN2Status)
  :if (($orbitWAN2Gateway != "203.0.113.1") || ($orbitWAN2Status != "bound")) do={ :error "DHCP/gateway WAN2 nao confirmado. Nenhuma alteracao." }
  :do {
    /routing table add name=orbit-rtt-wan1 fib
    /ip address add address=198.51.100.12/32 interface=lo comment="ORBIT RTT WAN1 source"
    /ip route add dst-address=0.0.0.0/0 gateway=203.0.113.1%ether1 routing-table=orbit-rtt-wan1 distance=1 scope=30 target-scope=10 check-gateway=none comment="ORBIT RTT WAN1 route"
    /ip route add blackhole dst-address=0.0.0.0/0 routing-table=orbit-rtt-wan1 distance=254 comment="ORBIT RTT WAN1 block"
    /routing table add name=orbit-rtt-wan2 fib
    /ip address add address=203.0.113.12/32 interface=lo comment="ORBIT RTT WAN2 source"
    /ip route add dst-address=0.0.0.0/0 gateway=203.0.113.1%ether5 routing-table=orbit-rtt-wan2 distance=1 scope=30 target-scope=10 check-gateway=none comment="ORBIT RTT WAN2 route"
    /ip route add blackhole dst-address=0.0.0.0/0 routing-table=orbit-rtt-wan2 distance=254 comment="ORBIT RTT WAN2 block"
    /ip firewall address-list add list=orbit-rtt-targets address=1.1.1.1 comment="ORBIT RTT target Cloudflare"
    /ip firewall address-list add list=orbit-rtt-targets address=8.8.8.8 comment="ORBIT RTT target Google"
    /ip firewall address-list add list=orbit-rtt-targets address=9.9.9.9 comment="ORBIT RTT target Quad9"
    /ip firewall mangle add chain=output protocol=icmp src-address=198.51.100.12/32 dst-address-list=orbit-rtt-targets action=mark-routing new-routing-mark=orbit-rtt-wan1 passthrough=no disabled=yes place-before=$orbitMangleAnchor comment="ORBIT RTT WAN1 output"
    /ip firewall nat add chain=srcnat protocol=icmp src-address=198.51.100.12/32 dst-address-list=orbit-rtt-targets out-interface=ether1 action=masquerade disabled=yes place-before=$orbitNatAnchor comment="ORBIT RTT WAN1 NAT"
    /ip firewall mangle add chain=output protocol=icmp src-address=203.0.113.12/32 dst-address-list=orbit-rtt-targets action=mark-routing new-routing-mark=orbit-rtt-wan2 passthrough=no disabled=yes place-before=$orbitMangleAnchor comment="ORBIT RTT WAN2 output"
    /ip firewall nat add chain=srcnat protocol=icmp src-address=203.0.113.12/32 dst-address-list=orbit-rtt-targets out-interface=ether5 action=masquerade disabled=yes place-before=$orbitNatAnchor comment="ORBIT RTT WAN2 NAT"
    /tool netwatch add comment="ORBIT RTT WAN1 Cloudflare" host=1.1.1.1 src-address=198.51.100.12 type=icmp interval=10s timeout=1s packet-count=5 packet-interval=200ms thr-avg=1s thr-max=1s thr-stdev=1s thr-jitter=1s thr-loss-percent=80% start-delay=3s startup-delay=30s up-script="" down-script="" test-script="" disabled=yes
    /tool netwatch add comment="ORBIT RTT WAN1 Google" host=8.8.8.8 src-address=198.51.100.12 type=icmp interval=10s timeout=1s packet-count=5 packet-interval=200ms thr-avg=1s thr-max=1s thr-stdev=1s thr-jitter=1s thr-loss-percent=80% start-delay=3s startup-delay=30s up-script="" down-script="" test-script="" disabled=yes
    /tool netwatch add comment="ORBIT RTT WAN1 Quad9" host=9.9.9.9 src-address=198.51.100.12 type=icmp interval=10s timeout=1s packet-count=5 packet-interval=200ms thr-avg=1s thr-max=1s thr-stdev=1s thr-jitter=1s thr-loss-percent=80% start-delay=3s startup-delay=30s up-script="" down-script="" test-script="" disabled=yes
    /tool netwatch add comment="ORBIT RTT WAN2 Cloudflare" host=1.1.1.1 src-address=203.0.113.12 type=icmp interval=10s timeout=1s packet-count=5 packet-interval=200ms thr-avg=1s thr-max=1s thr-stdev=1s thr-jitter=1s thr-loss-percent=80% start-delay=3s startup-delay=30s up-script="" down-script="" test-script="" disabled=yes
    /tool netwatch add comment="ORBIT RTT WAN2 Google" host=8.8.8.8 src-address=203.0.113.12 type=icmp interval=10s timeout=1s packet-count=5 packet-interval=200ms thr-avg=1s thr-max=1s thr-stdev=1s thr-jitter=1s thr-loss-percent=80% start-delay=3s startup-delay=30s up-script="" down-script="" test-script="" disabled=yes
    /tool netwatch add comment="ORBIT RTT WAN2 Quad9" host=9.9.9.9 src-address=203.0.113.12 type=icmp interval=10s timeout=1s packet-count=5 packet-interval=200ms thr-avg=1s thr-max=1s thr-stdev=1s thr-jitter=1s thr-loss-percent=80% start-delay=3s startup-delay=30s up-script="" down-script="" test-script="" disabled=yes
    /ip firewall mangle set [find where comment~"^ORBIT RTT "] disabled=no
    /ip firewall nat set [find where comment~"^ORBIT RTT "] disabled=no
    /tool netwatch set [find where comment~"^ORBIT RTT "] disabled=no
  } on-error={
    /tool netwatch remove [find where comment~"^ORBIT RTT "]
    /ip firewall mangle remove [find where comment~"^ORBIT RTT "]
    /ip firewall nat remove [find where comment~"^ORBIT RTT "]
    /ip firewall address-list remove [find where list="orbit-rtt-targets"]
    /ip route remove [find where comment~"^ORBIT RTT "]
    /ip address remove [find where comment~"^ORBIT RTT "]
    /routing table remove [find where name="orbit-rtt-wan1"]
    /routing table remove [find where name="orbit-rtt-wan2"]
    :error "Falha RTT. Itens novos removidos. Envie a saida; nao repita."
  }
  /tool netwatch print stats where comment~"^ORBIT RTT "
  /ip route print detail where comment~"^ORBIT RTT "
  :put "Seis sondas RTT instaladas. Aguarde 40 segundos para validacao no ORBIT."
}
