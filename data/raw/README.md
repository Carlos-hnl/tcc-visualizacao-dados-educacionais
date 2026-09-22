# Dados brutos (não versionados)

Esta pasta é ignorada pelo Git (ver `.gitignore` na raiz) porque os arquivos são grandes
(a Tabela_Escola sozinha passa de 140 MB) e são dados públicos — não há necessidade de
duplicá-los no repositório.

Baixe os arquivos abaixo e extraia aqui antes de rodar `etl/etl.py`:

| Arquivo esperado | Onde baixar |
|---|---|
| `Tabela_Escola_2025_V2.csv` | Microdados do Censo Escolar 2025 |
| `Tabela_Matricula_2025_V2.csv` | Microdados do Censo Escolar 2025 |
| `divulgacao_anos_iniciais_escolas_2025/divulgacao_anos_iniciais_escolas_2025.xlsx` | Resultados do Ideb 2025 (Anos Iniciais) |
| `divulgacao_anos_finais_escolas_2025/divulgacao_anos_finais_escolas_2025.xlsx` | Resultados do Ideb 2025 (Anos Finais) |
| `divulgacao_ensino_medio_escolas_2025/divulgacao_ensino_medio_escolas_2025.xlsx` | Resultados do Ideb 2025 (Ensino Médio) |
| `INSE_2023_escolas_INSE_ESC_2023.csv` | Indicador de Nível Socioeconômico 2023 |

Links oficiais:
- Censo Escolar: https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-escolar
- Ideb: https://www.gov.br/inep/pt-br/areas-de-atuacao/pesquisas-estatisticas-e-indicadores/ideb/resultados
- INSE: https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/indicadores-educacionais/nivel-socioeconomico

Os `.zip` do Ideb trazem os `.xlsx` dentro de uma subpasta com o mesmo nome do arquivo —
mantenha essa estrutura (ou ajuste os caminhos em `IDEB_FILES` no topo de `etl/etl.py`).
