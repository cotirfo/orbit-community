# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# ATIVACAO — habilita HTTPS somente para a origem LAN observada.
# 192.0.2.253 e o Huawei: outros clientes atras do NAT compartilham a origem.
# Usar apenas apos preparar certificados, usuario e verificar ATIVACAO.md.
{
  :if ([:len [/certificate find where name="orbit-server"]] = 0) do={ :error "Falta certificado orbit-server." }
  :if ([:len [/user find where name="orbit-monitor"]] = 0) do={ :error "Crie orbit-monitor no grupo orbit-read pelo WinBox primeiro." }
  :if ([/user get [find where name="orbit-monitor"] group] != "orbit-read") do={ :error "orbit-monitor nao pertence ao grupo orbit-read." }
  :if ([/ip service get [find where name="www-ssl"] disabled] = false) do={ :error "www-ssl ja ativo. Revisar estado antes de sobrescrever." }
  /ip service set [find where name="www-ssl"] certificate=orbit-server address=192.0.2.253/32 tls-version=only-1.2 disabled=no
  /ip service print detail where name="www-ssl"
}
