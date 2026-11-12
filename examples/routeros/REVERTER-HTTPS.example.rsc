# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# Desativa o HTTPS e a conta ORBIT, sem apagar certificados nem historico.
# Restaura www-ssl ao estado desabilitado informado antes da integracao.
# Executar somente se o certificado do servico ainda for orbit-server.
{
  :if ([/ip service get [find where name="www-ssl"] certificate] != "orbit-server") do={ :error "Servico nao usa orbit-server; nao alterar automaticamente." }
  /ip service set [find where name="www-ssl"] disabled=yes certificate=none address="" tls-version=any
  :if ([:len [/user find where name="orbit-monitor"]] > 0) do={ /user disable [find where name="orbit-monitor"] }
  :put "HTTPS desativado e conta ORBIT desabilitada. Certificados e grupo preservados."
}
