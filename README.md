# 🍀 Gerador de Apostas — Mega-Sena

Aplicação web estática para análise estatística e geração inteligente de apostas da Mega-Sena. Funciona inteiramente no navegador, sem servidor ou instalação.

---

## Arquivos

| Arquivo | Descrição |
|---|---|
| `index.html` | Estrutura e layout da aplicação |
| `script.js` | Lógica principal, geração de apostas e relatórios |
| `style.css` | Estilos e identidade visual |
| `ods-parser.js` | Parser de arquivos ODS (histórico de concursos) |

---

## Como usar

1. Abra o arquivo `index.html` em qualquer navegador moderno (Chrome, Edge, Firefox, Safari).
2. Carregue o arquivo `Mega_teste.ods` com o histórico de concursos clicando em **📂 Carregar Mega_teste.ods**.
3. Use as seções de análise para configurar seu grupo de números.
4. Gere as apostas e imprima em PDF.

> Nenhuma conexão com a internet é necessária após o carregamento inicial da página.

---

## Funcionalidades

### Aba Principal

#### 📂 Dados da Mega-Sena
Carrega um arquivo `.ods` com o histórico de concursos. Ao carregar, todas as seções de análise são desbloqueadas automaticamente.

#### 📈 Probabilidades de Acerto
Tabela comparativa de odds para grupos de tamanhos variados (18 a 60 números), com barra visual em escala logarítmica.

#### 📊 Análise Estatística *(requer ODS)*
Conjunto de ferramentas para refinar o grupo de apostas:

- **Pré-grupos automáticos** — extrai os números dos últimos N concursos (5, 6, 7, 8, 9, 10, 11, 12, 13 ou 17) e permite usá-los como grupo com um clique, registrando a origem no relatório PDF.
- **Atraso das dezenas** — lista números com atraso ≥ 20 concursos e exibe ranking completo dos 60 números por atraso. Permite incluir dezenas atrasadas diretamente no grupo.
- **Faixas presentes nos últimos 5 concursos** — detecta faixas (01–09, 10–19 etc.) que apareceram nos 5 concursos consecutivos mais recentes e permite excluí-las do grupo.
- **Faixas repetidas** — monitora faixas amplas com limiares de repetição configurados; emite alerta e botão de exclusão ao atingir o limiar.
- **Repetições sequenciais** — detecta dezenas que se repetiram nos últimos 3 ou 4 concursos consecutivos, com opção de exclusão individual. Inclui botão para excluir as 6 dezenas do último concurso.
- **Repetições nos últimos 10 concursos** — lista dezenas que apareceram 2 ou mais vezes no período, com exclusão individual.

#### 📜 Histórico — Últimos 80 concursos *(requer ODS)*
Tabela com número do concurso, data, dezenas sorteadas e número de concursos retroativos necessários para cobrir quadra, quina e sena a partir do histórico anterior.

#### ⭐ Apostas Pré-definidas
Oito apostas fixas cadastradas para inclusão direta na lista gerada. Apostas pré-definidas são destacadas visualmente (bolas verdes claras `#BED084`) tanto na tela quanto no PDF.

#### 🧮 Calculadora de Probabilidades
Calcula quantas apostas de 6 números um valor total permite e a probabilidade resultante sobre o universo de 60 números.

#### 🔎 Checagem de Apostas *(requer ODS)*
Cola um array de apostas no formato `[[n1,n2,...], ...]` (até 200 jogos, com 6 ou mais dezenas cada) e confronta com as 6 dezenas do **último concurso carregado**. Resultado inline com círculos coloridos:

- ⚪ Círculo branco — número não sorteado
- 🟢 Círculo verde — número acertado
- 🥉 Fundo amarelo — 4 acertos (quadra)
- 🥈 Fundo laranja — 5 acertos (quina)
- 🏆 Fundo verde — 6 acertos (sena)

Botão **🖨️ Imprimir relatório** gera PDF com o concurso de referência, as dezenas sorteadas e cada aposta marcada individualmente.

---

### 🎯 Grupo Final de Apostas (sidebar)
Grade interativa com os 60 números. Clique para adicionar ou remover manualmente. Exibe total de números no grupo e odds para 6 dezenas.

### ⚙️ Configurações das Apostas (sidebar)
- Números por aposta: 6 a 15
- Tipo de geração: com ou sem repetição entre apostas
- Valor individual (opcional, para cálculo de custo)
- Quantidade de apostas: 1 a 100 (limitado pelas combinações disponíveis no grupo)

### 📋 Apostas Geradas (sidebar)
Lista as apostas geradas com botões para excluir individualmente, adicionar uma aposta aleatória extra, limpar tudo ou imprimir em PDF.

O PDF gerado inclui: grupo utilizado, círculos com os números do grupo, probabilidades totais (universo e grupo), filtros e configurações aplicados, e nome de arquivo automático com data e origem do grupo (ex: `Gerador Mega 15-10-2026 - Ult9`).

### 📦 Array Final (sidebar)
Acumulador automático de lotes impressos:

- Alimentado a cada clique em **PDF** em "Apostas Geradas" — independente de o campo ser limpo depois.
- Cada lote exibe seu array individual com rótulo de grupo (ex: `Lote 1 — Ult9`) e botão de exclusão individual.
- O **array totalizador** agrega todos os lotes ativos e se atualiza ao excluir um lote.
- Botão **🗑 Limpar todos** zera lotes e totalizador.
- Botão **🖨️ PDF** gera relatório completo com cada lote separado e o array totalizador ao final — pronto para copiar na Checagem de Apostas.

---

### Aba Outros Jogos
Gerador independente para **Quina**, **Dupla-Sena**, **Lotofácil** e **Milionária**, cada um com:
- Grade de seleção de números (e trevos, no caso da Milionária)
- Configurações de tamanho de aposta e quantidade
- Cálculo de probabilidades em tempo real (universo total e grupo selecionado)
- Geração, listagem e impressão em PDF com nome automático (ex: `Gerador Quina 15-10-2026`)

---

## Formato do arquivo ODS

O arquivo deve ter uma planilha com as seguintes colunas na ordem:

| Coluna | Conteúdo |
|---|---|
| A | Número do concurso (inteiro) |
| B | Data do concurso |
| C–H | As 6 dezenas sorteadas |

A primeira linha é ignorada (cabeçalho). Concursos são ordenados automaticamente por número.

---

## Dependências externas

A aplicação carrega duas bibliotecas via CDN ao abrir `index.html`:

- **[JSZip](https://stuk.github.io/jszip/)** — leitura do arquivo ODS (formato ZIP internamente)
- Nenhuma outra dependência de framework ou biblioteca

---

## Hospedagem

Por ser uma aplicação 100% estática, pode ser hospedada em qualquer serviço de arquivos estáticos:

- **GitHub Pages** — faça upload dos 4 arquivos em um repositório e ative Pages em *Settings → Pages*.
- **Netlify / Vercel** — arraste a pasta para o painel de deploy.
- **Servidor local** — abra `index.html` diretamente no navegador.

Para adicionar proteção por senha sem alterar os arquivos, use **Cloudflare Access** ou **Netlify Identity** na frente do domínio.

---

## Versão atual

**v6** — inclui Array Final com acumulador de lotes e Checagem de Apostas com relatório individual por jogo.
