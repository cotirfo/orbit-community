# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# ORBIT Operador de exemplo - instalar uma vez. Mantem rotas, tabelas e PCC existentes.
# Seleciona TCP/UDP 8080 do Huawei aos seis servidores regionais indicados.
# Outros aparelhos Huawei que testarem nesses servidores seguirao a WAN atribuida.
# Pare as medicoes antes de importar. Nao repetir se houver erro.
{
  :if ([:len [/ip firewall mangle find where comment~"^ORBIT Operador de exemplo "]] > 0) do={ :error "Regras ORBIT Operador de exemplo ja existem. Nao repetir." }
  :if ([:len [/ip firewall address-list find where list="orbit-ookla-wan1"]] > 0) do={ :error "Lista WAN1 ja existe. Nao repetir." }
  :if ([:len [/ip firewall address-list find where list="orbit-ookla-wan2"]] > 0) do={ :error "Lista WAN2 ja existe. Nao repetir." }
  :local orbitAnchor [/ip firewall mangle find where comment="PCC WAN1 0"]
  :if ([:len $orbitAnchor] != 1) do={ :error "Ancora PCC nao e unica. Nenhuma alteracao." }
  :if ([:len [/routing table find where name="orbit-speed-wan1"]] != 1) do={ :error "Tabela orbit-speed-wan1 nao encontrada. Nenhuma alteracao." }
  :if ([:len [/ip route find where comment="ORBIT speed WAN1 route"]] != 1) do={ :error "Rota/bloqueio WAN1 nao encontrado. Nenhuma alteracao." }
  :if ([:len [/ip route find where comment="ORBIT speed WAN1 block"]] != 1) do={ :error "Rota/bloqueio WAN1 nao encontrado. Nenhuma alteracao." }
  :if ([:len [/routing table find where name="orbit-speed-wan2"]] != 1) do={ :error "Tabela orbit-speed-wan2 nao encontrada. Nenhuma alteracao." }
  :if ([:len [/ip route find where comment="ORBIT speed WAN2 route"]] != 1) do={ :error "Rota/bloqueio WAN2 nao encontrado. Nenhuma alteracao." }
  :if ([:len [/ip route find where comment="ORBIT speed WAN2 block"]] != 1) do={ :error "Rota/bloqueio WAN2 nao encontrado. Nenhuma alteracao." }
  :do {
    /ip firewall address-list add list=orbit-ookla-wan1 address=ookla-1.example comment="ORBIT Operador de exemplo server 1"
    /ip firewall address-list add list=orbit-ookla-wan1 address=ookla-2.example comment="ORBIT Operador de exemplo server 2"
    /ip firewall address-list add list=orbit-ookla-wan1 address=ookla-3.example comment="ORBIT Operador de exemplo server 3"
    /ip firewall address-list add list=orbit-ookla-wan2 address=ookla-4.example comment="ORBIT Operador de exemplo server 4"
    /ip firewall address-list add list=orbit-ookla-wan2 address=ookla-5.example comment="ORBIT Operador de exemplo server 5"
    /ip firewall address-list add list=orbit-ookla-wan2 address=ookla-6.example comment="ORBIT Operador de exemplo server 6"
    /ip firewall mangle add comment="ORBIT Operador de exemplo WAN1 TCP" chain=prerouting in-interface=bridge src-address=192.0.2.253/32 dst-address-list=orbit-ookla-wan1 protocol=tcp dst-port=8080 connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=orbit-speed-wan1 passthrough=yes disabled=yes place-before=$orbitAnchor
    /ip firewall mangle add comment="ORBIT Operador de exemplo WAN1 UDP" chain=prerouting in-interface=bridge src-address=192.0.2.253/32 dst-address-list=orbit-ookla-wan1 protocol=udp dst-port=8080 connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=orbit-speed-wan1 passthrough=yes disabled=yes place-before=$orbitAnchor
    /ip firewall mangle add comment="ORBIT Operador de exemplo WAN1 routing" chain=prerouting in-interface=bridge src-address=192.0.2.253/32 connection-mark=orbit-speed-wan1 action=mark-routing new-routing-mark=orbit-speed-wan1 passthrough=no disabled=yes place-before=$orbitAnchor
    /ip firewall mangle add comment="ORBIT Operador de exemplo WAN2 TCP" chain=prerouting in-interface=bridge src-address=192.0.2.253/32 dst-address-list=orbit-ookla-wan2 protocol=tcp dst-port=8080 connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=orbit-speed-wan2 passthrough=yes disabled=yes place-before=$orbitAnchor
    /ip firewall mangle add comment="ORBIT Operador de exemplo WAN2 UDP" chain=prerouting in-interface=bridge src-address=192.0.2.253/32 dst-address-list=orbit-ookla-wan2 protocol=udp dst-port=8080 connection-state=new connection-mark=no-mark action=mark-connection new-connection-mark=orbit-speed-wan2 passthrough=yes disabled=yes place-before=$orbitAnchor
    /ip firewall mangle add comment="ORBIT Operador de exemplo WAN2 routing" chain=prerouting in-interface=bridge src-address=192.0.2.253/32 connection-mark=orbit-speed-wan2 action=mark-routing new-routing-mark=orbit-speed-wan2 passthrough=no disabled=yes place-before=$orbitAnchor
    /ip firewall mangle set [find where comment~"^ORBIT Operador de exemplo "] disabled=no
  } on-error={
    /ip firewall mangle remove [find where comment~"^ORBIT Operador de exemplo "]
    /ip firewall address-list remove [find where list="orbit-ookla-wan1"]
    /ip firewall address-list remove [find where list="orbit-ookla-wan2"]
    :error "Falha ao instalar Operador de exemplo. Itens novos removidos; configuracao anterior mantida."
  }
  /ip firewall mangle print detail where comment~"^ORBIT Operador de exemplo "
  /ip firewall address-list print detail where list~"^orbit-ookla-"
  :put "Regras Operador de exemplo instaladas. O ORBIT validara as rotas e a WAN das conexoes."
}
