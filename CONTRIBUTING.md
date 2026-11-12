# Como contribuir

Abra uma issue para descrever a mudança proposta ou o comportamento observado. Para vulnerabilidades, use o canal indicado em [SECURITY.md](SECURITY.md). Inclua a versão, o sistema operacional, as integrações envolvidas e uma configuração mínima com dados fictícios.

## Ambiente de desenvolvimento

Use uma versão Node.js LTS mantida. A partir da raiz do projeto:

```sh
npm ci --ignore-scripts
npm --prefix tools/browser-build ci --ignore-scripts
npm run check
npm run build
npm test
```

Em Linux, use `ORBIT_TEST_PYTHON=python3 npm test` para incluir o contrato do worker Python quando o interpretador estiver disponível. Registre os testes pulados e as limitações do ambiente.

## Envio de alterações

- Edite os módulos-fonte e o CSS em `public/`. Os bundles são gerados pelo build.
- Preserve os contratos de status, histórico, SSE e controle administrativo quando possível. Explique mudanças de formato e como atualizar ou reverter.
- Use fixtures sintéticas para testar falhas, timeouts e integrações desativadas. Evite dependências de equipamentos ou serviços particulares para reproduzir o problema.
- Exclua credenciais, configurações reais, capturas, logs, bancos e dados do host de commits e anexos. Preserve os avisos de terceiros e revise os lockfiles quando atualizar dependências.
- No pull request, descreva o comportamento alterado, a forma de validação e qualquer impacto na instalação ou na recuperação.
