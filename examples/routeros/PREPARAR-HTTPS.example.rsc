# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# PREPARACAO ORBIT - cria certificados e grupo; nao ativa servicos.
# Executar uma vez pelo terminal WinBox ou /import.
# Se houver erro, pare e envie o erro; nao execute novamente inteiro.
{
  :if ([:len [/certificate find where name~"^orbit-"]] > 0) do={ :error "Certificados orbit- ja existem. Revisar antes de continuar." }
  /certificate add name=orbit-ca-template common-name=ORBIT-Local-CA key-size=2048 days-valid=3650 key-usage=key-cert-sign,crl-sign
  /certificate sign orbit-ca-template name=orbit-ca
  /certificate set [find where name="orbit-ca"] trusted=yes
  /certificate add name=orbit-server-template common-name=192.0.2.1 subject-alt-name=IP:192.0.2.1 key-size=2048 days-valid=365 key-usage=digital-signature,key-encipherment,tls-server
  /certificate sign orbit-server-template ca=orbit-ca name=orbit-server
  /certificate export-certificate [find where name="orbit-ca"] type=pem file-name=orbit-ca
  :if ([:len [/user group find where name="orbit-read"]] = 0) do={ /user group add name=orbit-read policy=read,api,rest-api }
  :if ([:len [/certificate get [find where name="orbit-ca"] fingerprint]] = 0) do={ :error "CA sem fingerprint. Preparacao incompleta." }
  :if ([:len [/certificate get [find where name="orbit-server"] fingerprint]] = 0) do={ :error "Servidor sem fingerprint. Preparacao incompleta." }
  /certificate print detail where name="orbit-ca"
  :put "Preparacao concluida. Baixe somente orbit-ca.crt em Files. Crie orbit-monitor pelo WinBox e siga ATIVACAO.md. HTTPS ainda nao foi ativado."
}
