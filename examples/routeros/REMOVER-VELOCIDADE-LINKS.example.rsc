# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# Remove somente os itens criados por ORBIT-VELOCIDADE-LINKS.rsc.
# Pare os testes no painel antes de importar este arquivo.
/ip firewall mangle remove [find where comment~"^ORBIT speed "]
/ip firewall mangle remove [find where comment~"^ORBIT Ookla "]
/ip firewall address-list remove [find where list="orbit-ookla-wan1"]
/ip firewall address-list remove [find where list="orbit-ookla-wan2"]
/ip route remove [find where comment~"^ORBIT speed "]
/routing table remove [find where name="orbit-speed-wan1"]
/routing table remove [find where name="orbit-speed-wan2"]
/ip firewall address-list remove [find where list="orbit-speed-servers"]
:put "Regras e tabelas ORBIT speed removidas. PCC original preservado."
