@echo off
setlocal enabledelayedexpansion

:: garante que qualquer saida mostre algo antes de fechar
:: (mesmo que o script quebre cedo)

title Solar Shield - Testes
cd /d "%~dp0"

echo.
echo  ================================================
echo    Solar Shield - Setup, Testes e Git
echo  ================================================
echo.
pause

:: -----------------------------------------------
:: CHECKS
:: -----------------------------------------------

echo.
echo  Verificando pre-requisitos...
echo.

set SKIP_TESTS=
set SKIP_GIT=
set SKIP_GH=

where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Docker nao encontrado.
    echo         Instale: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)
echo  [OK] Docker

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [AVISO] Node.js nao encontrado - testes unitarios serao pulados
    set SKIP_TESTS=1
) else (
    echo  [OK] Node.js
)

where git >nul 2>&1
if %errorlevel% neq 0 (
    echo  [AVISO] Git nao encontrado - etapa de repositorio sera pulada
    set SKIP_GIT=1
) else (
    echo  [OK] Git
)

where gh >nul 2>&1
if %errorlevel% neq 0 (
    echo  [INFO] gh CLI nao encontrado - push automatico indisponivel
    set SKIP_GH=1
) else (
    echo  [OK] GitHub CLI (gh)
)

:: -----------------------------------------------
:: PARTE 1 - DOCKER
:: -----------------------------------------------

echo.
echo  ================================================
echo    PARTE 1 de 6 - Subir infraestrutura Docker
echo  ================================================
echo.
echo  Comando: docker compose up --build -d
echo  (aguarda ~30s para RabbitMQ e Redis subirem)
echo.
pause

docker compose up --build -d
if %errorlevel% neq 0 (
    echo.
    echo  [ERRO] Falha ao subir os containers.
    echo.
    pause
    exit /b 1
)

echo.
echo  Aguardando servicos iniciarem (30s)...
timeout /t 30 /nobreak
echo.
echo  [OK] Containers no ar.
echo.
pause

:: -----------------------------------------------
:: PARTE 2 - HEALTH CHECKS
:: -----------------------------------------------

echo.
echo  ================================================
echo    PARTE 2 de 6 - Health checks
echo  ================================================
echo.
pause

echo.
echo  [Gateway - nginx :80]
curl -s http://localhost/health
echo.

echo.
echo  [Ingestor :3001]
curl -s http://localhost:3001/health
echo.

echo.
echo  [Alert Service :3002]
curl -s http://localhost:3002/health
echo.
pause

:: -----------------------------------------------
:: PARTE 3 - TESTES UNITARIOS
:: -----------------------------------------------

echo.
echo  ================================================
echo    PARTE 3 de 6 - Testes unitarios (RN1 + RN3)
echo  ================================================
echo.

if defined SKIP_TESTS (
    echo  [PULADO] Node.js nao disponivel.
    echo.
    pause
    goto parte4
)

pause

echo.
pushd tests
call npm install --silent
call npm test
popd

echo.
if %errorlevel% neq 0 (
    echo  [AVISO] Algum teste falhou. Ver saida acima.
) else (
    echo  [OK] Todos os testes passaram.
)
echo.
pause

:parte4

:: -----------------------------------------------
:: PARTE 4 - TESTES DE ENDPOINT
:: -----------------------------------------------

echo.
echo  ================================================
echo    PARTE 4 de 6 - Testes de endpoint
echo  ================================================

echo.
echo  --- 4.1  POST /api/ingest/gst  (ingestao NASA) ---
echo.
pause

curl -s -X POST http://localhost/api/ingest/gst
echo.

echo.
echo  Aguardando fila ser processada (4s)...
timeout /t 4 /nobreak

echo.
echo  --- 4.2  GET /api/alerts  (1a chamada - cache MISS esperado) ---
echo.
pause

curl -s http://localhost/api/alerts
echo.

echo.
echo  --- 4.3  GET /api/alerts  (2a chamada - cache HIT esperado) ---
echo.
pause

curl -s http://localhost/api/alerts
echo.

echo.
echo  --- 4.4  POST /api/ingest/gst novamente  (testa idempotencia RN3) ---
echo.
pause

curl -s -X POST http://localhost/api/ingest/gst
echo.

echo.
echo  Aguardando processamento (3s)...
timeout /t 3 /nobreak

echo.
echo  --- 4.5  GET /api/alerts  (deve ter o mesmo total - sem duplicatas) ---
echo.
pause

curl -s http://localhost/api/alerts
echo.
pause

:: -----------------------------------------------
:: PARTE 5 - RATE LIMIT
:: -----------------------------------------------

echo.
echo  ================================================
echo    PARTE 5 de 6 - Teste de rate limiting
echo  ================================================
echo.
echo  Dispara 15 requisicoes seguidas.
echo  O Nginx limita 10 req/s - algumas devem retornar 429.
echo.
pause

echo.
for /l %%i in (1,1,15) do (
    curl -s -o nul -w "  req %%i: HTTP %%{http_code}\n" http://localhost/api/alerts
)
echo.
pause

:: -----------------------------------------------
:: PARTE 6 - GIT E GITHUB
:: -----------------------------------------------

echo.
echo  ================================================
echo    PARTE 6 de 6 - Git e GitHub
echo  ================================================
echo.

if defined SKIP_GIT (
    echo  [PULADO] Git nao disponivel.
    echo.
    pause
    goto fim
)

pause

echo.
if not exist ".git" (
    git init
    git add .
    git commit -m "feat: Solar Shield - microsservicos de monitoramento de clima espacial (FIAP Global Solution 2026.1)"
    echo.
    echo  [OK] Commit inicial criado.
) else (
    echo  [Git] Repositorio ja existe. Verificando alteracoes...
    git add .
    git status
    echo.
    git diff --cached --quiet
    if !errorlevel! neq 0 (
        git commit -m "chore: atualizacao"
        echo  [OK] Novo commit criado.
    ) else (
        echo  [OK] Nada novo para commitar.
    )
)

echo.

if defined SKIP_GH (
    echo  Para publicar no GitHub:
    echo.
    echo    1. Acesse https://github.com/new  crie o repo "solar-shield"
    echo    2. Copie a URL e rode:
    echo.
    echo       git remote add origin ^<url^>
    echo       git branch -M main
    echo       git push -u origin main
    echo.
    pause
    goto fim
)

echo.
echo  Proximo passo: criar repo no GitHub e fazer push.
echo.
pause

gh repo create solar-shield --public --source=. --remote=origin --push
if %errorlevel% equ 0 (
    echo.
    echo  [OK] Publicado no GitHub!
    gh repo view --web
) else (
    echo.
    echo  [ERRO] Falha. Se nao estiver logado, rode: gh auth login
)

echo.
pause

:fim

echo.
echo  ================================================
echo    Concluido!
echo  ================================================
echo.
echo    POST  http://localhost/api/ingest/gst
echo    GET   http://localhost/api/alerts
echo    GET   http://localhost/health
echo    RabbitMQ UI: http://localhost:15672  (guest/guest)
echo.
echo    Para parar:  docker compose down
echo.
pause
