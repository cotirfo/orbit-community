# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# Atualiza somente as duas regras de conexao dos testes e sua lista de destinos.
# Mantem as tabelas exclusivas e o bloqueio sem failover ja instalados.
{
  :local orbitWAN1 [/ip firewall mangle find where comment="ORBIT speed WAN1 connection"]
  :local orbitFix [/ip firewall mangle find where comment="ORBIT speed WAN2 connection"]
  :if (([:len $orbitWAN1] != 1) || ([:len $orbitFix] != 1)) do={ :error "Regras de velocidade por link nao encontradas. Nenhuma alteracao." }
  :if ([:len [/ip firewall address-list find where list="orbit-speed-servers"]] > 0) do={ :error "Lista orbit-speed-servers ja existe. Nao repetir a importacao." }
  :local orbitWAN1OldPort [/ip firewall mangle get $orbitWAN1 src-port]
  :local orbitFixOldPort [/ip firewall mangle get $orbitFix src-port]
  :local orbitWAN1OldDst [/ip firewall mangle get $orbitWAN1 dst-address]
  :local orbitFixOldDst [/ip firewall mangle get $orbitFix dst-address]
  :local orbitWAN1OldList [:tostr [/ip firewall mangle get $orbitWAN1 dst-address-list]]
  :local orbitFixOldList [:tostr [/ip firewall mangle get $orbitFix dst-address-list]]
  :if (($orbitWAN1OldPort != "18201") || ($orbitFixOldPort != "18202")) do={ :error "Portas anteriores diferentes do esperado. Nenhuma alteracao." }
  :if (($orbitWAN1OldList != "") || ($orbitFixOldList != "")) do={ :error "Lista de destinos anterior inesperada. Nenhuma alteracao." }
  :do {
    /ip firewall address-list add list=orbit-speed-servers address=speed.cloudflare.com comment="ORBIT servers Cloudflare"
    /ip firewall address-list add list=orbit-speed-servers address=medicao-1.example comment="ORBIT servers Akamai Sao Paulo"
    /ip firewall address-list add list=orbit-speed-servers address=medicao-2.example comment="ORBIT servers Akamai Miami"
    /ip firewall mangle set $orbitWAN1 dst-address=0.0.0.0/0 dst-address-list=orbit-speed-servers src-port=18201,18203,18205
    /ip firewall mangle set $orbitFix dst-address=0.0.0.0/0 dst-address-list=orbit-speed-servers src-port=18202,18204,18206
  } on-error={
    /ip firewall mangle set $orbitWAN1 dst-address=$orbitWAN1OldDst dst-address-list=$orbitWAN1OldList src-port=$orbitWAN1OldPort
    /ip firewall mangle set $orbitFix dst-address=$orbitFixOldDst dst-address-list=$orbitFixOldList src-port=$orbitFixOldPort
    /ip firewall address-list remove [find where list="orbit-speed-servers"]
    :error "Falha na atualizacao. Configuracao anterior restaurada. Envie a saida."
  }
  /ip firewall mangle print detail where comment~"^ORBIT speed "
  /ip firewall address-list print detail where list="orbit-speed-servers"
  :put "Servidores autorizados para os testes ORBIT. Aguarde a leitura do painel."
}
