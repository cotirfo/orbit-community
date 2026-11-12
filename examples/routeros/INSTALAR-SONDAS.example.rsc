# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# ORBIT sondas v3 - somente Netwatch. Nao modifica rotas, PCC, NAT ou firewall.
# Verifica rotas configuradas e gateways. Permite instalar sondas durante uma queda.
# O ORBIT valida a rota ativa antes de atribuir RTT, jitter ou perda a uma WAN.
# Referencia: https://manual.mikrotik.com/docs/developer-guides/scripting/scripting-tips-and-tricks/
{
  :if ([:len [/tool netwatch find where comment="ORBIT qualidade WAN1"]] > 0) do={ :error "Sonda WAN1 ja existe. Nao continuar sem revisar." }
  :if ([:len [/tool netwatch find where comment="ORBIT qualidade WAN2"]] > 0) do={ :error "Sonda WAN2 ja existe. Nao continuar sem revisar." }
  :local orbitWAN1Count 0
  :local orbitFixCount 0
  :local orbitWAN1Route [:toarray ""]
  :local orbitFixRoute [:toarray ""]
  :foreach orbitRoute in=[/ip route print as-value] do={
    :local orbitDestination [:tostr ($orbitRoute->"dst-address")]
    :local orbitTable [:tostr ($orbitRoute->"routing-table")]
    :if ($orbitTable = "main") do={
      :if ($orbitDestination = "1.1.1.1/32") do={ :set orbitWAN1Count ($orbitWAN1Count + 1); :set orbitWAN1Route $orbitRoute }
      :if ($orbitDestination = "8.8.4.4/32") do={ :set orbitFixCount ($orbitFixCount + 1); :set orbitFixRoute $orbitRoute }
    }
  }
  :put ("Rotas main encontradas: WAN1=" . $orbitWAN1Count . " WAN2=" . $orbitFixCount)
  :if ($orbitWAN1Count != 1) do={ :error "Esperada uma rota main para 1.1.1.1/32. Nenhuma sonda criada." }
  :if ($orbitFixCount != 1) do={ :error "Esperada uma rota main para 8.8.4.4/32. Nenhuma sonda criada." }
  :local orbitWAN1Gateway [:tostr ($orbitWAN1Route->"gateway")]
  :local orbitFixGateway [:tostr ($orbitFixRoute->"gateway")]
  :put ("WAN1: gateway configurado=" . $orbitWAN1Gateway)
  :put ("WAN2: gateway configurado=" . $orbitFixGateway)
  :if (($orbitWAN1Gateway != "203.0.113.1") && ($orbitWAN1Gateway != "203.0.113.1%ether1")) do={ :error "Gateway WAN1 diferente do esperado. Nenhuma sonda criada." }
  :if (($orbitFixGateway != "203.0.113.1") && ($orbitFixGateway != "203.0.113.1%ether5")) do={ :error "Gateway WAN2 diferente do esperado. Nenhuma sonda criada." }
  /tool netwatch add comment="ORBIT qualidade WAN1" host=1.1.1.1 type=icmp interval=10s timeout=1s packet-count=5 packet-interval=200ms thr-avg=1s thr-max=1s thr-stdev=1s thr-jitter=1s thr-loss-percent=80% start-delay=3s startup-delay=30s up-script="" down-script="" test-script=""
  /tool netwatch add comment="ORBIT qualidade WAN2" host=8.8.4.4 type=icmp interval=10s timeout=1s packet-count=5 packet-interval=200ms thr-avg=1s thr-max=1s thr-stdev=1s thr-jitter=1s thr-loss-percent=80% start-delay=3s startup-delay=30s up-script="" down-script="" test-script=""
  /tool netwatch print stats
  :put "Duas sondas ORBIT instaladas. Aguarde o primeiro teste e a leitura do painel."
}
