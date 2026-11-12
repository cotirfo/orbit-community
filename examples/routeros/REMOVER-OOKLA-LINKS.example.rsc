# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# Primeiro selecione ORBIT / HTTP no painel e pare os testes.
# Remove somente regras e listas Ookla; preserva tabelas, rotas e PCC.
/ip firewall mangle remove [find where comment~"^ORBIT Ookla "]
/ip firewall address-list remove [find where list="orbit-ookla-wan1"]
/ip firewall address-list remove [find where list="orbit-ookla-wan2"]
:put "Regras e listas Ookla removidas. Metodo HTTP e PCC preservados."
