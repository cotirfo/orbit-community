# Autonomia estimada pelo consumo

O modo simples estima a autonomia pelo consumo informado ou observado e pelo banco de baterias do modelo. O exemplo fictício usa 12 V e 10 Ah + 30 Ah, equivalentes a 480 Wh nominais. A lista de cargas é ilustrativa.

## Cálculo e premissas

`autonomia em horas = 480 Wh × aproveitamento global assumido / consumo em W`.

| Cenário | Fator assumido | Energia de referência | Exemplo a 60 W |
| --- | --- | --- | --- |
| Conservador | 50% | 240 Wh | 4h00 |
| Nominal | 70% | 336 Wh | 5h36 |
| Otimista | 85% | 408 Wh | 6h48 |

Os fatores são hipóteses iniciais de simulação, editáveis, e não especificações
de fabricantes ou medições das baterias. Englobam capacidade utilizável e perdas uma
única vez. O modo simples não reaplica eficiência do inversor, saúde individual,
profundidade de descarga ou Peukert como multiplicadores adicionais.

Supõe-se que ambas as baterias estejam inicialmente carregadas. O painel não
mede o estado de carga real, não mostra porcentagem real de bateria e não faz
contagem regressiva. A leitura de entrada AC serve como aproximação do consumo
dos equipamentos; pode incluir carregamento e perdas do nobreak. Essa incerteza
fica explícita no painel e nos detalhes do cálculo.

Uma leitura antiga mantém a estimativa como histórica. Sem consumo válido,
o painel aguarda dados; zero não produz infinito; referência acima de 500 W
indica possível sobrecarga estimada. Não existe teto universal de quatro horas.

## Interface e compatibilidade

O card de autonomia usa a leitura recente automaticamente, sem exigir calibração.
O simulador aceita última leitura, média do período ou potência personalizada.
As premissas globais ficam disponíveis em um detalhe opcional. A simulação elétrica
avançada, com fatores individuais, permanece disponível, mas não bloqueia o padrão.
Preferências existentes de outros painéis e histórico de energia são preservados.

O backend e o navegador compartilham o mesmo cálculo. Configuração opcional:

```json
{
  "estimateMode": "simplified",
  "simplified": {
    "conservativeFraction": 0.5,
    "nominalFraction": 0.7,
    "optimisticFraction": 0.85
  }
}
```

Esse objeto pertence a `energy`. Instalações sem esses campos usam os mesmos
padrões automaticamente. Nenhuma credencial, coleta Tuya, rede, relé, banco de
dados ou formato de persistência precisa mudar.
