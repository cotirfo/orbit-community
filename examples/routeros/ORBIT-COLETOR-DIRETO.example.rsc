# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# ORBIT host coletor direto no MikroTik. Importar uma vez, antes de trocar o cabo.
# Reserva 192.0.2.250 para a Ethernet do host coletor, autoriza REST e migra os testes.
# Nao altera PCC, rotas, NAT, sondas ou configuracao do Huawei.
# Se houver erro, pare e envie a saida. Nao repetir sem revisar.
{
  :local orbitAddress "192.0.2.250"
  :local orbitMac "02:00:00:00:00:31"
  :local orbitLeaseComment "ORBIT host coletor direto"
  :local orbitPort [/interface bridge port find where interface="ether3"]
  :if ([:len $orbitPort] != 1) do={ :error "ether3 nao tem uma porta bridge unica. Nenhuma alteracao." }
  :if ([/interface bridge port get $orbitPort bridge] != "bridge") do={ :error "ether3 fora da bridge esperada. Nenhuma alteracao." }
  :if ([/interface bridge port get $orbitPort disabled]) do={ :error "Porta ether3 desabilitada. Nenhuma alteracao." }
  :local orbitInterface [/interface ethernet find where name="ether3"]
  :if ([:len $orbitInterface] != 1) do={ :error "Interface ether3 nao confirmada. Nenhuma alteracao." }
  :if ([/interface ethernet get $orbitInterface disabled]) do={ :error "ether3 desabilitada. Nenhuma alteracao." }
  :if ([:len [/ip address find where address="192.0.2.1/24" and interface="bridge"]] != 1) do={ :error "Rede 192.0.2.0/24 nao confirmada na bridge. Nenhuma alteracao." }
  :local orbitDhcp [/ip dhcp-server find where interface="bridge"]
  :if ([:len $orbitDhcp] != 1) do={ :error "Servidor DHCP da bridge nao e unico. Nenhuma alteracao." }
  :if ([/ip dhcp-server get $orbitDhcp disabled]) do={ :error "DHCP da bridge desabilitado. Nenhuma alteracao." }
  :local orbitDhcpName [/ip dhcp-server get $orbitDhcp name]
  :if ([:len [/ip dhcp-server lease find where address=$orbitAddress]] > 0) do={ :error "192.0.2.250 ja tem lease. Revisar; nenhuma alteracao." }
  :if ([:len [/ip dhcp-server lease find where mac-address=$orbitMac]] > 0) do={ :error "MAC Ethernet do host coletor ja tem lease. Revisar; nenhuma alteracao." }
  :if ([:len [/ip dhcp-server lease find where comment=$orbitLeaseComment]] > 0) do={ :error "Reserva ORBIT host coletor ja existe. Nao repetir." }
  :if ([:len [/ip arp find where address=$orbitAddress]] > 0) do={ :error "192.0.2.250 aparece no ARP. Revisar; nenhuma alteracao." }
  :local orbitService [/ip service find where name="www-ssl"]
  :local orbitUser [/user find where name="orbit-monitor"]
  :if (([:len $orbitService] != 1) || ([:len $orbitUser] != 1)) do={ :error "HTTPS ou usuario do coletor nao encontrado. Nenhuma alteracao." }
  :if (([/ip service get $orbitService disabled]) || ([/ip service get $orbitService port] != 443) || ([/ip service get $orbitService certificate] != "orbit-server")) do={ :error "HTTPS diferente da configuracao esperada. Nenhuma alteracao." }
  :if (([/user get $orbitUser disabled]) || ([/user get $orbitUser group] != "orbit-read")) do={ :error "Usuario de leitura diferente do esperado. Nenhuma alteracao." }
  :local orbitOldServiceAddress [/ip service get $orbitService address]
  :local orbitOldUserAddress [/user get $orbitUser address]
  :if ([:tostr $orbitOldServiceAddress] != "192.0.2.253/32") do={ :error "Lista de acesso HTTPS diferente do esperado. Nenhuma alteracao." }
  :if ([:tostr $orbitOldUserAddress] != "192.0.2.253/32") do={ :error "Lista de acesso do usuario diferente do esperado. Nenhuma alteracao." }
  :local orbitComments {"ORBIT speed WAN1 connection";"ORBIT speed WAN2 connection";"ORBIT Ookla WAN1 TCP";"ORBIT Ookla WAN1 UDP";"ORBIT Ookla WAN1 routing";"ORBIT Ookla WAN2 TCP";"ORBIT Ookla WAN2 UDP";"ORBIT Ookla WAN2 routing"}
  :foreach orbitComment in=$orbitComments do={
    :local orbitRule [/ip firewall mangle find where comment=$orbitComment]
    :if ([:len $orbitRule] != 1) do={ :error ("Regra nao unica: " . $orbitComment . ". Nenhuma alteracao.") }
    :local orbitSource [:tostr [/ip firewall mangle get $orbitRule src-address]]
    :if (($orbitSource != "192.0.2.253") && ($orbitSource != "192.0.2.253/32")) do={ :error ("Origem inesperada: " . $orbitComment . ". Nenhuma alteracao.") }
    :if ([/ip firewall mangle get $orbitRule disabled]) do={ :error ("Regra desabilitada: " . $orbitComment . ". Nenhuma alteracao.") }
  }
  :do {
    /ip dhcp-server lease add server=$orbitDhcpName address=$orbitAddress mac-address=$orbitMac comment=$orbitLeaseComment
    /ip service set $orbitService address=192.0.2.253/32,192.0.2.250/32
    /user set $orbitUser address=192.0.2.253/32,192.0.2.250/32
    :foreach orbitComment in=$orbitComments do={ /ip firewall mangle set [find where comment=$orbitComment] src-address=192.0.2.250/32 }
  } on-error={
    :foreach orbitComment in=$orbitComments do={ /ip firewall mangle set [find where comment=$orbitComment] src-address=192.0.2.253/32 }
    /ip service set $orbitService address=$orbitOldServiceAddress
    /user set $orbitUser address=$orbitOldUserAddress
    /ip dhcp-server lease remove [find where comment=$orbitLeaseComment]
    :error "Falha na migracao. Configuracao anterior restaurada. Envie a saida."
  }
  /ip dhcp-server lease print detail where comment=$orbitLeaseComment
  /ip service print detail where name="www-ssl"
  /ip firewall mangle print detail where comment~"^ORBIT (speed|Ookla) "
  :put "host coletor reservado em 192.0.2.250. Aguarde a preparacao Linux antes de trocar o cabo."
}
