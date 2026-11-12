# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# Remove apenas a extensao RTT cruzado; mantem monitoramento e roteamento antigos.
{
  /tool netwatch remove [find where comment~"^ORBIT RTT "]
  /ip firewall mangle remove [find where comment~"^ORBIT RTT "]
  /ip firewall nat remove [find where comment~"^ORBIT RTT "]
  /ip firewall address-list remove [find where list="orbit-rtt-targets"]
  /ip route remove [find where comment~"^ORBIT RTT "]
  /ip address remove [find where comment~"^ORBIT RTT "]
  /routing table remove [find where name="orbit-rtt-wan1"]
  /routing table remove [find where name="orbit-rtt-wan2"]
  :put "Extensao RTT cruzado removida."
}
