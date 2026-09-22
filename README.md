# Visualização Interativa de Dados Educacionais

TCC — Sistemas de Informação
Análise de fatores associados ao desempenho das escolas públicas brasileiras (Ideb), cruzado com infraestrutura (Censo Escolar) e nível socioeconômico (INSE).

## Status atual

- [x] Proposta do TCC definida (`docs/proposta/`)
- [x] Etapa 1 — ETL: integração Censo Escolar 2025 + Ideb 2025 + INSE 2023 (`etl/etl.py`)
- [x] Relatório de estatísticas descritivas da base tratada (`docs/relatorios/`)
- [ ] Etapa 2 — Análise exploratória (SQL/DuckDB ou notebook)
- [ ] Etapa 3 — Carga da base no DuckDB-Wasm (navegador)
- [ ] Etapa 4 — Visualizações interativas em D3.js
- [ ] Etapa 5 — Avaliação com usuários

## Estrutura do repositório

```
├── data/
│   ├── raw/            # dados brutos do Inep (NÃO versionados — ver data/raw/README.md)
│   └── processed/       # saída do ETL, pronta para o DuckDB-Wasm
├── etl/
│   └── etl.py           # pipeline de integração (Python + pandas + openpyxl)
├── docs/
│   ├── proposta/         # proposta original do TCC
│   └── relatorios/       # relatórios de metodologia e estatísticas descritivas
├── notebooks/            # análise exploratória (Etapa 2)
└── app/                  # aplicação web: DuckDB-Wasm + D3.js (Etapas 3 e 4)
    ├── public/            # index.html, CSS, dados estáticos servidos ao navegador
    └── src/               # módulos JS (carga do DuckDB, consultas SQL, componentes D3)
```

## Como rodar o ETL localmente

1. Baixe os arquivos brutos do Inep e coloque em `data/raw/` (ver `data/raw/README.md` para os links exatos).
2. Instale as dependências:
   ```bash
   pip install -r requirements.txt
   ```
3. Rode o script:
   ```bash
   python etl/etl.py
   ```
4. O resultado é gerado em `data/processed/escolas_ideb_infra_2025.csv`.

## Fontes de dados

| Base | Ano | Fonte |
|---|---|---|
| Censo Escolar | 2025 | https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-escolar |
| Ideb | 2025 | https://www.gov.br/inep/pt-br/areas-de-atuacao/pesquisas-estatisticas-e-indicadores/ideb/resultados |
| INSE | 2023 (edição mais recente disponível) | https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/indicadores-educacionais/nivel-socioeconomico |

Detalhes de como cada base foi lida, limpa e integrada estão documentados em `docs/relatorios/` e comentados diretamente no código-fonte de `etl/etl.py`.
