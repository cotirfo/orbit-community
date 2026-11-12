# Certificados locais

Guarde fora do repositório os certificados e as chaves da sua instalação. Use `caFile` e `caFingerprint` para verificar o RouterOS, e `huawei.certificateFingerprint` para o pin SHA-256 do equipamento Huawei em HTTPS. Confira os fingerprints por um canal confiável.

Para o monitor HTTPS, aponte `monitorHttps.keyFile` e `monitorHttps.certFile` para os arquivos da instalação. Uma CA pública opcional pode ser fornecida em `monitorHttps.caFile`. Veja o [guia de configuração](../docs/CONFIGURACAO.md).
