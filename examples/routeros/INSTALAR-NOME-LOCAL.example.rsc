# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# ORBIT - somente registro DNS local. Nao altera rotas, NAT ou DHCP.
# Nao repetir se o registro ja foi criado no terminal.
{
  :if ([:len [/ip dns static find where name="orbit.example"]] > 0) do={ :error "orbit.example ja existe. Confira o registro antes de continuar." }
  /ip dns static add name=orbit.example type=A address=198.51.100.107 ttl=5m comment="ORBIT painel local"
  /ip dns static print detail where name="orbit.example"
}
