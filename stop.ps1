$ErrorActionPreference = 'Stop'

Write-Host 'Stopping Distributed Rate Limiting System...' -ForegroundColor Cyan
docker compose down

Write-Host 'Application stopped. Redis data volume was preserved.' -ForegroundColor Green
Write-Host 'Use "docker compose down -v" only when you want to delete Redis data.' -ForegroundColor DarkGray
